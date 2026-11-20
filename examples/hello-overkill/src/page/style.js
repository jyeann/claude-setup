'use strict';
// The single inline stylesheet. Tokens come from tokens.js so colour values live in one place.
// Rules (see ux-redesign.md): no url(), no data: URIs, no web fonts; keyframes omit their `to` frame and use
// fill-mode backwards so an element's natural style is always its end state (nothing can stay invisible).
const { LIGHT, DARK, toCss } = require('./tokens');

const LIGHT_VARS = `${toCss(LIGHT)}--shadow-rgb:60 40 10;--grain:rgb(90 70 40 / .035);--edge:0 0 #0000;--stamp-blend:multiply`;
const DARK_VARS = `${toCss(DARK)}--shadow-rgb:0 0 0;--grain:rgb(255 255 255 / .018);--edge:inset 0 1px 0 rgb(255 255 255 / .05);--stamp-blend:normal`;

// Quantised meter values for [data-q] (0..100 step 5) without inline styles.
const Q_RULES = Array.from({ length: 21 }, (_, i) => `[data-q="${i * 5}"]{--q:${i / 20}}`).join('');
// Rail marker positions for the time machine.
const POS_RULES = Array.from({ length: 7 }, (_, i) => `[data-pos="${i}"]{--pos:${i}}`).join('');
// Stagger indices for direct children.
const STAGGER = Array.from({ length: 10 }, (_, i) => `.stagger>:nth-child(${i + 1}){--i:${i}}`).join('');

const GUI_I = Array.from({ length: 19 }, (_, i) => `.cert-guilloche path:nth-child(${i + 1}){--i:${i}}`).join('');

const KEYFRAMES = `
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@keyframes rise-lg{from{opacity:0;transform:translateY(14px) rotate(.6deg)}}
@keyframes slide-up{from{opacity:0;transform:translateY(32px)}}
@keyframes deal-a{from{opacity:0;transform:translateX(-24px) rotate(-4deg)}}
@keyframes deal-b{from{opacity:0;transform:translateX(24px) rotate(4deg)}}
@keyframes stamp-in{from{opacity:0;transform:scale(1.7) rotate(-16deg)}}
@keyframes stamp-in-r{from{opacity:0;transform:scale(2) rotate(14deg)}}
@keyframes thud{from{transform:translateY(1.5px)}}
@keyframes draw{from{stroke-dashoffset:1}}
@keyframes tape{from{clip-path:inset(0 100% 0 0)}}
@keyframes flip{from{transform:perspective(400px) rotateX(90deg)}}
@keyframes tick{from{opacity:.6;transform:translateY(-3px)}}
@keyframes shake{0%{transform:translateX(0)}25%{transform:translateX(-3px)}50%{transform:translateX(3px)}75%{transform:translateX(-2px)}}
@keyframes wash{from{background-color:rgb(255 122 92 / .22)}}
@keyframes ink-in{from{opacity:0;filter:blur(3px);transform:translateY(6px)}}
@keyframes press{from{opacity:0;filter:blur(4px);transform:translateY(4px)}}
@keyframes ripple{from{opacity:.5;transform:scale(1)}}
@keyframes grow{from{transform:scaleX(0)}}
@keyframes pop{from{transform:scale(.6)}}
@keyframes flap{from{transform:scaleY(1)}}
`;

const STYLE = `
:root{${LIGHT_VARS};color-scheme:light;
--font-display:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,"Bitstream Charter",Cambria,"URW Palladio L","P052",Georgia,ui-serif,serif;
--font-ui:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","Noto Sans","Liberation Sans",Arial,sans-serif;
--font-mono:ui-monospace,"SF Mono","Cascadia Mono","Roboto Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;
--s-1:.25rem;--s-2:.5rem;--s-3:.75rem;--s-4:1rem;--s-5:1.5rem;--s-6:2rem;--s-7:3rem;--s-8:4rem;
--r-0:2px;--r-1:6px;--r-2:10px;--r-pill:999px;--gutter:var(--s-4);
--d-instant:90ms;--d-fast:160ms;--d-base:260ms;--d-slow:420ms;--d-ceremony:720ms;--step:60ms;
--ease-out:cubic-bezier(.22,1,.36,1);--ease-in:cubic-bezier(.64,0,.78,0);--ease-io:cubic-bezier(.65,0,.35,1);
--ease-stamp:cubic-bezier(.34,1.56,.64,1);--spring-soft:cubic-bezier(.34,1.3,.64,1);--spring-snap:cubic-bezier(.3,1.4,.6,1);
--z-lift:1;--z-rail:10;--z-vt:20}
@supports (transition-timing-function:linear(0,1)){:root{--spring-soft:linear(0,.2 5%,.55 12%,.86 21%,1.04 32%,1.06 40%,1.03 50%,.995 63%,1 80%,1);--spring-snap:linear(0,.4 7%,.82 16%,1.05 27%,1.03 38%,.995 55%,1)}}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK_VARS};color-scheme:dark}}
:root[data-theme=dark]{${DARK_VARS};color-scheme:dark}
:root[data-theme=light]{color-scheme:light}
.paper{${LIGHT_VARS};color-scheme:light;color:var(--ink)}
.night{${DARK_VARS};color-scheme:dark;color:var(--ink)}
:root{--sh-1:var(--edge),0 1px 0 rgb(var(--shadow-rgb) / .06),0 1px 2px rgb(var(--shadow-rgb) / .10);
--sh-2:var(--edge),0 1px 1px rgb(var(--shadow-rgb) / .08),0 6px 14px -4px rgb(var(--shadow-rgb) / .22);
--sh-3:var(--edge),0 2px 2px rgb(var(--shadow-rgb) / .08),0 16px 30px -8px rgb(var(--shadow-rgb) / .34)}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--paper);-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;color:var(--ink);background-color:var(--paper);background-image:repeating-linear-gradient(0deg,var(--grain) 0 1px,transparent 1px 4px);font:400 1rem/1.55 var(--font-ui);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.theme-anim body{transition:background-color var(--d-base) var(--ease-out),color var(--d-base) var(--ease-out)}
[hidden]{display:none!important}
::selection{background:var(--teal);color:var(--paper)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
h1:focus-visible{outline-offset:4px;border-radius:var(--r-0)}
a{color:var(--teal);text-underline-offset:.2em}
p{margin:0}
svg{flex:none}
.ic{width:1.25rem;height:1.25rem;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.mono{font-family:var(--font-mono)}
.num{font-variant-numeric:tabular-nums}

/* ---------- shell ---------- */
.shell{min-height:100vh;display:flex;flex-direction:column;overflow-x:clip}
.airmail{height:6px;background:repeating-linear-gradient(135deg,var(--accent) 0 12px,var(--paper) 12px 24px,var(--teal) 24px 36px,var(--paper) 36px 48px)}
.letterhead,.frame,footer{width:100%;max-width:74rem;margin:0 auto;padding-inline:var(--gutter)}
.letterhead{display:flex;flex-direction:column;gap:var(--s-3);padding-block:var(--s-4) 0}
.letterhead::after{content:"";display:block;border-bottom:3px double var(--ink);margin-top:var(--s-1)}
.brand-row{display:flex;align-items:center;gap:var(--s-3);min-width:0}
.crest{width:2.5rem;height:2.5rem;color:var(--accent)}
.brand{font:700 1.375rem/1.1 var(--font-display);letter-spacing:-.005em}
.brand-sub{margin-top:2px}
.eyebrow{font:600 .75rem/1.4 var(--font-mono);letter-spacing:.14em;color:var(--ink-2)}
.tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-2)}
.tabs a{display:flex;align-items:center;justify-content:center;gap:var(--s-2);min-height:48px;padding:0 var(--s-4);border:1px solid var(--line);border-radius:var(--r-1) var(--r-1) 0 0;border-bottom-color:transparent;color:var(--ink);text-decoration:none;font-weight:500;background:transparent;transition:background-color var(--d-fast) var(--ease-out),transform var(--d-instant) var(--ease-out),box-shadow var(--d-fast) var(--ease-out)}
.tabs a[aria-current=page]{font-weight:700;background:var(--surface);box-shadow:inset 0 -3px 0 var(--accent);border-color:var(--line)}
.tabs a .ic{width:1.125rem;height:1.125rem;color:var(--ink-2)}
.tabs a[aria-current=page] .ic{color:var(--accent)}
.frame{flex:1;display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s-6);padding-block:var(--s-5) var(--s-6)}
main{min-width:0;outline:none}
.view-head{display:grid;gap:var(--s-2);margin-bottom:var(--s-5)}
h1{font:700 clamp(2rem,1.4rem + 2.6vw,3rem)/1.08 var(--font-display);letter-spacing:-.01em;margin:0;text-wrap:balance}
h2{font:600 1.375rem/1.3 var(--font-display);margin:0;text-wrap:balance}
.lede{font-size:1.125rem;line-height:1.5;color:var(--ink-2);max-width:40rem;text-wrap:pretty}
main>section:not([hidden]){animation:rise var(--d-base) var(--ease-out) backwards}
.annex{min-width:0}
.annex-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-3);margin-bottom:var(--s-3);padding-top:var(--s-4);border-top:1px solid var(--line)}
.annex-label{font:600 1.125rem/1.3 var(--font-display)}
.annex nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-2)}
.annex nav a{position:relative;min-width:0;overflow-wrap:anywhere;display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:60px;padding:var(--s-2) var(--s-3) var(--s-2) 3rem;border:1px solid var(--line);border-radius:var(--r-1);background:var(--surface);color:var(--ink);text-decoration:none;font-weight:600;line-height:1.25;box-shadow:var(--sh-1);transition:background-color var(--d-fast) var(--ease-out),transform var(--d-instant) var(--ease-out),box-shadow var(--d-fast) var(--ease-out),border-color var(--d-fast) var(--ease-out)}
.annex nav a::after{content:attr(data-sub) / "";font:500 .6875rem/1.3 var(--font-mono);letter-spacing:.1em;color:var(--ink-2)}
.annex nav a .ic{position:absolute;left:var(--s-3);top:50%;margin-top:-.75rem;width:1.5rem;height:1.5rem;color:var(--teal)}
.annex nav a[aria-current=page]{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent),var(--sh-1)}
.annex nav a[aria-current=page] .ic{color:var(--accent)}
footer{display:grid;gap:var(--s-4);padding-block:var(--s-5) var(--s-6);border-top:1px solid var(--line);color:var(--ink-2);font-size:.875rem}
.appearance{border:0;margin:0;padding:0;min-width:0;display:grid;gap:var(--s-2)}
.appearance legend{padding:0;margin-bottom:var(--s-2);font-weight:600;color:var(--ink)}
.seg{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--control);border-radius:var(--r-1);overflow:hidden;background:var(--surface)}
.seg label{position:relative;display:flex;align-items:center;justify-content:center;gap:var(--s-2);min-height:44px;padding:0 var(--s-3);cursor:pointer;color:var(--ink);font-weight:500;border-left:1px solid var(--line);transition:background-color var(--d-fast) var(--ease-out),color var(--d-fast) var(--ease-out)}
.seg label:first-child{border-left:0}
.seg input{appearance:none;-webkit-appearance:none;margin:0;width:1rem;height:1rem;border:2px solid var(--control);border-radius:50%;background:var(--surface);flex:none;transition:box-shadow var(--d-fast) var(--spring-snap)}
.seg input:checked{border-color:var(--accent-ink);background:var(--accent);box-shadow:inset 0 0 0 2px var(--accent),inset 0 0 0 8px var(--accent-ink)}
.seg label:has(input:checked){background:var(--accent);color:var(--accent-ink);font-weight:700}
.seg label:has(input:focus-visible){outline:3px solid var(--focus);outline-offset:-3px}
.seg input:focus-visible{outline:none}

/* ---------- forms and controls ---------- */
.sheet{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-2);box-shadow:var(--sh-1);padding:var(--s-5);min-width:0;position:relative}
.slip::after{content:attr(data-form) / "";position:absolute;top:var(--s-3);right:var(--s-4);font:600 .6875rem/1 var(--font-mono);letter-spacing:.12em;color:var(--ink-2)}
.field{display:grid;gap:var(--s-2);margin-bottom:var(--s-4)}
label,.label{font-weight:600;font-size:.9375rem}
input[type=text],input[type=date],input[type=number],select,textarea{width:100%;min-height:48px;padding:10px 12px;font:inherit;font-size:1rem;color:var(--ink);background-color:var(--surface);border:1px solid var(--control);border-radius:var(--r-1);transition:border-color var(--d-fast) var(--ease-out),box-shadow var(--d-fast) var(--ease-out)}
input:hover,select:hover,textarea:hover{border-color:var(--ink-2)}
input:focus-visible,select:focus-visible,textarea:focus-visible{border-color:var(--teal)}
select{appearance:none;-webkit-appearance:none;padding-right:40px;background-image:linear-gradient(45deg,transparent 50%,var(--ink) 50%),linear-gradient(135deg,var(--ink) 50%,transparent 50%);background-position:calc(100% - 20px) 52%,calc(100% - 14px) 52%;background-size:6px 6px;background-repeat:no-repeat}
textarea{min-height:9rem;resize:vertical;overflow-wrap:anywhere;font-family:var(--font-mono);font-size:.875rem;line-height:1.5rem;background-color:var(--surface);background-image:repeating-linear-gradient(transparent 0 calc(1.5rem - 1px),var(--line) calc(1.5rem - 1px) 1.5rem);background-attachment:local;background-position:0 10px}
[aria-invalid=true]{border:2px solid var(--bad)!important;animation:shake 400ms var(--ease-out)}
.hint{color:var(--ink-2);font-size:.8125rem;line-height:1.45;text-wrap:pretty}
.err{min-height:1.5rem;color:var(--bad);font-size:.9375rem;font-weight:500;display:flex;gap:var(--s-2);align-items:flex-start}
.err:not(:empty)::before{content:"!" / "";flex:none;display:inline-grid;place-items:center;width:1.25rem;height:1.25rem;margin-top:.1rem;border-radius:50%;background:var(--bad);color:var(--surface);font:700 .8125rem/1 var(--font-ui)}
.check{position:relative;display:flex;align-items:center;gap:var(--s-3);min-height:48px;padding:var(--s-2) var(--s-3);margin:0 calc(-1 * var(--s-3)) var(--s-4);border-radius:var(--r-1);transition:background-color var(--d-fast) var(--ease-out)}
.check:has(input:checked){background:linear-gradient(90deg,transparent 4px,transparent 4px),var(--sunken);box-shadow:inset 4px 0 0 var(--accent)}
.check:has(input:checked)::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:repeating-linear-gradient(135deg,var(--accent) 0 6px,transparent 6px 12px);border-radius:var(--r-1) 0 0 var(--r-1)}
.check input{appearance:none;-webkit-appearance:none;margin:0;width:28px;height:28px;flex:none;border:2px solid var(--control);border-radius:var(--r-1);background:var(--surface);cursor:pointer;transition:background-color var(--d-fast) var(--ease-out),border-color var(--d-fast) var(--ease-out),transform var(--d-instant) var(--ease-out)}
.check input:checked{background:var(--accent);border-color:var(--accent)}
.check input:active{transform:scale(.94)}
.check .tick{position:absolute;left:calc(var(--s-3) + 4px);width:20px;height:20px;pointer-events:none;stroke:var(--accent-ink);stroke-width:3;fill:none;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.6);transition:opacity var(--d-fast) var(--ease-out),transform 180ms var(--spring-snap)}
.check input:checked+.tick{opacity:1;transform:none}
.check label{font-weight:500;cursor:pointer}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s-2);min-height:48px;padding:0 var(--s-5);font:600 1rem/1.2 var(--font-ui);border-radius:var(--r-1);border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);text-decoration:none;cursor:pointer;box-shadow:var(--sh-1);-webkit-tap-highlight-color:transparent;transition:transform var(--d-instant) var(--ease-out),background-color var(--d-fast) var(--ease-out),box-shadow var(--d-fast) var(--ease-out),border-color var(--d-fast) var(--ease-out),color var(--d-fast) var(--ease-out)}
.btn:active{transform:scale(.97);box-shadow:var(--sh-1)}
.btn.secondary{background:transparent;color:var(--accent);border:1.5px solid var(--accent);box-shadow:none}
.btn.secondary:active{transform:scale(.98)}
.btn[aria-disabled=true]{background:var(--sunken);color:var(--ink);border-color:var(--control);box-shadow:none;cursor:not-allowed;transform:none}
.btn .ic{width:1.25rem;height:1.25rem}
.btn .spin-ring{display:none;width:1.125rem;height:1.125rem;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin 900ms linear infinite}
.btn.is-busy .spin-ring{display:inline-block}
.btn.is-busy .ic{display:none}
@keyframes spin{to{transform:rotate(360deg)}}
.actions{display:flex;flex-wrap:wrap;gap:var(--s-3);align-items:center}
.form-actions{display:flex;flex-wrap:wrap;gap:var(--s-3);margin-top:var(--s-2)}
.loading-line{display:flex;align-items:center;gap:var(--s-2);color:var(--ink-2);font-size:.9375rem;min-height:1.5rem;margin-top:var(--s-3)}
.loading-line::before{content:"";width:.75rem;height:.75rem;border-radius:50%;background:var(--accent);animation:pulse 1400ms var(--ease-io) infinite}
@keyframes pulse{50%{opacity:.7}}
@media (hover:hover){
.btn:hover{background:var(--accent-hover);border-color:var(--accent-hover);transform:translateY(-1px);box-shadow:var(--sh-2)}
.btn.secondary:hover{background:var(--sunken);color:var(--accent);border-color:var(--accent);box-shadow:none}
.btn[aria-disabled=true]:hover{background:var(--sunken);color:var(--ink);border-color:var(--control);transform:none;box-shadow:none}
.tabs a:hover{background:var(--sunken)}
.tabs a[aria-current=page]:hover{background:var(--surface)}
.annex nav a:hover{transform:translateY(-1px);box-shadow:var(--sh-2);border-color:var(--control)}
.seg label:hover:not(:has(input:checked)){background:var(--sunken)}
}
.tabs a:active,.annex nav a:active{transform:scale(.98)}
.panel-msg{border-left:6px solid var(--bad);background:var(--surface);border-radius:var(--r-1);padding:var(--s-4);display:grid;gap:var(--s-2);box-shadow:var(--sh-1)}
.panel-msg.tea{border-left-color:var(--warn)}
.panel-msg .msg-ic{width:2.25rem;height:2.25rem;color:var(--warn)}
.panel-msg.oops .msg-ic{color:var(--bad)}
.panel-msg .btn{justify-self:start}

/* ---------- hello ---------- */
.hello-grid{display:grid;gap:var(--s-5);grid-template-columns:minmax(0,1fr)}
.envelope{position:relative;min-height:17rem;margin-top:2.25rem;display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}
.env-top{position:relative;height:2.25rem;color:var(--line)}
.env-top svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.env-body{fill:var(--surface);stroke:var(--line)}
.env-flap{fill:var(--sunken);stroke:var(--control);stroke-width:1;transform-origin:50% 0;transform-box:view-box}
.envelope.is-open .env-flap{transform:scaleY(-1);animation:flap 240ms var(--ease-io) backwards}
.letter{position:relative;flex:1;display:grid;align-content:start;gap:var(--s-4);padding:var(--s-5);background:var(--surface);border:1px solid var(--line);border-radius:0 0 var(--r-2) var(--r-2);box-shadow:var(--sh-2);background-image:linear-gradient(to bottom,transparent calc(33% - 1px),rgb(var(--shadow-rgb) / .07) 33%,transparent calc(33% + 1px));min-width:0}
.letter.blank{border-style:dashed;box-shadow:none;background-image:none;place-content:center;text-align:center;color:var(--ink-2);font:italic 400 1.125rem/1.5 var(--font-display)}
.letter.blank .ic{margin:0 auto var(--s-2);width:2.5rem;height:2.5rem;color:var(--line);stroke-width:1.25}
.letter.arrive{animation:slide-up 400ms var(--spring-soft) 120ms backwards,thud 80ms var(--ease-out) 820ms}
.pen{width:min(16rem,80%);height:3rem;margin:0 auto;stroke:var(--accent);stroke-width:2;fill:none;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:write 1200ms linear infinite}
@keyframes write{to{stroke-dashoffset:0}}
.greeting{font:500 clamp(1.5rem,1.1rem + 2.2vw,2.5rem)/1.2 var(--font-display);text-wrap:balance;hyphens:auto;overflow-wrap:anywhere;margin:0;padding-right:4.5rem;min-width:0;animation:ink-in 420ms var(--ease-out) 300ms backwards}
.greeting:lang(ja){font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",ui-serif,serif}
.ledger{display:flex;flex-wrap:wrap;gap:var(--s-2);align-items:center}
.chip{display:inline-flex;align-items:center;gap:var(--s-2);min-height:2rem;padding:0 var(--s-3);border:1px solid var(--line);border-radius:var(--r-0);background:var(--sunken);font:500 .875rem/1 var(--font-mono);font-variant-numeric:tabular-nums}
.dots{display:inline-flex;gap:4px;padding-left:var(--s-1)}
.dots i{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--accent)}
.dots i.on{background:var(--accent)}
.ref{font:500 .8125rem/1.4 var(--font-mono);color:var(--ink-2)}
.postmark{position:absolute;top:var(--s-4);right:var(--s-4);width:4.75rem;height:4.75rem;color:var(--accent);mix-blend-mode:var(--stamp-blend);opacity:.92;transform:rotate(-7deg);animation:stamp-in 200ms var(--ease-stamp) 620ms backwards;pointer-events:none}
.postmark text{fill:currentColor;font:600 9px var(--font-mono);text-anchor:middle}
.postmark .yr{font-size:11px}
.letter .rise{animation:rise var(--d-base) var(--ease-out) backwards;animation-delay:calc(440ms + var(--i,0) * var(--step))}
.ticket{display:grid;grid-template-columns:auto 1fr;gap:var(--s-4);align-items:center;padding:var(--s-4);border:2px dashed var(--control);border-radius:var(--r-1);background:var(--surface)}
.ring{width:3.5rem;height:3.5rem;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:4}
.ring .track{stroke:var(--sunken)}
.ring .bar{stroke:var(--accent);stroke-linecap:round;stroke-dasharray:150.8;transition:stroke-dashoffset 1s linear}
.ring-num{font:700 .875rem/1 var(--font-mono)}

/* ---------- certificate ---------- */
.cert-stage{display:grid;gap:var(--s-5);justify-items:center}
.cert-sheet{position:relative;width:100%;max-width:34rem;aspect-ratio:566/800;border-radius:var(--r-2);background-color:var(--surface);background-image:repeating-linear-gradient(0deg,var(--grain) 0 1px,transparent 1px 4px),radial-gradient(ellipse at 50% 40%,transparent 55%,rgb(var(--shadow-rgb) / .06));box-shadow:0 1px 1px rgb(60 40 10 / .08),0 22px 44px -14px rgb(0 0 0 / .45);animation:rise-lg var(--d-slow) var(--ease-out) backwards;container-type:inline-size;display:flex;flex-direction:column}
.cert-guilloche{position:absolute;inset:0;width:100%;height:100%;fill:none}
.cert-guilloche path{stroke-dashoffset:0;stroke-dasharray:1;vector-effect:non-scaling-stroke;animation:draw 700ms var(--ease-io) backwards;animation-delay:calc(120ms + var(--i,0) * 30ms)}
.cert-guilloche .rule{stroke:var(--ink);stroke-width:1.6}
.cert-guilloche .rule2{stroke:var(--teal);stroke-width:.75}
.cert-guilloche .band{stroke:var(--teal);stroke-width:.7;opacity:.85}
.cert-guilloche .rose{stroke:var(--accent);stroke-width:.8;opacity:.9}
.cert-guilloche .mark{stroke:var(--teal);stroke-width:.6;opacity:.16}
.cert-body{position:relative;flex:1;padding:12% 11% 8%;display:flex;flex-direction:column;align-items:center;text-align:center;gap:1.4cqw;color:var(--ink)}
.cert-body>*{animation:rise var(--d-base) var(--ease-out) backwards;animation-delay:calc(360ms + var(--i,0) * var(--step))}
.cert-crest{width:9cqw;height:9cqw;color:var(--accent)}
.cert-body .eyebrow{font-size:max(.625rem,2.1cqw)}
.eng-title{font:700 max(1.25rem,6.2cqw)/1.05 var(--font-display);letter-spacing:.01em;text-shadow:0 1px 0 rgb(255 255 255 / .8),0 -1px 0 rgb(0 0 0 / .12)}
.cert-rule{width:40%;height:1px;background:linear-gradient(90deg,transparent,var(--ink-2),transparent);position:relative;margin:1cqw 0}
.cert-rule::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;background:var(--accent);transform:translate(-50%,-50%) rotate(45deg)}
.cert-dl{margin:0;display:grid;gap:.4cqw;width:100%;justify-items:center}
.cert-dl dt{font:600 max(.625rem,1.9cqw)/1.3 var(--font-mono);letter-spacing:.16em;color:var(--ink-2);margin-top:1.6cqw}
.cert-dl dd{margin:0;max-width:100%;overflow-wrap:anywhere}
.cert-name{font:italic 500 max(1.5rem,7.2cqw)/1.1 var(--font-display);text-wrap:balance}
.cert-greet{font:400 max(1rem,3.6cqw)/1.35 var(--font-display);text-wrap:balance}
.cert-greet::before{content:"\\201C" / ""}
.cert-greet::after{content:"\\201D" / ""}
.cert-date{font:500 max(.8125rem,2.6cqw)/1.3 var(--font-mono);font-variant-numeric:tabular-nums}
.cert-sig{font:500 max(.625rem,1.75cqw)/1.45 var(--font-mono);background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-0);padding:.4em .7em;max-width:92%!important}
.cert-serial{font:500 max(.625rem,1.9cqw)/1.3 var(--font-mono);color:var(--ink-2);letter-spacing:.06em}
.cert-seal{position:relative;margin-top:auto;flex:none;width:max(5.5rem,19cqw);height:auto;aspect-ratio:120/140;transform:rotate(-8deg);animation:stamp-in 240ms var(--ease-stamp) 700ms backwards;overflow:visible}
.cert-seal .disc{fill:var(--accent)}
.cert-seal .ribbon{fill:var(--accent-hover)}
.cert-seal .inner{fill:none;stroke:var(--accent-ink);stroke-width:1.2}
.cert-seal text{fill:var(--accent-ink);font:700 7.5px var(--font-mono);text-anchor:middle}
.cert-seal .mono-gram{font:700 26px var(--font-display);letter-spacing:-1px}
.cert-seal .ripple{fill:none;stroke:var(--accent);stroke-width:1;opacity:0;transform-origin:60px 60px;animation:ripple 500ms var(--ease-out) 700ms backwards}
.cert-foot{display:none}
.cert-skeleton{width:100%;max-width:34rem;aspect-ratio:566/800;border:2px dashed var(--line);border-radius:var(--r-2);display:grid;place-content:center;gap:var(--s-2);text-align:center;color:var(--ink-2);animation:pulse 1400ms var(--ease-io) infinite}
.cert-tools{width:100%;max-width:34rem;display:grid;gap:var(--s-3)}
.copied{display:inline-flex;align-items:center;gap:var(--s-1);padding:0 var(--s-3);min-height:2rem;border-radius:var(--r-pill);border:1px solid var(--ok);color:var(--ok);font-weight:600;font-size:.875rem;animation:pop 180ms var(--spring-snap) backwards}
.dead{position:relative;width:100%;max-width:34rem;padding:var(--s-7) var(--s-5);border:2px dashed var(--control);border-radius:var(--r-2);background:var(--sunken);display:grid;gap:var(--s-4);justify-items:center;text-align:center}
.rts{font:700 1.125rem/1 var(--font-mono);letter-spacing:.12em;color:var(--bad);border:3px double var(--bad);padding:var(--s-2) var(--s-4);border-radius:var(--r-1);transform:rotate(-6deg);animation:stamp-in 200ms var(--ease-stamp) backwards}

/* ---------- verify ---------- */
.verify-grid{display:grid;gap:var(--s-5);grid-template-columns:minmax(0,1fr)}
.tray{position:relative}
.tray .scan{position:absolute;left:var(--s-5);right:var(--s-5);top:calc(var(--s-5) + 2rem);height:2px;background:var(--accent);box-shadow:0 0 12px var(--accent);opacity:.8;animation:scan 900ms linear infinite alternate;pointer-events:none}
@keyframes scan{to{transform:translateY(7rem)}}
.verdict-pane{display:grid;align-content:start;gap:var(--s-4);min-height:12rem;justify-items:center;text-align:center;padding:var(--s-5) var(--s-4)}
.ghost-ring{width:9rem;height:9rem;border:2px dashed var(--line);border-radius:50%;display:grid;place-content:center;color:var(--ink-2);font:600 .75rem/1.3 var(--font-mono);letter-spacing:.12em;padding:var(--s-4)}
.stamp{position:relative;display:inline-flex;align-items:center;gap:var(--s-3);padding:var(--s-3) var(--s-5);border:4px double currentColor;border-radius:var(--r-2);background:var(--surface);transform:rotate(-3deg);animation:stamp-in 200ms var(--ease-stamp) backwards}
.stamp.ok{color:var(--ok)}
.stamp.bad{color:var(--bad);transform:rotate(4deg);animation:stamp-in-r 200ms var(--ease-stamp) backwards,shake 400ms var(--ease-out) 280ms}
.stamp strong{font:700 2rem/1 var(--font-display)}
.stamp .glyph{font:700 2rem/1 var(--font-ui)}
.stamp::after{content:"";position:absolute;inset:-6px;border:2px solid currentColor;border-radius:inherit;opacity:0;animation:ripple 400ms var(--ease-out) 200ms backwards;pointer-events:none}
.reason{max-width:22rem;text-wrap:pretty;animation:rise var(--d-base) var(--ease-out) 240ms backwards}

/* ---------- battle ---------- */
.table-well{background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-2);padding:var(--s-5) var(--s-4);display:grid;gap:var(--s-4);grid-template-columns:minmax(0,1fr);min-height:12rem;align-content:start;box-shadow:inset 0 2px 6px rgb(var(--shadow-rgb) / .1)}
.opt{position:relative;display:block;width:100%;min-height:8rem;text-align:left;padding:var(--s-6) var(--s-5) var(--s-5);background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:var(--r-2);box-shadow:var(--sh-2);font:inherit;cursor:pointer;overflow-wrap:anywhere;transition:transform var(--d-fast) var(--ease-out),box-shadow var(--d-fast) var(--ease-out)}
.opt::before{content:attr(data-tag) / "";position:absolute;top:-12px;left:var(--s-4);width:30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-ink);font:700 .9375rem/1 var(--font-display);box-shadow:var(--sh-1)}
.opt.a{transform:rotate(-.6deg);animation:deal-a 380ms var(--spring-soft) backwards}
.opt.b{transform:rotate(.5deg);animation:deal-b 380ms var(--spring-soft) 90ms backwards}
.opt-tag{display:block;font:600 .75rem/1.4 var(--font-mono);letter-spacing:.12em;color:var(--ink-2);margin-bottom:var(--s-2)}
.opt-text{display:block;font:500 clamp(1.25rem,1rem + 1vw,1.625rem)/1.3 var(--font-display);text-wrap:balance}
.opt:active{transform:scale(.985)}
.opt[aria-disabled=true]{cursor:progress;opacity:.85}
@media (hover:hover){.opt:hover{transform:translateY(-3px) rotate(0);box-shadow:var(--sh-3)}}
.done-letter{position:relative;padding:var(--s-5);background:var(--surface);border:1px solid var(--line);border-radius:var(--r-2);overflow-wrap:anywhere;font:500 1.25rem/1.3 var(--font-display);transition:transform var(--d-base) var(--ease-out)}
.done-letter.win{transform:translateY(-6px);box-shadow:var(--sh-3);border-color:var(--accent);animation:rise 220ms var(--spring-snap) backwards}
.done-letter.lose{transform:translateY(4px) scale(.98);box-shadow:none;animation:rise 300ms var(--ease-out) backwards}
.pick{position:absolute;top:-14px;right:var(--s-4);font:700 .75rem/1 var(--font-mono);letter-spacing:.12em;color:var(--accent);background:var(--surface);border:2px solid var(--accent);border-radius:var(--r-1);padding:6px 10px;transform:rotate(-6deg);animation:stamp-in 200ms var(--ease-stamp) 160ms backwards}
.thanks{font-weight:600;animation:rise var(--d-base) var(--ease-out) 160ms backwards}
.after-vote{display:grid;gap:var(--s-3);justify-items:start}
.after-vote .btn{animation:rise var(--d-base) var(--ease-out) 240ms backwards}
.vote-note{min-height:1.5rem}
.lb-wrap{margin-top:var(--s-5)}

.ghost-letter{min-height:8rem;border:2px dashed var(--line);border-radius:var(--r-2);animation:pulse 1400ms var(--ease-io) infinite}
.table-well>:not(.opt):not(.ghost-letter){grid-column:1/-1}
.done-list{list-style:none;margin:0;padding:var(--s-3) 0 0;display:grid;gap:var(--s-5);grid-template-columns:minmax(0,1fr)}
.done-letter .pick{position:absolute}

@media (max-width:767px){.opt.a,.opt.b{transform:none;animation-name:rise}}

/* ---------- tables ---------- */
table{width:100%;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums}
caption{text-align:left;font:600 1.125rem/1.3 var(--font-display);padding-bottom:var(--s-2)}
th{font:600 .8125rem/1.45 var(--font-ui);color:var(--ink-2);text-align:left;padding:var(--s-2) var(--s-3);border-bottom:2px solid var(--ink);background:transparent}
td{padding:var(--s-3);border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
.lb th:first-child{width:3.5rem}
.lb th:last-child{width:4.5rem;text-align:right}
.lb td:first-child{font:700 1.25rem/1.2 var(--font-display)}
.lb td:last-child{text-align:right;font-family:var(--font-mono)}
.lb tbody tr:first-child td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
.lb tr.hot td{animation:wash 900ms var(--ease-out) backwards}
.lb tr.hot td:last-child{animation:wash 900ms var(--ease-out) backwards,tick 260ms var(--ease-out) backwards}

/* ---------- weather ---------- */
.two-col{display:grid;gap:var(--s-5);grid-template-columns:minmax(0,1fr)}
.telegram{position:relative;padding:0;overflow:hidden;min-width:0}
.tg-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s-3);padding:var(--s-2) var(--s-4);background:var(--sunken);border-bottom:1px solid var(--line);font:600 .75rem/1.4 var(--font-mono);letter-spacing:.14em;color:var(--ink-2)}
.tg-head .ic{width:2.25rem;height:2.25rem;color:var(--teal);animation:pop 300ms var(--spring-snap) backwards}
.tg-body{display:grid;gap:var(--s-3);padding:var(--s-4)}
.strip{padding:var(--s-2) var(--s-3);background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-0);font:500 1.0625rem/1.45 var(--font-display);overflow-wrap:anywhere;animation:tape 360ms linear backwards;animation-delay:calc(var(--i,0) * 140ms)}
.strip.blank{background:transparent;border-style:dashed;color:var(--ink-2);font-style:italic;animation:none}
.meter{height:10px;border-radius:var(--r-pill);background:var(--sunken);border:1px solid var(--line);overflow:hidden}
.meter span{display:block;height:100%;background:var(--teal);transform-origin:0 50%;transform:scaleX(var(--q,0));animation:grow 520ms var(--ease-out) 160ms backwards}
${Q_RULES}
.tg-meta{font:500 .875rem/1.5 var(--font-mono);color:var(--ink-2);overflow-wrap:anywhere;animation:rise var(--d-base) var(--ease-out) 420ms backwards}

/* ---------- wall ---------- */
.board{position:relative;border-radius:var(--r-2);background:var(--paper);background-image:none;border:1px solid var(--line);box-shadow:inset 0 2px 10px rgb(0 0 0 / .5),var(--sh-2);padding:var(--s-4);color:var(--ink);min-width:0}
.board-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-3) var(--s-4);padding-bottom:var(--s-3);border-bottom:1px solid var(--line);margin-bottom:var(--s-3)}
.board-cap{flex-basis:100%;font:600 .6875rem/1 var(--font-mono);letter-spacing:.2em;color:var(--ink-2)}
.lamp{width:14px;height:14px;border-radius:50%;flex:none;border:2px solid var(--warn);background:transparent}
.lamp[data-state=open]{background:var(--ok);border-color:var(--ok);box-shadow:0 0 10px var(--ok)}
.lamp[data-state=reconnecting]{background:var(--warn);animation:pulse 1400ms var(--ease-io) infinite}
.lamp[data-state=closed],.lamp[data-state=full]{background:var(--bad);border-color:var(--bad)}
#wall-status{font-weight:600;outline-offset:2px}
.board-count{margin-left:auto;font:600 1rem/1 var(--font-mono);color:var(--warn);font-variant-numeric:tabular-nums}
.feed{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.board .feed li{position:relative;display:flex;align-items:center;gap:var(--s-3);min-height:44px;padding:6px var(--s-3) 6px 0;border-radius:var(--r-0);background:var(--surface);font:500 .9375rem/1.35 var(--font-mono);overflow-wrap:anywhere}
.board .feed li::before{content:attr(data-time) / "";flex:none;align-self:stretch;display:grid;place-items:center;min-width:5.75rem;padding:0 var(--s-2);background:var(--sunken) linear-gradient(transparent 49%,rgb(0 0 0 / .55) 49% 51%,transparent 51%);color:var(--warn);font-variant-numeric:tabular-nums;border-radius:var(--r-0) 0 0 var(--r-0)}
.board .feed li[data-milestone]{box-shadow:inset 3px 0 0 var(--accent)}
.board .feed li.new{animation:rise 200ms var(--ease-out) backwards}
.ghost-rows{display:grid;gap:4px;margin-top:var(--s-3)}
.ghost-rows i{height:44px;border:1px dashed var(--line);border-radius:var(--r-0)}
#wall-empty{color:var(--ink-2);text-align:center;padding:var(--s-3) 0 0}

/* ---------- sla ---------- */
.control{border-radius:var(--r-2);background:var(--paper);border:1px solid var(--line);padding:var(--s-4);box-shadow:var(--sh-2);color:var(--ink);display:grid;gap:var(--s-4);min-width:0;position:relative}
.control .err:empty{display:none}
.control.stale{border:2px dashed var(--warn)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:var(--s-2);margin:0}
.stat{background:var(--sunken);border:1px solid var(--line);border-radius:var(--r-1);padding:var(--s-3);min-width:0}
.stat dt{font-size:.8125rem;color:var(--ink-2)}
.stat dd{margin:0;font:600 clamp(1.25rem,5.5vw,1.6rem)/1.15 var(--font-mono);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.stat dd.tick{animation:tick 260ms var(--ease-out) backwards}
.stat dd[data-alert]{color:var(--warn)}
.stat dd[data-alert]::before{content:"\\25B2  " / ""}
.control.locked .stat{background-image:repeating-linear-gradient(135deg,var(--line) 0 2px,transparent 2px 8px)}
.spark{margin:0;display:grid;gap:var(--s-2)}
.spark svg{width:100%;height:4rem;display:block}
.spark .area{fill:var(--teal);opacity:.14}
.spark .lineP{fill:none;stroke:var(--teal);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.spark figcaption{font-size:.8125rem;color:var(--ink-2)}
.control table th{border-bottom-color:var(--line)}

/* ---------- time machine ---------- */
.rail{position:relative;display:grid;grid-template-columns:repeat(7,1fr);margin-top:var(--s-5);border-top:2px solid var(--ink)}
.rail span{font:600 .75rem/1 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink-2);padding-top:var(--s-3);text-align:center;border-left:1px solid var(--line)}
.rail span:first-child{border-left:0}
.rail .marker{position:absolute;top:-9px;left:0;width:calc(100% / 7);height:0;display:flex;justify-content:center;transform:translateX(calc(var(--pos,0) * 100%));transition:transform 520ms var(--spring-soft)}
.rail .marker::before{content:"";border:8px solid transparent;border-top-color:var(--accent);border-bottom:0}
${POS_RULES}
.era-card{display:grid;gap:var(--s-3);align-content:start;min-height:15rem;transition:border-radius var(--d-base) var(--ease-out)}
.era-head{display:flex;gap:var(--s-4);align-items:center}
.pm{width:6rem;height:6rem;color:var(--accent);mix-blend-mode:var(--stamp-blend);transform:rotate(-6deg)}
.pm text{fill:currentColor;font:600 10px var(--font-mono);text-anchor:middle}
.pm .yr{font-size:15px;font-variant-numeric:tabular-nums}
.pm.landed{animation:stamp-in 200ms var(--ease-stamp) backwards}
.pm.blank{color:var(--line)}
#tm-out p{overflow-wrap:anywhere}
.tm-greet{font:500 1.375rem/1.35 var(--font-display);text-wrap:balance}
.era-card.landed .era-card-body>p{animation:rise var(--d-base) var(--ease-out) backwards;animation-delay:calc(500ms + var(--i,0) * 80ms)}
.era-card[data-era=e1]{border:3px double var(--ink);border-radius:var(--r-0)}
.era-card[data-era=e1] .tm-greet{font-style:italic}
.era-card[data-era=e2]{border:1px solid var(--ink);outline:1px solid var(--line);outline-offset:-7px;border-radius:var(--r-0)}
.era-card[data-era=e2] .tm-greet{font-variant-caps:small-caps;letter-spacing:.04em}
.era-card[data-era=e3]{border:2px solid var(--teal);border-radius:28px 4px 28px 4px}
.era-card[data-era=e3] .tm-greet{font-family:var(--font-ui);font-weight:700}
.era-card[data-era=e4]{border:2px dashed var(--control);border-radius:var(--r-1)}
.era-card[data-era=e4] .tm-greet{font-family:var(--font-mono);font-size:1.125rem}
.era-card[data-era=e5]{border:3px ridge var(--control);border-radius:0}
.era-card[data-era=e5] .tm-greet{font-family:"Times New Roman",Times,serif}
.era-card[data-era=e6]{border-radius:16px;box-shadow:var(--sh-2)}
.era-card[data-era=e6] .tm-greet{font-family:var(--font-ui);font-weight:600}

/* ---------- haiku ---------- */
.haiku-card{position:relative;display:grid;gap:var(--s-3);justify-items:center;text-align:center;padding:var(--s-7) var(--s-5);border:1px solid var(--line);border-radius:var(--r-0);background:var(--surface);box-shadow:var(--sh-2);min-width:0;min-height:15rem;align-content:center}
.haiku-card[data-haiku=morning]{background:var(--wash-morning)}
.haiku-card[data-haiku=ocean]{background:var(--wash-ocean)}
.haiku-lines{display:grid;gap:var(--s-2);max-width:24rem}
.haiku-lines p{position:relative;font:500 clamp(1.25rem,1rem + 1.2vw,1.75rem)/1.5 var(--font-display);overflow-wrap:anywhere;text-wrap:balance;animation:press 420ms var(--ease-out) backwards;animation-delay:calc(var(--i,0) * 320ms)}
.haiku-lines p::after{content:attr(data-n) / "";margin-left:.6em;font:500 .75rem/1 var(--font-mono);color:var(--ink-2);vertical-align:middle}
.seal-pill{display:inline-flex;align-items:center;gap:var(--s-2);min-height:2.25rem;padding:0 var(--s-4);border:1.5px solid var(--ok);border-radius:var(--r-pill);color:var(--ok);font-weight:600;animation:stamp-in 160ms var(--ease-stamp) 1060ms backwards}
.seal-pill.warn{border-color:var(--warn);color:var(--warn)}
.haiku-limit{color:var(--ink-2);font-size:.8125rem;max-width:26rem;animation:rise var(--d-base) var(--ease-out) 1240ms backwards}
.dotrows{display:grid;gap:var(--s-3);justify-items:center}
.dotrows div{display:flex;gap:8px}
.dotrows i{width:10px;height:10px;border-radius:50%;background:var(--line)}

/* ---------- federation ---------- */
.notice{display:flex;gap:var(--s-3);align-items:flex-start;padding:var(--s-4);border:3px double var(--warn);border-radius:var(--r-1);background:var(--surface);margin-bottom:var(--s-5)}
.notice .ic{width:1.5rem;height:1.5rem;color:var(--warn);margin-top:2px}
.fed-grid{display:grid;gap:var(--s-5);grid-template-columns:minmax(0,1fr);margin-bottom:var(--s-5)}
.fed-map{width:100%;max-width:22rem;height:auto;justify-self:center}
.fed-map .orbit{fill:none;stroke:var(--line);stroke-dasharray:3 5}
.fed-map .hq{fill:var(--accent)}
.fed-map text{font:700 9px var(--font-mono);text-anchor:middle;dominant-baseline:central}
.fed-map .hq-t{fill:var(--accent-ink)}
.fed-map .node{fill:var(--surface);stroke:var(--control);stroke-width:2}
.fed-map .node.up{stroke:var(--ok)}
.fed-map .node.down{stroke:var(--bad)}
.fed-map .node-t{fill:var(--ink)}
.fed-map .link{stroke:var(--control);stroke-width:2}
.fed-map .link.up{stroke:var(--teal)}
.fed-map .link.down{stroke:var(--bad);stroke-dasharray:4 4}
.fed-map .dot{fill:var(--accent)}
.fed-map.checking .node{animation:pulse 1200ms var(--ease-io) infinite}
.peer-table{counter-reset:peer}
.peer-table tbody tr td:first-child::before{counter-increment:peer;content:counter(peer) / "";display:inline-grid;place-items:center;width:1.4rem;height:1.4rem;margin-right:var(--s-2);border-radius:50%;border:1.5px solid var(--control);font:700 .75rem/1 var(--font-mono)}
.fed-origin{font-family:var(--font-mono);font-size:.875rem}
.st-up{color:var(--ok);font-weight:600}
.st-down{color:var(--bad);font-weight:600}
.peers-list{list-style:none;margin:var(--s-3) 0 0;padding:0;display:grid;gap:var(--s-2)}
.peer{padding:var(--s-3) var(--s-4);border-left:6px solid var(--line);background:var(--surface);border-radius:var(--r-1);overflow-wrap:anywhere;animation:rise var(--d-base) var(--ease-out) backwards;animation-delay:calc(var(--i,0) * var(--step))}
.peer.ok{border-left-color:var(--ok)}
.peer.bad{border-left-color:var(--bad)}
.peer strong{font-family:var(--font-mono);font-size:.875rem;display:block}
.section-title{margin:var(--s-6) 0 var(--s-3)}

/* ---------- motion utilities ---------- */
${KEYFRAMES}
.rise{animation:rise var(--d-base) var(--ease-out) backwards;animation-delay:calc(var(--i,0) * var(--step))}
${STAGGER}
${GUI_I}

/* ---------- responsive ---------- */
@media (max-width:359px){.tabs a .ic{display:none}}
@media (max-width:479px){.cert-body{padding:10% 7% 8%}.form-actions .btn,.cert-tools .btn,.after-vote .btn{width:100%}.tabs a{padding:0 var(--s-2)}.greeting{padding-right:0;padding-top:4rem}}
@media (min-width:640px){
:root{--gutter:var(--s-6)}
.letterhead{flex-direction:row;align-items:flex-end;justify-content:space-between;flex-wrap:wrap}
.letterhead::after{flex-basis:100%;margin-top:0}
.tabs{display:flex}
.tabs a{min-width:7.5rem}
.annex nav{grid-template-columns:repeat(3,minmax(0,1fr))}
footer{grid-template-columns:minmax(0,1fr) auto;align-items:end}
.appearance{min-width:20rem}
}
@media (min-width:768px){
.hello-grid{grid-template-columns:minmax(0,21rem) minmax(0,1fr);align-items:start}
.verify-grid{grid-template-columns:minmax(0,1fr) minmax(0,18rem);align-items:start}
.two-col{grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start}
.table-well{grid-template-columns:repeat(2,minmax(0,1fr));padding:var(--s-6) var(--s-5)}
.opt.a{transform:rotate(-1.2deg)}.opt.b{transform:rotate(1deg)}
.fed-grid{grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start}
.done-list{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:1200px){
.frame{grid-template-columns:minmax(0,1fr) 15rem;gap:var(--s-7)}
.annex-head{border-top:0;padding-top:0}
.annex nav{grid-template-columns:minmax(0,1fr)}
}
@media (min-width:1200px) and (min-height:640px){.annex{position:sticky;top:var(--s-4);align-self:start;z-index:var(--z-rail)}}
@media (forced-colors:active){
.check input:checked{background:Highlight;border-color:Highlight}
.check .tick{stroke:HighlightText}
.seg label:has(input:checked){outline:3px solid Highlight;outline-offset:-3px}
.seg label:has(input:focus-visible){outline:3px dashed CanvasText;outline-offset:2px}
select{forced-color-adjust:auto;appearance:auto;background-image:none;padding-right:12px}
.meter span{background:Highlight}
.lamp{border-color:CanvasText}

.btn,.tabs a,.annex nav a,.opt,.stamp,.sheet{border:1px solid CanvasText}
:focus-visible{outline-color:Highlight}
.tabs a[aria-current=page],.annex nav a[aria-current=page]{border:3px solid Highlight}
}

/* ---------- reduced motion: opacity only ---------- */
@media (prefers-reduced-motion:reduce){
:root{--d-fast:120ms;--d-base:120ms;--d-slow:150ms;--d-ceremony:150ms;--step:0ms}
@keyframes rise{from{opacity:0}}@keyframes rise-lg{from{opacity:0}}@keyframes slide-up{from{opacity:0}}
@keyframes deal-a{from{opacity:0}}@keyframes deal-b{from{opacity:0}}@keyframes stamp-in{from{opacity:0}}@keyframes stamp-in-r{from{opacity:0}}
@keyframes thud{from{opacity:1}}@keyframes draw{from{opacity:0}}@keyframes tape{from{opacity:0}}@keyframes flip{from{opacity:0}}
@keyframes tick{from{opacity:1}}@keyframes shake{from{opacity:1}}@keyframes wash{from{opacity:1}}@keyframes ink-in{from{opacity:0}}
@keyframes press{from{opacity:0}}@keyframes ripple{from{opacity:0}}@keyframes grow{from{opacity:0}}@keyframes pop{from{opacity:0}}@keyframes flap{from{opacity:1}}
*,*::before,*::after{animation-duration:150ms!important;animation-delay:0ms!important;transition-duration:0ms!important;scroll-behavior:auto!important}
.pen,.spin-ring,.loading-line::before,.lamp,.cert-skeleton,.ghost-letter,.tray .scan,.fed-map .node{animation:none!important}
.btn:active,.opt:active,.tabs a:active,.annex nav a:active,.check input:active{transform:none}
.opt.a,.opt.b,.done-letter.win,.done-letter.lose{transform:none}
@media (hover:hover){.btn:hover,.opt:hover,.annex nav a:hover{transform:none}}
.ring .bar{transition:none}
}

/* ---------- print: the certificate is the artifact ---------- */
@page{size:A4 portrait;margin:10mm}
@media print{
:root{color-scheme:light}
html,body{background:#fff!important;color:#000}
.airmail,header,.annex,footer,#status,.view-head .eyebrow,.view-head .lede,.cert-tools,.eng-title,button,.btn,textarea{display:none!important}
.view-head{margin:0 0 4mm;text-align:center}
.view-head h1{font-size:20pt}
*,*::before,*::after{animation:none!important;transition:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.frame{display:block;padding:0}
.cert-stage{display:block}
.cert-stage[hidden],.cert-skeleton{display:none!important}
.cert-sheet{width:176mm;max-width:none;min-height:249mm;margin:0 auto;box-shadow:none;border-radius:0;break-inside:avoid;page-break-inside:avoid}
.cert-foot{display:block;text-align:center;font:9pt/1.4 var(--font-ui);color:#333;margin-top:4mm}
}
`;

module.exports = { STYLE };
