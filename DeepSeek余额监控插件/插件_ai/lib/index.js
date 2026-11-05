/**
 * ds余额 — DeepSeek API 余额监控（宿主半侧）
 *
 * 职责：
 *  - 从 DSH 凭据存储读取 DEEPSEEK_API_KEY（绝不把密钥发送到浏览器）。
 *  - 定时调用 https://api.deepseek.com/user/balance，并把每次余额变化写入本地 JSON。
 *  - 通过 /ds-balance/api/* 与 /ds-balance/events 提供给客户端半侧。
 *
 * 数据默认放在 $DSH_HOME/storages/ds-balance/history.json；可用 DS_BALANCE_DATA_DIR 覆盖。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PLUGIN_ID = 'dsh-ds-balance-ai'
const API_VERSION = 3
const STATE_ENDPOINT = '/ds-balance/api/state'
const REFRESH_ENDPOINT = '/ds-balance/api/refresh'
const EXPORT_ENDPOINT = '/ds-balance/api/history.csv'
const EVENTS_ENDPOINT = '/ds-balance/events'
const BALANCE_PATH = '/user/balance'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.resolve(process.env.DS_BALANCE_DATA_DIR || path.join(DSH_HOME, 'storages', 'ds-balance'))
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')
const API_BASE = String(process.env.DS_BALANCE_API_BASE || 'https://api.deepseek.com').replace(/\/+$/, '')
const PREFERRED_CURRENCY = String(process.env.DS_BALANCE_CURRENCY || 'CNY').toUpperCase()
const POLL_INTERVAL_MS = clampNumber(Number(process.env.DS_BALANCE_POLL_MS), 10_000, 300_000, 20_000)
const REQUEST_TIMEOUT_MS = clampNumber(Number(process.env.DS_BALANCE_TIMEOUT_MS), 3_000, 60_000, 12_000)
const MAX_CHANGES = 5000
const MAX_SERIES = 3000
const SAVE_IDLE_MS = 5 * 60_000
const ATTRIBUTION_GRACE_MS = 5 * 60_000
const MAX_CONVERSATIONS = 40

/** 北京时间高峰时段（官方 2026-08 价格页）：工作日 09:00–12:00、14:00–18:00。 */
const PEAK_WINDOWS = [
  [9 * 60, 12 * 60],
  [14 * 60, 18 * 60],
]

/**
 * 2026 年中国法定节假日（国办发明电〔2025〕7 号）。
 * 官方计费规则：周末与法定节假日全天为“空闲时段”，调休上班日不影响周末属性。
 * 2027 年及以后未内置的年份只按周末判断；可以在 DS_BALANCE_HOLIDAYS 里补充。
 */
const HOLIDAY_RANGES_2026 = [
  ['2026-01-01', '2026-01-03', '元旦'],
  ['2026-02-15', '2026-02-23', '春节'],
  ['2026-04-04', '2026-04-06', '清明节'],
  ['2026-05-01', '2026-05-05', '劳动节'],
  ['2026-06-19', '2026-06-21', '端午节'],
  ['2026-09-25', '2026-09-27', '中秋节'],
  ['2026-10-01', '2026-10-07', '国庆节'],
]

const HOLIDAYS = new Map()
for (const [start, end, name] of HOLIDAY_RANGES_2026) {
  for (const dateKey of datesBetween(start, end)) HOLIDAYS.set(dateKey, name)
}
for (const entry of String(process.env.DS_BALANCE_HOLIDAYS || '').split(',')) {
  const [dateKey, name] = entry.trim().split(':')
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) HOLIDAYS.set(dateKey, name || '自定义节假日')
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const BEIJING_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export const name = 'ds-balance'
export const inject = ['credentials']

/**
 * Cordis 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const monitor = createMonitor(ctx)

  // 对话归属是可选增强：即使某个 profile 没有这些服务，余额监控仍然可用。
  ctx.inject(['sessions', 'sessionTitle', 'agents'], (scope) => {
    const tracker = createSessionTracker(scope)
    monitor.attachTracker(tracker)
    scope.effect(() => tracker.start(), 'ds-balance: turn attribution')
  })

  ctx.effect(() => {
    void monitor.start()
    return () => monitor.stop()
  }, 'ds-balance: polling')

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const disposers = [
        scope.webServer.register({ kind: 'exact', path: STATE_ENDPOINT, handler: (req, res) => handleState(monitor, req, res) }),
        scope.webServer.register({ kind: 'exact', path: REFRESH_ENDPOINT, handler: (req, res) => handleRefresh(monitor, req, res) }),
        scope.webServer.register({ kind: 'exact', path: EXPORT_ENDPOINT, handler: (req, res) => handleExport(monitor, req, res) }),
        scope.webServer.register({ kind: 'exact', path: EVENTS_ENDPOINT, handler: (req, res) => handleEvents(monitor, req, res) }),
      ]
      return () => {
        for (const dispose of disposers) dispose()
        monitor.closeEvents()
      }
    }, 'ds-balance: HTTP routes')
  })
}

/**
 * 从 session/event 的 turn/start、turn/end 跟踪“哪个对话正在跑”。
 * 事件是主路径；5 秒一次的 root agent 对账用于兜底（插件中途加载、漏事件）。
 */
function createSessionTracker(scope) {
  const active = new Map()
  const titles = new Map()
  const pendingMessages = new Map()
  let lastActive = null
  let interval = null
  let started = false

  return { start, stop, attribute, snapshot, titleFor }

  function start() {
    if (started) return () => {}
    started = true
    seed()
    const off = scope.on('session/event', onSessionEvent)
    interval = setInterval(reconcile, 5_000)
    interval.unref?.()
    return () => {
      started = false
      off?.()
      if (interval) clearInterval(interval)
      interval = null
      active.clear()
      pendingMessages.clear()
    }
  }

  function stop() {
    started = false
    if (interval) clearInterval(interval)
    interval = null
    active.clear()
    pendingMessages.clear()
  }

  function seed() {
    try {
      for (const session of scope.sessions.list()) updateTitle(session)
    } catch {
      // 标题服务暂时不可用时，后续 session/title 事件会补上。
    }
    try {
      for (const agent of scope.agents.roots()) {
        if (agent?.status !== 'running') continue
        const session = agent.session
        if (!session?.id) continue
        updateTitle(session)
        const startedAt = Date.now()
        active.set(session.id, {
          id: session.id,
          title: titles.get(session.id) ?? null,
          startedAt,
          turn: makeTurn(session.id, null, startedAt),
        })
      }
    } catch {
      // 没有 root agent 时只依赖 turn 事件。
    }
  }

  function onSessionEvent(session, event) {
    const id = session?.id
    if (!id || !event || typeof event.type !== 'string') return
    if (event.type === 'session/title') {
      const title = event.data?.title
      if (typeof title === 'string' && title.trim()) titles.set(id, title.trim())
      return
    }
    if (event.type === 'user/message') {
      if (event.data?.source?.kind !== 'user') return
      addUserMessage(id, extractUserText(event.data))
      return
    }
    if (event.type === 'turn/start') {
      if (!isRootSession(id)) return
      updateTitle(session)
      const startedAt = Date.now()
      const pending = pendingMessages.get(id) ?? []
      pendingMessages.delete(id)
      const previous = active.get(id)
      const resumed = previous?.turn?.turnNumber == null ? previous : null
      active.set(id, {
        id,
        title: titles.get(id) ?? null,
        startedAt: resumed?.startedAt ?? startedAt,
        turn: makeTurn(id, event.data?.turn, resumed?.startedAt ?? startedAt, [
          ...(resumed?.turn?.messages ?? []),
          ...pending,
        ]),
      })
      return
    }
    if (event.type === 'turn/end') {
      const record = active.get(id)
      if (!record) return
      updateTitle(session)
      record.turn.endedAt = Date.now()
      if (!Number.isInteger(record.turn.turnNumber) && Number.isInteger(event.data?.turn)) {
        record.turn.turnNumber = event.data.turn
        record.turn.turnId = `${id}#${event.data.turn}`
      }
      active.delete(id)
      lastActive = { id, at: record.turn.endedAt, turn: record.turn }
      return
    }
    if (event.type === 'session/disposed') {
      const record = active.get(id)
      if (!record) return
      record.turn.endedAt = Date.now()
      active.delete(id)
      lastActive = { id, at: record.turn.endedAt, turn: record.turn }
    }
  }

  function reconcile() {
    const running = new Map()
    try {
      for (const agent of scope.agents.roots()) {
        if (agent?.status !== 'running') continue
        const id = agent.session?.id
        if (!id) continue
        running.set(id, agent.session)
      }
    } catch {
      return
    }
    for (const [id, session] of running) {
      if (active.has(id)) continue
      updateTitle(session)
      const startedAt = Date.now()
      const pending = pendingMessages.get(id) ?? []
      pendingMessages.delete(id)
      active.set(id, {
        id,
        title: titles.get(id) ?? null,
        startedAt,
        turn: makeTurn(id, null, startedAt, pending),
      })
    }
    for (const id of [...active.keys()]) {
      if (running.has(id)) continue
      const record = active.get(id)
      record.turn.endedAt = Date.now()
      active.delete(id)
      lastActive = { id, at: record.turn.endedAt, turn: record.turn }
    }
  }

  function isRootSession(id) {
    try {
      const roots = scope.agents.roots()
      if (roots.length === 0) return true
      return roots.some((agent) => (agent.session?.id ?? agent.id) === id)
    } catch {
      return true
    }
  }

  function updateTitle(session) {
    if (!session?.id) return
    try {
      const snapshot = scope.sessionTitle.get(session)
      if (typeof snapshot?.title === 'string' && snapshot.title.trim()) {
        titles.set(session.id, snapshot.title.trim())
      }
    } catch {
      // 标题还没生成或 session 已释放；不是错误。
    }
  }

  function titleFor(id) {
    return id ? titles.get(id) ?? null : null
  }

  function makeTurn(sessionId, turnNumber, startedAt, messages = []) {
    return {
      turnId: `${sessionId}#${turnNumber ?? startedAt}`,
      turnNumber: Number.isInteger(turnNumber) ? turnNumber : null,
      startedAt,
      endedAt: null,
      messages: [...messages].slice(-10),
    }
  }

  function addUserMessage(sessionId, text) {
    const value = String(text ?? '').trim()
    if (!value) return
    const activeRecord = active.get(sessionId)
    if (activeRecord?.turn) {
      activeRecord.turn.messages.push(value.slice(0, 500))
      if (activeRecord.turn.messages.length > 10) activeRecord.turn.messages = activeRecord.turn.messages.slice(-10)
      return
    }
    const pending = pendingMessages.get(sessionId) ?? []
    pending.push(value.slice(0, 500))
    pendingMessages.set(sessionId, pending.slice(-10))
  }

  function extractUserText(data) {
    const content = Array.isArray(data?.content) ? data.content : []
    const parts = []
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
      else if (part?.type === 'image') parts.push('[图片]')
    }
    return parts.join('\n').trim().slice(0, 500)
  }

  function turnAttribution(turn) {
    if (!turn) {
      return {
        turnId: null,
        turnNumber: null,
        turnText: null,
        turnMessages: [],
        turnStartedAt: null,
        turnEndedAt: null,
      }
    }
    return {
      turnId: turn.turnId,
      turnNumber: turn.turnNumber,
      turnText: turn.messages.length > 0 ? turn.messages.join(' / ').slice(0, 500) : null,
      turnMessages: [...turn.messages],
      turnStartedAt: turn.startedAt ? new Date(turn.startedAt).toISOString() : null,
      turnEndedAt: turn.endedAt ? new Date(turn.endedAt).toISOString() : null,
    }
  }

  function attribute(now = Date.now()) {
    const running = [...active.values()]
    if (running.length === 1) {
      return {
        sessionId: running[0].id,
        sessionTitle: titleFor(running[0].id) ?? running[0].title ?? null,
        attribution: 'active',
        ...turnAttribution(running[0].turn),
      }
    }
    if (running.length > 1) {
      return {
        sessionId: null,
        sessionTitle: null,
        attribution: 'parallel',
        sessionIds: running.map((entry) => entry.id),
        sessionTitles: running.map((entry) => titleFor(entry.id) ?? entry.title ?? null),
      }
    }
    if (lastActive && now - lastActive.at <= ATTRIBUTION_GRACE_MS) {
      return {
        sessionId: lastActive.id,
        sessionTitle: titleFor(lastActive.id),
        attribution: 'recent',
        ...turnAttribution(lastActive.turn),
      }
    }
    return { sessionId: null, sessionTitle: null, attribution: 'unattributed' }
  }

  function snapshot() {
    return {
      activeIds: [...active.keys()],
      activeTurnIds: [...active.values()].map((entry) => entry.turn?.turnId).filter(Boolean),
      titles: Object.fromEntries(titles),
      lastActiveAt: lastActive?.at ?? null,
    }
  }
}

function createMonitor(ctx) {
  let loaded = false
  let loading = null
  let stopped = false
  let timer = null
  let saveTimer = null
  let inFlight = null
  let abortController = null
  let lastSavedAt = 0
  let lastManualRefreshAt = 0
  let nextPollAt = null
  let keySource = 'unknown'
  let latencyMs = null
  let lastAttemptAt = null
  let lastSuccessAt = null
  let lastError = null
  let consecutiveFailures = 0
  let current = null
  let previous = null
  let firstSeenAt = null
  let changes = []
  let series = []
  let tracker = null
  const eventClients = new Map()

  return {
    start,
    stop,
    ensureLoaded,
    refresh,
    publicState,
    attachTracker,
    getSnapshot: () => ({ current, changes, series }),
    csv,
    addEventClient,
    removeEventClient,
    closeEvents,
    get lastManualRefreshAt() {
      return lastManualRefreshAt
    },
    set lastManualRefreshAt(value) {
      lastManualRefreshAt = value
    },
  }

  function attachTracker(nextTracker) {
    tracker = nextTracker
  }

  async function ensureLoaded() {
    if (loaded) return
    if (!loading) loading = load()
    await loading
  }

  async function load() {
    try {
      const raw = await readFile(HISTORY_FILE, 'utf8')
      const doc = JSON.parse(raw)
      current = normalizeStoredCurrent(doc.current)
      previous = normalizeStoredCurrent(doc.previous)
      firstSeenAt = typeof doc.firstSeenAt === 'string' ? doc.firstSeenAt : null
      lastSuccessAt = typeof doc.lastSuccessAt === 'string' ? doc.lastSuccessAt : null
      lastAttemptAt = typeof doc.lastAttemptAt === 'string' ? doc.lastAttemptAt : null
      lastError = doc.lastError && typeof doc.lastError === 'object' ? doc.lastError : null
      consecutiveFailures = Number.isFinite(doc.consecutiveFailures) ? doc.consecutiveFailures : 0
      changes = Array.isArray(doc.changes) ? doc.changes.filter(isChange).map(normalizeChange).slice(-MAX_CHANGES) : []
      series = Array.isArray(doc.series) ? doc.series.filter(isSeriesPoint).slice(-MAX_SERIES) : []
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn(`[ds-balance] 读取历史失败，将从空记录开始：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      loaded = true
    }
  }

  async function start() {
    await ensureLoaded()
    if (stopped) return
    await refresh('startup')
    scheduleNext()
  }

  function stop() {
    stopped = true
    if (timer) clearTimeout(timer)
    if (saveTimer) clearTimeout(saveTimer)
    timer = null
    saveTimer = null
    abortController?.abort()
    abortController = null
    closeEvents()
  }

  function scheduleNext() {
    if (stopped) return
    if (timer) clearTimeout(timer)
    nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString()
    timer = setTimeout(async () => {
      await refresh('poll')
      scheduleNext()
    }, POLL_INTERVAL_MS)
    timer.unref?.()
  }

  async function refresh(trigger = 'poll') {
    if (stopped) return publicState()
    if (inFlight) return inFlight

    const request = (async () => {
      await ensureLoaded()
      lastAttemptAt = new Date().toISOString()
      abortController = new AbortController()
      const timeout = setTimeout(() => abortController?.abort(), REQUEST_TIMEOUT_MS)
      try {
        const apiKey = await resolveApiKey()
        if (!apiKey) {
          throw monitorError('NO_API_KEY', '没有找到 DEEPSEEK_API_KEY。请在 DSH 的模型设置里保存 DeepSeek API Key，或设置同名环境变量后重启。')
        }
        const startedAt = performance.now()
        const response = await fetch(`${API_BASE}${BALANCE_PATH}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          signal: abortController.signal,
        })
        const text = await response.text()
        latencyMs = Math.round(performance.now() - startedAt)

        if (!response.ok) {
          const detail = safeSnippet(text)
          const code = response.status === 401 || response.status === 403 ? 'API_KEY_INVALID' : `HTTP_${response.status}`
          throw monitorError(code, `余额接口返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`)
        }

        let payload
        try {
          payload = JSON.parse(text)
        } catch {
          throw monitorError('BAD_RESPONSE', `余额接口返回的不是有效 JSON：${safeSnippet(text)}`)
        }
        recordSuccess(payload, trigger)
      } catch (error) {
        recordFailure(error)
      } finally {
        clearTimeout(timeout)
        abortController = null
      }
      broadcast()
      await maybeSave(true)
      return publicState()
    })()

    inFlight = request
    try {
      return await request
    } finally {
      if (inFlight === request) inFlight = null
    }
  }

  async function resolveApiKey() {
    let resolved
    try {
      resolved = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
    } catch {
      resolved = undefined
    }
    const value = String(resolved?.value ?? process.env.DEEPSEEK_API_KEY ?? '').trim()
    keySource = value ? String(resolved?.source ?? (process.env.DEEPSEEK_API_KEY ? 'environment' : 'unknown')) : 'missing'
    return value
  }

  function recordSuccess(payload, trigger) {
    const wallets = normalizeWallets(payload)
    if (wallets.length === 0) {
      throw monitorError('BAD_RESPONSE', '余额接口没有返回 balance_infos，无法读取余额。')
    }
    const observedAt = new Date().toISOString()
    const next = {
      available: payload?.is_available !== false,
      wallets,
      fingerprint: fingerprint(wallets),
      observedAt,
    }
    const before = current
    if (!before) {
      firstSeenAt = observedAt
    } else if (before.fingerprint !== next.fingerprint) {
      previous = before
      const attribution = tracker?.attribute(Date.now()) ?? { sessionId: null, sessionTitle: null, attribution: 'unattributed' }
      changes.push(...diffWallets(before.wallets, wallets, observedAt, trigger, attribution))
      if (changes.length > MAX_CHANGES) changes = changes.slice(-MAX_CHANGES)
    }
    current = next
    lastSuccessAt = observedAt
    lastError = null
    consecutiveFailures = 0
    maybeAppendSeries(wallets, observedAt, before?.fingerprint !== next.fingerprint)
  }

  function recordFailure(error) {
    const normalized = error && typeof error === 'object'
      ? {
          code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
          message: String(error.message || error),
          at: new Date().toISOString(),
        }
      : { code: 'UNKNOWN', message: String(error), at: new Date().toISOString() }
    normalized.message = safeSnippet(normalized.message)
    lastError = normalized
    consecutiveFailures += 1
  }

  function maybeAppendSeries(wallets, observedAt, changed) {
    const primary = pickPrimary(wallets)
    if (!primary) return
    const last = series[series.length - 1]
    const point = { t: observedAt, c: primary.currency, v: primary.totalCents }
    const stale = !last || Date.now() - Date.parse(last.t) > 10 * 60_000
    if (changed || stale || last.c !== point.c || last.v !== point.v) {
      series.push(point)
      if (series.length > MAX_SERIES) series = series.slice(-MAX_SERIES)
    }
  }

  async function maybeSave(force) {
    const now = Date.now()
    if (!force && now - lastSavedAt < SAVE_IDLE_MS) return
    if (!force && !changes.length) return
    if (saveTimer) return
    saveTimer = setTimeout(async () => {
      saveTimer = null
      await writeHistory()
    }, force ? 50 : 500)
    saveTimer.unref?.()
  }

  async function writeHistory() {
    lastSavedAt = Date.now()
    const doc = {
      version: API_VERSION,
      plugin: PLUGIN_ID,
      updatedAt: new Date().toISOString(),
      firstSeenAt,
      lastSuccessAt,
      lastAttemptAt,
      lastError,
      consecutiveFailures,
      current,
      previous,
      changes,
      series,
    }
    try {
      await mkdir(DATA_DIR, { recursive: true })
      const temporary = `${HISTORY_FILE}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
      await rename(temporary, HISTORY_FILE)
    } catch (error) {
      console.warn(`[ds-balance] 保存历史失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function publicState() {
    const now = Date.now()
    const primary = pickPrimary(current?.wallets ?? [])
    const summary = summarize(changes, primary?.currency, now)
    const trackerSnapshot = tracker?.snapshot() ?? { activeIds: [], titles: {}, lastActiveAt: null }
    const conversationView = buildConversations(changes, trackerSnapshot, now, primary?.currency)
    const status = !current ? (lastError ? 'error' : 'loading') : (lastError ? 'stale' : 'ok')
    return {
      ok: status !== 'error',
      version: API_VERSION,
      plugin: PLUGIN_ID,
      status,
      now: new Date(now).toISOString(),
      timeZone: 'Asia/Shanghai',
      phase: phaseInfo(now),
      available: current?.available ?? null,
      primary: primary ? {
        currency: primary.currency,
        total: primary.total,
        granted: primary.granted,
        toppedUp: primary.toppedUp,
        totalCents: primary.totalCents,
        grantedCents: primary.grantedCents,
        toppedUpCents: primary.toppedUpCents,
      } : null,
      wallets: (current?.wallets ?? []).map((wallet) => ({ ...wallet })),
      lastSuccessAt,
      lastAttemptAt,
      firstSeenAt,
      latencyMs,
      keySource,
      pollIntervalMs: POLL_INTERVAL_MS,
      nextPollAt,
      refreshing: Boolean(inFlight),
      consecutiveFailures,
      error: lastError,
      stats: summary,
      activeSessionId: trackerSnapshot.activeIds.length === 1 ? trackerSnapshot.activeIds[0] : null,
      conversations: conversationView.groups,
      conversationCount: conversationView.count,
      attributionRule: '余额变化归到变化发生时正在运行的对话；多个根对话同时运行记为并行，刚结束的对话保留 5 分钟归属窗口。',
      changes: changes.slice(-60).reverse().map((change) => ({ ...change })),
      series: series
        .filter((point) => !primary || point.c === primary.currency)
        .slice(-1500)
        .map((point) => ({ ...point })),
      source: {
        provider: 'DeepSeek API',
        endpoint: `${API_BASE}${BALANCE_PATH}`,
        pricingPage: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
        historyFile: HISTORY_FILE,
      },
    }
  }

  function csv() {
    const header = ['时间(北京时间)', '币种', '变动', '变动前', '变动后', '类型', '对话ID', '对话标题', '归属方式', '轮次', '用户消息']
    const rows = changes.map((change) => [
      formatBeijingDateTime(change.at),
      change.currency,
      formatCents(change.deltaCents),
      change.before,
      change.after,
      change.kind,
      change.sessionId ?? (change.sessionIds?.length ? change.sessionIds.join('|') : ''),
      change.sessionTitle ?? (change.sessionTitles?.filter(Boolean).join(' | ') ?? ''),
      change.attribution,
      change.turnNumber ?? '',
      change.turnText ?? (change.turnMessages?.join(' | ') ?? ''),
    ])
    return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
  }

  function addEventClient(req, res) {
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        // 连接已经断开时由 close 事件清理。
      }
    }, 20_000)
    heartbeat.unref?.()
    eventClients.set(res, heartbeat)
    res.on('close', () => {
      clearInterval(heartbeat)
      eventClients.delete(res)
    })
  }

  function removeEventClient(res) {
    const heartbeat = eventClients.get(res)
    if (heartbeat) clearInterval(heartbeat)
    eventClients.delete(res)
  }

  function closeEvents() {
    for (const [res, heartbeat] of eventClients) {
      clearInterval(heartbeat)
      try {
        res.end()
      } catch {
        // 已断开的连接无需再处理。
      }
    }
    eventClients.clear()
  }

  function broadcast() {
    if (eventClients.size === 0) return
    let payload
    try {
      payload = `data: ${JSON.stringify({ type: 'state', state: publicState() })}\n\n`
    } catch {
      return
    }
    for (const res of eventClients.keys()) {
      try {
        res.write(payload)
      } catch {
        removeEventClient(res)
      }
    }
  }

}

async function handleState(monitor, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
  await monitor.ensureLoaded()
  sendJson(res, 200, monitor.publicState(), req.method === 'HEAD')
}

async function handleRefresh(monitor, req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: '只接受同源刷新请求。' } })
  const now = Date.now()
  if (now - monitor.lastManualRefreshAt < 1500) {
    await monitor.ensureLoaded()
    return sendJson(res, 200, monitor.publicState())
  }
  monitor.lastManualRefreshAt = now
  await monitor.refresh('manual')
  sendJson(res, 200, monitor.publicState())
}

async function handleExport(monitor, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
  await monitor.ensureLoaded()
  const body = monitor.csv()
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="ds-balance-history.csv"',
    'content-length': Buffer.byteLength(body),
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

async function handleEvents(monitor, req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET')
  await monitor.ensureLoaded()
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 5000\n\n')
  res.write(`data: ${JSON.stringify({ type: 'state', state: monitor.publicState() })}\n\n`)
  monitor.addEventClient(req, res)
}

function isChange(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.at === 'string'
    && typeof value.currency === 'string'
    && Number.isFinite(value.deltaCents)
}

function normalizeChange(value) {
  const sessionId = typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : null
  const attribution = typeof value.attribution === 'string'
    ? value.attribution
    : sessionId ? 'active' : 'legacy'
  return {
    ...value,
    sessionId,
    sessionTitle: typeof value.sessionTitle === 'string' && value.sessionTitle ? value.sessionTitle : null,
    sessionIds: Array.isArray(value.sessionIds) ? value.sessionIds.filter((id) => typeof id === 'string') : [],
    sessionTitles: Array.isArray(value.sessionTitles) ? value.sessionTitles.filter((title) => typeof title === 'string') : [],
    attribution,
    turnId: typeof value.turnId === 'string' && value.turnId ? value.turnId : null,
    turnNumber: Number.isInteger(value.turnNumber) ? value.turnNumber : null,
    turnText: typeof value.turnText === 'string' && value.turnText ? value.turnText : null,
    turnMessages: Array.isArray(value.turnMessages) ? value.turnMessages.filter((text) => typeof text === 'string') : [],
    turnStartedAt: typeof value.turnStartedAt === 'string' ? value.turnStartedAt : null,
    turnEndedAt: typeof value.turnEndedAt === 'string' ? value.turnEndedAt : null,
  }
}

function isSeriesPoint(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.t === 'string'
    && typeof value.c === 'string'
    && Number.isFinite(value.v)
}

function normalizeStoredCurrent(value) {
  if (!value || !Array.isArray(value.wallets)) return null
  const wallets = value.wallets.filter(isWallet).map((wallet) => ({ ...wallet }))
  return {
    available: value.available !== false,
    wallets,
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : fingerprint(wallets),
    observedAt: typeof value.observedAt === 'string' ? value.observedAt : null,
  }
}

function normalizeWallets(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  return infos
    .map((info) => {
      const currency = String(info?.currency || '').toUpperCase()
      const total = normalizeAmount(info?.total_balance)
      const granted = normalizeAmount(info?.granted_balance ?? '0.00')
      const toppedUp = normalizeAmount(info?.topped_up_balance ?? '0.00')
      return {
        currency,
        total,
        granted,
        toppedUp,
        totalCents: parseCents(total),
        grantedCents: parseCents(granted),
        toppedUpCents: parseCents(toppedUp),
      }
    })
    .filter(isWallet)
    .sort((left, right) => currencyRank(left.currency) - currencyRank(right.currency) || left.currency.localeCompare(right.currency))
}

function isWallet(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.currency === 'string'
    && value.currency.length > 0
    && typeof value.total === 'string'
    && Number.isFinite(value.totalCents)
}

function diffWallets(beforeWallets, afterWallets, at, trigger, attribution = {}) {
  const beforeByCurrency = new Map(beforeWallets.map((wallet) => [wallet.currency, wallet]))
  const afterByCurrency = new Map(afterWallets.map((wallet) => [wallet.currency, wallet]))
  const currencies = [...new Set([...beforeByCurrency.keys(), ...afterByCurrency.keys()])]
  const changes = []
  for (const currency of currencies) {
    const before = beforeByCurrency.get(currency)
    const after = afterByCurrency.get(currency)
    const beforeCents = before?.totalCents ?? 0
    const afterCents = after?.totalCents ?? 0
    const deltaCents = afterCents - beforeCents
    if (deltaCents === 0) continue
    let kind = 'adjustment'
    if (deltaCents < 0) kind = 'spend'
    else if ((after?.grantedCents ?? 0) > (before?.grantedCents ?? 0)) kind = 'grant'
    else if ((after?.toppedUpCents ?? 0) > (before?.toppedUpCents ?? 0)) kind = 'topup'
    changes.push({
      id: `${Date.parse(at)}-${currency}-${changes.length}`,
      at,
      currency,
      before: before?.total ?? '0.00',
      after: after?.total ?? '0.00',
      delta: formatCents(deltaCents),
      deltaCents,
      kind,
      trigger,
      sessionId: attribution.sessionId ?? null,
      sessionTitle: attribution.sessionTitle ?? null,
      sessionIds: Array.isArray(attribution.sessionIds) ? attribution.sessionIds : [],
      sessionTitles: Array.isArray(attribution.sessionTitles) ? attribution.sessionTitles : [],
      attribution: attribution.attribution ?? 'unattributed',
      turnId: attribution.turnId ?? null,
      turnNumber: Number.isInteger(attribution.turnNumber) ? attribution.turnNumber : null,
      turnText: attribution.turnText ?? null,
      turnMessages: Array.isArray(attribution.turnMessages) ? attribution.turnMessages : [],
      turnStartedAt: attribution.turnStartedAt ?? null,
      turnEndedAt: attribution.turnEndedAt ?? null,
    })
  }
  return changes
}

function fingerprint(wallets) {
  return wallets.map((wallet) => `${wallet.currency}:${wallet.total}`).join('|')
}

function pickPrimary(wallets) {
  if (!Array.isArray(wallets) || wallets.length === 0) return null
  return wallets.find((wallet) => wallet.currency === PREFERRED_CURRENCY)
    ?? wallets.find((wallet) => wallet.currency === 'CNY')
    ?? wallets[0]
}

function buildConversations(changes, trackerSnapshot, now, currency) {
  const dayStart = startOfBeijingDay(now)
  const groups = new Map()
  for (const change of changes) {
    if (currency && change.currency !== currency) continue
    const attribution = change.attribution ?? (change.sessionId ? 'active' : 'legacy')
    const sessionId = change.sessionId ?? null
    const key = sessionId
      ? `session:${sessionId}`
      : attribution === 'parallel' ? 'parallel' : attribution === 'legacy' ? 'legacy' : 'unattributed'
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        sessionId,
        sessionTitle: null,
        title: null,
        attribution,
        active: false,
        spentCents: 0,
        addedCents: 0,
        todaySpentCents: 0,
        changeCount: 0,
        deductionCount: 0,
        firstAt: null,
        lastAt: null,
        lastChangeCents: null,
        sessionIds: [],
        sessionTitles: [],
        turns: [],
        turnCount: 0,
        changes: [],
      }
      groups.set(key, group)
    }
    const timestamp = Date.parse(change.at)
    const at = Number.isFinite(timestamp) ? timestamp : now
    group.spentCents += change.deltaCents < 0 ? -change.deltaCents : 0
    group.addedCents += change.deltaCents > 0 ? change.deltaCents : 0
    if (at >= dayStart && change.deltaCents < 0) group.todaySpentCents += -change.deltaCents
    group.changeCount += 1
    if (change.deltaCents < 0) group.deductionCount += 1
    if (group.firstAt === null || at < Date.parse(group.firstAt)) group.firstAt = new Date(at).toISOString()
    if (group.lastAt === null || at > Date.parse(group.lastAt)) {
      group.lastAt = new Date(at).toISOString()
      group.lastChangeCents = change.deltaCents
    }
    if (change.sessionTitle) group.sessionTitle = change.sessionTitle
    if (Array.isArray(change.sessionIds)) {
      for (const id of change.sessionIds) if (!group.sessionIds.includes(id)) group.sessionIds.push(id)
    }
    if (Array.isArray(change.sessionTitles)) {
      for (const title of change.sessionTitles) if (title && !group.sessionTitles.includes(title)) group.sessionTitles.push(title)
    }
    group.changes.push(change)
  }

  for (const group of groups.values()) {
    const liveTitle = group.sessionId ? trackerSnapshot.titles?.[group.sessionId] : null
    group.sessionTitle = liveTitle || group.sessionTitle
    group.active = Boolean(group.sessionId && trackerSnapshot.activeIds?.includes(group.sessionId))
    if (group.sessionId) {
      group.title = group.sessionTitle
        || `对话 ${group.sessionId.replace(/^session-/, '').slice(0, 8)}`
      group.attribution = group.active ? 'active' : group.attribution
    } else if (group.key === 'parallel') {
      group.title = '并行对话'
      group.sessionTitle = group.sessionTitles.join(' | ') || null
    } else if (group.key === 'legacy') {
      group.title = '未归属（旧记录）'
    } else {
      group.title = '未归属'
    }

    const turns = new Map()
    const untracked = []
    for (const change of group.changes) {
      if (!change.turnId) {
        untracked.push(change)
        continue
      }
      let turn = turns.get(change.turnId)
      if (!turn) {
        turn = {
          turnId: change.turnId,
          turnNumber: change.turnNumber ?? null,
          userText: null,
          userMessages: [],
          startedAt: change.turnStartedAt ?? null,
          endedAt: change.turnEndedAt ?? null,
          spentCents: 0,
          addedCents: 0,
          changeCount: 0,
          deductionCount: 0,
          firstAt: null,
          lastAt: null,
          active: Boolean(trackerSnapshot.activeTurnIds?.includes(change.turnId)),
        }
        turns.set(change.turnId, turn)
      }
      const at = Date.parse(change.at)
      const timestamp = Number.isFinite(at) ? at : now
      turn.spentCents += change.deltaCents < 0 ? -change.deltaCents : 0
      turn.addedCents += change.deltaCents > 0 ? change.deltaCents : 0
      turn.changeCount += 1
      if (change.deltaCents < 0) turn.deductionCount += 1
      if (!turn.firstAt || timestamp < Date.parse(turn.firstAt)) turn.firstAt = new Date(timestamp).toISOString()
      if (!turn.lastAt || timestamp > Date.parse(turn.lastAt)) turn.lastAt = new Date(timestamp).toISOString()
      if (!turn.startedAt && change.turnStartedAt) turn.startedAt = change.turnStartedAt
      if (change.turnEndedAt) turn.endedAt = change.turnEndedAt
      if (Number.isInteger(change.turnNumber)) turn.turnNumber = change.turnNumber
      for (const text of (change.turnMessages ?? [])) {
        if (text && !turn.userMessages.includes(text)) turn.userMessages.push(text)
      }
      if (!turn.userMessages.length && change.turnText) turn.userMessages.push(change.turnText)
    }
    for (const turn of turns.values()) {
      turn.userMessages = turn.userMessages.slice(0, 10)
      turn.userText = turn.userMessages.length ? turn.userMessages.join(' / ').slice(0, 300) : null
    }
    const orderedTurns = [...turns.values()].sort((left, right) => String(right.lastAt).localeCompare(String(left.lastAt)))
    if (orderedTurns.length > 0 && untracked.length > 0) {
      const spentCents = untracked.reduce((sum, change) => sum + (change.deltaCents < 0 ? -change.deltaCents : 0), 0)
      const addedCents = untracked.reduce((sum, change) => sum + (change.deltaCents > 0 ? change.deltaCents : 0), 0)
      orderedTurns.push({
        turnId: '__untracked__',
        turnNumber: null,
        userText: null,
        userMessages: [],
        startedAt: untracked[0]?.at ?? null,
        endedAt: untracked[untracked.length - 1]?.at ?? null,
        spentCents,
        addedCents,
        changeCount: untracked.length,
        deductionCount: untracked.filter((change) => change.deltaCents < 0).length,
        firstAt: untracked[0]?.at ?? null,
        lastAt: untracked[untracked.length - 1]?.at ?? null,
        active: false,
      })
    }
    group.turnCount = orderedTurns.length
    group.turns = orderedTurns.slice(0, 30)

    if (!group.lastAt) group.lastAt = new Date(now).toISOString()
    group.changes = group.changes
      .slice(-12)
      .reverse()
      .map((change) => ({ ...change }))
  }

  const ordered = [...groups.values()].sort((left, right) => (
    Number(right.active) - Number(left.active)
    || String(right.lastAt).localeCompare(String(left.lastAt))
  ))
  return {
    groups: ordered.slice(0, MAX_CONVERSATIONS),
    count: ordered.length,
  }
}

function summarize(changes, currency, now) {
  const dayStart = startOfBeijingDay(now)
  const dayAgo = now - 24 * 60 * 60_000
  let todaySpent = 0
  let todayAdded = 0
  let todayChanges = 0
  let last24hSpent = 0
  let last24hChanges = 0
  let lastChangeAt = null
  let lastChangeCents = null
  for (const change of changes) {
    if (currency && change.currency !== currency) continue
    const timestamp = Date.parse(change.at)
    if (!Number.isFinite(timestamp)) continue
    if (timestamp >= dayStart) {
      todayChanges += 1
      if (change.deltaCents < 0) todaySpent += -change.deltaCents
      else todayAdded += change.deltaCents
    }
    if (timestamp >= dayAgo) {
      last24hChanges += 1
      if (change.deltaCents < 0) last24hSpent += -change.deltaCents
    }
    if (!lastChangeAt || timestamp > Date.parse(lastChangeAt)) {
      lastChangeAt = change.at
      lastChangeCents = change.deltaCents
    }
  }
  return {
    todaySpentCents: todaySpent,
    todayAddedCents: todayAdded,
    todayChanges,
    last24hSpentCents: last24hSpent,
    last24hChanges,
    lastChangeAt,
    lastChangeCents,
  }
}

function phaseInfo(now) {
  const parts = beijingParts(now)
  const holiday = HOLIDAYS.get(parts.dateKey) ?? null
  const isWeekend = parts.weekday === 0 || parts.weekday === 6
  const dayKind = holiday ? 'holiday' : isWeekend ? 'weekend' : 'workday'
  const currentPhase = phaseAt(now)
  const nextChange = nextTransition(now)
  const nextPhase = nextChange === null ? null : phaseAt(nextChange)
  return {
    id: currentPhase,
    label: currentPhase === 'peak' ? '高峰时段' : '空闲时段',
    short: currentPhase === 'peak' ? '高峰' : '空闲',
    multiplier: currentPhase === 'peak' ? 2 : 1,
    dayKind,
    dayLabel: holiday ? `法定节假日 · ${holiday}` : isWeekend ? '周末' : '工作日',
    holidayName: holiday,
    date: parts.dateKey,
    weekday: WEEKDAY_NAMES[parts.weekday],
    minutesOfDay: parts.hour * 60 + parts.minute,
    nextChangeAt: nextChange === null ? null : new Date(nextChange).toISOString(),
    nextPhase,
    nextPhaseLabel: nextPhase === 'peak' ? '高峰' : '空闲',
    segments: daySegments(dayKind),
    peakRule: '工作日 09:00–12:00、14:00–18:00 为高峰；其余时间（含周末、法定节假日全天）为空闲。',
  }
}

function phaseAt(timestamp) {
  const parts = beijingParts(timestamp)
  if (parts.weekday === 0 || parts.weekday === 6) return 'offpeak'
  if (HOLIDAYS.has(parts.dateKey)) return 'offpeak'
  const minute = parts.hour * 60 + parts.minute
  return PEAK_WINDOWS.some(([start, end]) => minute >= start && minute < end) ? 'peak' : 'offpeak'
}

function nextTransition(now) {
  const current = phaseAt(now)
  const base = beijingParts(now)
  for (let offset = 0; offset < 16; offset += 1) {
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset, 12))
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    for (const hour of [0, 9, 12, 14, 18]) {
      const candidate = Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0)
      if (candidate <= now) continue
      if (phaseAt(candidate) !== current) return candidate
    }
  }
  return null
}

function daySegments(dayKind) {
  if (dayKind !== 'workday') return [{ start: 0, end: 1440, phase: 'offpeak' }]
  return [
    { start: 0, end: 9 * 60, phase: 'offpeak' },
    { start: 9 * 60, end: 12 * 60, phase: 'peak' },
    { start: 12 * 60, end: 14 * 60, phase: 'offpeak' },
    { start: 14 * 60, end: 18 * 60, phase: 'peak' },
    { start: 18 * 60, end: 1440, phase: 'offpeak' },
  ]
}

function beijingParts(timestamp) {
  const parts = Object.fromEntries(
    BEIJING_FORMATTER.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second) % 60,
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

function startOfBeijingDay(timestamp) {
  const parts = beijingParts(timestamp)
  return Date.UTC(parts.year, parts.month - 1, parts.day, -8, 0, 0, 0)
}

function datesBetween(start, end) {
  const dates = []
  const cursor = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (cursor <= last) {
    const year = cursor.getUTCFullYear()
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0')
    const day = String(cursor.getUTCDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function currencyRank(currency) {
  if (currency === PREFERRED_CURRENCY) return 0
  if (currency === 'CNY') return 1
  if (currency === 'USD') return 2
  return 10
}

function normalizeAmount(value) {
  const text = String(value ?? '').trim()
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : '0.00'
}

function parseCents(value) {
  const text = normalizeAmount(value)
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2) || 0)
  return Number.isFinite(cents) ? (negative ? -cents : cents) : 0
}

function formatCents(cents) {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

function formatBeijingDateTime(value) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return String(value ?? '')
  const parts = beijingParts(timestamp)
  return `${parts.dateKey} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function monitorError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function safeSnippet(value, length = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length)
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, { allow, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: `只支持 ${allow}。` } }))
}

function sendJson(res, status, value, headOnly = false) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-ds-balance-version': String(API_VERSION),
    'content-length': Buffer.byteLength(body),
  })
  res.end(headOnly ? undefined : body)
}
