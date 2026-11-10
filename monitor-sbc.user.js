// ==UserScript==
// @name         3CX | Monitor de SBCs
// @namespace    local.3cx.sbc.monitor
// @version      1.0.4
// @description  Monitor de SBCs em qualquer aba. Abertura do dia fixa, situação atual separada e atualização pelo próprio painel.
// @updateURL    https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js
// @downloadURL  https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

// REGRA DE PUBLICAÇÃO — obrigatória para qualquer IA que altere este arquivo:
// 1. Aumente // @version e a constante VERSION juntos (exemplo: 1.0.4 → 1.0.5).
// 2. Mantenha @updateURL, @downloadURL e UPDATE_URL iguais a:
//    https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js
// 3. Copie este arquivo para o clone do repositório como monitor-sbc.user.js.
// 4. Atualize "Versão publicada" no README.md do mesmo repositório.
// 5. Faça commit e git push na branch main de:
//    https://github.com/danielm712/Painel-Monitoramento-3cx.git
// Sem esse push, Verificar atualização não entrega a versão nova aos analistas.
// Vale para esta conversa e para qualquer outra IA que edite o script.

(() => {
'use strict';
if (window.top !== window.self) return;
if (window.__TMX_SBC_MONITOR__) return; window.__TMX_SBC_MONITOR__ = true;
const SERVERS_KEY='sbc-monitor-v6:servers', PENDING_ALERT_KEY='sbc-monitor-v7:pending-alert';
const defaults=[{name:'tank',url:'https://tank.3cx.com.br:5001/#/office/voice-and-chat'},{name:'propus',url:'https://propus.my3cx.com.br:5001/#/office/voice-and-chat'}];
function validServer(s){try{const u=new URL(s.url);return typeof s.name==='string'&&u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
let servers=GM_getValue(SERVERS_KEY,defaults); if(!Array.isArray(servers)||!servers.length) servers=defaults;
servers=servers.filter(validServer); if(!servers.length) servers=defaults;
const originOf=s=>new URL(s.url).origin, currentOrigin=location.origin;
const tokenKey=s=>`sbc-monitor-v6:token:${originOf(s)}`;
const snapshotKey=s=>`sbc-monitor-v6:snapshot:${originOf(s)}`;
const stateKey=s=>`sbc-monitor-v7:states:${originOf(s)}`;
const logKey=d=>`sbc-monitor-v7:log:${d}`;
const layoutKey=`sbc-monitor-v6:layout:${currentOrigin}`;
const DAILY='sbc-monitor-v9:daily:', LEASE='sbc-monitor-v9:leader', COMMAND='sbc-monitor-v9:refresh', CONFIG='sbc-monitor-v9:config';
const CHECK_MS=60000, STALE_MS=150000, LEASE_MS=20000;
const SUMMARY='sbc-monitor-v92:summary:', CURRENT='sbc-monitor-v10:current:', FOLLOWUP='sbc-monitor-v95:followups:', FOLLOWUP_ACK='sbc-monitor-v95:followup-ack:', FOLLOWUP_META='sbc-monitor-v95:followup-meta:', ZONE='America/Sao_Paulo';
const UPDATE_URL='https://raw.githubusercontent.com/danielm712/Painel-Monitoramento-3cx/main/monitor-sbc.user.js', RETENTION_DAYS=30;
function loadConfig(v){const o=v&&typeof v==='object'?v:{};const url=typeof o.updateUrl==='string'&&/^https:\/\/\S+\.user\.js(?:\?.*)?$/.test(o.updateUrl.trim())?o.updateUrl.trim():'';return {...o,opening:/^([01]\d|2[0-3]):[0-5]\d$/.test(o?.opening)?o.opening:'08:00',intervalSeconds:Number.isInteger(o?.intervalSeconds)&&o.intervalSeconds>=30&&o.intervalSeconds<=3600?o.intervalSeconds:CHECK_MS/1000,followUpMinutes:Number.isInteger(o?.followUpMinutes)&&o.followUpMinutes>=0&&o.followUpMinutes<=240?o.followUpMinutes:15,minOfflineMinutes:Number.isInteger(o?.minOfflineMinutes)&&o.minOfflineMinutes>=1&&o.minOfflineMinutes<=30?o.minOfflineMinutes:3,updateUrl:url};}
const checkMs=()=>config.intervalSeconds*1000;
const tabId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`;
let config=GM_getValue(CONFIG,{opening:'08:00'}), layout=GM_getValue(layoutKey,{})||{};
config=loadConfig(config);
const state={open:!!layout.open,section:['history','alerts'].includes(layout.section)?layout.section:'servers',settings:false,view:'all',filter:'all',busy:false,lastPoll:0,snapshots:{},captureMessage:'',alertDay:null,historyDay:null,alertFollowUp:null,currentOpen:false,editingNameOrigin:null,statsHelpOpen:false,technicalOpen:false,technicalScroll:0,pendingAlert:GM_getValue(PENDING_ALERT_KEY,null),expanded:null,historyFilter:['all','caiu','voltou','sessao','info','erro'].includes(layout.historyFilter)?layout.historyFilter:'all',prefs:false,returnTo:'',menu:false,confirm:false,hiddenTab:false,startedAt:Date.now(),errorDetails:''};
let stopped=false, acquiring=false, leader=false, commandSeen=GM_getValue(COMMAND,null)?.id, pollStart=0, captureBusy=false;
// ---- UI 0.9.3: tokens, Shadow DOM, helpers (DOM nodes only: h() + createElementNS) ----
const VERSION='1.0.4', PREFS='sbc-monitor-v91:prefs';
const PREF_DEFAULTS=Object.freeze({theme:'auto',compact:false,animations:true,anySite:true,rememberPosition:true});
function loadPrefs(v){const p={...PREF_DEFAULTS,...(v&&typeof v==='object'?v:{})};if(!['light','dark','auto'].includes(p.theme))p.theme='auto';for(const k of ['compact','animations','anySite','rememberPosition'])p[k]=!!p[k];return p;}
let prefs=loadPrefs(GM_getValue(PREFS,null));
// 0.9.0 always saved its default 440x580 size on first paint; treat that as "no custom size".
if(!layout.v91){if(layout.panel&&layout.panel.w===440&&layout.panel.h===580){layout.panel.w=400;layout.panel.h=640;}layout.v91=1;}
const STRINGS={
 title:'Monitor SBC',tabs:{servers:'Servidores',alerts:'Alerta',history:'Histórico'},
 openFab:'Abrir Monitor SBC (Alt+Shift+M)',minimize:'Recolher painel (Esc)',hide:'Ocultar nesta aba',settings:'Configurações',theme:'Alternar tema claro/escuro',
 refresh:'Atualizar',refreshing:'Atualizando…',back:'Voltar',
};
const CSS=`:host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;color-scheme:light;font:13px/1.5 var(--font-sans);color:var(--text);-webkit-font-smoothing:antialiased;
--bg:#fff;--bg-subtle:#f8fafc;--bg-muted:#f1f5f9;--border:#e2e8f0;--border-strong:#cbd5e1;--text:#0f172a;--text-muted:#475569;--text-subtle:#64748b;--accent:#2563eb;--on-accent:#fff;--success:#16a34a;--warning:#d97706;--danger:#dc2626;--info:#0284c7;--overlay:rgb(15 23 42 / .45);
--shadow-sm:0 1px 2px rgb(16 24 40 / .06),0 1px 3px rgb(16 24 40 / .08);--shadow-md:0 4px 8px -2px rgb(16 24 40 / .10),0 2px 4px -2px rgb(16 24 40 / .06);--shadow-lg:0 16px 32px -8px rgb(16 24 40 / .18),0 4px 8px -4px rgb(16 24 40 / .08)}
:host([data-theme='dark']){color-scheme:dark;--bg:#0f1524;--bg-subtle:#151c2e;--bg-muted:#1c2438;--border:#263149;--border-strong:#364562;--text:#f1f5f9;--text-muted:#cbd5e1;--text-subtle:#94a3b8;--overlay:rgb(2 6 23 / .6);--shadow-sm:0 1px 2px rgb(0 0 0 / .4);--shadow-md:0 4px 12px rgb(0 0 0 / .45);--shadow-lg:0 16px 40px rgb(0 0 0 / .6),0 0 0 1px rgb(255 255 255 / .04)}
:host{--accent-hover:color-mix(in srgb,var(--accent) 88%,#000);--accent-subtle:color-mix(in srgb,var(--accent) 10%,var(--bg));--accent-border:color-mix(in srgb,var(--accent) 35%,var(--bg));--accent-text:color-mix(in srgb,var(--accent) 70%,var(--text));--ring:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent);
--font-sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--fs-xs:11px;--fs-sm:12px;--fs-md:13px;--fs-lg:14px;--fs-xl:16px;--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--r-sm:6px;--r-md:8px;--r-card:10px;--r-lg:12px;--r-full:999px;--ease-out:cubic-bezier(.16,1,.3,1);--dur-fast:120ms;--dur-base:180ms;--dur-slow:240ms}
*{box-sizing:border-box}
[hidden]{display:none !important}
button,input{font:inherit;color:inherit;margin:0;appearance:none;-webkit-appearance:none}
button{cursor:pointer;background:none;border:0;padding:0;text-align:inherit}
button:disabled{opacity:.5;cursor:not-allowed}
:focus{outline:none}
:focus-visible{outline:none;box-shadow:var(--ring)}
.ic{stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}
.panel{position:fixed;pointer-events:auto;display:flex;flex-direction:column;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);overflow:hidden;min-width:320px;min-height:320px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);resize:both;contain:layout paint style;transition:opacity var(--dur-slow) var(--ease-out),transform var(--dur-slow) var(--ease-out)}
.panel.entering{opacity:0;transform:translateY(6px) scale(.98)}
.panel.sheet{border-radius:16px 16px 0 0;resize:none;max-width:100vw;padding-bottom:env(safe-area-inset-bottom)}
.hd{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);user-select:none;cursor:grab;touch-action:none;flex:none}
.hd.dragging{cursor:grabbing}
.mono{width:20px;height:20px;border-radius:var(--r-sm);background:var(--accent);color:var(--on-accent);display:grid;place-items:center;flex:none}
.title{flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden}
.title b{font-size:var(--fs-lg);font-weight:600}
.title small{font-size:var(--fs-sm);color:var(--text-subtle)}
.ib{width:28px;height:28px;border-radius:var(--r-sm);display:inline-grid;place-items:center;color:var(--text-subtle);flex:none;transition:background-color var(--dur-fast),color var(--dur-fast),transform var(--dur-fast)}
.ib.rel{position:relative}
.hcnt{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;padding:0 4px;border-radius:var(--r-full);background:var(--danger);color:var(--on-accent);font-size:10px;font-weight:600;line-height:1;display:grid;place-items:center;border:2px solid var(--bg);font-variant-numeric:tabular-nums;pointer-events:none;z-index:1}
.hcnt.i{position:static;display:inline-grid;min-width:16px;height:16px;margin-left:2px;vertical-align:middle}
.ib:hover:not(:disabled),.ib[aria-pressed='true']{background:var(--bg-muted);color:var(--text)}
.ib:active:not(:disabled),.btn:active:not(:disabled),.chip:active{transform:scale(.98)}
.tabs{display:flex;gap:var(--sp-4);padding:0 var(--sp-4);border-bottom:1px solid var(--border);flex:none;user-select:none}
.tab{position:relative;padding:var(--sp-2) 0 10px;font-weight:500;color:var(--text-subtle);display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-sm) var(--r-sm) 0 0}
.tab:hover,.tab[aria-selected='true']{color:var(--text)}
.tab::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--accent);transform:scaleX(0);transition:transform var(--dur-base) var(--ease-out)}
.tab[aria-selected='true']::after{transform:scaleX(1)}
.cnt{min-width:20px;height:20px;padding:0 6px;border-radius:var(--r-full);font-size:var(--fs-xs);font-weight:500;display:inline-grid;place-items:center;background:var(--accent-subtle);border:1px solid var(--accent-border);color:var(--accent-text);font-variant-numeric:tabular-nums}
.body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4)}
:host(.compact) .body{padding:var(--sp-3);gap:var(--sp-3)}
:host(.compact) td{padding:var(--sp-1) var(--sp-3)}
:host(.compact) .evt,:host(.compact) .ti,:host(.compact) .li{padding:var(--sp-2) 0}
.foot{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3) var(--sp-2) var(--sp-4);border-top:1px solid var(--border);background:var(--bg-subtle);color:var(--text-subtle);font-size:var(--fs-sm);flex:none}
.foot .btn.ghost{background:var(--bg)}
.foot .grow{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.tone-s{--t:var(--success)}.tone-w{--t:var(--warning)}.tone-d{--t:var(--danger)}.tone-i{--t:var(--info)}.tone-n{--t:var(--text-subtle)}
.tbg{background:color-mix(in srgb,var(--t) 12%,var(--bg));border:1px solid color-mix(in srgb,var(--t) 30%,var(--bg));color:color-mix(in srgb,var(--t) 65%,var(--text))}
.ttx{color:color-mix(in srgb,var(--t) 65%,var(--text))}
.tic{color:var(--t)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 var(--sp-3);border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:500;border:1px solid var(--border-strong);background:var(--bg);color:var(--text);box-shadow:var(--shadow-sm);white-space:nowrap;flex:none;transition:background-color var(--dur-fast),border-color var(--dur-fast),transform var(--dur-fast)}
.btn:hover:not(:disabled){background:var(--bg-subtle)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.primary:hover:not(:disabled){background:var(--accent-hover)}
.btn.ghost{border-color:transparent;background:transparent;box-shadow:none;color:var(--text-muted)}
.btn.ghost:hover:not(:disabled){background:var(--bg-muted);color:var(--text)}
.btn.sm{height:24px;padding:0 var(--sp-2)}
.badge{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 var(--sp-2);border-radius:var(--r-full);font-size:var(--fs-xs);font-weight:500;white-space:nowrap;font-variant-numeric:tabular-nums;flex:none}
.d{width:6px;height:6px;border-radius:50%;background:var(--t);flex:none}
.dot{width:8px;height:8px;border-radius:50%;background:var(--t);flex:none}
.alert{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);border-radius:var(--r-md);flex:none}
.alert.top{align-items:flex-start;padding:var(--sp-3)}
.row{display:flex;align-items:center;gap:var(--sp-2)}
.wrap{flex-wrap:wrap}
.top-al{align-items:flex-start}
.grow{flex:1;min-width:0}
.end{justify-content:flex-end}
.ct{font-weight:600}
.sub{color:var(--text-subtle);font-size:var(--fs-sm)}
.mut{color:var(--text-muted)}
.num{font-variant-numeric:tabular-nums}
.trunc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2);flex:none}
.card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-card);padding:var(--sp-3);box-shadow:var(--shadow-sm);min-width:0}
.server-block{cursor:pointer;transition:border-color var(--dur-fast),box-shadow var(--dur-fast)}
.server-block:hover{border-color:var(--border-strong)}
.server-block.expanded{grid-column:1 / -1;border-color:var(--accent-border);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
.cardhead{display:flex;align-items:center;gap:var(--sp-2);width:100%;border-radius:var(--r-sm)}
.cardhead .name{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chev{color:var(--text-subtle);transition:transform var(--dur-base) var(--ease-out)}
.expanded .chev{transform:rotate(90deg)}
.kpi{display:flex;gap:var(--sp-3);align-items:baseline;margin-top:6px;flex-wrap:wrap}
.kpi b{font-size:var(--fs-xl);font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.kpi span{font-size:var(--fs-sm);color:var(--text-subtle);margin-left:var(--sp-1)}
.kpi .zero{color:var(--text-subtle)}
.sbc-list{margin-top:var(--sp-3)}
.sbc-row{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) 0;border-top:1px solid var(--border)}
.sbc-row .name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sec{font-size:var(--fs-md);font-weight:600;line-height:1.3;margin-bottom:var(--sp-2)}
.day-hd{padding:var(--sp-2) 0 var(--sp-1);font-size:var(--fs-sm);font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border);margin-bottom:var(--sp-1)}
.day-hd:first-child{margin-top:0}
.list-day{display:flex;flex-direction:column;gap:0;flex:none}
.list-day .ti,.list-day .evt{border-top:0}
.list-day .ti+.ti,.list-day .evt+.evt{border-top:1px solid var(--border)}
.ti.compact-evt{cursor:default;padding:var(--sp-2) 0}
.min0{min-width:0}
.follow-sec{margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--border)}
.acard{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--bg);flex:none}
.acard.wait{border-color:color-mix(in srgb,var(--warning) 50%,var(--border))}
.acard .hd{display:flex;align-items:baseline;gap:8px}
.acard .hd b{font-size:var(--fs-sm);font-weight:600;color:var(--text-muted)}
.acard .fact{font-size:var(--fs-lg);font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.st{margin-left:auto;font-size:var(--fs-xs);font-weight:600;flex:none}
.st.ok{color:var(--success)}
.st.no{color:var(--warning)}
.tw{border:1px solid var(--border);border-radius:var(--r-card);overflow:hidden;flex:none}
table{width:100%;border-collapse:collapse}
th{position:sticky;top:0;background:var(--bg-subtle);color:var(--text-muted);font-size:var(--fs-sm);font-weight:600;text-align:left;padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--border)}
td{padding:6px var(--sp-3);border-bottom:1px solid var(--border)}
tbody tr:hover td{background:var(--bg-subtle)}
.r{text-align:right;font-variant-numeric:tabular-nums}
tfoot td{font-weight:600;border-bottom:0;background:var(--bg-subtle)}
.mutd{color:var(--text-subtle)}
.msg{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--fs-sm)/1.5 var(--font-mono);background:var(--bg-subtle);border:1px solid var(--border);border-radius:var(--r-md);padding:var(--sp-3);margin:var(--sp-3) 0;color:var(--text)}
.pending{border-color:var(--accent-border)}
.ti{width:100%;display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) 0;border-top:1px solid var(--border)}
.ti .tm{width:40px;font-weight:600;font-variant-numeric:tabular-nums;flex:none}
.ti .lb{font-weight:500}
.chips{display:flex;flex-wrap:wrap;gap:var(--sp-1)}
.chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--r-sm);border:1px solid var(--border);color:var(--text-muted);font-size:var(--fs-sm);font-weight:500;transition:background-color var(--dur-fast)}
.chip:hover{background:var(--bg-subtle)}
.chip[aria-pressed='true']{background:var(--accent-subtle);border-color:var(--accent-border);color:var(--accent-text)}
.evt{width:100%;display:flex;gap:var(--sp-3);padding:var(--sp-3) 0;border-top:1px solid var(--border)}
.evt .tile{width:28px;height:28px;border-radius:var(--r-md);display:grid;place-items:center;flex:none}
.evt .t{font-weight:600}
.sk{background:var(--bg-muted);border-radius:var(--r-sm);animation:tmxpulse 1.4s ease-in-out infinite}
.sk.l{height:12px}.sk.k{height:24px;width:36px}.w55{width:55%}.w40{width:40%}.w90{width:90%}.w80{width:80%}.w70{width:70%}.w60{width:60%}.w30{width:96px}
.skrow{padding:var(--sp-3)}.skrow+.skrow{border-top:1px solid var(--border)}
@keyframes tmxpulse{50%{opacity:.55}}
.spin{animation:tmxspin .8s linear infinite}
@keyframes tmxspin{to{transform:rotate(360deg)}}
.prog{height:6px;border-radius:var(--r-full);background:var(--bg-muted);overflow:hidden;margin-top:var(--sp-2)}
.prog i{display:block;height:100%;background:var(--accent);border-radius:inherit;transition:width var(--dur-slow) var(--ease-out)}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:var(--sp-2);padding:var(--sp-6) var(--sp-4)}
.empty .ci{width:48px;height:48px;border-radius:50%;background:var(--bg-muted);display:grid;place-items:center;color:var(--text-subtle)}
.empty .et{font-size:var(--fs-lg);font-weight:600;line-height:1.3;text-wrap:balance}
.empty .ed{color:var(--text-muted);max-width:290px}
.empty .row{margin-top:var(--sp-2)}
details{width:100%;text-align:left;margin-top:var(--sp-4)}
summary{cursor:pointer;color:var(--text-muted);font-size:var(--fs-sm);border-radius:var(--r-sm);user-select:none}
.stats-help{margin:0;flex:none}
.stats-help summary{color:var(--text-subtle);padding:2px 0}
.stats-help summary:hover{color:var(--text-muted)}
.stats-dl{margin:var(--sp-1) 0 0;padding:var(--sp-2) var(--sp-3);background:var(--bg-subtle);border-radius:var(--r-sm);border:1px solid var(--border)}
.stats-dl dt{font-size:var(--fs-sm);font-weight:600;color:var(--text-muted);margin-top:var(--sp-2)}
.stats-dl dt:first-child{margin-top:0}
.stats-dl dd{margin:2px 0 0;font-size:var(--fs-sm);color:var(--text-subtle);line-height:1.45}
.h2{font-size:var(--fs-xl);font-weight:600;letter-spacing:-.01em;line-height:1.3}
.li{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) 0;border-top:1px solid var(--border)}
.list{flex:none}
.lbl{font-size:var(--fs-sm);font-weight:500;color:var(--text-muted);margin-bottom:var(--sp-1)}
.field{height:32px;border:1px solid var(--border-strong);border-radius:var(--r-sm);padding:0 10px;background:var(--bg);color:var(--text);cursor:text;min-width:0;transition:border-color var(--dur-fast)}
.field:focus,.field:focus-visible{border-color:var(--accent);box-shadow:var(--ring)}
.field::placeholder{color:var(--text-subtle)}
.field[aria-invalid='true']{border-color:var(--danger)}
.field.time{width:112px;font-variant-numeric:tabular-nums}
.set{display:flex;flex-direction:column}
.set .li{padding:6px 0;min-height:40px}
.set+.set{margin-top:calc(var(--sp-2) * -1)}
.sw{width:36px;height:20px;border-radius:var(--r-full);background:var(--border-strong);position:relative;flex:none;transition:background-color var(--dur-fast)}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--on-accent);box-shadow:var(--shadow-sm);transition:transform var(--dur-fast) var(--ease-out)}
.sw[aria-checked='true']{background:var(--accent)}
.sw[aria-checked='true']::after{transform:translateX(16px)}
.seg{display:flex;padding:2px;background:var(--bg-muted);border-radius:var(--r-md);flex:none}
.seg button{padding:var(--sp-1) 10px;border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:500;color:var(--text-muted)}
.seg button[aria-checked='true']{background:var(--bg);color:var(--text);box-shadow:var(--shadow-sm)}
kbd{font:var(--fs-xs) var(--font-mono);border:1px solid var(--border-strong);border-radius:4px;padding:1px 5px;color:var(--text-muted)}
.fab{position:fixed;pointer-events:auto;width:48px;height:48px;border-radius:var(--r-lg);background:var(--accent);color:var(--on-accent);display:grid;place-items:center;box-shadow:var(--shadow-md);cursor:grab;touch-action:none;transition:background-color var(--dur-fast),transform var(--dur-fast)}
.fab:hover{background:var(--accent-hover)}
.fab .fb{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 var(--sp-1);border-radius:var(--r-full);background:var(--danger);color:var(--on-accent);font-size:var(--fs-xs);font-weight:600;display:grid;place-items:center;border:2px solid var(--bg);font-variant-numeric:tabular-nums}
.fab .fb.warn{background:var(--warning)}
.fab::before{content:attr(data-tip);position:absolute;right:calc(100% + var(--sp-2));top:50%;transform:translateY(-50%);background:var(--text);color:var(--bg);font-size:var(--fs-sm);line-height:1.5;padding:var(--sp-1) var(--sp-2);border-radius:var(--r-sm);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity var(--dur-fast) 400ms}
.fab:hover::before,.fab:focus-visible::before,.fab.show-tip::before{opacity:1}
.fab.show-tip::before{transition:none}
.toasts{position:fixed;right:20px;bottom:20px;width:min(360px,calc(100vw - 40px));display:flex;flex-direction:column;gap:var(--sp-2);pointer-events:none}
.toast{pointer-events:auto;display:flex;align-items:flex-start;gap:var(--sp-3);padding:var(--sp-3);background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r-card);box-shadow:var(--shadow-md);animation:tmxin var(--dur-base) var(--ease-out)}
.toast .tt{font-weight:600}
.toast .td{font-size:var(--fs-sm);color:var(--text-muted)}
.toast .btn{margin-top:var(--sp-2)}
.toast .ib{width:20px;height:20px}
@keyframes tmxin{from{opacity:0;transform:translateY(6px)}}
.overlay{position:absolute;inset:0;background:var(--overlay);display:grid;place-items:center;padding:var(--sp-4);z-index:2;animation:tmxfade var(--dur-base) var(--ease-out)}
@keyframes tmxfade{from{opacity:0}}
.dialog{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-lg);padding:var(--sp-5);width:100%;max-width:340px;display:flex;flex-direction:column;gap:var(--sp-2)}
.dialog .row{margin-top:var(--sp-3)}
.rel{position:relative}
.menu{position:absolute;right:0;top:calc(100% + var(--sp-1));min-width:168px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-md);padding:var(--sp-1);z-index:3}
.menu button{display:flex;width:100%;height:32px;align-items:center;gap:var(--sp-2);padding:0 var(--sp-2);border-radius:var(--r-sm);font-size:var(--fs-sm)}
.menu button:hover,.menu button:focus-visible{background:var(--bg-muted)}
:host(.no-anim) *,:host(.no-anim) *::before,:host(.no-anim) *::after{animation:none !important;transition:none !important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none !important;transition-duration:1ms !important}}
@media print{:host{display:none}}
`;
const NS='http://www.w3.org/2000/svg';
const P=d=>['path',{d}],C=(cx,cy,r)=>['circle',{cx,cy,r}],R=(x0,y0,w,hh,rx)=>['rect',{x:x0,y:y0,width:w,height:hh,rx}];
const ICONS={
 act:[P('M22 12h-4l-3 9L9 3l-3 9H2')],sun:[C(12,12,4),P('M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4')],
 moon:[P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z')],sliders:[P('M20 7h-9M14 17H5'),C(17,17,3),C(7,7,3)],minus:[P('M5 12h14')],x:[P('M18 6 6 18M6 6l12 12')],
 refresh:[P('M21 12a9 9 0 1 1-3-6.7L21 8'),P('M21 3v5h-5')],copy:[R(9,9,13,13,2),P('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')],
 check:[P('M20 6 9 17l-5-5')],checkCircle:[C(12,12,10),P('m9 12 2 2 4-4')],xCircle:[C(12,12,10),P('m15 9-6 6M9 9l6 6')],
 down:[P('m7 7 10 10M17 7v10H7')],up:[P('M7 17 17 7M7 7h10v10')],warn:[P('m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z'),P('M12 9v4M12 17h.01')],
 info:[C(12,12,10),P('M12 16v-4M12 8h.01')],ext:[P('M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5')],
 download:[P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3')],lock:[R(3,11,18,11,2),P('M7 11V7a5 5 0 0 1 10 0v4')],
 chevD:[P('m6 9 6 6 6-6')],chevR:[P('m9 18 6-6-6-6')],back:[P('m15 18-6-6 6-6')],wifiOff:[P('M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2-1.5M12 20h.01')],
 trash:[P('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6')],inbox:[P('M22 12h-6l-2 3h-4l-2-3H2'),P('M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z')],
 loader:[P('M21 12a9 9 0 1 1-6.2-8.6')],plus:[P('M12 5v14M5 12h14')],
};
function svg(name,size=16,cls=''){const s=document.createElementNS(NS,'svg');for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,class:('ic '+cls).trim(),'aria-hidden':'true',focusable:'false'}))s.setAttribute(k,String(v));
 for(const [tag,attrs] of ICONS[name]||[]){const c=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))c.setAttribute(k,String(v));s.append(c);}return s;}
function h(tag,props,...kids){const e=document.createElement(tag);
 for(const [k,v] of Object.entries(props||{})){if(v==null||v===false)continue;
  if(k==='class')e.className=v;else if(k==='text')e.textContent=String(v);else if(k==='dataset')Object.assign(e.dataset,v);
  else if(k.startsWith('on')&&typeof v==='function')e.addEventListener(k.slice(2),v);else if(k==='value')e.value=v;else e.setAttribute(k,v===true?'':String(v));}
 for(const c of kids.flat(Infinity)){if(c==null||c===false)continue;e.append(c instanceof Node?c:document.createTextNode(String(c)));}return e;}
const x=(tag,cls,text)=>h(tag,{class:cls||null,text});
function btn(label,action,opts={}){const kind=opts.kind||'';return h('button',{type:'button',class:`btn ${kind}${opts.sm?' sm':''}`.trim(),dataset:{action,...(opts.data||{})},disabled:opts.disabled||null,'aria-label':opts.aria||null,'aria-busy':opts.busy?'true':null},opts.icon?svg(opts.icon,14,opts.spin?'spin':''):null,label);}
function ib(iconName,label,action,data={},extra={}){return h('button',{type:'button',class:'ib','aria-label':label,title:label,dataset:{action,...data},...extra},svg(iconName,16));}
function badge(tone,text,withDot=true,iconName){return h('span',{class:`badge tbg tone-${tone}`},iconName?svg(iconName,12):withDot?h('span',{class:'d'}):null,text);}
const host=document.createElement('div');host.id='tmx-sbc-monitor-host';host.setAttribute('data-version',VERSION);document.body.append(host);
const root=host.attachShadow({mode:'open'});
try{if(!('adoptedStyleSheets' in root)||typeof CSSStyleSheet!=='function')throw new Error('fallback');const sheet=new CSSStyleSheet();sheet.replaceSync(CSS);root.adoptedStyleSheets=[sheet];}
catch{root.append(h('style',{text:CSS}));}
const icon=h('button',{type:'button',class:'fab','aria-label':STRINGS.openFab,dataset:{tip:STRINGS.title}},svg('act',20),h('span',{class:'fb',hidden:true}));
const themeBtn=ib('moon',STRINGS.theme,'theme-toggle');
const prefsBtn=ib('sliders',STRINGS.settings,'prefs',{},{'aria-pressed':'false'});
const header=h('div',{class:'hd'},h('span',{class:'mono'},svg('act',12)),h('div',{class:'title'},h('b',{id:'tmx-title',text:STRINGS.title}),h('small',{text:'v'+VERSION})),
 themeBtn,prefsBtn,ib('minus',STRINGS.minimize,'close'),ib('x',STRINGS.hide,'hide'));
const tabsEl=h('div',{class:'tabs',role:'tablist','aria-label':'Seções'},...['servers','alerts','history'].map(id=>h('button',{type:'button',class:'tab',role:'tab',id:'tmx-tab-'+id,'aria-controls':'tmx-body',dataset:{section:id}},STRINGS.tabs[id],id==='alerts'?h('span',{class:'cnt',hidden:true}):null)));
const body=h('div',{class:'body view-body',id:'tmx-body',role:'tabpanel',tabindex:'-1'});
const foot=h('div',{class:'foot'});
const panel=h('section',{class:'panel',role:'region','aria-labelledby':'tmx-title',hidden:true},header,tabsEl,body,foot);
const toasts=h('div',{class:'toasts','aria-live':'polite'});
root.append(icon,panel,toasts);
const mq=typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):null;
function resolvedTheme(){return prefs.theme==='auto'?(mq?.matches?'dark':'light'):prefs.theme;}
function applyTheme(){host.setAttribute('data-theme',resolvedTheme());host.classList.toggle('compact',prefs.compact);host.classList.toggle('no-anim',!prefs.animations);themeBtn.replaceChildren(svg(resolvedTheme()==='dark'?'sun':'moon',16));}
mq?.addEventListener?.('change',()=>{applyTheme();});
function applyVisibility(){const onServer=servers.some(s=>originOf(s)===currentOrigin);host.style.display=(state.hiddenTab||document.fullscreenElement||(!prefs.anySite&&!onServer))?'none':'';}
function savePrefs(){GM_setValue(PREFS,{...prefs});applyTheme();layoutNow();}

// Calendar boundaries are fixed to the analyst's zone, regardless of OS/browser timezone.
function dayId(d){return new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function dayIds(days){const today=dayId(new Date()),noon=Date.parse(today+'T12:00:00-03:00');return Array.from({length:days},(_,i)=>dayId(new Date(noon-i*86400000)));}
function dateLabel(v){return new Date(v).toLocaleDateString('pt-BR',{timeZone:ZONE});}
function formatTime(v){return new Date(v).toLocaleString('pt-BR',{timeZone:ZONE});}
function shortTime(v){return new Date(v).toLocaleTimeString('pt-BR',{timeZone:ZONE,hour:'2-digit',minute:'2-digit'});}
function eventOrigin(e){if(e?.origin)return e.origin;const raw=String(e?.incident||'').split('|')[0];try{return raw?new URL(raw).origin:'';}catch{return '';}}
function serverByOrigin(origin){return origin?servers.find(s=>originOf(s)===origin):null;}
function serverLabel(name,origin){const live=serverByOrigin(origin);if(live)return live.name;const hit=servers.find(s=>s.name===name||(s.aliases||[]).includes(name));return hit?hit.name:(name||'');}
function labelOf(e){return serverLabel(e?.server||'',eventOrigin(e));}
function escapeReg(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function nameRewrites(){const map=new Map();for(const s of servers){map.set(s.name,s.name);for(const a of s.aliases||[])map.set(a,s.name);}for(const day of dayIds(RETENTION_DAYS)){for(const e of GM_getValue(logKey(day),[])){const live=serverByOrigin(eventOrigin(e));if(live&&e.server&&e.server!==live.name)map.set(e.server,live.name);}}return [...map.entries()].filter(([from,to])=>from&&from!==to).sort((a,b)=>b[0].length-a[0].length);}
function rewriteNames(text){let out=String(text||'');for(const [from,to] of nameRewrites())out=out.replace(new RegExp(`(?<![\\w-])${escapeReg(from)}(?![\\w-])`,'g'),to);return out;}
function logEvent(type,server='',sbc='',details='',incident='',extras={}){const now=new Date(),key=logKey(dayId(now)),events=GM_getValue(key,[]);events.push({at:now.toISOString(),type,server:serverLabel(server,extras.origin),sbc,details,incident,...extras});GM_setValue(key,events);}
function readEvents(days){return dayIds(days).flatMap(d=>GM_getValue(logKey(d),[])).sort((a,b)=>a.at.localeCompare(b.at));}
function ownsLease(){const l=GM_getValue(LEASE,null);return !stopped&&l?.owner===tabId&&l.until>Date.now();}
// New summaries are separate from the append-only legacy daily messages and event logs.
function daily(day=dayId(new Date())){
 const entry=GM_getValue(SUMMARY+day,null);if(entry)return [entry];
 const legacy=GM_getValue(DAILY+day,[]),opening=legacy.find(e=>e.type==='opening');
 return opening?[{...opening,day,legacy:true}]:[];
}
function addDaily(entry,day=dayId(new Date())){const key=DAILY+day,entries=GM_getValue(key,[]);if(!entries.some(e=>e.id===entry.id)){entries.push(entry);GM_setValue(key,entries);}}
// Individual transitions remain in the raw audit log, never additional timeline messages.
function minOfflineMs(){return (config.minOfflineMinutes||3)*60000;}
function updateTransitions(server,items){
 if(!ownsLease())return;
 const key=stateKey(server), previous=GM_getValue(key,{})||{}, next={...previous},now=new Date().toISOString(),wait=minOfflineMs();
 for(const item of items){const before=previous[item.name];if(item.state==='unknown')continue;
 if(item.state==='offline'){
  if(before?.state==='offline'){
   if(!before.baseline&&!before.confirmed&&Date.now()-Date.parse(before.since)>=wait){
    logEvent('offline_detectado',server.name,item.name,'Mudou de online para offline',before.incident,{origin:originOf(server)});
    next[item.name]={...before,confirmed:true};
   }else next[item.name]=before;
  }else if(!before){
   const incident=`${originOf(server)}|${item.name}|${now}`;
   next[item.name]={state:'offline',since:now,incident,baseline:true,confirmed:false};
   logEvent('offline_detectado',server.name,item.name,'Offline na primeira observação; queda real pode ser anterior',incident,{origin:originOf(server)});
  }else{
   const incident=`${originOf(server)}|${item.name}|${now}`;
   next[item.name]={state:'offline',since:now,incident,baseline:false,confirmed:false};
  }
 }else if(item.state==='online'&&before?.state==='offline'&&before.confirmed){
  const minutes=Math.max(0,Math.round((Date.now()-Date.parse(before.since))/6000)/10);
  logEvent('online_restabelecido',server.name,item.name,`Voltou online; duração observada: ${minutes} min`,before.incident,{durationMinutes:minutes,origin:originOf(server)});
  next[item.name]={state:'online',since:now};
 }else if(item.state==='online')next[item.name]={state:'online',since:before?.state==='online'?before.since:now};
 else if(!before)next[item.name]={state:item.state,since:now};}
 GM_setValue(key,next);
}
  function xhr(options) {
    if (!servers.some(s => originOf(s) === new URL(options.url).origin)) return Promise.reject(new Error('Servidor não configurado'));
    return new Promise((resolve, reject) => GM_xmlhttpRequest({ ...options, timeout: 12_000,
      redirect: 'error', onload: response => { if (response.finalUrl && new URL(response.finalUrl).origin !== new URL(options.url).origin) reject(new Error('Redirecionamento fora do servidor bloqueado')); else resolve(response); }, onerror: () => reject(new Error('Falha de conexão')),
      ontimeout: () => reject(new Error('Tempo esgotado')) }));
  }
  function parse(response, label) {
    if (response.status !== 200) throw new Error(`${label}: HTTP ${response.status}`);
    try { return JSON.parse(response.responseText); }
    catch { throw new Error(`${label}: resposta inválida`); }
  }
  function storedToken(server) {
    const item = GM_getValue(tokenKey(server), null);
    return item?.value && item.expiresAt > Date.now() + 30_000 ? item : null;
  }
  function saveToken(server, data) {
    if (!data.access_token) throw new Error(`${server.name}: token ausente`);
    const item = { value: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 90) * 1000 };
    GM_setValue(tokenKey(server), item);
    return item;
  }
  async function refreshToken(server) {
    const url = `${originOf(server)}/connect/token`;
    const body = 'client_id=Webclient&grant_type=refresh_token';
    let response;
    if (originOf(server) === currentOrigin) {
      const native = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      response = { status: native.status, responseText: await native.text() };
    } else {
      response = await xhr({ method: 'POST', url, data: body, anonymous: false,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    }
    if (response.status === 401) throw new Error('Sessão inativa. Abra o servidor e faça login.');
    const token = saveToken(server, parse(response, `${server.name} sessão`));
    if (ownsLease()) logEvent('sessao_renovada', server.name, '', 'Token temporário obtido; conteúdo não registrado');
    return token;
  }
  async function listSbcs(server, token) {
    const found = new Map();
    const origin = originOf(server);
    let next = new URL('/xapi/v1/Sbcs', origin);
    next.searchParams.set('$select', 'DisplayName,HasConnection,Name');
    next.searchParams.set('$top', '100'); next.searchParams.set('$skip', '0');
    for (let page = 0; page < 100; page++) {
      if (!ownsLease()) throw new Error('Coordenação transferida para outra aba');
      const response = await xhr({ method: 'GET', url: next.href, anonymous: true,
        headers: { Authorization: `Bearer ${token.value}`, Accept: 'application/json' } });
      if (response.status === 401) throw new Error('Token expirado. Clique Atualizar.');
      const data = parse(response, `${server.name} SBCs`);
      if (!Array.isArray(data.value)) throw new Error('Lista de SBCs inválida');
      for (const raw of data.value) {
        const name = String(raw.DisplayName || raw.Name || '').trim();
        if (name) found.set(String(raw.Name || name), { name,
          state: raw.HasConnection === true ? 'online' : raw.HasConnection === false ? 'offline' : 'unknown' });
      }
      if (data['@odata.nextLink']) {
        const hint = new URL(data['@odata.nextLink'], origin);
        if (hint.origin !== origin) throw new Error('Paginação fora do servidor');
        next = new URL(hint.pathname + hint.search, origin);
      } else if (data.value.length === 100) next.searchParams.set('$skip', String((page + 1) * 100));
      else return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    throw new Error('Limite de páginas da API');
  }
  async function pollOne(server, force) {
    if (!ownsLease()) return;
    let token = force ? null : storedToken(server);
    try {
      if (!token) token = await refreshToken(server);
      let items;
      try { items = await listSbcs(server, token); }
      catch (error) {
        if (!error.message.includes('Token expirado')) throw error;
        if (!ownsLease()) return;
        GM_deleteValue(tokenKey(server));
        token = await refreshToken(server);
        items = await listSbcs(server, token);
      }
      if (!ownsLease()) return;
      const before=GM_getValue(snapshotKey(server),null);
      const snapshot = { checkedAt: Date.now(), items, error: '', failStreak:0, lastGoodAt:Date.now() };
      state.snapshots[originOf(server)] = snapshot;
      GM_setValue(snapshotKey(server), snapshot);
      updateTransitions(server, items);
      if(!before||before.error||JSON.stringify(before.items)!==JSON.stringify(items))logEvent('verificacao_ok', server.name, '', 'Leitura concluída', '', {
        total: items.length,
        online: items.filter((item) => item.state === 'online').length,
        offline: items.filter((item) => item.state === 'offline').length,
        unknown: items.filter((item) => item.state === 'unknown').length,
      });
    } catch (error) {
      if (!ownsLease()) return;
      const before=GM_getValue(snapshotKey(server),null);
      const auth=/sessão|token|401|login/i.test(error.message);
      const streak=(before?.failStreak||0)+1;
      const lastGood=before?.lastGoodAt||(before&&!before.error?before.checkedAt:0);
      const grace=Math.max(checkMs()*3,180000);
      const keep=!!(before?.items?.length&&lastGood&&Date.now()-lastGood<grace&&!auth&&streak<3);
      const snapshot=keep
        ?{...before,items:before.items,error:'',failStreak:streak,lastGoodAt:lastGood,checkedAt:before.checkedAt}
        :{checkedAt:Date.now(),items:[],error:error.message,failStreak:streak,lastGoodAt:lastGood||0};
      state.snapshots[originOf(server)] = snapshot;
      GM_setValue(snapshotKey(server), snapshot);
      if(!keep&&before?.error!==error.message)logEvent('verificacao_falhou', server.name, '', error.message);
    }
  }
async function pollAll(force=false){
 if(state.busy||!ownsLease())return;
 state.busy=true;state.lastPoll=Date.now();pollStart=Date.now();render();
 try{await Promise.all(servers.map(s=>pollOne(s,force)));if(ownsLease()) openingAlert();}
 finally{state.busy=false;render();}
}
  function health(server) {
    const local = state.snapshots[originOf(server)];
    const shared = GM_getValue(snapshotKey(server), null);
    const snapshot = shared && (!local || shared.checkedAt >= local.checkedAt) ? shared : local || shared;
    if (!snapshot) return { kind: 'inactive', items: [], error: 'Sessão ainda não capturada.' };
    const lastGood=snapshot.lastGoodAt||(!snapshot.error?snapshot.checkedAt:0);
    const freshFor=Math.max(STALE_MS,checkMs()*3+30000);
    const auth=/sessão|token|401|login/i.test(snapshot.error||'');
    if(snapshot.error&&auth) return { kind: 'inactive', items: [], error: snapshot.error };
    if(snapshot.items?.length&&lastGood&&Date.now()-lastGood<=freshFor&&(snapshot.failStreak||0)<3) return { kind: 'active', items: snapshot.items, checkedAt: lastGood };
    if (snapshot.error) return { kind: 'inactive', items: [], error: snapshot.error };
    if (!lastGood||Date.now()-lastGood>freshFor) return { kind: 'inactive', items: [], error: 'Leitura antiga. Clique Atualizar.' };
    return { kind: 'active', items: snapshot.items || [], checkedAt: lastGood };
  }
function reportableOffline(server,name){const rec=GM_getValue(stateKey(server),{})[name];if(!rec||rec.state!=='offline')return true;if(rec.baseline||rec.confirmed)return true;return false;}
function snapshotFacts(day,reportableOnly){
 const infos=servers.map(s=>({s,h:health(s)}));
 const offline=infos.flatMap(({s,h})=>h.kind!=='active'?[]:h.items.filter(i=>i.state==='offline'&&(!reportableOnly||reportableOffline(s,i.name))).map(i=>{const since=offlineSinceIso(s,i.name,day);return `🔴 *${s.name}* · ${i.name}${since?` · offline desde ${whenLabel(since)}`:' · offline'}`;}));
 const online=infos.reduce((n,{h})=>n+h.items.filter(i=>i.state==='online').length,0);
 const unknown=infos.reduce((n,{h})=>n+h.items.filter(i=>i.state==='unknown').length,0);
 const inactive=infos.filter(({h})=>h.kind!=='active').map(({s,h})=>`${s.name} (${sessionLabel(h)==='Sessão expirada'?'sessão: reconectar':'rede/leitura: verificar e atualizar'})`);
 const events=GM_getValue(logKey(day),[]),falls=events.filter(e=>e.type==='offline_detectado'&&e.details==='Mudou de online para offline').length,returns=events.filter(e=>e.type==='online_restabelecido').length;
 return {infos,offline,online,unknown,inactive,falls,returns};
}
function messageText(kind,facts,atIso,stats){
 const title=kind==='opening'?'🚨 *ALERTA 3CX — ABERTURA DO DIA*':'📌 *ALERTA 3CX — SITUAÇÃO ATUAL*';
 const head=`${title}\n${dateLabel(atIso)} · ${shortTime(atIso)}`;
 const body=facts.offline.length?facts.offline.join('\n'):stats.active?'🟢 Nenhum SBC offline nas sessões com leitura atual.':'⚠️ Nenhuma leitura atual confirmada.';
 const counts=`${stats.active?`Online: ${facts.online} SBC`:'Online: sem leitura atual'}${facts.unknown?`\nIndefinidos: ${facts.unknown} SBC`:''}${facts.inactive.length?`\n⚠️ Sem leitura atual: ${facts.inactive.join(', ')}.`:''}`;
 const analysis=kind==='opening'?`\n\n📊 *Análise na abertura*\nQuedas já confirmadas: ${facts.falls} · Recuperações: ${facts.returns}\nOffline na abertura: ${stats.openingOffline??'sem leitura'}\nLeitura: ${stats.active}/${stats.total} servidores`:`\n\n📊 *Acumulado do dia*\nQuedas confirmadas (mín. ${config.minOfflineMinutes} min): ${facts.falls} · Recuperações: ${facts.returns}\nPico de offline confirmado: ${stats.peak}\nLeitura: ${stats.active}/${stats.total} servidores\nAtualizado: ${shortTime(atIso)} (Brasília)`;
 return `${head}\n\n${body}\n\n${counts}${analysis}`;
}
function openingAlert(){
 if(!ownsLease())return;
 const now=new Date(),day=dayId(now),hm=shortTime(now),key=SUMMARY+day,old=GM_getValue(key,null);
 if(old&&!old.frozen)GM_setValue(key,{...old,frozen:true});
 const frozen=GM_getValue(key,null);
 if(!frozen){
  if(hm<config.opening){updateCurrent(day);return;}
  const facts=snapshotFacts(day,true);
  if(!facts.infos.some(({h})=>h.kind==='active'))return;
  const at=now.toISOString(),stats={online:facts.online,offline:facts.offline.length,unknown:facts.unknown,falls:facts.falls,returns:facts.returns,peak:facts.offline.length,openingOffline:facts.offline.length,active:facts.infos.length-facts.inactive.length,total:facts.infos.length};
  GM_setValue(key,{id:'opening',day,at,updatedAt:at,type:'opening',label:'Abertura do dia',stats,text:messageText('opening',facts,at,stats),sentAt:null,frozen:true});
 }
 updateCurrent(day);
 followUpAlerts(day,snapshotFacts(day,true).infos);
}
function updateCurrent(day){
 const facts=snapshotFacts(day,true),nowIso=new Date().toISOString(),key=CURRENT+day,old=GM_getValue(key,null);
 const opening=GM_getValue(SUMMARY+day,null);
 const stats={online:facts.online,offline:facts.offline.length,unknown:facts.unknown,falls:facts.falls,returns:facts.returns,peak:Math.max(opening?.stats?.peak||0,facts.offline.length),active:facts.infos.length-facts.inactive.length,total:facts.infos.length};
 const signature=JSON.stringify({offline:facts.offline,inactive:facts.inactive,falls:facts.falls,returns:facts.returns});
 const changed=!old||old.signature!==signature;
 if(!facts.infos.some(({h})=>h.kind==='active')&&!old)return;
 GM_setValue(key,{id:'current',day,at:old?.at||nowIso,updatedAt:changed?nowIso:old.updatedAt,type:'current',label:'Situação atual',stats,signature,text:messageText('current',facts,changed?nowIso:old.updatedAt,stats),sentAt:changed?null:old?.sentAt||null});
}
function readCurrent(day){return GM_getValue(CURRENT+day,null);}
function followUpAckAt(day){const ack=GM_getValue(FOLLOWUP_ACK+day,null);if(ack)return ack;const sum=GM_getValue(SUMMARY+day,null);return sum?.at||new Date().toISOString();}
function transitionSince(day,since){return GM_getValue(logKey(day),[]).filter(e=>e.at>since&&((e.type==='offline_detectado'&&e.details==='Mudou de online para offline')||e.type==='online_restabelecido')).sort((a,b)=>a.at.localeCompare(b.at));}
function readFollowUps(day){const list=GM_getValue(FOLLOWUP+day,[]);return Array.isArray(list)?list:[];}
function saveFollowUps(day,list){GM_setValue(FOLLOWUP+day,list);}
function followUpHeadline(f){const p=[];if(f.falls)p.push(`${f.falls} ${f.falls===1?'caiu':'caíram'}`);if(f.returns)p.push(`${f.returns} ${f.returns===1?'voltou':'voltaram'}`);return p.length?p.join(' · '):'Sem mudanças';}
function composeFollowUpText(events,infos,nowIso){
 const falls=events.filter(e=>e.type==='offline_detectado'),returns=events.filter(e=>e.type==='online_restabelecido');
 const body=[...falls.map(e=>`🔴 *${labelOf(e)}* · ${e.sbc} · caiu ${shortTime(e.at)}`),...returns.map(e=>`🟢 *${labelOf(e)}* · ${e.sbc} · voltou ${shortTime(e.at)}${awayLabel(e.durationMinutes)}`)];
 const off=infos?.reduce((n,{h})=>n+(h.items?.filter(i=>i.state==='offline').length||0),0)??null,on=infos?.reduce((n,{h})=>n+(h.items?.filter(i=>i.state==='online').length||0),0)??null;
 let tail='';
 if(infos){const offLines=infos.flatMap(({s,h})=>h.kind!=='active'?[]:h.items.filter(i=>i.state==='offline').map(i=>{const since=offlineSinceIso(s,i.name,dayId(new Date(nowIso)));return since?`🔴 *${s.name}* · ${i.name} · offline desde ${whenLabel(since)}`:`🔴 *${s.name}* · ${i.name} · offline`;}));
   if(offLines.length)tail+=`\n\n*Ainda offline*\n${offLines.join('\n')}`;}
 if(off!=null)tail+=`\n\nResumo: ${off} offline · ${on} online\nAtualizado: ${shortTime(nowIso)} (Brasília)`;
 return `📋 *ACOMPANHAMENTO 3CX*\n${dateLabel(nowIso)} · ${shortTime(nowIso)}\nDesde último envio: ${falls.length} queda${falls.length===1?'':'s'} · ${returns.length} recuperaç${returns.length===1?'ão':'ões'}\n\n${body.length?body.join('\n'):'🟢 Nenhuma queda ou recuperação nova no período.'}${tail}`;
}
function upsertFollowUp(day,events,infos){
 if(!events.length)return;
 const now=new Date(),nowIso=now.toISOString(),eventAtMax=events.reduce((m,e)=>e.at>m?e.at:m,events[0].at);
 const falls=events.filter(e=>e.type==='offline_detectado').length,returns=events.filter(e=>e.type==='online_restabelecido').length;
 const list=readFollowUps(day),pending=list.find(f=>!f.sentAt);
 const text=composeFollowUpText(events,infos,nowIso);
 if(pending){Object.assign(pending,{updatedAt:nowIso,text,falls,returns,eventAtMax,signature:events.map(e=>e.at+e.type+e.sbc).join('|')});saveFollowUps(day,list);return;}
 const id=`fu-${now.getTime()}-${Math.random().toString(36).slice(2,7)}`;
 list.unshift({id,at:nowIso,updatedAt:nowIso,fromAt:followUpAckAt(day),eventAtMax,text,falls,returns,sentAt:null,signature:events.map(e=>e.at+e.type+e.sbc).join('|')});
 saveFollowUps(day,list);
 GM_setValue(FOLLOWUP_META+day,{lastTry:now.getTime()});
}
function followUpAlerts(day,infos){
 if(!ownsLease()||!config.followUpMinutes)return;
 if(!GM_getValue(SUMMARY+day,null))return;
 const ack=followUpAckAt(day),events=transitionSince(day,ack);
 const list=readFollowUps(day),pending=list.find(f=>!f.sentAt);
 if(pending){const sig=events.map(e=>e.at+e.type+e.sbc).join('|');if(sig!==pending.signature&&events.length)upsertFollowUp(day,events,infos);return;}
 if(!events.length)return;
 const meta=GM_getValue(FOLLOWUP_META+day,{lastTry:0})||{},elapsed=Date.now()-(meta.lastTry||0);
 if(elapsed<config.followUpMinutes*60000)return;
 upsertFollowUp(day,events,infos);
}
function explainEvent(e){
 const map={offline_detectado:['caiu','SBC ficou offline','Copie a atualização na aba Alerta e envie no WhatsApp.'],online_restabelecido:['voltou','SBC voltou online','Se ainda não enviou, use a aba Alerta.'],verificacao_falhou:[/sessão|token|401/i.test(e.details)?'sessao':'erro',/sessão|token|401/i.test(e.details)?'Sessão inativa — precisa login':'Falha ao consultar SBCs',/sessão|token|401/i.test(e.details)?'Clique em Reconectar e faça login no 3CX.':'Clique Atualizar. Se repetir, confira a rede e o acesso ao 3CX.'],sessao_renovada:['info','Sessão renovada','Nenhuma ação necessária.'],verificacao_ok:['info','Verificação concluída','Nenhuma ação necessária.'],alerta_copiado:['info','Mensagem copiada para WhatsApp','Cole e envie no WhatsApp; depois confirme o envio.'],alerta_enviado_confirmado:['info','Envio confirmado pelo analista','Horário registrado manualmente.'],painel_aberto:['info','Painel aberto',''],painel_fechado:['info','Painel minimizado',''],servidor_adicionado:['info','Servidor adicionado','Conecte a sessão do 3CX.'],servidor_removido:['info','Servidor removido',''],servidor_renomeado:['info','Servidor renomeado','Nome exibido em alertas e listas.'],servidor_aberto:['info','Aba de login aberta','Faça login no 3CX e aguarde Conectado ✓.'],atualizacao_manual:['info','Atualização solicitada',''],sessao_verificada_manualmente:['info','Sessão verificada manualmente',''],filtro_servidor:['info','Filtro de servidor alterado',''],filtro_estado:['info','Filtro de estado alterado',''],log_exportado:['info','Histórico exportado para CSV','']};
 return map[e.type]||['info',e.type.replaceAll('_',' '),''];
}
// ---- Layout, drag, persistence ----
function saveLayout(){layout.open=state.open;layout.section=state.section;layout.historyFilter=state.historyFilter;GM_setValue(layoutKey,layout);}
function clamp(n,min,max){return Math.min(Math.max(Number(n)||0,min),max);}
function layoutNow(){
 const small=innerWidth<480,pos=prefs.rememberPosition?layout.panel:null,ip=prefs.rememberPosition?layout.icon:null;
 const w=small?innerWidth:clamp(layout.panel?.w||400,320,Math.max(320,innerWidth-16));
 const hh=clamp(layout.panel?.h||Math.min(640,Math.round(innerHeight*.8)),320,Math.max(320,small?Math.round(innerHeight*.85):innerHeight-16));
 panel.classList.toggle('sheet',small);panel.style.width=w+'px';panel.style.height=hh+'px';
 if(small){panel.style.left='0px';panel.style.top=Math.max(0,innerHeight-hh)+'px';}
 else{panel.style.left=clamp(pos?.x??innerWidth-w-20,8,Math.max(8,innerWidth-w-8))+'px';panel.style.top=clamp(pos?.y??innerHeight-hh-20,8,Math.max(8,innerHeight-hh-8))+'px';}
 icon.style.left=clamp(ip?.x??innerWidth-68,8,Math.max(8,innerWidth-56))+'px';icon.style.top=clamp(ip?.y??innerHeight-68,8,Math.max(8,innerHeight-56))+'px';
 toasts.style.bottom=state.open?'20px':'80px';
}
function openPanel(open,manual=false,moveFocus=false){
 state.open=open;icon.hidden=open;panel.hidden=!open;
 if(open&&prefs.animations&&manual){panel.classList.add('entering');requestAnimationFrame(()=>requestAnimationFrame(()=>panel.classList.remove('entering')));}
 layoutNow();saveLayout();if(manual)logEvent(open?'painel_aberto':'painel_fechado');
 if(moveFocus)(open?prefsBtn:icon).focus({preventScroll:true});
}
function drag(node,handle,field){handle.addEventListener('pointerdown',e=>{
 if(e.button!==0||(handle!==icon&&e.target.closest('button'))||panel.classList.contains('sheet')&&node===panel)return;
 const start=[e.clientX,e.clientY,node.offsetLeft,node.offsetTop];let moved=false,frame=0,last=null;handle.setPointerCapture?.(e.pointerId);
 const apply=()=>{frame=0;if(!last)return;node.style.left=clamp(start[2]+last[0],8,innerWidth-node.offsetWidth-8)+'px';node.style.top=clamp(start[3]+last[1],8,innerHeight-node.offsetHeight-8)+'px';};
 const move=ev=>{const dx=ev.clientX-start[0],dy=ev.clientY-start[1];if(Math.abs(dx)+Math.abs(dy)>5){moved=true;handle.classList.add('dragging');}if(!moved)return;last=[dx,dy];if(!frame)frame=requestAnimationFrame(apply);};
 const end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.classList.remove('dragging');
  if(frame){cancelAnimationFrame(frame);apply();}
  if(moved){let l=node.offsetLeft,t=node.offsetTop;const r=innerWidth-l-node.offsetWidth,b=innerHeight-t-node.offsetHeight;
   if(l<24)l=8;if(r<24)l=innerWidth-node.offsetWidth-8;if(t<24)t=8;if(b<24)t=innerHeight-node.offsetHeight-8; // snap 16px
   node.style.left=l+'px';node.style.top=t+'px';layout[field]={...layout[field],x:l,y:t};saveLayout();if(node===icon)icon.dataset.dragged='1';}};
 handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
});}
drag(icon,icon,'icon');drag(panel,header,'panel');
header.addEventListener('dblclick',e=>{if(e.target.closest('button'))return;if(layout.panel){delete layout.panel.x;delete layout.panel.y;}saveLayout();layoutNow();});
let resizeTimer;
new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!state.open||panel.classList.contains('sheet'))return;layout.panel={x:panel.offsetLeft,y:panel.offsetTop,w:panel.offsetWidth,h:panel.offsetHeight};saveLayout();},200);}).observe(panel);
window.addEventListener('resize',()=>{clearTimeout(layoutNow.t);layoutNow.t=setTimeout(layoutNow,100);});
// ---- Toasts ----
function toast(kind,title,desc='',action=null){
 const tone={success:'s',error:'d',warning:'w',info:'i'}[kind]||'i',name={success:'checkCircle',error:'xCircle',warning:'warn',info:'info'}[kind]||'info';
 const el=h('div',{class:`toast tone-${tone}`,role:kind==='error'?'alert':'status'},h('span',{class:'tic'},svg(name,16)),
  h('div',{class:'grow'},h('div',{class:'tt',text:title}),desc?h('div',{class:'td',text:desc}):null,action?btn(action.label,action.action,{sm:true}):null),
  ib('x','Fechar aviso','toast-close'));
 while(toasts.children.length>=3)toasts.firstElementChild.remove();
 toasts.append(el);let timer;const ms=kind==='error'?8000:5000,arm=()=>{timer=setTimeout(()=>el.remove(),ms);};
 el.addEventListener('mouseenter',()=>clearTimeout(timer));el.addEventListener('mouseleave',arm);arm();return el;
}
// ---- Reversible UI disclosures (ephemeral UI state only; never a storage migration) ----
const disclosureTrail={servers:[],alerts:[],history:[]},viewTrail=[],sectionScroll={servers:0,alerts:0,history:0};
let menuScroll=0;
function disclosureValue(kind){return kind==='servers'?state.expanded:kind==='alerts'?state.alertDay:state.historyDay;}
function setDisclosure(kind,value){if(kind==='servers')state.expanded=value;else if(kind==='alerts')state.alertDay=value;else state.historyDay=value;}
function focusDisclosure(kind,value){const el=[...root.querySelectorAll('button')].find(b=>kind==='servers'?b.dataset.action==='expand'&&b.dataset.origin===value:b.dataset.action==='select-summary'&&b.dataset.view===kind&&b.dataset.day===value);el?.focus({preventScroll:true});return el;}
function toggleDisclosure(kind,value){
 const trail=disclosureTrail[kind];if(!trail)return;
 const previous=disclosureValue(kind),scroll=body.scrollTop;
 if(previous===value){const saved=trail.pop()||{value:null,scroll};setDisclosure(kind,saved.value);render();body.scrollTop=saved.scroll;focusDisclosure(kind,saved.value||value);return;}
 // Selecting an already-open ancestor goes back instead of creating a cyclic history.
 const ancestor=trail.findIndex(item=>item.value===value);
 if(ancestor>=0){const saved=trail[ancestor];trail.splice(ancestor);setDisclosure(kind,saved.value);render();body.scrollTop=saved.scroll;focusDisclosure(kind,value);return;}
 trail.push({value:previous,scroll});setDisclosure(kind,value);render();body.scrollTop=scroll;focusDisclosure(kind,value)?.scrollIntoView?.({block:'nearest'});
}
function captureView(){return {prefs:state.prefs,settings:state.settings,section:state.section,scroll:body.scrollTop,focus:root.activeElement?focusKey(root.activeElement):null};}
function restoreView(saved){state.prefs=saved?.prefs||false;state.settings=saved?.settings||false;if(saved?.section)state.section=saved.section;state.returnTo='';render();body.scrollTop=saved?.scroll||0;
 const el=saved?.focus?[...root.querySelectorAll('button,input,summary')].find(e=>focusKey(e)===saved.focus):null;(el||prefsBtn).focus({preventScroll:true});}
function togglePrefs(){if(state.prefs||state.settings){const saved=viewTrail[0];viewTrail.length=0;restoreView(saved);return;}
 viewTrail.push(captureView());state.prefs=true;state.settings=false;state.menu=false;body.scrollTop=0;render();}
function toggleConnect(){if(state.settings){back();return;}viewTrail.push(captureView());state.settings=true;state.prefs=false;state.menu=false;state.captureMessage='';body.scrollTop=0;render();}
function closeMenu(){state.menu=false;render();body.scrollTop=menuScroll;panel.querySelector('[data-action=export-menu]')?.focus({preventScroll:true});}
function selectSection(section){if(section===state.section&&!state.settings&&!state.prefs)return;sectionScroll[state.section]=body.scrollTop;state.section=section;state.settings=false;state.prefs=false;state.menu=false;viewTrail.length=0;render();body.scrollTop=sectionScroll[section]||0;saveLayout();}
// ---- View helpers ----
function counts(hh){return{online:hh.items.filter(i=>i.state==='online').length,offline:hh.items.filter(i=>i.state==='offline').length,unknown:hh.items.filter(i=>i.state==='unknown').length};}
function sessionLabel(hh){return /sessão|token|401|login/i.test(hh.error||'')?'Sessão expirada':'Sem leitura';}
function serverConnected(s){return health(s).kind==='active';}
function disconnectedCount(){return servers.filter(s=>!serverConnected(s)).length;}
function updatePrefsConnBadge(n){
 let b=prefsBtn.querySelector('.hcnt');prefsBtn.classList.toggle('rel',n>0);
 if(!n){b?.remove();prefsBtn.setAttribute('aria-label',STRINGS.settings);return;}
 if(!b){b=h('span',{class:'hcnt'});prefsBtn.append(b);}
 b.textContent=String(n);prefsBtn.setAttribute('aria-label',`${STRINGS.settings} · ${n} servidor${n>1?'es':''} sem conexão`);
}
function saveServerName(origin,name){
 const label=String(name||'').trim();if(!label){toast('error','Nome vazio','Digite um nome para o servidor.');return;}
 const s=servers.find(v=>originOf(v)===origin);if(!s)return;
 const old=s.name;if(old===label)return;
 s.aliases=[...new Set([...(s.aliases||[]),old])];s.name=label;GM_setValue(SERVERS_KEY,servers);state.editingNameOrigin=null;logEvent('servidor_renomeado',label,'',`Antes: ${old}`,'',{origin});toast('success','Nome atualizado',`“${label}” passa a valer em alertas, histórico e mensagens.`);render();
}
function isLoading(){return servers.every(s=>!GM_getValue(snapshotKey(s),null)&&!state.snapshots[originOf(s)])&&(state.busy||Date.now()-state.startedAt<8000);}
function healthBanner(){const inactive=servers.filter(s=>health(s).kind!=='active');if(!inactive.length||inactive.length===servers.length&&!state.settings)return null;
 const one=inactive.length===1?health(inactive[0]):null,text=one?(sessionLabel(one)==='Sessão expirada'?`Sessão do ${inactive[0].name} expirou.`:`${inactive[0].name} sem leitura atual.`):`${inactive.length} servidores sem leitura atual. Conecte ou atualize.`;
 return h('div',{class:'alert tbg tone-w banner-warn',role:'status'},h('span',{class:'tic'},svg('warn',16)),h('span',{class:'grow',text}),state.settings?null:btn('Reconectar','open-connect',{sm:true}));}
function ago(ms){const s=Math.max(0,Math.round(ms/1000));return s<60?`há ${s} s`:s<3600?`há ${Math.round(s/60)} min`:`às ${shortTime(Date.now()-ms)}`;}
function renderFoot(){
 if(state.prefs){foot.hidden=true;return;}foot.hidden=false;
 const checks=servers.map(s=>{const sh=GM_getValue(snapshotKey(s),null),lo=state.snapshots[originOf(s)];return Math.max(sh?.checkedAt||0,lo?.checkedAt||0);}),last=Math.max(0,...checks);
 if(state.busy){foot.replaceChildren(svg('loader',14,'spin'),h('span',{class:'grow',text:`Verificando ${servers.length} servidores…`}),btn(STRINGS.refreshing,'refresh',{kind:'ghost',sm:true,disabled:true,busy:true}));return;}
 const anyActive=servers.some(s=>health(s).kind==='active'),next=last?Math.round((last+checkMs()-Date.now())/1000):0;
 const text=!last?'Ainda sem leitura':`${anyActive?'Atualizado':'Última verificação'} ${ago(Date.now()-last)}${next>0?` · próxima verificação em ${next} s`:''}`;
 foot.replaceChildren(svg('refresh',14),h('span',{class:'grow',text}),btn(STRINGS.refresh,'refresh',{kind:'ghost',sm:true}));
}
// ---- Servers ----
function renderServers(){
 const banner=healthBanner();if(banner)body.append(banner);
 const grid=h('div',{class:'grid'});
 for(const s of servers){const hh=health(s),c=counts(hh),o=originOf(s),expanded=state.expanded===o,tone=hh.kind!=='active'?'w':c.offline?'d':'s';
  const card=h('div',{class:`card server-block${c.offline?' has-offline':''}${expanded?' expanded':''}`,dataset:{expand:o}},
   h('button',{type:'button',class:'cardhead','aria-expanded':String(expanded),'aria-controls':'sbc-'+s.name,'aria-label':`Servidor ${s.name}: ${hh.kind==='active'?`${c.online} online, ${c.offline} offline`:sessionLabel(hh)}`,dataset:{action:'expand',origin:o}},
    h('span',{class:`dot tone-${tone}`}),h('span',{class:'name',text:s.name}),svg('chevR',14,'chev')));
  if(hh.kind==='active'){card.append(h('div',{class:'kpi'},h('div',{},h('b',{text:c.online}),h('span',{text:'online'})),h('div',{},h('b',{class:c.offline?'ttx tone-d':'zero',text:c.offline}),h('span',{text:'offline'})),c.unknown?h('div',{},h('b',{class:'zero',text:c.unknown}),h('span',{text:'indef.'})):null));}
  else card.append(h('div',{class:'kpi',title:hh.error},badge('w',sessionLabel(hh))));
  if(expanded){const list=h('div',{class:'sbc-list',id:'sbc-'+s.name});
   if(hh.kind!=='active')list.append(h('div',{class:'sub',text:hh.error}),h('div',{class:'row',style:'margin-top:8px'},btn('Reconectar','connect',{icon:'ext',data:{origin:o}})));
   for(const item of [...hh.items].sort((a,b)=>({offline:0,unknown:1,online:2}[a.state]-{offline:0,unknown:1,online:2}[b.state])||a.name.localeCompare(b.name,'pt-BR'))){const t=item.state==='online'?'s':item.state==='offline'?'d':'n';list.append(h('div',{class:`sbc-row ${item.state}`},h('span',{class:'name',text:item.name}),badge(t,item.state==='online'?'Online':item.state==='offline'?'Offline':'Indefinido')));}
   if(hh.kind==='active'&&!hh.items.length)list.append(h('div',{class:'sub',text:'Nenhum SBC encontrado neste servidor.'}));card.append(list);}else card.append(h('div',{id:'sbc-'+s.name,hidden:true}));
  grid.append(card);}
 body.append(grid,h('div',{class:'sec',text:'Visão geral'}));
 const tbody=h('tbody');let on=0,off=0,act=0;
 for(const s of servers){const hh=health(s),c=counts(hh),a=hh.kind==='active';if(a){on+=c.online;off+=c.offline;act++;}
  tbody.append(h('tr',{},h('td',{text:s.name}),h('td',{},a?badge('s','Ativa'):badge('w',sessionLabel(hh)==='Sessão expirada'?'Expirada':'Sem leitura')),
   h('td',{class:a?'r':'r mutd',text:a?c.online:'—'}),h('td',{class:a&&c.offline?'r ttx tone-d':a?'r':'r mutd',text:a?c.offline:'—'})));}
 body.append(h('div',{class:'tw'},h('table',{},h('thead',{},h('tr',{},h('th',{text:'Servidor'}),h('th',{text:'Sessão'}),h('th',{class:'r',text:'Online'}),h('th',{class:'r',text:'Offline'}))),tbody,
  h('tfoot',{},h('tr',{},h('td',{colspan:'2',text:`Total · ${act} de ${servers.length} sessões`}),h('td',{class:'r',text:on}),h('td',{class:off?'r ttx tone-d':'r',text:off}))))));
}
function renderSkeleton(){
 const grid=h('div',{class:'grid','aria-hidden':'true'});for(let i=0;i<4;i++)grid.append(h('div',{class:'card'},h('div',{class:'sk l w55'}),h('div',{class:'row',style:'margin-top:12px;gap:12px'},h('div',{class:'sk k'}),h('div',{class:'sk k'}))));
 const tw=h('div',{class:'tw','aria-hidden':'true'});for(const w of ['w90','w80','w70','w60'])tw.append(h('div',{class:'skrow'},h('div',{class:'sk l '+w})));
 body.append(h('span',{class:'sub',text:'Carregando servidores…'}),grid,h('div',{class:'sk l w30','aria-hidden':'true'}),tw);
}
function renderError(){
 const infos=servers.map(s=>({s,hh:health(s)})),auth=infos.every(({hh})=>/sessão|token|401|login|capturada/i.test(hh.error||''));
 const details=infos.map(({s,hh})=>`${s.name} · ${originOf(s)} · ${hh.error||'sem erro'}`).join('\n');
 body.append(h('div',{class:'empty',role:'alert'},h('div',{class:'ci'},svg(auth?'lock':'wifiOff',22)),
  h('div',{class:'et',text:auth?'Nenhum servidor conectado':'Não foi possível ler os servidores'}),
  h('div',{class:'ed',text:auth?'Faça login no 3CX de cada servidor para o monitor ler os SBCs.':'O 3CX não respondeu a tempo. Verifique sua conexão ou a VPN e tente de novo.'}),
  h('div',{class:'row'},auth?null:btn('Conectar servidores','open-connect'),auth?btn('Conectar servidores','open-connect',{kind:'primary'}):btn('Tentar novamente','refresh',{kind:'primary',icon:'refresh'})),
  h('details',{class:'technical-details',open:state.technicalOpen||null},h('summary',{'aria-expanded':String(state.technicalOpen),'aria-controls':'tmx-technical',text:'Detalhes técnicos'}),h('div',{id:'tmx-technical'},h('pre',{class:'msg',text:details}),btn('Copiar detalhes','copy-details',{sm:true,icon:'copy'})))));
 state.errorDetails=details;
}
// ---- Alerts ----
function headline(e){if(e.type==='opening')return'Abertura do dia';if(e.type==='offline')return`${e.server} · ${e.sbc} ficou offline`;if(e.type==='online')return`${e.server} · ${e.sbc} voltou`;return e.label||'Mensagem';}
function summary(e){const t=e.text||'',partial=e.stats&&e.stats.active<e.stats.total?' · leitura parcial':'';if(e.type==='opening'){if(e.stats?.active===0)return'Sem leitura';const n=(t.match(/🔴/g)||[]).length,on=(t.match(/Online: (\d+)/)||[])[1];return `${n} offline${on?` · ${on} online`:''}${partial}`;}
 if(e.type==='current')return `${e.stats?.offline??0} offline agora${partial}`;
 if(e.type==='online'){const m=(t.match(/~([\d.,]+) min/)||[])[1];return m?`fora por ~${m} min`:'voltou online';}if(e.type==='offline')return'ficou offline';return e.label||'';}
function summaryDetail(entry,day,view){return h('div',{class:'card pending summary-detail',id:`tmx-summary-${view}-${day}`,role:'region','aria-label':`Mensagem de ${dateLabel(entry.at)}`},
 h('pre',{class:'msg',text:rewriteNames(entry.text)}),
 h('div',{class:'row end'},entry.sentAt?badge('s',`Enviado ${shortTime(entry.sentAt)}`):btn('Marcar enviado','sent',{icon:'check',data:{id:entry.id,day}}),btn('Copiar','copy',{kind:'primary',icon:'copy',data:{id:entry.id,day}})));
}
function followUpDetail(fu,day){return h('div',{class:'card pending summary-detail',id:`tmx-followup-${fu.id}`,role:'region'},
 h('pre',{class:'msg',text:rewriteNames(fu.text)}),
 h('div',{class:'row end'},fu.sentAt?badge('s',`Enviado ${shortTime(fu.sentAt)}`):btn('Marcar enviado','sent-followup',{icon:'check',data:{id:fu.id,day}}),btn('Copiar','copy-followup',{kind:'primary',icon:'copy',data:{id:fu.id,day}})));
}
function sbcStateSince(server,name){return GM_getValue(stateKey(server),{})[name]?.since||null;}
function offlineSinceIso(server,sbc,day){const st=sbcStateSince(server,sbc);if(st)return st;const names=new Set([server.name,...(server.aliases||[])]),origin=originOf(server);const ev=GM_getValue(logKey(day),[]).filter(e=>e.type==='offline_detectado'&&e.sbc===sbc&&(names.has(e.server)||eventOrigin(e)===origin)).sort((a,b)=>b.at.localeCompare(a.at))[0];return ev?.at||null;}
function whenLabel(iso){if(!iso)return'—';const d=new Date(iso);return dayId(d)===dayId(new Date())?shortTime(iso):`${dateLabel(iso)} ${shortTime(iso)}`;}
function durSince(iso){if(!iso)return'';const min=Math.max(0,Math.round((Date.now()-Date.parse(iso))/60000));if(min<60)return`há ${min} min`;const h=Math.floor(min/60),rest=min%60;if(h<48)return rest?`há ${h} h e ${rest} min`:`há ${h} h`;const days=Math.floor(h/24);return`há ${days} dia${days>1?'s':''}`;}
function awayLabel(minutes){if(minutes==null)return'';if(minutes<60)return` · fora cerca de ${String(minutes).replace('.',',')} min`;const h=Math.round(minutes/6)/10;return` · fora cerca de ${String(h).replace('.',',')} h`;}
function collectOfflineNow(day){const rows=[];for(const s of servers){const hh=health(s);if(hh.kind!=='active')continue;const states=GM_getValue(stateKey(s),{});for(const item of hh.items){if(item.state!=='offline')continue;const rec=states[item.name];rows.push({server:s.name,sbc:item.name,since:rec?.since||offlineSinceIso(s,item.name,day),pending:!!(rec&&!rec.baseline&&!rec.confirmed)});}}rows.sort((a,b)=>(a.since||'z').localeCompare(b.since||'z'));return rows;}
function collectReturnedToday(day){return GM_getValue(logKey(day),[]).filter(e=>e.type==='online_restabelecido').sort((a,b)=>b.at.localeCompare(a.at));}
function offlineNowLine(r){const wait=r.pending?`oscilação · aguarda ${config.minOfflineMinutes} min`:(r.since?durSince(r.since):'');return h('div',{class:'ti compact-evt'},h('span',{class:'tm',text:r.since?shortTime(r.since):'—'}),h('span',{class:`dot tone-${r.pending?'w':'d'}`}),h('div',{class:'grow min0'},h('div',{class:'lb trunc',text:`${r.server} · ${r.sbc}`}),wait?h('div',{class:'sub trunc',text:wait}):null));}
function returnedLine(e){const away=awayLabel(e.durationMinutes).replace(/^ · /,'');return h('div',{class:'ti compact-evt'},h('span',{class:'tm',text:shortTime(e.at)}),h('span',{class:'dot tone-s'}),h('div',{class:'grow min0'},h('div',{class:'lb trunc',text:`${labelOf(e)} · ${e.sbc}`}),away?h('div',{class:'sub trunc',text:away}):null));
}
function analysisHelp(){
 const rows=[['Quedas observadas','Vezes em que algum SBC passou de online para offline. O mesmo SBC pode contar mais de uma vez.'],['Recuperações','Vezes em que um SBC que estava offline voltou a ficar online.'],['Offline na abertura observada','Quantos SBCs já estavam offline no primeiro resumo do dia, depois do horário de abertura.'],['Pico observado','Maior quantidade de SBCs offline ao mesmo tempo durante o dia.']];
 const dl=h('dl',{class:'stats-dl'});for(const [label,text] of rows)dl.append(h('dt',{text:label}),h('dd',{text}));
 return h('details',{class:'stats-help',open:state.statsHelpOpen||null},h('summary',{text:'Números da mensagem'}),dl);
}
function alertActions(entry,day,kind){
 const expanded=kind==='opening'?state.alertDay===day:state.currentOpen;
 const copyAction=kind==='opening'?'copy':'copy-current',sentAction=kind==='opening'?'sent':'sent-current',viewAction=kind==='opening'?'select-summary':'toggle-current';
 const sent=!!entry.sentAt;
 return h('div',{class:sent?'acard':'acard wait'},
  h('div',{class:'hd'},h('b',{text:kind==='opening'?'Abertura':'Agora'}),h('span',{class:sent?'st ok':'st no',text:sent?'enviada':'falta enviar'})),
  h('div',{class:'fact',text:`${summary(entry)} · ${shortTime(entry.updatedAt||entry.at)}`}),
  h('div',{class:'row'},btn('Copiar',copyAction,{kind:'primary',sm:true,icon:'copy',data:{id:entry.id,day}}),sent?null:btn('Enviado',sentAction,{sm:true,icon:'check',data:{id:entry.id,day}}),btn(expanded?'Ocultar':'Texto',viewAction,{kind:'ghost',sm:true,data:{day,view:'alerts'}})),
  expanded?h('pre',{class:'msg',text:rewriteNames(entry.text)}):null);
}
function renderAlerts(){const day=dayId(new Date()),entry=daily(day)[0],current=readCurrent(day);
 if(!entry&&!current){body.append(h('div',{class:'empty'},h('div',{class:'ci'},svg('inbox',22)),h('div',{class:'et',text:'Nenhuma mensagem ainda'}),h('div',{class:'ed',text:`A abertura é gravada uma vez, depois das ${config.opening} (Brasília), e não muda mais.`})));return;}
 const offlineNow=collectOfflineNow(day),returned=collectReturnedToday(day);
 if(entry)body.append(alertActions(entry,day,'opening'));
 if(current)body.append(alertActions(current,day,'current'));
 const fus=config.followUpMinutes?readFollowUps(day):[];
 if(fus.length){
  const fsec=h('div',{class:fus.some(f=>!f.sentAt)?'acard wait':'acard'},h('div',{class:'hd'},h('b',{text:'Mudou'})));
  const flist=h('div',{class:'list-day'});
  for(const fu of fus){const open=state.alertFollowUp===fu.id;
   flist.append(h('button',{type:'button',class:'ti',dataset:{action:'select-followup',id:fu.id,day},'aria-expanded':String(open),'aria-controls':`tmx-followup-${fu.id}`},
    h('span',{class:'tm',text:shortTime(fu.updatedAt||fu.at)}),h('div',{class:'grow'},h('div',{class:'lb trunc',text:followUpHeadline(fu)})),h('span',{class:fu.sentAt?'st ok':'st no',text:fu.sentAt?'enviado':'falta enviar'}),svg(open?'chevD':'chevR',14)));
   flist.append(open?followUpDetail(fu,day):h('div',{id:`tmx-followup-${fu.id}`,hidden:true}));}
  fsec.append(flist);body.append(fsec);
 }
 if(offlineNow.length){body.append(h('div',{class:'day-hd',text:`Offline (${offlineNow.length})`}));const list=h('div',{class:'list-day'});for(const r of offlineNow)list.append(offlineNowLine(r));body.append(list);}
 if(returned.length){body.append(h('div',{class:'day-hd',text:`Voltaram (${returned.length})`}));const list=h('div',{class:'list-day'});for(const e of returned.slice(0,50))list.append(returnedLine(e));if(returned.length>50)list.append(h('div',{class:'sub',text:`+ ${returned.length-50} no CSV`}));body.append(list);}
 body.append(analysisHelp());
}
// ---- History ----
const TONE={caiu:['d','down'],voltou:['s','up'],sessao:['w','warn'],info:['i','info'],erro:['n','xCircle']};
function explain(e){return e.type==='preferencias_restauradas'?['info','Preferências restauradas','Servidores, sessões e histórico foram mantidos.']:explainEvent(e);}
function dayLabel(d){const t=new Date(),y=new Date();y.setDate(t.getDate()-1);return dayId(d)===dayId(t)?'Hoje':dayId(d)===dayId(y)?'Ontem':d.toLocaleDateString('pt-BR');}
function renderHistory(){
 const exp=h('div',{class:'rel'},btn('Exportar CSV','export-menu',{icon:'download'}));exp.firstChild.setAttribute('aria-haspopup','menu');exp.firstChild.setAttribute('aria-expanded',String(state.menu));
 if(state.menu)exp.append(h('div',{class:'menu',role:'menu'},h('button',{type:'button',role:'menuitem',dataset:{action:'csv7'}},svg('download',14),'Últimos 7 dias'),h('button',{type:'button',role:'menuitem',dataset:{action:'csv30'}},svg('download',14),'Últimos 30 dias')));
 body.append(h('div',{class:'row'},h('span',{class:'grow sec',text:'Arquivo · 7 dias anteriores'}),exp));
 let total=0;for(const day of dayIds(8).slice(1)){
  const entry=daily(day)[0];if(!entry)continue;total++;
  const expanded=state.historyDay===day,stats=entry.stats;
  const statLine=stats?`↓${stats.falls} ↑${stats.returns} · pico ${stats.peak} · ${stats.active}/${stats.total} serv.`:null;
  body.append(h('div',{class:'day-hd',text:dateLabel(entry.at)}));
  body.append(h('div',{class:'list-day'},h('button',{type:'button',class:'ti',dataset:{action:'select-summary',day,view:'history'},'aria-expanded':String(expanded),'aria-controls':`tmx-summary-history-${day}`},
   h('span',{class:'tm',text:shortTime(entry.updatedAt||entry.at)}),h('div',{class:'grow'},h('div',{class:'lb trunc',text:summary(entry)}),statLine?h('div',{class:'sub trunc',text:statLine}):null),svg(expanded?'chevD':'chevR',14))));
  body.append(expanded?summaryDetail(entry,day,'history'):h('div',{id:`tmx-summary-history-${day}`,hidden:true}));
 }
 if(!total)body.append(h('div',{class:'empty'},h('div',{class:'et',text:'Nenhum dia anterior arquivado'}),h('div',{class:'ed',text:'Hoje está na aba Alerta.'})));
 body.append(h('div',{class:'sub',text:'Exportar CSV inclui eventos brutos e resumos.'}));
}
// ---- Connect servers ----
function titleRow(title,sub){return h('div',{class:'row top-al'},ib('back',STRINGS.back,'back'),h('div',{class:'grow'},h('div',{class:'h2',text:title}),sub?h('div',{class:'sub',text:sub}):null));}
function renderConnect(){
 body.append(titleRow('Conectar servidores','Nome, sessão e leitura dos SBCs. O nome vale em alertas e relatórios.'));
 const banner=healthBanner();if(banner)body.append(banner);
 const n=servers.filter(serverConnected).length,bad=servers.length-n,pct=Math.round(n/servers.length*100);
 body.append(h('div',{},h('div',{class:'row'},h('span',{class:'grow',style:'font-weight:500',text:`${n} de ${servers.length} conectados`}),bad?h('span',{class:'hcnt i',text:String(bad),title:`${bad} sem conexão`}):null,h('span',{class:'sub num',text:pct+'%'})),
  h('div',{class:'prog',role:'progressbar','aria-valuemin':'0','aria-valuemax':String(servers.length),'aria-valuenow':String(n),'aria-label':'Servidores conectados'},h('i',{style:`width:${pct}%`}))));
 body.append(h('div',{class:'row end',style:'margin-top:8px'},btn('Verificar conexões','verify-servers',{sm:true,icon:'refresh',busy:state.busy,disabled:state.busy})));
 const list=h('div',{class:'list'});let primaryUsed=false;
 const ordered=[...servers].sort((a,b)=>Number(serverConnected(a))-Number(serverConnected(b)));
 for(const s of ordered){const hh=health(s),o=originOf(s),good=serverConnected(s),editing=state.editingNameOrigin===o;
  let action;if(good)action=badge('s','Conectado');else{action=btn('Conectar','connect',{kind:primaryUsed?'':'primary',icon:'ext',data:{origin:o}});primaryUsed=true;}
  const nameBlock=editing?h('div',{class:'row wrap',style:'width:100%'},h('input',{class:'field grow server-rename',type:'text',value:s.name,'data-origin':o,'aria-label':`Nome de ${s.name}`}),btn('Salvar','save-name',{sm:true,data:{origin:o}}),btn('Cancelar','cancel-name',{kind:'ghost',sm:true}))
   :h('div',{class:'row',style:'width:100%'},h('div',{style:'font-weight:500',class:'trunc grow',text:s.name}),btn('Renomear','edit-name',{kind:'ghost',sm:true,data:{origin:o}}));
  list.append(h('div',{class:'li',style:'align-items:flex-start'},h('span',{class:`dot tone-${good?'s':'w'}`,style:'margin-top:6px'}),h('div',{class:'grow min0'},nameBlock,h('div',{class:'sub trunc',text:o.replace('https://','')}),!good&&hh.error?h('div',{class:'sub ttx tone-w',text:hh.error}):null),
   action,ib('trash',`Remover ${s.name}`,'remove',{origin:o})));}
 body.append(list,h('div',{},h('label',{class:'lbl',for:'tmx-url',text:'Adicionar servidor'}),h('div',{class:'row'},h('input',{id:'tmx-url',class:'field grow server-url',type:'url',placeholder:'https://servidor:5001',autocomplete:'off','aria-label':'URL HTTPS do servidor'}),btn('Adicionar','add',{icon:'plus'}))),
  h('div',{class:'alert top tbg tone-i'},h('span',{class:'tic'},svg('lock',16)),h('span',{class:'grow',text:'Conectar abre o 3CX numa aba para você fazer login. O monitor guarda só um token temporário, nunca a senha. Quando aparecer “Conectado”, pode fechar a aba.'})));
}
// ---- Settings ----
function sw(key,label){return h('button',{type:'button',class:'sw',role:'switch','aria-checked':String(!!prefs[key]),'aria-label':label,dataset:{action:'pref',key}});}
function setRow(label,sub,control){return h('div',{class:'li'},h('div',{class:'grow'},h('div',{style:'font-weight:500',text:label}),sub?h('div',{class:'sub',text:sub}):null),control);}
function renderPrefs(){
 body.append(titleRow('Configurações',''));
 const seg=h('div',{class:'seg',role:'radiogroup','aria-label':'Tema'},...[['light','Claro'],['dark','Escuro'],['auto','Automático']].map(([v,l])=>h('button',{type:'button',role:'radio','aria-checked':String(prefs.theme===v),dataset:{action:'theme',value:v},text:l})));
 const time=h('input',{class:'field time opening-time',type:'time',value:config.opening,'aria-label':'Horário da abertura do dia'});
 body.append(h('div',{class:'set'},h('div',{class:'sec',style:'margin-bottom:4px',text:'Aparência'}),setRow('Tema','',seg),setRow('Modo compacto','Menos espaço entre itens',sw('compact','Modo compacto')),setRow('Animações','Desative para reduzir movimento',sw('animations','Animações'))),
  h('div',{class:'set'},h('div',{class:'sec',style:'margin-bottom:4px',text:'Comportamento'}),setRow('Horário da abertura do dia','Gravada uma vez. Não é reescrita.',time),setRow('Atualizar a cada (segundos)','30 a 3600 s · padrão 60 s',h('input',{class:'field time poll-interval',type:'number',min:'30',max:'3600',step:'1',value:String(config.intervalSeconds),'aria-label':'Intervalo de atualização em segundos'})),setRow('Confirmar queda após (min)','Abaixo disso é oscilação e não vai ao WhatsApp',h('input',{class:'field time min-offline',type:'number',min:'1',max:'30',step:'1',value:String(config.minOfflineMinutes),'aria-label':'Minutos offline para confirmar queda'})),setRow('Acompanhamento a cada (min)','0 = desligado · padrão 15',h('input',{class:'field time followup-interval',type:'number',min:'0',max:'240',step:'1',value:String(config.followUpMinutes),'aria-label':'Intervalo de mensagens de acompanhamento em minutos'})),setRow('Mostrar em qualquer site','Ligado: o painel abre fora do 3CX',sw('anySite','Mostrar em qualquer site')),setRow('Lembrar posição do painel','',sw('rememberPosition','Lembrar posição do painel'))),
  h('div',{class:'set'},h('div',{class:'sec',style:'margin-bottom:4px',text:'Avançado'}),h('div',{class:'li'},h('div',{class:'grow min0'},h('div',{class:'row',style:'gap:6px;align-items:center'},h('div',{style:'font-weight:500',text:'Servidores 3CX'}),(dc=>dc?h('span',{class:'hcnt i',text:String(dc),title:`${dc} sem conexão com o painel`}):null)(disconnectedCount())),h('div',{class:'sub',text:`${servers.length} configurados · renomear e conectar em Gerenciar`})),h('div',{class:'row'},btn('Verificar','verify-servers',{sm:true,icon:'refresh',busy:state.busy,disabled:state.busy}),btn('Gerenciar','open-connect',{sm:true}))),setRow('Atalho do painel','',h('span',{},h('kbd',{text:'Alt'}),' + ',h('kbd',{text:'Shift'}),' + ',h('kbd',{text:'M'})))),
  h('div',{class:'set'},h('div',{class:'sec',style:'margin-bottom:4px',text:'Atualização'}),setRow('URL do script','Endereço fixo no GitHub. Verificar atualização baixa esse arquivo e compara a versão.',h('input',{class:'field grow update-url',type:'url',value:config.updateUrl||UPDATE_URL,placeholder:UPDATE_URL,'aria-label':'URL de atualização do script'})),h('div',{class:'row'},btn('Verificar atualização','check-update',{sm:true,icon:'refresh'}),h('span',{class:'sub',text:`Instalada: ${VERSION} · histórico local: ${RETENTION_DAYS} dias`}))),
  h('div',{class:'row',style:'border-top:1px solid var(--border);padding-top:12px'},btn('Restaurar padrões','restore-ask',{kind:'ghost',sm:true}),h('span',{class:'grow'}),h('span',{class:'sub',text:`Versão ${VERSION}`})));
}
function renderConfirm(){panel.querySelector('.overlay')?.remove();if(!state.confirm)return;
 const dlg=h('div',{class:'overlay'},h('div',{class:'dialog',role:'dialog','aria-modal':'true','aria-labelledby':'tmx-dlg-t','aria-describedby':'tmx-dlg-d'},
  h('div',{class:'h2',id:'tmx-dlg-t',text:'Restaurar padrões?'}),h('div',{class:'mut',id:'tmx-dlg-d',text:'Tema, aparência, horário da abertura (08:00), atualização (60 s), filtros e posição do painel voltam ao padrão. Servidores, sessões, mensagens e histórico não são alterados.'}),
  h('div',{class:'row end'},btn('Cancelar','restore-cancel'),btn('Restaurar padrões','restore-do',{kind:'primary'}))));
 panel.append(dlg);
}
function render(){
 applyVisibility();
 const scroll=body.scrollTop,act=root.activeElement,fk=act?focusKey(act):null,sel=act&&act.matches?.('input')?[act.value,act.selectionStart]:null;
 const all=servers.map(s=>health(s)),off=all.reduce((n,hh)=>n+counts(hh).offline,0),inactive=all.filter(hh=>hh.kind!=='active').length,today=dayId(new Date()),cur=readCurrent(today),pendingN=(daily(today).filter(e=>!e.sentAt).length)+(cur&&!cur.sentAt?1:0)+(config.followUpMinutes?readFollowUps(today).filter(f=>!f.sentAt).length:0);
 panel.classList.toggle('bad',off>0);icon.classList.toggle('bad',off>0);
 const fb=icon.querySelector('.fb');fb.hidden=!(off||inactive);fb.textContent=off?String(off):'!';fb.classList.toggle('warn',!off&&!!inactive);
 const tip=off?`Monitor SBC · ${off} offline`:inactive?`Monitor SBC · ${inactive} sem leitura`:'Monitor SBC · tudo online';icon.dataset.tip=tip;icon.setAttribute('aria-label',`${tip}. Abrir (Alt+Shift+M)`);
 const tabsOn=!state.prefs&&!state.settings;tabsEl.hidden=!tabsOn;
 for(const b of tabsEl.querySelectorAll('[data-section]')){const on=tabsOn&&b.dataset.section===state.section;b.setAttribute('aria-selected',String(on));b.tabIndex=on||!tabsOn?0:-1;}
 const cnt=tabsEl.querySelector('.cnt');cnt.hidden=!pendingN;cnt.textContent=String(pendingN);cnt.setAttribute('aria-label',`${pendingN} pendentes`);
 updatePrefsConnBadge(disconnectedCount());
 prefsBtn.setAttribute('aria-pressed',String(state.prefs||state.settings));prefsBtn.setAttribute('aria-expanded',String(state.prefs||state.settings));prefsBtn.setAttribute('aria-controls','tmx-body');body.setAttribute('aria-labelledby',tabsOn?'tmx-tab-'+state.section:'tmx-title');
 const draftUrl=body.querySelector('.server-url')?.value;
 body.replaceChildren();body.setAttribute('aria-busy',String(state.busy));
 if(state.prefs)renderPrefs();
 else if(state.settings){renderConnect();if(draftUrl)body.querySelector('.server-url').value=draftUrl;}
 else if(isLoading())renderSkeleton();
 else if(state.section==='servers'){if(all.every(hh=>hh.kind!=='active'))renderError();else renderServers();}
 else if(state.section==='alerts')renderAlerts();else renderHistory();
 renderFoot();renderConfirm();body.scrollTop=scroll;
 if(fk){const t=[...root.querySelectorAll('button,input,summary')].find(e=>focusKey(e)===fk);if(t&&t!==root.activeElement){t.focus({preventScroll:true});if(sel&&t.matches('input')&&t.type==='url'){t.value=sel[0];try{t.setSelectionRange(sel[1],sel[1]);}catch{}}}}
}
function focusKey(e){const d=e.dataset||{};return [e.tagName,e.className,d.action,d.origin,d.id,d.day,d.view,d.filter,d.value,d.key,d.section,e.type].join('|');}

async function copyText(value){try{await navigator.clipboard.writeText(value);}catch{const field=x('textarea');field.value=value;field.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(field);field.select();const copied=document.execCommand('copy');field.remove();if(!copied)throw new Error('Não foi possível copiar.');}}
function csvContent(days){
 const columns=['data_hora_local','at','type','server','sbc','incident','details','durationMinutes','total','online','offline','unknown','day','updatedAt','falls','returns','peak','openingOffline','active','text'];
 const rows=[...readEvents(days)];for(const day of dayIds(days)){
  const e=GM_getValue(SUMMARY+day,null);if(e)rows.push({at:e.at,type:'resumo_diario',day,updatedAt:e.updatedAt,text:e.text,...e.stats});
  for(const raw of GM_getValue(DAILY+day,[]))rows.push({at:raw.at,type:'mensagem_legada_'+raw.type,server:raw.server,sbc:raw.sbc,day,text:raw.text,details:raw.sentAt?'Envio registrado '+raw.sentAt:'Sem envio confirmado'});
  const cur=readCurrent(day);if(cur)rows.push({at:cur.updatedAt||cur.at,type:'situacao_atual',day,updatedAt:cur.updatedAt,text:cur.text,details:cur.sentAt?'Envio '+cur.sentAt:'Pendente',...cur.stats});
  for(const fu of readFollowUps(day))rows.push({at:fu.at,type:'acompanhamento',day,updatedAt:fu.updatedAt,text:fu.text,details:fu.sentAt?'Envio '+fu.sentAt:'Pendente',falls:fu.falls,returns:fu.returns});
 }
 const quote=v=>`"${String(v??'').replaceAll('"','""')}"`;
 return '\uFEFF'+[columns.join(';'),...rows.sort((a,b)=>(a.at||'').localeCompare(b.at||'')).map(e=>columns.map(c=>quote(c==='data_hora_local'?formatTime(e.at):e[c])).join(';'))].join('\r\n');
}
function exportEvents(days){logEvent('log_exportado','','',`CSV dos últimos ${days} dias`);const url=URL.createObjectURL(new Blob([csvContent(days)],{type:'text/csv;charset=utf-8'}));const a=x('a');a.href=url;a.download=`monitor-sbc-${days}dias-${dayId(new Date())}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);render();}
// ---- Events (delegated inside the shadow root) ----
function back(){restoreView(viewTrail.pop());}
function restoreDefaults(){
 prefs={...PREF_DEFAULTS};GM_setValue(PREFS,{...prefs});config=loadConfig(null);GM_setValue(CONFIG,config);
 delete layout.panel;delete layout.icon;state.historyFilter='all';saveLayout();applyTheme();layoutNow();
 logEvent('preferencias_restauradas','','','Somente preferências; servidores, sessões e histórico mantidos');
}
function addServer(){const input=body.querySelector('.server-url');
 try{const u=new URL(input.value.trim());if(u.protocol!=='https:'||u.username||u.password)throw new Error('Use uma URL HTTPS sem usuário e senha.');if(servers.some(s=>originOf(s)===u.origin))throw new Error('Esse servidor já está na lista.');
  const s={name:u.hostname.split('.')[0],url:u.origin+'/#/office/voice-and-chat'};servers=[...servers,s];GM_setValue(SERVERS_KEY,servers);listenServer(s);logEvent('servidor_adicionado',s.name,'',u.origin);
  input.value='';GM_setValue(COMMAND,{id:tabId+Date.now()});toast('success','Servidor adicionado',`Clique Conectar em ${s.name} para fazer login.`);render();}
 catch(e){const msg=e instanceof TypeError?'Digite uma URL completa, como https://servidor:5001.':e.message;input.setAttribute('aria-invalid','true');toast('error','Não foi possível adicionar',msg);}}
root.addEventListener('click',async event=>{
 const target=event.target.closest('button');
 if(state.menu&&!(target&&(target.closest('.menu')||target.dataset.action==='export-menu'))){state.menu=false;render();if(!target)return;}
 if(!target){const card=event.target.closest('[data-expand]');if(card&&!event.target.closest('.sbc-list')){toggleDisclosure('servers',card.dataset.expand);}return;}
 if(target===icon){if(icon.dataset.dragged){delete icon.dataset.dragged;return;}openPanel(true,true,true);render();return;}
 if(target.dataset.section){selectSection(target.dataset.section);return;}
 const action=target.dataset.action;
 if(action==='toast-close'){target.closest('.toast')?.remove();return;}
 if(action==='close'){openPanel(false,true,true);render();}
 if(action==='hide'){state.hiddenTab=true;applyVisibility();}
 if(action==='theme-toggle'){prefs.theme=resolvedTheme()==='dark'?'light':'dark';savePrefs();render();}
 if(action==='prefs'){togglePrefs();}
 if(action==='settings'||action==='open-connect'){toggleConnect();}
 if(action==='back')back();
 if(action==='theme'){prefs.theme=target.dataset.value;savePrefs();render();}
 if(action==='pref'){const k=target.dataset.key;if(k in PREF_DEFAULTS&&k!=='theme'){prefs[k]=!prefs[k];savePrefs();render();}}
 if(action==='restore-ask'){state.confirm=true;render();panel.querySelector('[data-action=restore-cancel]')?.focus();}
 if(action==='restore-cancel'){state.confirm=false;render();panel.querySelector('[data-action=restore-ask]')?.focus();}
 if(action==='restore-do'){state.confirm=false;restoreDefaults();render();toast('success','Padrões restaurados','Servidores, sessões e histórico foram mantidos.');}
 if(action==='expand'){logEvent('filtro_servidor','','',target.dataset.origin);toggleDisclosure('servers',target.dataset.origin);}
 if(action==='history-filter'){logEvent('filtro_estado','','',target.dataset.filter);state.historyFilter=target.dataset.filter;saveLayout();render();}
 if(action==='export-menu'){if(state.menu)closeMenu();else{menuScroll=body.scrollTop;state.menu=true;render();panel.querySelector('.menu button')?.focus({preventScroll:true});}}
 if(action==='refresh'){logEvent('atualizacao_manual');const cmd={id:`${tabId}-${Date.now()}-${Math.random()}`};GM_setValue(COMMAND,cmd);await tick();}
 if(action==='verify-servers'){logEvent('sessao_verificada_manualmente','','','Verificação manual de conexão na lista de servidores');GM_setValue(COMMAND,{id:`verify-${tabId}-${Date.now()}`});await tick();const bad=disconnectedCount();toast(bad?'warning':'success',bad?`${bad} servidor${bad>1?'es':''} sem conexão`:'Conexões OK',bad?'Use Conectar no servidor em vermelho.':'Leitura dos SBCs disponível.');}
 if(action==='edit-name'){state.editingNameOrigin=target.dataset.origin;render();body.querySelector(`.server-rename[data-origin="${target.dataset.origin}"]`)?.focus();}
 if(action==='cancel-name'){state.editingNameOrigin=null;render();}
 if(action==='save-name'){const input=body.querySelector(`.server-rename[data-origin="${target.dataset.origin}"]`);saveServerName(target.dataset.origin,input?.value||'');}
 if(action==='connect'){const s=servers.find(s=>originOf(s)===target.dataset.origin);if(s){logEvent('sessao_verificada_manualmente',s.name);logEvent('servidor_aberto',s.name,'','Aba aberta para login/captura da sessão');window.open(s.url,`sbc-capture-${s.name}`,'noopener');toast('info',`Login do ${s.name} aberto`,'Faça login na nova aba. O status muda para Conectado sozinho.');}}
 if(action==='remove'){
  if(servers.length===1){toast('warning','Mantenha ao menos um servidor','Adicione outro antes de remover este.');return;}
  const s=servers.find(s=>originOf(s)===target.dataset.origin);if(!s)return;servers=servers.filter(v=>v!==s);GM_setValue(SERVERS_KEY,servers);GM_deleteValue(tokenKey(s));GM_deleteValue(snapshotKey(s));logEvent('servidor_removido',s.name,'',originOf(s));render();
  toast('success',`${s.name} removido`,'O histórico desse servidor foi mantido.');}
 if(action==='add')addServer();
 if(action==='select-summary'||action==='close-summary'){const view=target.dataset.view,day=target.dataset.day;if(view===state.section&&['alerts','history'].includes(view)&&daily(day).length&&(view==='alerts'?day===dayId(new Date()):day!==dayId(new Date()))){if(action!=='close-summary'||disclosureValue(view)===day)toggleDisclosure(view,day);}return;}
 if(action==='copy'||action==='copy-current'){const entry=action==='copy-current'||target.dataset.id==='current'?readCurrent(target.dataset.day):daily(target.dataset.day).find(e=>e.id===target.dataset.id);if(!entry)return;try{await copyText(rewriteNames(entry.text));logEvent('alerta_copiado','','',action==='copy-current'?'Situação atual copiada':'Abertura copiada',entry.id);toast('success','Mensagem copiada','Cole no WhatsApp e depois marque como enviado.');}catch(e){toast('error','Não foi possível copiar',e.message+' Selecione o texto e copie com Ctrl+C.');}render();}
 if(action==='copy-followup'){const fu=readFollowUps(target.dataset.day).find(f=>f.id===target.dataset.id);if(!fu)return;try{await copyText(rewriteNames(fu.text));logEvent('alerta_copiado','','',`Acompanhamento copiado (${fu.id})`,fu.id);toast('success','Acompanhamento copiado','Cole no WhatsApp e marque como enviado.');}catch(e){toast('error','Não foi possível copiar',e.message);}render();}
 if(action==='sent'||action==='sent-current'){const day=target.dataset.day||dayId(new Date()),current=action==='sent-current'||target.dataset.id==='current',key=(current?CURRENT:SUMMARY)+day;let entry=GM_getValue(key,null);if(entry&&!entry.sentAt){entry.sentAt=new Date().toISOString();if(!current)entry.frozen=true;GM_setValue(key,entry);logEvent('alerta_enviado_confirmado','','',current?'Situação atual enviada':'Abertura enviada',day);toast('success','Envio registrado',`Horário ${shortTime(entry.sentAt)} salvo neste navegador.`);}render();}
 if(action==='toggle-current'){state.currentOpen=!state.currentOpen;render();return;}
 if(action==='check-update'){await checkUpdate();return;}
 if(action==='sent-followup'){const day=target.dataset.day||dayId(new Date()),list=readFollowUps(day),fu=list.find(f=>f.id===target.dataset.id);if(!fu||fu.sentAt)return;fu.sentAt=new Date().toISOString();saveFollowUps(day,list);GM_setValue(FOLLOWUP_ACK+day,fu.eventAtMax||fu.at);logEvent('alerta_enviado_confirmado','','',`Acompanhamento enviado (${fu.id})`,fu.id);toast('success','Acompanhamento registrado',`Próximo delta após ${shortTime(fu.sentAt)}.`);state.alertFollowUp=null;render();}
 if(action==='select-followup'){const id=target.dataset.id;state.alertFollowUp=state.alertFollowUp===id?null:id;render();return;}
 if(action==='copy-details'){try{await copyText(state.errorDetails||'');toast('success','Detalhes copiados','');}catch(e){toast('error','Não foi possível copiar',e.message);}}
 if(action==='csv7'||action==='csv30'){state.menu=false;exportEvents(action==='csv7'?7:30);toast('success','CSV exportado','O arquivo não inclui tokens nem senhas.');}
});
root.addEventListener('change',e=>{
 if(e.target.matches('.poll-interval')){const value=e.target.value,n=Number(value);
  if(value.trim()!==''&&Number.isInteger(n)&&n>=30&&n<=3600){config={...config,intervalSeconds:n};GM_setValue(CONFIG,config);e.target.removeAttribute('aria-invalid');toast('success','Intervalo salvo',`Atualização a cada ${n} s. Uma única aba continua responsável.`);void tick();}
  else{e.target.setAttribute('aria-invalid','true');toast('error','Intervalo inválido','Use um número inteiro de 30 a 3600 segundos.');}return;}
 if(e.target.matches('.min-offline')){const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=30){config={...config,minOfflineMinutes:n};GM_setValue(CONFIG,config);e.target.removeAttribute('aria-invalid');toast('success','Tempo mínimo salvo',`Queda só entra no alerta depois de ${n} min offline.`);}else{e.target.setAttribute('aria-invalid','true');toast('error','Valor inválido','Use de 1 a 30 minutos.');}return;}
 if(e.target.matches('.update-url')){const url=e.target.value.trim();if(!url){config={...config,updateUrl:''};GM_setValue(CONFIG,config);return;}if(/^https:\/\/\S+\.user\.js(?:\?.*)?$/.test(url)){config={...config,updateUrl:url};GM_setValue(CONFIG,config);e.target.removeAttribute('aria-invalid');toast('success','URL salva','Os analistas neste navegador já podem verificar a atualização.');}else{e.target.setAttribute('aria-invalid','true');toast('error','URL inválida','Use HTTPS e termine com .user.js');}return;}
 if(e.target.matches('.followup-interval')){const value=e.target.value,n=Number(value);
  if(value.trim()!==''&&Number.isInteger(n)&&n>=0&&n<=240){config={...config,followUpMinutes:n};GM_setValue(CONFIG,config);e.target.removeAttribute('aria-invalid');toast('success','Acompanhamento salvo',n?`Nova mensagem de delta a cada ${n} min quando houver mudanças.`:'Acompanhamentos automáticos desligados.');render();}
  else{e.target.setAttribute('aria-invalid','true');toast('error','Intervalo inválido','Use um inteiro de 0 (desligado) a 240 minutos.');}return;}
 if(!e.target.matches('.opening-time'))return;const time=e.target.value;
 if(/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){config={...config,opening:time};GM_setValue(CONFIG,config);e.target.removeAttribute('aria-invalid');toast('success','Horário salvo',`Abertura do dia às ${time} (Brasília).`);}
 else{e.target.setAttribute('aria-invalid','true');toast('error','Horário inválido','Use HH:MM, por exemplo 08:00.');}});
root.addEventListener('toggle',e=>{
 if(e.target.matches?.('.stats-help')&&e.target.isConnected){state.statsHelpOpen=!!e.target.open;return;}
 if(!e.target.matches?.('.technical-details')||!e.target.isConnected)return;
 const opened=e.target.open;if(opened&&!state.technicalOpen)state.technicalScroll=body.scrollTop;
 if(!opened&&state.technicalOpen)body.scrollTop=state.technicalScroll;state.technicalOpen=opened;e.target.querySelector('summary')?.setAttribute('aria-expanded',String(opened));
},true);
root.addEventListener('input',e=>{if(e.target.matches('.server-url'))e.target.removeAttribute('aria-invalid');});
root.addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.stopPropagation();if(state.confirm){state.confirm=false;render();panel.querySelector('[data-action=restore-ask]')?.focus();}else if(state.menu){closeMenu();}else if(state.settings||state.prefs)back();else if(state.section==='alerts'&&state.currentOpen){state.currentOpen=false;render();}else if(state.section==='alerts'&&state.alertFollowUp){state.alertFollowUp=null;render();}else if(['alerts','history'].includes(state.section)&&disclosureValue(state.section)){toggleDisclosure(state.section,disclosureValue(state.section));}else if(state.section==='servers'&&state.technicalOpen){state.technicalOpen=false;render();body.scrollTop=state.technicalScroll;body.querySelector('.technical-details summary')?.focus({preventScroll:true});}else if(state.section==='servers'&&state.expanded){toggleDisclosure('servers',state.expanded);}else if(state.open){openPanel(false,true,true);render();}return;}
 if(e.key==='Enter'&&e.target.matches('.server-url')){e.preventDefault();addServer();return;}
 if(e.key==='Enter'&&e.target.matches('.server-rename')){e.preventDefault();saveServerName(e.target.dataset.origin,e.target.value);return;}
 if(e.key==='Tab'&&state.confirm){const f=[...panel.querySelectorAll('.dialog button')];if(!f.length)return;const i=f.indexOf(root.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();f.at(-1).focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}return;}
 if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&e.target.getAttribute('role')==='tab'){e.preventDefault();const ids=['servers','alerts','history'],i=ids.indexOf(e.target.dataset.section),n=ids[(i+(e.key==='ArrowRight'?1:2))%3];selectSection(n);tabsEl.querySelector(`[data-section=${n}]`).focus({preventScroll:true});return;}
 if((e.key==='ArrowDown'||e.key==='ArrowUp')&&e.target.closest('.menu')){e.preventDefault();const items=[...panel.querySelectorAll('.menu button')],i=items.indexOf(e.target);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length].focus();return;}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-expand]')){e.preventDefault();toggleDisclosure('servers',e.target.dataset.expand);}
});
document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyM'){e.preventDefault();state.hiddenTab=false;openPanel(!state.open,true,true);render();}},true);
document.addEventListener('click',e=>{if(state.menu&&e.target!==host){state.menu=false;render();}});
document.addEventListener('fullscreenchange',applyVisibility);

// Lease: one polling coordinator, heartbeat every 4 seconds. Expired tabs must re-elect.
async function elect(){
 if(stopped||acquiring)return false;if(ownsLease()){leader=true;GM_setValue(LEASE,{owner:tabId,until:Date.now()+LEASE_MS});return true;}
 leader=false;const old=GM_getValue(LEASE,null);if(old?.until>Date.now())return false;
 acquiring=true;
 try{
 await new Promise(resolve=>setTimeout(resolve,100+Math.random()*250));
 if(stopped)return false;const fresh=GM_getValue(LEASE,null);if(fresh?.until>Date.now())return false;
 GM_setValue(LEASE,{owner:tabId,until:Date.now()+LEASE_MS});
 await new Promise(resolve=>setTimeout(resolve,100));
 leader=ownsLease();if(leader)state.lastPoll=0;return leader;
 }finally{acquiring=false;}
}
async function captureLocal(){
 const server=servers.find(s=>originOf(s)===currentOrigin);if(!server||captureBusy||storedToken(server))return;
 // Only a 3CX login tab can renew its own cookie-backed session. It never lists SBCs as a follower.
 if(Date.now()-(captureLocal.last||0)<30000)return;captureLocal.last=Date.now();captureBusy=true;
 try{await refreshToken(server);GM_setValue(COMMAND,{id:'capture-'+tabId+'-'+Date.now()});}catch{/* Coordinator publishes user-facing status; never persist credential responses. */}finally{captureBusy=false;}
}
function releaseUrl(){const url=(config.updateUrl||UPDATE_URL||'').trim();return /^https:\/\/\S+\.user\.js(?:\?.*)?$/.test(url)?url:'';}
function versionNewer(remote,local){const a=String(remote).split('.').map(n=>parseInt(n,10)||0),b=String(local).split('.').map(n=>parseInt(n,10)||0);for(let i=0;i<3;i++){if((a[i]||0)!==(b[i]||0))return (a[i]||0)>(b[i]||0);}return false;}
async function checkUpdate(){
 const url=releaseUrl();if(!url){toast('warning','Sem URL de atualização','Em Configurações, cole o HTTPS do arquivo .user.js publicado.');return;}
 try{
  const response=await new Promise((resolve,reject)=>GM_xmlhttpRequest({method:'GET',url,timeout:15000,onload:resolve,onerror:()=>reject(new Error('Falha ao baixar')),ontimeout:()=>reject(new Error('Tempo esgotado'))}));
  if(response.status!==200)throw new Error('HTTP '+response.status);
  const remote=(String(response.responseText).match(/@version\s+([0-9]+\.[0-9]+\.[0-9]+)/)||[])[1];
  if(!remote)throw new Error('Versão não encontrada no arquivo');
  if(!versionNewer(remote,VERSION)){toast('success','Você está na versão mais nova',`Instalada: ${VERSION}`);return;}
  window.open(url,'_blank','noopener');
  toast('info',`Versão ${remote} disponível`,'O Tampermonkey deve pedir para atualizar. Confirme a instalação e recarregue a página.');
 }catch(e){toast('error','Não foi possível verificar',e.message);}
}
function purgeRetention(){
 if(!ownsLease())return;
 const today=dayId(new Date());if(GM_getValue('sbc-monitor-v10:purged','')===today)return;
 const noon=Date.parse(today+'T12:00:00-03:00');
 for(let i=RETENTION_DAYS;i<RETENTION_DAYS+90;i++){const d=dayId(new Date(noon-i*86400000));for(const k of [logKey(d),SUMMARY+d,DAILY+d,FOLLOWUP+d,FOLLOWUP_ACK+d,FOLLOWUP_META+d,CURRENT+d])GM_deleteValue(k);}
 GM_setValue('sbc-monitor-v10:purged',today);
}
async function tick(){
 if(stopped)return;
 if(await elect()){
 purgeRetention();
 const command=GM_getValue(COMMAND,null),manual=command&&command.id!==commandSeen;
 if(manual&&!state.busy)commandSeen=command.id;
 if(!state.busy&&(manual||Date.now()-state.lastPoll>=checkMs()))await pollAll(false);
 }else{void captureLocal();}
 render();
}
const listenerKeys=new Set();
function listenServer(server){const key=snapshotKey(server);if(listenerKeys.has(key))return;listenerKeys.add(key);GM_addValueChangeListener(key,()=>render());}
for(const server of servers)listenServer(server);
GM_addValueChangeListener(SERVERS_KEY,(_k,_o,v)=>{if(Array.isArray(v)&&v.length){servers=v.filter(validServer);for(const s of servers)listenServer(s);render();}});
GM_addValueChangeListener(CONFIG,(_k,_o,v)=>{config=loadConfig(v);render();});
GM_addValueChangeListener(COMMAND,()=>{void tick();});
let watchedDay='';function watchDay(){const d=dayId(new Date());if(d===watchedDay)return;watchedDay=d;GM_addValueChangeListener(DAILY+d,()=>render());GM_addValueChangeListener(SUMMARY+d,()=>render());GM_addValueChangeListener(CURRENT+d,()=>render());GM_addValueChangeListener(FOLLOWUP+d,()=>render());state.alertDay=null;state.alertFollowUp=null;disclosureTrail.alerts.length=0;state.captureMessage='';}
// Preserve the old copied-but-not-confirmed alert without inventing a sent timestamp.
function migratePending(){if(!ownsLease())return;const old=GM_getValue(PENDING_ALERT_KEY,null);if(!old?.items?.length)return;
 const date=new Date(old.copiedAt);if(!Number.isFinite(date.getTime()))return;
 const id='legacy-'+old.copiedAt,marker='sbc-monitor-v92:legacy-pending-migrated';if(GM_getValue(marker,null)===id)return;
 addDaily({id,at:date.toISOString(),label:'Alerta copiado na versão anterior',type:'legacy',sentAt:null,text:'🚨 *ALERTA 3CX — SBC OFFLINE*\n'+old.items.map(i=>`🔴 *${i.server}* · ${i.name}`).join('\n')},dayId(date));
 GM_setValue(marker,id); // Keep the original legacy object; do not re-import it on subsequent days.
}
window.addEventListener('pagehide',()=>{if(ownsLease())GM_setValue(LEASE,{owner:tabId,until:0});stopped=true;});
window.addEventListener('pageshow',()=>{if(stopped){stopped=false;void tick();}});
GM_addValueChangeListener(PREFS,(_k,_o,v)=>{prefs=loadPrefs(v);applyTheme();layoutNow();render();});
// Idempotent re-mount: SPAs that rebuild <body> children must not remove the monitor.
let remountTimer;new MutationObserver(()=>{clearTimeout(remountTimer);remountTimer=setTimeout(()=>{if(!host.isConnected&&document.body)document.body.append(host);},150);}).observe(document.documentElement,{childList:true,subtree:false});
if(document.body)new MutationObserver(()=>{if(!host.isConnected){clearTimeout(remountTimer);remountTimer=setTimeout(()=>{if(!host.isConnected)document.body.append(host);},150);}}).observe(document.body,{childList:true});
applyTheme();layoutNow();openPanel(state.open);watchDay();render();
void tick().then(migratePending);
setInterval(()=>{watchDay();void tick().then(migratePending);},4000);
})();
