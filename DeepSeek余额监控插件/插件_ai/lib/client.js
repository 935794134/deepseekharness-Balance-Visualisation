/**
 * ds余额 — DeepSeek API 余额监控（浏览器半侧）
 *
 * 这个文件是 DSH 外部客户端 bundle 的入口格式：window.__ModuleLoader__.load(...)
 * 内部只依赖共享模块表里的 react / react/jsx-runtime，不引入任何第三方运行时。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ds-balance-ai',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo } = React

    const PANEL_ID = 'ds-balance'
    const STATE_ENDPOINT = '/ds-balance/api/state'
    const REFRESH_ENDPOINT = '/ds-balance/api/refresh'
    const EVENTS_ENDPOINT = '/ds-balance/events'
    const EXPORT_ENDPOINT = '/ds-balance/api/history.csv'
    const inject = ['slots', 'layout']

    const KIND_LABELS = {
      spend: { text: '消耗', tone: 'spend' },
      topup: { text: '充值', tone: 'add' },
      grant: { text: '赠送', tone: 'add' },
      adjustment: { text: '调整', tone: 'muted' },
    }

    const CSS = `
      .dsb-page{box-sizing:border-box;min-height:100%;height:100%;overflow:auto;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);padding:calc(var(--dsh-frame-top-clearance,0px) + 28px) clamp(20px,4vw,52px) 56px}
      .dsb-inner{max-width:1120px;margin:0 auto}
      .dsb-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
      .dsb-kicker{font-size:10px;line-height:16px;letter-spacing:.16em;font-weight:650;color:var(--dsw-alias-label-tertiary,#888);text-transform:uppercase;margin-bottom:7px}
      .dsb-title{display:flex;align-items:center;gap:11px;font-size:28px;line-height:1.2;font-weight:620;letter-spacing:-.02em;margin:0}
      .dsb-title svg{flex:none;color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsb-sub{margin:7px 0 0;color:var(--dsw-alias-label-secondary,#666);font-size:13px;line-height:21px}
      .dsb-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:4px}
      .dsb-btn{box-sizing:border-box;height:32px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,#d4d4d4);background:transparent;color:var(--dsw-alias-label-primary,#111);font:inherit;font-size:12px;line-height:20px;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;text-decoration:none;white-space:nowrap}
      .dsb-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a)}
      .dsb-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:2px}
      .dsb-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#111);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:520}
      .dsb-btn-primary:hover{background:var(--dsw-alias-button-primary-hover,#333)}
      .dsb-btn[disabled]{opacity:.55;cursor:default}
      .dsb-spin{width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:dsb-rotate .8s linear infinite;display:inline-block}
      @keyframes dsb-rotate{to{transform:rotate(360deg)}}
      .dsb-meta{display:flex;flex-wrap:wrap;align-items:center;gap:7px 16px;margin:0 0 20px;color:var(--dsw-alias-label-tertiary,#888);font-size:11px;line-height:17px}
      .dsb-meta-item{display:inline-flex;align-items:center;gap:6px}
      .dsb-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22c55e);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 15%,transparent);flex:none}
      .dsb-dot.warn{background:var(--dsw-alias-state-warn-primary,#f59e0b);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 15%,transparent)}
      .dsb-dot.error{background:var(--dsw-alias-label-error,#ef4444)}
      .dsb-dot.loading{animation:dsb-pulse 1.2s ease-in-out infinite}
      @keyframes dsb-pulse{0%,100%{opacity:.35}50%{opacity:1}}
      .dsb-alert{display:flex;gap:10px;align-items:flex-start;border:.5px solid var(--dsw-alias-state-warn-primary,#f59e0b);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 7%,transparent);border-radius:12px;padding:11px 14px;margin:0 0 16px;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary,#555)}
      .dsb-alert strong{color:var(--dsw-alias-label-primary,#111);font-weight:600}
      .dsb-alert code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);padding:1px 4px;border-radius:4px}
      .dsb-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1.08fr) minmax(0,.82fr);gap:14px;align-items:stretch}
      .dsb-card{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);padding:18px 20px;min-width:0}
      .dsb-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
      .dsb-card-title{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
      .dsb-card-sub{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999);margin-top:2px}
      .dsb-label{font-size:11px;line-height:17px;font-weight:520;color:var(--dsw-alias-label-tertiary,#888);letter-spacing:.03em}
      .dsb-hero-amount{font-size:clamp(36px,4.2vw,46px);line-height:1.08;font-weight:640;letter-spacing:-.035em;font-variant-numeric:tabular-nums;margin:7px 0 10px;color:var(--dsw-alias-label-primary,#111)}
      .dsb-currency{font-size:11px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888);border:.5px solid var(--dsw-alias-border-l2,#ddd);border-radius:5px;padding:0 5px;vertical-align:middle;margin-left:7px;letter-spacing:.04em}
      .dsb-wallets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
      .dsb-wallet{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary,#666);background:var(--dsw-alias-bg-layer-2,#f6f6f6);border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums}
      .dsb-wallet b{font-weight:550;color:var(--dsw-alias-label-primary,#111)}
      .dsb-divider{height:.5px;background:var(--dsw-alias-border-l2,#e8e8e8);margin:12px 0}
      .dsb-last{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}
      .dsb-last-value{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
      .dsb-last-value.neg{color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-last-value.pos{color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dsb-phase-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;line-height:18px;font-weight:600;padding:2px 9px;white-space:nowrap}
      .dsb-phase-pill.off{color:var(--dsw-alias-state-success-primary,#12805c);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 28%,transparent)}
      .dsb-phase-pill.peak{color:var(--dsw-alias-state-warn-label,#9a5b00);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 12%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 32%,transparent)}
      .dsb-phase-name{font-size:20px;line-height:1.25;font-weight:600;letter-spacing:-.01em;margin:2px 0 4px}
      .dsb-phase-count{font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary,#666);font-variant-numeric:tabular-nums}
      .dsb-phase-count b{font-weight:600;color:var(--dsw-alias-label-primary,#111)}
      .dsb-timeline{position:relative;height:22px;margin:16px 0 6px;display:flex;border-radius:5px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#f2f2f2)}
      .dsb-seg{height:100%;min-width:1px}
      .dsb-seg.off{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 42%,transparent)}
      .dsb-seg.peak{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 55%,transparent)}
      .dsb-now{position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:1px;background:var(--dsw-alias-label-primary,#111);box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#fff);transform:translateX(-1px);pointer-events:none}
      .dsb-axis{display:flex;justify-content:space-between;font-size:9px;line-height:13px;color:var(--dsw-alias-label-tertiary,#aaa);font-variant-numeric:tabular-nums}
      .dsb-rule{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);margin-top:12px}
      .dsb-rule a{color:var(--dsw-alias-link,#4d6bfe);text-decoration:none}
      .dsb-rule a:hover{text-decoration:underline}
      .dsb-stat{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:7px 0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary,#666)}
      .dsb-stat + .dsb-stat{border-top:.5px solid var(--dsw-alias-border-l2,#eee)}
      .dsb-stat b{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#111);font-variant-numeric:tabular-nums}
      .dsb-stat b.neg{color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-stat b.pos{color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dsb-stat small{display:block;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,#aaa);font-weight:400}
      .dsb-live{display:inline-flex;align-items:center;gap:6px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999)}
      .dsb-chart-card{margin-top:14px}
      .dsb-seg-control{display:flex;align-items:center;background:var(--dsw-alias-bg-layer-2,#f3f3f3);border-radius:7px;padding:2px;gap:2px}
      .dsb-seg-control button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#888);font:inherit;font-size:10px;line-height:18px;padding:1px 8px;border-radius:5px;cursor:pointer}
      .dsb-seg-control button.on{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,#ddd)}
      .dsb-chart-wrap{position:relative;min-height:194px}
      .dsb-y-label{position:absolute;left:0;font-size:9px;line-height:13px;color:var(--dsw-alias-label-tertiary,#aaa);font-variant-numeric:tabular-nums;pointer-events:none;background:var(--dsw-alias-bg-layer-1,#fff);padding-right:2px}
      .dsb-y-label.top{top:2px}
      .dsb-y-label.bottom{bottom:7px}
      .dsb-chart-wrap svg{display:block;width:100%;height:194px;overflow:visible;cursor:crosshair}
      .dsb-chart-tip{position:absolute;z-index:3;transform:translate(-50%,-115%);min-width:118px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-tooltip-bg,#1f1f1f);color:var(--dsw-alias-tooltip-label,#fff);box-shadow:0 6px 18px #0000002e;pointer-events:none;font-size:10px;line-height:15px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .dsb-chart-tip-time{font-size:9px;line-height:14px;opacity:.68}
      .dsb-chart-tip-value{font-size:14px;line-height:20px;font-weight:600;margin:1px 0}
      .dsb-chart-tip-delta{font-size:9px;line-height:14px;opacity:.82}
      .dsb-chart-tip-delta.neg{color:#fca5a5}
      .dsb-chart-tip-delta.pos{color:#86efac}
      .dsb-chart-axis{display:flex;justify-content:space-between;font-size:9px;line-height:13px;color:var(--dsw-alias-label-tertiary,#aaa);margin-top:2px;font-variant-numeric:tabular-nums}
      .dsb-chart-foot{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:11px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}
      .dsb-chart-foot b{font-weight:550;color:var(--dsw-alias-label-secondary,#666)}
      .dsb-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:150px;gap:6px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:18px;text-align:center;padding:20px 10px}
      .dsb-empty strong{font-size:12px;font-weight:550;color:var(--dsw-alias-label-secondary,#666)}
      .dsb-history{margin-top:14px}
      .dsb-history .dsb-card-head{flex-wrap:wrap}
      .dsb-summary{display:flex;flex-wrap:wrap;gap:6px 18px;padding:0 0 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,#eee);font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums}
      .dsb-summary b{font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
      .dsb-summary b.neg{color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-summary b.pos{color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dsb-conv{border-bottom:.5px solid var(--dsw-alias-border-l2,#eee)}
      .dsb-conv:last-child{border-bottom:0}
      .dsb-conv-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto 10px;align-items:center;gap:10px;box-sizing:border-box;width:100%;padding:11px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .dsb-conv-row:hover .dsb-conv-title-text{color:var(--dsw-alias-brand-primary,#4d6bfe)}
      .dsb-conv-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px;border-radius:6px}
      .dsb-conv-icon{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);flex:none}
      .dsb-conv-icon.active{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dsb-conv-main{min-width:0}
      .dsb-conv-title{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;line-height:18px;font-weight:560;color:var(--dsw-alias-label-primary,#111)}
      .dsb-conv-title-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsb-live-tag{font-size:9px;line-height:15px;padding:0 5px;border-radius:4px;color:var(--dsw-alias-state-success-primary,#12805c);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 10%,transparent);white-space:nowrap;flex:none}
      .dsb-conv-sub{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);margin-top:1px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsb-conv-right{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      .dsb-conv-amount{display:block;font-size:13px;line-height:19px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}
      .dsb-conv-amount.neg{color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-conv-time{display:block;font-size:9px;line-height:14px;color:var(--dsw-alias-label-tertiary,#aaa);font-weight:400;margin-top:1px}
      .dsb-conv-chevron{font-size:9px;color:var(--dsw-alias-label-tertiary,#aaa);text-align:center}
      .dsb-conv-bar{height:2px;margin:-3px 0 9px 38px;border-radius:2px;background:var(--dsw-alias-bg-layer-2,#f3f3f3);overflow:hidden}
      .dsb-conv-bar span{display:block;height:100%;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-error,#ef4444) 45%,transparent)}
      .dsb-conv-detail{margin:-1px 0 12px 38px;padding:5px 0 2px;border-top:.5px dashed var(--dsw-alias-border-l2,#e8e8e8)}
      .dsb-conv-detail-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:8px;align-items:baseline;padding:3px 0;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}
      .dsb-conv-detail-time{color:var(--dsw-alias-label-tertiary,#aaa)}
      .dsb-conv-detail-main{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#666)}
      .dsb-conv-detail-amount{font-weight:550;color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-conv-empty{font-size:10px;line-height:17px;color:var(--dsw-alias-label-tertiary,#aaa);padding:4px 0 2px}
      .dsb-turn-list{display:flex;flex-direction:column}
      .dsb-turn-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:8px;align-items:start;padding:7px 0;border-top:.5px dashed var(--dsw-alias-border-l2,#e8e8e8)}
      .dsb-turn-row:first-child{border-top:0;padding-top:2px}
      .dsb-turn-time{font-size:9px;line-height:17px;color:var(--dsw-alias-label-tertiary,#aaa);font-variant-numeric:tabular-nums;padding-top:1px}
      .dsb-turn-main{min-width:0}
      .dsb-turn-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,#555);word-break:break-word}
      .dsb-turn-text.muted{color:var(--dsw-alias-label-tertiary,#999)}
      .dsb-turn-sub{font-size:9px;line-height:14px;color:var(--dsw-alias-label-tertiary,#aaa);margin-top:1px;font-variant-numeric:tabular-nums}
      .dsb-turn-amount{font-size:11px;line-height:17px;font-weight:600;color:var(--dsw-alias-label-error,#ef4444);font-variant-numeric:tabular-nums;white-space:nowrap;padding-top:1px}
      .dsb-tag-session{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}
      .dsb-list{display:flex;flex-direction:column}
      .dsb-item{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:11px;padding:11px 0;border-top:.5px solid var(--dsw-alias-border-l2,#eee)}
      .dsb-item:first-child{border-top:0;padding-top:2px}
      .dsb-item-icon{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-label-secondary,#666)}
      .dsb-item-icon.spend{color:var(--dsw-alias-label-error,#ef4444);background:color-mix(in srgb,var(--dsw-alias-label-error,#ef4444) 8%,transparent)}
      .dsb-item-icon.add{color:var(--dsw-alias-state-success-primary,#16a34a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 9%,transparent)}
      .dsb-item-title{min-width:0;font-size:12px;line-height:18px;font-weight:550;color:var(--dsw-alias-label-primary,#111);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dsb-item-sub{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#999);margin-top:1px;font-variant-numeric:tabular-nums}
      .dsb-tag{font-size:9px;line-height:15px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#f4f4f4);color:var(--dsw-alias-label-tertiary,#888);font-weight:500}
      .dsb-item-amount{text-align:right;font-size:13px;line-height:19px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
      .dsb-item-amount.neg{color:var(--dsw-alias-label-error,#ef4444)}
      .dsb-item-amount.pos{color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dsb-item-time{font-size:9px;line-height:14px;color:var(--dsw-alias-label-tertiary,#aaa);font-weight:400;margin-top:1px}
      .dsb-footer{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:18px;font-size:10px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999)}
      .dsb-footer code{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:10px}
      .dsb-skeleton{border-radius:16px;border:.5px solid var(--dsw-alias-border-l1,#e5e5e5);background:var(--dsw-alias-bg-layer-1,#fff);padding:18px 20px;min-height:170px;box-sizing:border-box}
      .dsb-skeleton-line{height:10px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);margin:10px 0;animation:dsb-pulse 1.4s ease-in-out infinite}
      .dsb-chip-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#22c55e);flex:none}
      .dsb-chip-dot.error{background:var(--dsw-alias-label-error,#ef4444)}
      .dsb-foot{display:flex;align-items:center;gap:7px;box-sizing:border-box;width:100%;min-height:34px;margin:0 2px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:12px;line-height:20px;cursor:pointer;text-align:left;font-variant-numeric:tabular-nums}
      .dsb-foot:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000a);color:var(--dsw-alias-label-primary,#111)}
      .dsb-foot:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-2px}
      .dsb-foot-label{min-width:0;white-space:nowrap}
      .dsb-foot-value{margin-left:auto;font-weight:600;color:var(--dsw-alias-label-primary,#111);white-space:nowrap}
      .dsb-foot-phase{font-size:9px;line-height:15px;padding:0 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#f3f3f3);color:var(--dsw-alias-label-tertiary,#888);flex:none}
      .dsb-foot.compact{width:36px;height:36px;min-height:36px;justify-content:center;padding:0;margin:0}
      .dsb-foot-symbol{font-weight:600;color:var(--dsw-alias-label-primary,#111)}
      .dsb-full-error{max-width:620px;margin:40px auto;text-align:center;border:.5px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:18px;background:var(--dsw-alias-bg-layer-1,#fff);padding:34px 28px}
      .dsb-full-error h2{font-size:17px;line-height:24px;font-weight:600;margin:0 0 8px}
      .dsb-full-error p{font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#666);margin:0 auto 14px;max-width:460px}
      .dsb-full-error .dsb-btn{margin:2px 3px}
      @media (max-width:980px){.dsb-grid{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}.dsb-grid .dsb-stat-card{grid-column:1/-1}.dsb-stat-card .dsb-stat{display:inline-flex;width:33.33%;border-top:0!important;padding:4px 10px 4px 0;vertical-align:top}.dsb-stat-card .dsb-stat b{font-size:15px}}
      @media (max-width:660px){.dsb-page{padding-left:16px;padding-right:16px}.dsb-title{font-size:24px}.dsb-grid{grid-template-columns:1fr}.dsb-stat-card .dsb-stat{width:100%;display:flex}.dsb-actions{width:100%}.dsb-item{grid-template-columns:28px minmax(0,1fr) auto}}
      @media (prefers-reduced-motion:reduce){.dsb-spin,.dsb-dot.loading,.dsb-skeleton-line{animation:none}.dsb-spin{border-right-color:currentColor}}
    `

    function createBalanceStore() {
      let snapshot = { data: null, loading: true, refreshing: false, error: null, fetchedAt: 0, streamOpen: false }
      const listeners = new Set()
      let inFlight = null
      let stream = null
      let pollTimer = null
      let startTimer = null
      let started = false

      const emit = () => {
        for (const listener of listeners) {
          try {
            listener()
          } catch {
            // 单个订阅者失败不影响其他 UI。
          }
        }
      }
      const update = (patch) => {
        snapshot = { ...snapshot, ...patch }
        emit()
      }
      const acceptState = (data) => {
        if (!data || typeof data !== 'object') throw new Error('宿主返回了空的余额状态')
        update({
          data,
          loading: data.status === 'loading' && !data.primary,
          refreshing: false,
          error: data.error ?? (data.status === 'error' ? { code: 'UNKNOWN', message: '余额读取失败' } : null),
          fetchedAt: Date.now(),
        })
      }

      async function refresh(force = false) {
        if (inFlight) return inFlight
        update({ loading: snapshot.data === null, refreshing: force })
        inFlight = (async () => {
          try {
            const response = await fetch(force ? REFRESH_ENDPOINT : STATE_ENDPOINT, {
              method: force ? 'POST' : 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: force ? { 'content-type': 'application/json' } : undefined,
              body: force ? '{}' : undefined,
            })
            const text = await response.text()
            let data
            try {
              data = JSON.parse(text)
            } catch {
              throw new Error(response.status === 404 ? '宿主半侧未加载（/ds-balance/api/state 返回 404）' : `接口返回了非 JSON 内容（HTTP ${response.status}）`)
            }
            if (!response.ok) throw new Error(data?.error?.message || `接口返回 HTTP ${response.status}`)
            acceptState(data)
            if (data?.error && data.status === 'stale') update({ error: data.error })
          } catch (error) {
            update({
              loading: false,
              refreshing: false,
              error: { code: 'CLIENT', message: error instanceof Error ? error.message : String(error) },
            })
          } finally {
            inFlight = null
          }
        })()
        return inFlight
      }

      function connectStream() {
        if (stream || typeof EventSource === 'undefined') return
        try {
          stream = new EventSource(EVENTS_ENDPOINT)
          stream.onopen = () => update({ streamOpen: true })
          stream.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data)
              if (message?.type === 'state') acceptState(message.state)
            } catch {
              // 忽略格式不完整的 SSE 帧，下一帧或轮询会补齐。
            }
          }
          stream.onerror = () => update({ streamOpen: false })
        } catch {
          stream = null
        }
      }

      function start() {
        if (started) return
        started = true
        connectStream()
        startTimer = setTimeout(() => { void refresh(false) }, 250)
        pollTimer = setInterval(() => { void refresh(false) }, 30_000)
        document.addEventListener('visibilitychange', onVisibility)
      }

      function onVisibility() {
        if (document.visibilityState === 'visible' && Date.now() - snapshot.fetchedAt > 30_000) void refresh(false)
      }

      function stop() {
        started = false
        if (startTimer) clearTimeout(startTimer)
        if (pollTimer) clearInterval(pollTimer)
        startTimer = null
        pollTimer = null
        stream?.close()
        stream = null
        document.removeEventListener('visibilitychange', onVisibility)
      }

      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        start,
        stop,
        refresh,
      }
    }

    function useNow(intervalMs) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥'
      if (currency === 'USD') return '$'
      return ''
    }

    function money(cents, currency) {
      const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
      const sign = value < 0 ? '-' : ''
      const absolute = Math.abs(value)
      const amount = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
      const symbol = currencySymbol(currency)
      return symbol ? `${sign}${symbol}${amount}` : `${sign}${currency || ''} ${amount}`.trim()
    }

    function signedMoney(cents, currency) {
      const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
      return `${value > 0 ? '+' : ''}${money(value, currency)}`
    }

    function formatDuration(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '00:00:00'
      const totalSeconds = Math.floor(milliseconds / 1000)
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    }

    function formatRelative(iso, now) {
      const timestamp = Date.parse(iso)
      if (!Number.isFinite(timestamp)) return '—'
      const difference = Math.max(0, now - timestamp)
      if (difference < 15_000) return '刚刚'
      if (difference < 60_000) return `${Math.floor(difference / 1000)} 秒前`
      if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`
      if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`
      return `${Math.floor(difference / 86_400_000)} 天前`
    }

    function formatClock(iso) {
      const timestamp = Date.parse(iso)
      if (!Number.isFinite(timestamp)) return '—'
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(timestamp))
    }

    function formatAxisTime(timestamp) {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(timestamp))
    }

    const GROUP_DAY_TIME = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const GROUP_TIME = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })

    function formatGroupRange(firstAt, lastAt) {
      const first = Date.parse(firstAt)
      const last = Date.parse(lastAt)
      if (!Number.isFinite(first) || !Number.isFinite(last)) return '时间未知'
      const firstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(first))
      const lastDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(last))
      if (firstDay === lastDay) return `${GROUP_DAY_TIME.format(new Date(first))}–${GROUP_TIME.format(new Date(last))}`
      return `${GROUP_DAY_TIME.format(new Date(first))} → ${GROUP_DAY_TIME.format(new Date(last))}`
    }

    function truncateText(text, limit = 26) {
      const value = String(text ?? '')
      return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
    }

    function KickerIcon() {
      return h(
        'svg',
        { width: 26, height: 26, viewBox: '0 0 26 26', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2.5, y: 7, width: 21, height: 14, rx: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M2.5 11h21', stroke: 'currentColor', strokeWidth: 1.6, opacity: .55 }),
        h('path', { d: 'M7 16.5h4.5M14.5 16.5H19', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('circle', { cx: 20, cy: 11, r: 1.15, fill: 'currentColor' }),
      )
    }

    function ChatIcon({ size = 15 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3.2 3.2h9.6c.7 0 1.2.5 1.2 1.2v5.2c0 .7-.5 1.2-1.2 1.2H7l-3.3 2.4v-2.4H3.2c-.7 0-1.2-.5-1.2-1.2V4.4c0-.7.5-1.2 1.2-1.2Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('path', { d: 'M4.6 6.3h6.8M4.6 8.7h4.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: .65 }),
      )
    }

    function FooterBalance({ wide, useBalance, openPanel }) {
      const snapshot = useBalance((value) => value)
      const data = snapshot.data
      const primary = data?.primary
      const phase = data?.phase
      const hasError = Boolean(snapshot.error)
      return h(
        'button',
        {
          type: 'button',
          className: `dsb-foot${wide ? '' : ' compact'}`,
          onClick: openPanel,
          title: hasError ? `余额读取异常：${snapshot.error?.message ?? ''}` : '打开 DeepSeek 余额监控',
          'aria-label': '打开 DeepSeek 余额监控',
        },
        h('span', { className: `dsb-chip-dot${hasError ? ' error' : ''}` }),
        wide
          ? h(React.Fragment, null,
              h('span', { className: 'dsb-foot-label' }, '余额'),
              h('span', { className: 'dsb-foot-value' }, primary ? money(primary.totalCents, primary.currency) : '—'),
              phase ? h('span', { className: 'dsb-foot-phase' }, phase.short) : null,
            )
          : h('span', { className: 'dsb-foot-symbol' }, '¥'),
      )
    }

    function StatusMeta({ snapshot, now }) {
      const data = snapshot.data
      const status = data?.status ?? (snapshot.loading ? 'loading' : 'error')
      const dotClass = status === 'ok' ? '' : status === 'loading' ? ' loading' : status === 'stale' ? ' warn' : ' error'
      const label = status === 'ok'
        ? (snapshot.streamOpen ? '实时通道已连接' : '轮询更新中')
        : status === 'loading'
          ? '正在读取余额…'
          : status === 'stale'
            ? '显示上次成功数据'
            : '暂时读不到余额'
      return h(
        'div',
        { className: 'dsb-meta' },
        h('span', { className: 'dsb-meta-item' }, h('span', { className: `dsb-dot${dotClass}` }), label),
        data?.lastSuccessAt ? h('span', { className: 'dsb-meta-item' }, '上次成功 ', formatRelative(data.lastSuccessAt, now)) : null,
        data?.latencyMs ? h('span', { className: 'dsb-meta-item' }, '接口 ', `${data.latencyMs} ms`) : null,
        data?.pollIntervalMs ? h('span', { className: 'dsb-meta-item' }, '每 ', `${Math.round(data.pollIntervalMs / 1000)} 秒查询`) : null,
        data?.source?.historyFile ? h('span', { className: 'dsb-meta-item', title: data.source.historyFile }, '本地历史已开启') : null,
      )
    }

    function BalanceCard({ data, now }) {
      const primary = data.primary
      const stats = data.stats ?? {}
      const lastChange = stats.lastChangeAt
      return h(
        'section',
        { className: 'dsb-card' },
        h(
          'div',
          { className: 'dsb-card-head' },
          h('div', { className: 'dsb-label' }, '可用余额'),
          primary ? h('span', { className: 'dsb-currency' }, primary.currency) : null,
        ),
        h('div', { className: 'dsb-hero-amount' }, primary ? money(primary.totalCents, primary.currency) : '—'),
        primary
          ? h(
              'div',
              { className: 'dsb-wallets' },
              h('span', { className: 'dsb-wallet' }, '充值 ', h('b', null, money(primary.toppedUpCents, primary.currency))),
              h('span', { className: 'dsb-wallet' }, '赠送 ', h('b', null, money(primary.grantedCents, primary.currency))),
              ...(data.wallets ?? [])
                .filter((wallet) => wallet.currency !== primary.currency)
                .map((wallet) => h('span', { className: 'dsb-wallet', key: wallet.currency }, `${wallet.currency} `, h('b', null, money(wallet.totalCents, wallet.currency)))),
              data.available === false ? h('span', { className: 'dsb-wallet' }, '账户不可用') : null,
            )
          : null,
        h('div', { className: 'dsb-divider' }),
        h(
          'div',
          { className: 'dsb-last' },
          h('span', null, '最近一次变动'),
          lastChange
            ? h(
                'span',
                { className: `dsb-last-value ${stats.lastChangeCents < 0 ? 'neg' : stats.lastChangeCents > 0 ? 'pos' : ''}`, title: formatClock(lastChange) },
                signedMoney(stats.lastChangeCents, primary?.currency),
                h('span', { style: { fontWeight: 400, color: 'var(--dsw-alias-label-tertiary,#999)', marginLeft: 6 } }, formatRelative(lastChange, now)),
              )
            : h('span', { className: 'dsb-last-value' }, '还没有变动记录'),
        ),
      )
    }

    function PhaseCard({ phase, now }) {
      const remaining = phase.nextChangeAt ? Date.parse(phase.nextChangeAt) - now : null
      const nextLabel = phase.nextPhase === 'peak' ? '距高峰' : '距空闲'
      return h(
        'section',
        { className: 'dsb-card' },
        h(
          'div',
          { className: 'dsb-card-head' },
          h('div', { className: 'dsb-label' }, '繁忙程度 · 计费时段'),
          h('span', { className: `dsb-phase-pill ${phase.id === 'peak' ? 'peak' : 'off'}` }, phase.label, ' · ', `${phase.multiplier}×`),
        ),
        h('div', { className: 'dsb-phase-name' }, phase.label),
        h(
          'div',
          { className: 'dsb-phase-count' },
          phase.nextChangeAt
            ? h(React.Fragment, null, `${nextLabel}还有 `, h('b', null, formatDuration(remaining)))
            : '下一个时段切换时间未知',
        ),
        h(
          'div',
          { className: 'dsb-timeline', 'aria-label': '北京时间 24 小时峰谷示意' },
          ...phase.segments.map((segment, index) => h('span', {
            key: `${segment.phase}-${index}`,
            className: `dsb-seg ${segment.phase}`,
            style: { flex: `${segment.end - segment.start} 1 0` },
            title: `${segment.phase === 'peak' ? '高峰' : '空闲'} ${String(Math.floor(segment.start / 60)).padStart(2, '0')}:00–${String(Math.floor(segment.end / 60)).padStart(2, '0')}:00`,
          })),
          h('span', { className: 'dsb-now', style: { left: `${Math.min(100, Math.max(0, (phase.minutesOfDay / 1440) * 100))}%` }, title: '现在' }),
        ),
        h(
          'div',
          { className: 'dsb-axis' },
          h('span', null, '00:00'),
          h('span', null, '06:00'),
          h('span', null, '12:00'),
          h('span', null, '18:00'),
          h('span', null, '24:00'),
        ),
        h(
          'div',
          { className: 'dsb-rule' },
          `${phase.dayLabel}${phase.holidayName ? `（${phase.holidayName}）` : ''} · `,
          '高峰 09:00–12:00 / 14:00–18:00，空闲 1×，高峰约 2×。',
          h('a', { href: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', target: '_blank', rel: 'noreferrer' }, ' 官方价格说明'),
        ),
      )
    }

    function StatsCard({ data }) {
      const stats = data.stats ?? {}
      const currency = data.primary?.currency
      return h(
        'section',
        { className: 'dsb-card dsb-stat-card' },
        h(
          'div',
          { className: 'dsb-card-head' },
          h('div', null, h('div', { className: 'dsb-card-title' }, '今天'), h('div', { className: 'dsb-card-sub' }, '北京时间自然日')),
        ),
        h('div', { className: 'dsb-stat' }, h('span', null, '消耗'), h('b', { className: 'neg' }, money(stats.todaySpentCents ?? 0, currency))),
        h('div', { className: 'dsb-stat' }, h('span', null, '充值/赠送'), h('b', { className: 'pos' }, money(stats.todayAddedCents ?? 0, currency))),
        h('div', { className: 'dsb-stat' }, h('span', null, '变动次数'), h('b', null, `${stats.todayChanges ?? 0}`)),
        h(
          'div',
          { className: 'dsb-stat' },
          h('span', null, '近 24 小时消耗'),
          h('b', null, money(stats.last24hSpentCents ?? 0, currency), h('small', null, `${stats.last24hChanges ?? 0} 次变动`)),
        ),
      )
    }

    function Chart({ data, range }) {
      const [hoverIndex, setHoverIndex] = useState(null)
      useEffect(() => { setHoverIndex(null) }, [range])
      const currency = data.primary?.currency
      const points = Array.isArray(data.series) ? data.series.filter((point) => point.c === currency) : []
      const currentPoint = data.primary && data.lastSuccessAt ? { t: data.lastSuccessAt, v: data.primary.totalCents, c: currency } : null
      const all = [...points, ...(currentPoint ? [currentPoint] : [])]
        .filter((point) => Number.isFinite(point.v) && Number.isFinite(Date.parse(point.t)))
        .sort((left, right) => Date.parse(left.t) - Date.parse(right.t))
      const now = Date.now()
      const windowMs = range === '7d' ? 7 * 86_400_000 : 86_400_000
      const requestedStart = now - windowMs
      let visible = all.filter((point) => Date.parse(point.t) >= requestedStart)
      if (visible.length === 0 && all.length > 0) visible = [all[all.length - 1]]
      if (visible.length === 0) {
        return h('div', { className: 'dsb-empty' }, h('strong', null, '还没有曲线数据'), h('span', null, '首次成功读取余额后开始记录；有变动或每 10 分钟会补一个点。'))
      }
      if (visible.length === 1) {
        const only = visible[0]
        visible = [{ t: new Date(Date.parse(only.t) - 120_000).toISOString(), v: only.v, c: currency }, only]
      }
      // 记录时间短于所选区间时，按实际记录范围铺满画布，避免所有点挤在右端。
      const firstRecordedAt = Date.parse(visible[0].t)
      let viewStart = Math.max(requestedStart, firstRecordedAt)
      if (now - viewStart < 120_000) viewStart = now - 120_000
      const viewEnd = now
      const viewSpan = Math.max(1, viewEnd - viewStart)
      const width = 760
      const height = 194
      const padding = { top: 12, right: 8, bottom: 8, left: 48 }
      const values = visible.map((point) => point.v)
      const actualMinimum = Math.min(...values)
      const actualMaximum = Math.max(...values)
      // 底边固定为 0，顶边取当前时间段的最高余额，直接看绝对值而不是放大波动。
      const scaleMaximum = Math.max(1, actualMaximum)
      const x = (timestamp) => padding.left + ((timestamp - viewStart) / viewSpan) * (width - padding.left - padding.right)
      const y = (value) => padding.top + ((scaleMaximum - value) / scaleMaximum) * (height - padding.top - padding.bottom)
      const handleMouseMove = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        const svgX = ((event.clientX - rect.left) / rect.width) * width
        if (svgX < padding.left || svgX > width - padding.right) {
          setHoverIndex(null)
          return
        }
        let nearest = 0
        let bestDistance = Infinity
        visible.forEach((point, index) => {
          const distance = Math.abs(x(Date.parse(point.t)) - svgX)
          if (distance < bestDistance) {
            bestDistance = distance
            nearest = index
          }
        })
        setHoverIndex((current) => current === nearest ? current : nearest)
      }
      const handleMouseLeave = () => setHoverIndex(null)
      const hovered = hoverIndex !== null ? visible[hoverIndex] ?? null : null
      const hoverX = hovered ? x(Date.parse(hovered.t)) : 0
      const hoverY = hovered ? y(hovered.v) : 0
      const hoverDelta = hovered && hoverIndex > 0 ? hovered.v - visible[hoverIndex - 1].v : null
      const tooltipLeft = Math.min(88, Math.max(12, (hoverX / width) * 100))
      const tooltipTop = Math.min(90, Math.max(12, (hoverY / height) * 100))
      const line = visible.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(Date.parse(point.t)).toFixed(2)},${y(point.v).toFixed(2)}`).join(' ')
      const area = `${line} L${x(Date.parse(visible[visible.length - 1].t)).toFixed(2)},${y(0).toFixed(2)} L${x(Date.parse(visible[0].t)).toFixed(2)},${y(0).toFixed(2)} Z`
      const last = visible[visible.length - 1]
      const first = visible[0]
      const difference = last.v - first.v
      const grid = [0, 1, 2, 3].map((index) => {
        const gy = padding.top + (index / 3) * (height - padding.top - padding.bottom)
        return h('line', { key: index, x1: padding.left, x2: width - padding.right, y1: gy, y2: gy, stroke: 'rgba(128,128,128,.24)', strokeWidth: 1, strokeDasharray: index === 3 ? '' : '3 5' })
      })
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dsb-chart-wrap' },
          h('span', { className: 'dsb-y-label top' }, money(scaleMaximum, currency)),
          h('span', { className: 'dsb-y-label bottom' }, '0'),
          h(
            'svg',
            { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '余额走势图，底边为 0，顶边为当前时间段最高余额', onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave },
            h(
              'defs',
              null,
              h(
                'linearGradient',
                { id: 'dsb-area-fill', x1: 0, y1: 0, x2: 0, y2: 1 },
                h('stop', { offset: '0%', stopColor: '#4d6bfe', stopOpacity: .20 }),
                h('stop', { offset: '100%', stopColor: '#4d6bfe', stopOpacity: 0 }),
              ),
            ),
            ...grid,
            hovered
              ? h('line', { x1: hoverX, x2: hoverX, y1: padding.top, y2: y(0), stroke: '#4d6bfe', strokeOpacity: .35, strokeWidth: 1, strokeDasharray: '3 4', pointerEvents: 'none' })
              : null,
            h('path', { d: area, fill: 'url(#dsb-area-fill)' }),
            h('path', { d: line, fill: 'none', stroke: '#4d6bfe', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }),
            h('circle', { cx: x(Date.parse(last.t)), cy: y(last.v), r: 3.5, fill: '#4d6bfe', stroke: '#ffffff', strokeWidth: 2 }),
            hovered
              ? h('circle', { cx: hoverX, cy: hoverY, r: 4.5, fill: '#4d6bfe', stroke: '#ffffff', strokeWidth: 2, pointerEvents: 'none' })
              : null,
          ),
          hovered
            ? h(
                'div',
                { className: 'dsb-chart-tip', style: { left: `${tooltipLeft}%`, top: `${tooltipTop}%` } },
                h('div', { className: 'dsb-chart-tip-time' }, formatClock(hovered.t)),
                h('div', { className: 'dsb-chart-tip-value' }, money(hovered.v, currency)),
                h(
                  'div',
                  { className: `dsb-chart-tip-delta${hoverDelta === null ? '' : hoverDelta < 0 ? ' neg' : hoverDelta > 0 ? ' pos' : ''}` },
                  hoverDelta === null ? '区间起点' : `较上一点 ${signedMoney(hoverDelta, currency)}`,
                ),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dsb-chart-axis' },
          ...Array.from({ length: 5 }, (_, index) => {
            const timestamp = viewStart + (index / 4) * viewSpan
            return h('span', { key: index }, formatAxisTime(timestamp))
          }),
        ),
        h(
          'div',
          { className: 'dsb-chart-foot' },
          h('span', null, '区间最低 ', h('b', null, money(actualMinimum, currency))),
          h('span', null, '区间最高 ', h('b', null, money(actualMaximum, currency))),
          h('span', null, '区间变化 ', h('b', { className: difference < 0 ? 'neg' : difference > 0 ? 'pos' : '' }, signedMoney(difference, currency))),
          h('span', null, '采样 ', h('b', null, `${visible.length} 点`)),
        ),
      )
    }

    function TurnDetails({ turns, turnCount, currency }) {
      const shown = turns.slice(0, 30)
      return h(
        'div',
        { className: 'dsb-turn-list' },
        ...shown.map((turn) => {
          const untracked = turn.turnId === '__untracked__'
          const at = turn.startedAt || turn.lastAt
          const amount = turn.spentCents > 0
            ? signedMoney(-turn.spentCents, currency)
            : turn.addedCents > 0 ? signedMoney(turn.addedCents, currency) : '—'
          const sub = `${turn.deductionCount ?? turn.changeCount} 次扣减${turn.active ? ' · 进行中' : ''}`
          return h(
            'div',
            { className: 'dsb-turn-row', key: turn.turnId },
            h('span', { className: 'dsb-turn-time', title: at ? formatClock(at) : '' }, at ? GROUP_TIME.format(new Date(at)) : '—'),
            h(
              'span',
              { className: 'dsb-turn-main' },
              h(
                'span',
                { className: `dsb-turn-text${untracked ? ' muted' : ''}`, title: turn.userText ?? '' },
                untracked ? '未细分（升级前的记录）' : turn.userText || '未记录用户消息',
              ),
              h('span', { className: 'dsb-turn-sub' }, sub),
            ),
            h('span', { className: 'dsb-turn-amount' }, amount),
          )
        }),
        turnCount > shown.length ? h('div', { className: 'dsb-conv-empty' }, `仅显示最近 ${shown.length} / ${turnCount} 条消息`) : null,
      )
    }

    function ChangeDetails({ group, currency }) {
      return h(
        'div',
        null,
        h('div', { className: 'dsb-conv-empty' }, '这些记录产生时还没有消息级归因，下面是单次扣减明细。'),
        ...(group.changes ?? []).map((change) => h(
          'div',
          { className: 'dsb-conv-detail-row', key: change.id ?? `${change.at}-${change.currency}` },
          h('span', { className: 'dsb-conv-detail-time', title: formatClock(change.at) }, GROUP_TIME.format(new Date(change.at))),
          h('span', { className: 'dsb-conv-detail-main' }, `${change.before} → ${change.after}${change.trigger === 'manual' ? ' · 手动' : ''}`),
          h('span', { className: 'dsb-conv-detail-amount' }, signedMoney(change.deltaCents, currency)),
        )),
      )
    }

    function ConversationList({ groups, now, currency, totalGroups }) {
      const [expanded, setExpanded] = useState(null)
      if (!Array.isArray(groups) || groups.length === 0) {
        return h('div', { className: 'dsb-empty' }, h('strong', null, '还没有可归到对话的扣减'), h('span', null, '等下一次余额变化，或切到“按时间”查看单条查询记录。'))
      }
      const attributed = groups.filter((group) => group.sessionId || group.key === 'parallel').reduce((sum, group) => sum + group.spentCents, 0)
      const unattributed = groups.filter((group) => !group.sessionId && group.key !== 'parallel').reduce((sum, group) => sum + group.spentCents, 0)
      const maxSpent = Math.max(1, ...groups.map((group) => group.spentCents))
      const shown = groups.slice(0, 20)
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dsb-summary' },
          h('span', null, '已归属 ', h('b', { className: 'neg' }, signedMoney(-attributed, currency))),
          h('span', null, '未归属 ', h('b', { className: unattributed ? 'neg' : '' }, signedMoney(-unattributed, currency))),
          h('span', null, '对话 ', h('b', null, `${groups.filter((group) => group.sessionId).length}`)),
          totalGroups > shown.length ? h('span', null, `仅显示最近 ${shown.length} / ${totalGroups} 个`) : null,
        ),
        h(
          'div',
          { className: 'dsb-list' },
          ...shown.map((group) => {
            const isOpen = expanded === group.key
            const messagePart = group.turnCount > 0 ? `${group.turnCount} 条消息 · ` : ''
            const sub = group.active
              ? `进行中 · ${messagePart}${group.deductionCount ?? group.changeCount} 次扣减 · ${formatGroupRange(group.firstAt, group.lastAt)}`
              : group.key === 'parallel'
                ? `并行 ${group.sessionIds.length || '多'} 个对话，无法精确拆分 · ${formatGroupRange(group.firstAt, group.lastAt)}`
                : group.key === 'legacy'
                  ? `升级前的记录，没有对话信息 · ${formatGroupRange(group.firstAt, group.lastAt)}`
                  : group.key === 'unattributed'
                    ? `没有活跃对话可归属 · ${formatGroupRange(group.firstAt, group.lastAt)}`
                    : `${messagePart}${group.deductionCount ?? group.changeCount} 次扣减 · ${formatGroupRange(group.firstAt, group.lastAt)}`
            return h(
              'div',
              { className: 'dsb-conv', key: group.key },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsb-conv-row',
                  onClick: () => setExpanded(isOpen ? null : group.key),
                  'aria-expanded': isOpen,
                  title: group.sessionId ? group.sessionId : undefined,
                },
                h('span', { className: `dsb-conv-icon${group.active ? ' active' : ''}` }, h(ChatIcon)),
                h(
                  'span',
                  { className: 'dsb-conv-main' },
                  h(
                    'span',
                    { className: 'dsb-conv-title' },
                    h('span', { className: 'dsb-conv-title-text' }, group.title || '对话'),
                    group.active ? h('span', { className: 'dsb-live-tag' }, '进行中') : null,
                  ),
                  h('span', { className: 'dsb-conv-sub' }, sub),
                ),
                h(
                  'span',
                  { className: 'dsb-conv-right' },
                  h('span', { className: `dsb-conv-amount${group.spentCents > 0 ? ' neg' : ''}` }, group.spentCents > 0 ? signedMoney(-group.spentCents, currency) : group.addedCents > 0 ? signedMoney(group.addedCents, currency) : '—'),
                  h('span', { className: 'dsb-conv-time', title: formatClock(group.lastAt) }, group.active ? '现在' : formatRelative(group.lastAt, now)),
                ),
                h('span', { className: 'dsb-conv-chevron' }, isOpen ? '⌃' : '⌄'),
              ),
              group.spentCents > 0
                ? h('div', { className: 'dsb-conv-bar' }, h('span', { style: { width: `${Math.max(4, (group.spentCents / maxSpent) * 100)}%` } }))
                : null,
              isOpen
                ? h(
                    'div',
                    { className: 'dsb-conv-detail' },
                    Array.isArray(group.turns) && group.turns.length > 0
                      ? h(TurnDetails, { turns: group.turns, turnCount: group.turnCount ?? group.turns.length, currency })
                      : h(ChangeDetails, { group, currency }),
                  )
                : null,
            )
          }),
        ),
      )
    }

    function Timeline({ changes, now }) {
      return h(
        'div',
        { className: 'dsb-list' },
        ...changes.map((change) => {
          const kind = KIND_LABELS[change.kind] ?? KIND_LABELS.adjustment
          const negative = change.deltaCents < 0
          const sessionLabel = change.sessionTitle
            ? truncateText(change.sessionTitle, 22)
            : change.sessionIds?.length ? `并行 ${change.sessionIds.length} 个对话` : null
          return h(
            'div',
            { className: 'dsb-item', key: change.id ?? `${change.at}-${change.currency}` },
            h('div', { className: `dsb-item-icon ${kind.tone}` }, negative ? '↓' : '↑'),
            h(
              'div',
              null,
              h(
                'div',
                { className: 'dsb-item-title' },
                kind.text,
                h('span', { className: 'dsb-tag' }, change.currency),
                sessionLabel ? h('span', { className: 'dsb-tag dsb-tag-session', title: change.sessionId ?? '' }, sessionLabel) : null,
                change.trigger === 'manual' ? h('span', { className: 'dsb-tag' }, '手动刷新') : null,
              ),
              h('div', { className: 'dsb-item-sub' }, `${change.before} → ${change.after}`),
            ),
            h(
              'div',
              { className: 'dsb-item-amount' },
              h('div', { className: negative ? 'neg' : 'pos' }, signedMoney(change.deltaCents, change.currency)),
              h('div', { className: 'dsb-item-time', title: formatClock(change.at) }, formatRelative(change.at, now)),
            ),
          )
        }),
      )
    }

    function History({ data, now }) {
      const [view, setView] = useState(data.conversations?.length ? 'conversation' : 'timeline')
      const changes = Array.isArray(data.changes) ? data.changes : []
      const groups = Array.isArray(data.conversations) ? data.conversations : []
      const hasAny = changes.length > 0 || groups.length > 0
      const needsRestart = Number(data.version) < 3 || !Array.isArray(data.conversations)
      return h(
        'section',
        { className: 'dsb-card dsb-history' },
        h(
          'div',
          { className: 'dsb-card-head' },
          h(
            'div',
            null,
            h('div', { className: 'dsb-card-title' }, '对话账单'),
            h('div', { className: 'dsb-card-sub' }, view === 'conversation'
              ? '同一对话的多次扣减合并为一行；展开看每条用户消息的扣减'
              : '按两次成功查询的差额记录；类型按钱包变化推断，接口本身可能有延迟'),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h(
              'div',
              { className: 'dsb-seg-control' },
              h('button', { type: 'button', className: view === 'conversation' ? 'on' : '', onClick: () => setView('conversation') }, '按对话'),
              h('button', { type: 'button', className: view === 'timeline' ? 'on' : '', onClick: () => setView('timeline') }, '按时间'),
            ),
            h('a', { className: 'dsb-btn', href: EXPORT_ENDPOINT, download: 'ds-balance-history.csv' }, '导出 CSV'),
          ),
        ),
        needsRestart
          ? h(
              'div',
              { className: 'dsb-alert' },
              h('span', null, '↻'),
              h('div', null, h('strong', null, '消息级明细要重启 DSH 后生效'), h('div', null, '新宿主会按每条用户消息记录扣减；旧记录归入“未细分”，不会丢失。')),
            )
          : null,
        !hasAny
          ? h('div', { className: 'dsb-empty' }, h('strong', null, '还没有记录到变动'), h('span', null, '第一次查询只建立基线；之后余额增加或减少，都会在这里留下一条记录。'))
          : view === 'conversation'
            ? h(ConversationList, { groups, now, currency: data.primary?.currency, totalGroups: data.conversationCount ?? groups.length })
            : h(Timeline, { changes, now }),
      )
    }

    function FullError({ snapshot, refresh }) {
      const message = snapshot.error?.message ?? '未知错误'
      return h(
        'div',
        { className: 'dsb-full-error' },
        h('h2', null, '暂时读不到 DeepSeek 余额'),
        h('p', null, message),
        h('p', null, '插件使用 DSH 已保存的 DEEPSEEK_API_KEY 访问余额接口。可以在“设置 → 模型”里保存 Key，或设置同名环境变量后重启 DSH。'),
        h('button', { className: 'dsb-btn dsb-btn-primary', type: 'button', onClick: () => void refresh(true) }, snapshot.refreshing ? h('span', { className: 'dsb-spin' }) : null, '重试'),
        h('a', { className: 'dsb-btn', href: 'https://platform.deepseek.com/top_up', target: '_blank', rel: 'noreferrer' }, '打开充值页'),
      )
    }

    function BalancePage({ useBalance, refresh, openPanel }) {
      const snapshot = useBalance((value) => value)
      const data = snapshot.data
      const now = useNow(30_000)
      const [range, setRange] = useState('24h')

      if ((!data || !data.primary) && snapshot.loading) {
        return h(
          'div',
          { className: 'dsb-page' },
          h(
            'div',
            { className: 'dsb-inner' },
            h('div', { className: 'dsb-kicker' }, 'DEEPSEEK API · 余额监控'),
            h('h1', { className: 'dsb-title' }, h(KickerIcon), '余额与峰谷'),
            h('p', { className: 'dsb-sub' }, '正在建立基线并读取余额…'),
            h(
              'div',
              { className: 'dsb-grid', style: { marginTop: 24 } },
              ...[0, 1, 2].map((index) => h('div', { className: 'dsb-skeleton', key: index },
                h('div', { className: 'dsb-skeleton-line', style: { width: '35%' } }),
                h('div', { className: 'dsb-skeleton-line', style: { width: '62%', height: 30 } }),
                h('div', { className: 'dsb-skeleton-line', style: { width: '80%' } }),
              )),
            ),
          ),
        )
      }
      if (!data) return h('div', { className: 'dsb-page' }, h('div', { className: 'dsb-inner' }, h(FullError, { snapshot, refresh })))

      const phase = data.phase
      const hasError = Boolean(data.error || snapshot.error)
      const statusText = data.status === 'stale' ? '显示上次成功数据' : null
      return h(
        'div',
        { className: 'dsb-page' },
        h(
          'div',
          { className: 'dsb-inner' },
          h(
            'header',
            { className: 'dsb-top' },
            h(
              'div',
              null,
              h('div', { className: 'dsb-kicker' }, 'DEEPSEEK API · 余额监控'),
              h('h1', { className: 'dsb-title' }, h(KickerIcon), '余额与峰谷'),
              h('p', { className: 'dsb-sub' }, '余额、峰谷、按对话记账，都在这一个面板里。'),
            ),
            h(
              'div',
              { className: 'dsb-actions' },
              h('button', { type: 'button', className: 'dsb-btn dsb-btn-primary', onClick: () => void refresh(true), disabled: snapshot.refreshing }, snapshot.refreshing ? h('span', { className: 'dsb-spin' }) : null, '刷新'),
              h('a', { className: 'dsb-btn', href: 'https://platform.deepseek.com/top_up', target: '_blank', rel: 'noreferrer' }, '充值'),
              h('a', { className: 'dsb-btn', href: EXPORT_ENDPOINT, download: 'ds-balance-history.csv' }, '导出'),
            ),
          ),
          h(StatusMeta, { snapshot, now }),
          hasError
            ? h(
                'div',
                { className: 'dsb-alert' },
                h('span', null, '⚠'),
                h(
                  'div',
                  null,
                  h('strong', null, statusText ?? '余额读取失败'),
                  h('div', null, snapshot.error?.message ?? data.error?.message ?? '未知错误'),
                  data.error?.code ? h('div', null, '错误码 ', h('code', null, data.error.code)) : null,
                  h('div', null, '后台会继续按间隔重试；已产生的历史记录不会丢失。'),
                ),
              )
            : null,
          h(
            'div',
            { className: 'dsb-grid' },
            h(BalanceCard, { data, now }),
            h(PhaseCard, { phase, now }),
            h(StatsCard, { data }),
          ),
          h(
            'section',
            { className: 'dsb-card dsb-chart-card' },
            h(
              'div',
              { className: 'dsb-card-head' },
              h('div', null, h('div', { className: 'dsb-card-title' }, '余额走势'), h('div', { className: 'dsb-card-sub' }, '折线只记录本机看到的变化；不是平台账单')),
              h(
                'div',
                { className: 'dsb-seg-control' },
                h('button', { type: 'button', className: range === '24h' ? 'on' : '', onClick: () => setRange('24h') }, '24 小时'),
                h('button', { type: 'button', className: range === '7d' ? 'on' : '', onClick: () => setRange('7d') }, '7 天'),
              ),
            ),
            h(Chart, { data, range }),
          ),
          h(History, { data, now }),
          h(
            'div',
            { className: 'dsb-footer' },
            h('span', null, '余额接口 ', h('code', null, 'api.deepseek.com/user/balance'), '；后台每 ', h('code', null, `${Math.round((data.pollIntervalMs ?? 20000) / 1000)}s`), ' 查询一次。'),
            h('span', null, '峰谷按北京时间：工作日 09:00–12:00、14:00–18:00 为高峰，其余为空闲；周末及法定节假日全天空闲。'),
            h('span', null, data.attributionRule ?? '余额变化归到变化发生时正在运行的对话。'),
            h('span', null, 'API Key 只留在宿主进程，不会下发到浏览器。'),
            h('span', null, '历史文件 ', h('code', null, data.source?.historyFile ?? 'history.json')),
          ),
        ),
      )
    }

    function apply(ctx) {
      const store = createBalanceStore()

      ctx.effect(() => {
        store.start()
        return () => store.stop()
      }, 'ds-balance: client polling and SSE')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dsBalance = '1'
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      }, 'ds-balance: styles')

      const face = {
        hooks: { balance: store },
        refresh: (force = true) => store.refresh(force),
        openPanel: () => ctx.layout.selectPanel(PANEL_ID),
      }

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => face,
      }, BalancePage))

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'ds-balance-footer',
        order: -10,
        inject: () => face,
      }, FooterBalance))
    }

    exports.PANEL_ID = PANEL_ID
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
