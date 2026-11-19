/** Aussehen des Viewers (Issue #122), aus dem freigegebenen Entwurf (feldspur-design/html-viewer/runde3). */
export const VIEWER_CSS = String.raw`
/* Feldspur-Viewer (Issue #122). Farben wie apps/desktop/src/renderer/styles.css (--rail*, --k-*, --st-*),
   Ocker und Moos aus dem App-Symbol. Motiv: das App-Symbol selbst – Bahnen auf einem Blatt, die Fahne als Zeitzeiger. */
:root {
  --bg: #e7ebe3; --panel: #fcfbf7; --panel-2: #f4f5ef; --sunken: #dfe4da;
  --ink: #26241f; --ink-2: #47443c; --muted: #5b5d53;
  --line: #d7dccf; --line-2: #bcc2b3;
  --accent: #a4441f; --accent-ink: #fffaf2; --accent-soft: #f3e1d3;
  --rail: #3a281d; --rail-2: #2c1e15; --rail-ink: #f5ecdf; --rail-muted: #c9b7a2; --rail-hover: #4a3427; --rail-line: #5c4636;
  --ocker: #e6ab68; --moos: #7f8f5a;
  --k-video: #3b5d85; --k-audio: #44692f; --good: #44692f;
  --warn: #8f5a07; --warn-soft: #f6e7c9; --bad: #a3302f;
  --st-clock: #5f6b73; --st-card: #5f6c71; --st-episode: #1d2b33; --st-start: #2a52be;
  --st-photo: #8a4fbf; --st-diary: #a8571f; --st-sync: #107a5f;
  --mark: #f6dc8c; --mark-ink: #26241f;
  --frame: #1c130e; --frame-2: #2a1c14; --frame-ink: #f5ecdf; --frame-muted: #c9b7a2;
  --print: #ffffff; --dot: rgb(38 36 31 / 0.11);
  --shadow: 30 32 24;
  --fs: 1;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #1a1815; --panel: #23201c; --panel-2: #292520; --sunken: #14120f;
  --ink: #efe8dc; --ink-2: #d0c6b6; --muted: #a59a89;
  --line: #37322b; --line-2: #4a433a;
  --accent: #e48f63; --accent-ink: #26140a; --accent-soft: #452b1d;
  --rail: #110e0b; --rail-2: #0a0806; --rail-ink: #efe6da; --rail-muted: #a59683; --rail-hover: #221b16; --rail-line: #3a2e25;
  --k-video: #91b2da; --k-audio: #a0c584; --good: #a0c584;
  --warn: #e8b95e; --warn-soft: #3b2e15; --bad: #f08d87;
  --st-clock: #a9b2b7; --st-card: #a3b0b5; --st-episode: #efe8dc; --st-start: #9fb6f2;
  --st-photo: #cfa6ee; --st-diary: #e8a672; --st-sync: #79cfb2;
  --mark: #6b5516; --mark-ink: #fff3cf;
  --frame: #070605; --frame-2: #1a1410;
  --print: #3a342c; --dot: rgb(239 232 220 / 0.07);
  --shadow: 0 0 0;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1a1815; --panel: #23201c; --panel-2: #292520; --sunken: #14120f;
    --ink: #efe8dc; --ink-2: #d0c6b6; --muted: #a59a89;
    --line: #37322b; --line-2: #4a433a;
    --accent: #e48f63; --accent-ink: #26140a; --accent-soft: #452b1d;
    --rail: #110e0b; --rail-2: #0a0806; --rail-ink: #efe6da; --rail-muted: #a59683; --rail-hover: #221b16; --rail-line: #3a2e25;
    --k-video: #91b2da; --k-audio: #a0c584; --good: #a0c584;
    --warn: #e8b95e; --warn-soft: #3b2e15; --bad: #f08d87;
    --st-clock: #a9b2b7; --st-card: #a3b0b5; --st-episode: #efe8dc; --st-start: #9fb6f2;
    --st-photo: #cfa6ee; --st-diary: #e8a672; --st-sync: #79cfb2;
    --mark: #6b5516; --mark-ink: #fff3cf;
    --frame: #070605; --frame-2: #1a1410;
    --print: #3a342c; --dot: rgb(239 232 220 / 0.07);
    --shadow: 0 0 0;
    color-scheme: dark;
  }
}

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--ink);
  font: 400 15px/1.5 "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  accent-color: var(--accent);
  scrollbar-color: var(--line-2) transparent;
  overflow: hidden;
}
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
h1, h2, h3 { font-family: "Source Serif 4", Charter, Georgia, serif; font-weight: 600; margin: 0; text-wrap: balance; letter-spacing: -0.005em; }
p { margin: 0; text-wrap: pretty; }
.num { font-variant-numeric: tabular-nums lining-nums; letter-spacing: 0.01em; }
::selection { background: var(--accent-soft); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
svg.ic { width: 1.1em; height: 1.1em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.333; stroke-linecap: round; stroke-linejoin: round; }
svg.fl { flex: none; }
.kmark { display: inline-flex; align-items: center; justify-content: center; height: 15px; min-width: 15px; padding: 0 2px; border: 1px solid currentColor; border-radius: 3px; font-size: 11px; font-weight: 600; line-height: 1; flex: none; }
.grow { flex: 1; }

.btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 4px 10px; border: 1px solid transparent; border-radius: 7px; background: none; color: var(--ink-2); white-space: nowrap; }
.btn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
.btn[aria-pressed="true"], .btn[aria-expanded="true"] { background: color-mix(in srgb, var(--ink) 10%, transparent); color: var(--ink); }
.btn.line { border-color: var(--line-2); }
.btn.icon { padding: 4px; min-width: 32px; justify-content: center; }
.btn.fill { background: var(--accent); color: var(--accent-ink); font-weight: 600; padding-inline: 16px; min-height: 36px; }
.btn.fill:hover { background: color-mix(in srgb, var(--accent) 88%, var(--ink)); color: var(--accent-ink); }
.btn.small { min-height: 24px; padding: 0 8px; font-size: 0.8rem; border-radius: 6px; }

/* ───── Aufbau ───── */
.app { display: grid; grid-template-columns: minmax(400px, 46fr) minmax(0, 54fr); height: 100dvh; }
.app[data-kontext="offen"] { grid-template-columns: minmax(380px, 40fr) minmax(0, 36fr) minmax(320px, 24fr); }

/* ───── Bühne: oben der Projektor in Umbra, darunter der Tisch in Salbei ───── */
.stage { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; scrollbar-color: var(--line-2) transparent; }
.proj {
  flex: none; display: flex; flex-direction: column; gap: 10px; padding: 12px 22px 12px;
  background: var(--rail); color: var(--rail-ink);
  --ink: var(--rail-ink); --ink-2: var(--rail-ink); --muted: var(--rail-muted); --line-2: var(--rail-line);
  --accent: var(--ocker); --accent-ink: #3a281d;
  accent-color: var(--ocker);
}
.title { display: flex; align-items: center; gap: 11px; min-width: 0; }
.symbol { width: 34px; height: 34px; flex: none; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.35)); }
.title h1 { font-size: 1.65rem; line-height: 1.15; white-space: nowrap; }
.title .sub { color: var(--rail-muted); font-size: 0.93rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; padding-top: 5px; }
.wordmark { font: 600 1.02rem/1 "Source Serif 4", Charter, Georgia, serif; color: var(--rail-muted); letter-spacing: 0.005em; padding-top: 5px; }

.video { position: relative; aspect-ratio: 16 / 9; width: min(100%, calc((100dvh - 452px) * 16 / 9)); min-width: min(100%, 300px); margin-inline: auto; background: var(--frame); color: var(--frame-ink); border-radius: 5px; overflow: hidden; container-type: inline-size; cursor: pointer; user-select: none; flex: none; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45), 0 14px 28px -14px rgb(0 0 0 / 0.7); }
.v-play { position: absolute; inset: 0; margin: auto; width: 9cqw; height: 9cqw; border-radius: 50%; background: rgb(28 19 14 / 0.6); display: grid; place-items: center; transition: opacity 0.15s; pointer-events: none; }
.v-play svg { width: 3.8cqw; height: 3.8cqw; fill: var(--frame-ink); }
.video[data-playing="true"] .v-play { opacity: 0; }
.v-missing { position: absolute; inset: 0; display: none; place-content: center; justify-items: center; gap: 8px; padding: 6%; text-align: center; background: var(--frame); cursor: default; font-size: clamp(13px, 2.6cqw, 16px); }
.v-missing code { font-family: inherit; color: var(--frame-ink); font-weight: 600; overflow-wrap: anywhere; }
.v-missing p { color: var(--frame-muted); max-width: 46ch; }
.v-missing .btn { color: var(--frame-ink); border-color: var(--frame-muted); margin-top: 6px; }
.app[data-video="fehlt"] .v-missing { display: grid; }

.transport { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; flex: none; min-width: 0; }
.play { width: 42px; height: 42px; border-radius: 50%; border: none; background: var(--ocker); color: #3a281d; display: grid; place-items: center; flex: none; margin-right: 4px; box-shadow: 0 2px 0 rgb(0 0 0 / 0.35), inset 0 1px 0 rgb(255 255 255 / 0.35); }
.play svg { width: 18px; height: 18px; fill: currentColor; }
.play:hover { filter: brightness(1.07); }
.play:active { transform: translateY(1px); box-shadow: 0 1px 0 rgb(0 0 0 / 0.35); }
.now { display: flex; align-items: baseline; gap: 8px; margin-left: 6px; margin-right: auto; min-width: 0; white-space: nowrap; overflow: hidden; }
.now .clock { font-size: 1.45rem; font-weight: 600; line-height: 1; }
.now .vt { color: var(--rail-muted); font-size: 0.9rem; }
.now small { color: var(--rail-muted); font-size: 0.8rem; }
.vol { display: inline-flex; align-items: center; gap: 2px; }
.vol input { width: 64px; }

/* Tisch: Punktraster wie im Feldbuch, darauf das Blatt mit den Bahnen */
.desk {
  flex: 1 0 auto; display: flex; flex-direction: column; gap: 9px; padding: 20px 22px 16px;
  background-color: var(--bg);
  background-image: radial-gradient(circle at 1px 1px, var(--dot) 1px, transparent 1.4px); background-size: 14px 14px;
  position: relative;
}
/* Schattenkante des Projektors auf dem Tisch (eigener Streifen, keine Kartenfläche) */
.desk::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 9px; background: linear-gradient(rgb(0 0 0 / 0.16), transparent); pointer-events: none; }
/* Zeitleiste = Blatt aus dem App-Symbol. Beschriftung so breit wie der längste Gerätename. */
.tl {
  position: relative; display: grid; grid-template-columns: minmax(0, max-content) minmax(0, 1fr); --lab: 0px; gap: 4px 0; font-size: 0.86rem;
  background: var(--panel); border-radius: 10px; padding: 10px 14px 12px 12px; flex: none;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--line-2) 60%, transparent), 0 2px 0 color-mix(in srgb, var(--line-2) 70%, transparent), 0 14px 22px -16px rgb(var(--shadow) / 0.45);
}
.tl-row, #lanes > .tl-row { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; min-height: 30px; }
.tl-lab { display: flex; align-items: center; gap: 7px; padding-right: 12px; min-width: 0; color: var(--ink-2); }
.tl-lab .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; max-width: 24ch; }
.tl-lab .ref { color: var(--accent); width: 10px; height: 12px; flex: none; }
.tl-lab .cap { color: var(--muted); font-size: 0.8rem; }
.tl-head { color: var(--muted); font-size: 0.8rem; min-height: 28px; margin-top: 2px; }
.tl-head .tl-lab:last-child { padding-right: 0; gap: 8px; }
.tl-track { position: relative; height: 26px; }
/* Raster: Uhrzeiten oben, feine Linien durch alle Bahnen (wie in „Durchsehen“) */
.grid { position: absolute; left: var(--lab); width: var(--tlw, 0px); top: 10px; bottom: 12px; pointer-events: none; }
.grid i { position: absolute; top: 15px; bottom: 0; width: 1px; background: var(--line); }
.grid span { position: absolute; top: 0; transform: translateX(-50%); font-size: 0.72rem; line-height: 14px; color: var(--muted); font-style: normal; white-space: nowrap; }
.tl-row.ruler { min-height: 14px; } .tl-row.ruler .tl-track { height: 14px; }
.tl-row.marks { min-height: 12px; } .tl-row.marks .tl-track { height: 12px; }
.tl-row.eps .tl-track { height: 24px; cursor: pointer; }
.seg { position: absolute; top: 0; bottom: 0; border-radius: 999px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.seg.ep { background: color-mix(in srgb, var(--ink) 13%, var(--panel)); color: var(--ink); padding: 0 11px; line-height: 24px; font-size: 0.82rem; font-weight: 600; border: none; text-align: left; }
.seg.ep:hover { background: color-mix(in srgb, var(--ink) 22%, var(--panel)); }
.seg.ep[aria-current="true"] { background: var(--rail); color: var(--rail-ink); }
:root[data-theme="dark"] .seg.ep[aria-current="true"] { background: var(--ink); color: var(--panel); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .seg.ep[aria-current="true"] { background: var(--ink); color: var(--panel); } }
.seg.gap { top: 5px; bottom: 5px; background-image: repeating-linear-gradient(135deg, var(--line-2) 0 3px, transparent 3px 7px); }
.tick { position: absolute; }
.tick.photo { top: 2px; width: 8px; height: 8px; margin-left: -4px; transform: rotate(45deg); background: var(--st-photo); border-radius: 1.5px; }
.tick.diary { top: 1px; width: 4px; height: 10px; margin-left: -2px; background: var(--st-diary); border-radius: 2px; }
.tick.hit { top: 0; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; border: 2.5px solid var(--accent); background: var(--mark); }
.lane .tl-track { cursor: pointer; }
.badge-k { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--k) 16%, transparent); color: var(--k); }
.badge-k svg { width: 13px; height: 13px; }
.clip { position: absolute; top: 2px; bottom: 2px; border-radius: 8px; background: color-mix(in srgb, var(--k) 24%, var(--panel)); color: var(--k); overflow: hidden; }
.clip svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.clip span { position: absolute; left: 6px; top: 3px; font-size: 0.72rem; font-weight: 600; line-height: 1; color: var(--ink); background: color-mix(in srgb, var(--panel) 84%, transparent); padding: 1px 4px; border-radius: 4px; white-space: nowrap; }
.lane.k-audio { --k: var(--k-audio); }
.lane.k-video { --k: var(--k-video); }
.lane[data-hoerbar="false"] { --k: var(--line-2); }
.lane[data-hoerbar="false"] .name { color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; }
.ms { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--line-2); background: var(--panel); font-size: 0.78rem; font-weight: 600; color: var(--ink-2); padding: 0; flex: none; box-shadow: 0 1px 0 var(--line-2); }
.ms:hover { border-color: var(--ink-2); }
.ms.solo[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); box-shadow: none; }
.ms.mute[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--panel); box-shadow: none; }
.app:not([data-ton="frei"]) .ms { display: none; }
/* Zeitzeiger: die Fahne aus dem Symbol, ragt über das Blatt hinaus */
.playhead { position: absolute; top: -9px; bottom: -6px; left: var(--lab); width: 0; pointer-events: none; z-index: 2; }
.playhead i { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--accent); border-radius: 1px; }
.playhead svg { position: absolute; top: 0; left: -1px; width: 15px; height: 12px; color: var(--accent); filter: drop-shadow(0 1px 1px rgb(var(--shadow) / 0.3)); }
.tip { position: absolute; top: -12px; transform: translate(-50%, -100%); background: var(--rail); color: var(--rail-ink); padding: 2px 8px; border-radius: 5px; font-size: 0.78rem; white-space: nowrap; pointer-events: none; display: none; z-index: 3; }
#seek { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; pointer-events: none; }
#seek:focus-visible + .focusring { outline: 2px solid var(--accent); outline-offset: 2px; }
.focusring { position: absolute; inset: 0; border-radius: 999px; pointer-events: none; }
/* Tonspuren: Standard ist die Mischung. Die Einzelspuren öffnet ein ruhiger Knopf. */
#mix-state { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.ton-btn { color: var(--ink-2); border-color: var(--line-2); background: var(--panel); flex: none; position: relative; z-index: 2; }
#mix-state, #mix-reset { position: relative; z-index: 2; }
.ton-btn .ok { display: none; color: var(--good); }
.app[data-ton="frei"] .ton-btn { border-color: transparent; color: var(--good); font-weight: 600; }
.app[data-ton="frei"] .ton-btn .ok { display: block; } .app[data-ton="frei"] .ton-btn .mx { display: none; }
.ton-known { display: none; grid-column: 1 / -1; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; padding: 7px 8px 7px 12px; border-radius: 8px; background: var(--warn-soft); color: var(--ink); font-size: 0.86rem; }
.ton-known .btn { background: var(--panel); border-color: var(--line-2); color: var(--ink); margin-left: auto; }
.app[data-ton="bekannt"] .ton-known { display: flex; }
.tl-foot { color: var(--muted); font-size: 0.8rem; display: flex; gap: 6px 16px; flex-wrap: wrap; align-items: center; padding-left: calc(var(--lab) + 0px); flex: none; }
.tl-foot span { display: inline-flex; align-items: center; gap: 6px; }
.tl-foot i { display: inline-block; flex: none; }
.tl-foot .i-photo { width: 7px; height: 7px; transform: rotate(45deg); background: var(--st-photo); border-radius: 1px; }
.tl-foot .i-diary { width: 4px; height: 10px; background: var(--st-diary); border-radius: 2px; }
.tl-foot .i-hit { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--accent); background: var(--mark); }
.tl-foot .i-gap { width: 18px; height: 8px; border-radius: 4px; background-image: repeating-linear-gradient(135deg, var(--line-2) 0 3px, transparent 3px 7px); }
.tl-foot svg { width: 9px; height: 11px; color: var(--accent); }
.facts { display: grid; grid-template-columns: calc(var(--lab, 150px) - 0px) minmax(0, 1fr); gap: 3px 0; margin: 8px 0 0; padding-top: 12px; border-top: 1px dashed var(--line-2); font-size: 0.9rem; color: var(--ink-2); flex: none; }
.facts dt { color: var(--muted); } .facts dd { margin: 0; overflow-wrap: anywhere; }
.facts .mid { display: inline-block; font-weight: 600; letter-spacing: 0.04em; }

/* ───── Blatt: Einsatztranskript ───── */
.sheet { background: var(--panel); display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; container-type: inline-size; z-index: 1; border-left: 1px solid var(--line); }
.sheet::before { content: ""; position: absolute; top: 0; bottom: 0; left: -13px; width: 12px; background: linear-gradient(to left, rgb(var(--shadow) / 0.13), transparent); pointer-events: none; }
.bar { display: flex; align-items: center; gap: 6px; padding: 12px 22px 11px; border-bottom: 1px solid var(--line); }
.search { display: flex; align-items: center; gap: 6px; flex: 1 1 160px; min-width: 120px; max-width: 360px; border: 1px solid var(--line-2); border-radius: 8px; padding: 0 8px; background: var(--panel-2); }
.search:focus-within { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: 1px; background: var(--panel); }
.search input { flex: 1; min-width: 0; border: none; background: none; height: 32px; outline: none; }
.search input::placeholder { color: var(--muted); opacity: 1; }
.search .cnt { color: var(--muted); font-size: 0.86rem; white-space: nowrap; }
.search svg { color: var(--muted); }
@container (max-width: 640px) { .bar .lbl { display: none; } .bar { gap: 2px; } }
@container (max-width: 470px) { .sw .w, #keys-btn { display: none; } .bar .btn { padding-inline: 6px; } }
.badge { background: var(--warn-soft); color: var(--warn); border-radius: 999px; padding: 0 6px; font-size: 0.78rem; font-weight: 600; }
.menu { position: relative; }
.menu > summary { list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 264px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 10px; padding: 12px 14px; box-shadow: 0 10px 30px -8px rgb(var(--shadow) / 0.25); display: grid; gap: 10px; }
.pop fieldset { border: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.pop legend { color: var(--muted); font-size: 0.82rem; padding: 0; margin-bottom: 2px; }
.seg3 { display: flex; border: 1px solid var(--line-2); border-radius: 7px; overflow: hidden; }
.seg3 button { flex: 1; border: none; background: none; padding: 4px 6px; min-height: 30px; font-size: 0.9rem; color: var(--ink-2); }
.seg3 button + button { border-left: 1px solid var(--line-2); }
.seg3 button[aria-pressed="true"] { background: var(--ink); color: var(--panel); }
.kinds { display: grid; gap: 2px; }
.kind { display: flex; align-items: center; gap: 8px; min-height: 28px; cursor: pointer; }
.kind i { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.kind .num { margin-left: auto; color: var(--muted); }
.filtered { padding: 8px 22px; background: var(--warn-soft); color: var(--ink); font-size: 0.9em; }
.sw { gap: 8px; }
.sw .knob { width: 28px; height: 16px; border-radius: 999px; background: var(--line-2); position: relative; flex: none; transition: background 0.15s; }
.sw .knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--panel); transition: transform 0.15s; }
.sw[aria-checked="true"] .knob { background: var(--accent); }
.sw[aria-checked="true"] .knob::after { transform: translateX(12px); }
.sw[aria-checked="false"] { color: var(--muted); }
#ctx-btn .kmark, .c-head .kmark { background: var(--rail); color: var(--rail-ink); border-color: var(--rail); height: 18px; min-width: 18px; border-radius: 4px; }
:root[data-theme="dark"] :is(#ctx-btn, .c-head) .kmark { background: var(--ink-2); color: var(--panel); border-color: var(--ink-2); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) :is(#ctx-btn, .c-head) .kmark { background: var(--ink-2); color: var(--panel); border-color: var(--ink-2); } }

.scroll { flex: 1; min-height: 0; overflow-y: auto; scroll-padding-top: 56px; font-size: calc(16px * var(--fs)); line-height: 1.5; }
.meta { display: none; padding: 16px 22px 6px; color: var(--st-clock); font-size: 0.9em; max-width: 78ch; gap: 1px; }
.tr { list-style: none; margin: 0; padding: 0 0 40vh; }
/* Randspalte: Uhrzeit, dann das Zeichen der Zeilenart (Linien-Icons der Marke) */
.ln { display: grid; grid-template-columns: var(--gut, calc(72px * var(--fs))) 20px minmax(0, 68ch); column-gap: 10px; padding: 4px 22px; cursor: pointer; overflow-wrap: anywhere; }
.tr[data-zeit="marke"] { --gut: calc(108px * var(--fs)); }
.ln:hover { background: var(--panel-2); }
.tm { position: relative; border: none; background: none; padding: 0; text-align: left; color: var(--st-clock); align-self: start; font-size: calc(14.7px * var(--fs)); line-height: calc(24px * var(--fs)); white-space: nowrap; }
.ln:hover .tm { text-decoration: underline; text-underline-offset: 3px; }
.gl { align-self: start; height: calc(24px * var(--fs)); display: grid; place-items: center; color: var(--kc, var(--line-2)); }
.gl svg { width: 17px; height: 17px; }
.gl .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--line-2); }
.ln[aria-current="true"] { background: color-mix(in srgb, var(--accent-soft) 62%, var(--panel)); }
.ln[aria-current="true"] .tm { color: var(--accent); font-weight: 600; }
.tx { min-width: 0; }
.tx .ck { color: var(--st-clock); font-size: 0.92em; }
.tx .hd { font-weight: 600; }
.tx .src { color: var(--st-clock); font-size: 0.82em; border: 1px solid var(--line-2); border-radius: 4px; padding: 0 5px; margin-right: 2px; white-space: nowrap; }
.tx .sp { font-weight: 600; }
.tx .body { white-space: pre-line; }
.k-card { --kc: var(--st-card); } .k-card .hd { color: var(--st-card); } .k-card .body { font-style: italic; }
.k-start { --kc: var(--st-start); } .k-start .hd { color: var(--st-start); }
.k-photo { --kc: var(--st-photo); } .k-photo .hd { color: var(--st-photo); }
.k-diary { --kc: var(--st-diary); } .k-diary .hd { color: var(--st-diary); }
.k-sync { --kc: var(--st-sync); } .k-sync .hd { color: var(--st-sync); }
.k-end { --kc: var(--muted); }
.k-start, .k-sync, .k-end { font-size: 0.92em; color: var(--ink-2); }
.k-card { margin: 14px 0 6px; padding-top: 18px; position: relative; }
.k-card::before { content: ""; position: absolute; left: 22px; right: 22px; top: 2px; height: 8px; border-radius: 4px; background-image: repeating-linear-gradient(135deg, var(--line-2) 0 3px, transparent 3px 7px); }
/* Episode: Kopf bleibt stehen; rechts die Lage der Episode im Einsatz */
.k-episode { position: sticky; top: 0; z-index: 2; background: var(--panel); margin-top: 20px; padding-block: 9px 8px; align-items: baseline; box-shadow: 0 1px 0 var(--line), 0 8px 10px -10px rgb(var(--shadow) / 0.35); cursor: pointer; }
.k-episode:hover, .k-episode[aria-current="true"] { background: var(--panel); }
.k-episode .tx { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.k-episode h2 { font-size: 1.36em; color: var(--st-episode); white-space: nowrap; }
.k-episode .body { color: var(--st-clock); font-size: 0.9em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
.k-episode .gl { color: var(--st-episode); height: calc(30px * var(--fs)); }
.k-episode .tm { line-height: calc(30px * var(--fs)); }
.lage { display: flex; gap: 2px; width: 84px; height: 7px; flex: none; align-self: center; }
.lage i { border-radius: 4px; background: var(--line-2); min-width: 3px; }
.lage i.g { background: none; background-image: repeating-linear-gradient(135deg, var(--line-2) 0 2px, transparent 2px 4px); }
.lage i.on { background: var(--accent); }
/* Tagebuch: ein Zettel aus dem Feldbuch, in Serifenschrift */
.k-diary { padding-block: 8px; }
.k-diary .tx { background: color-mix(in srgb, var(--st-diary) 7%, var(--panel)); padding: 9px 14px 11px; border-radius: 2px 9px 2px 2px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-diary) 16%, transparent), 0 2px 0 color-mix(in srgb, var(--st-diary) 14%, transparent), 0 10px 14px -12px rgb(var(--shadow) / 0.5); position: relative; }
.k-diary .tx::after { content: ""; position: absolute; top: 0; right: 0; width: 13px; height: 13px; border-radius: 0 9px 0 4px; background: linear-gradient(225deg, var(--panel) 50%, color-mix(in srgb, var(--st-diary) 26%, var(--panel)) 50%); }
.k-diary .body { font-family: "Source Serif 4", Charter, Georgia, serif; font-size: 0.97em; line-height: 1.55; }
.k-diary .hd { display: inline-block; margin-bottom: 2px; }
.imgs { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 6px; }
/* Fotos: Abzüge mit weißem Rand. Im Tagebuchzettel ohne eigenen Rahmen: der Ausschnitt gehört zum Zettel. */
.k-diary .img, .k-diary .img:hover { padding: 0; background: none; box-shadow: none; transform: none; outline: 1px solid color-mix(in srgb, var(--st-diary) 24%, transparent); }
.img { border: none; border-radius: 2px; padding: 5px; background: var(--print); overflow: hidden; display: block; cursor: zoom-in; line-height: 0; max-width: min(100%, 340px); box-shadow: 0 0 0 1px color-mix(in srgb, var(--line-2) 70%, transparent), 0 8px 14px -8px rgb(var(--shadow) / 0.5); transition: transform 0.15s, box-shadow 0.15s; }
.img:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px var(--line-2), 0 12px 18px -8px rgb(var(--shadow) / 0.55); }
.img img { display: block; width: 100%; height: auto; }
.ref { display: inline-flex; align-items: center; gap: 5px; border: none; background: none; padding: 0 2px; color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; font-family: "Source Sans 3", system-ui, sans-serif; }
.ref:hover { color: var(--accent); text-decoration-color: currentColor; }
mark { background: var(--mark); color: var(--mark-ink); border-radius: 2px; padding: 0 1px; }
mark.cur { outline: 2px solid var(--accent); }
.tr[data-zeit="video"] .tm .c, .tr[data-zeit="marke"] .tm .c, .tr[data-zeit="uhr"] .tm .v, .tr[data-zeit="marke"] .tm .v, .tr[data-zeit="uhr"] .tm .m, .tr[data-zeit="video"] .tm .m { display: none; }
.tr.no-line .k-line, .tr.no-diary .k-diary, .tr.no-photo .k-photo, .tr.no-tech .k-start, .tr.no-tech .k-sync, .tr.no-tech .k-card { display: none; }
.back { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 5; background: var(--rail); color: var(--rail-ink); border: none; border-radius: 999px; padding: 8px 16px 8px 12px; display: none; align-items: center; gap: 8px; box-shadow: 0 0 0 1px var(--rail-line), 0 10px 30px -8px rgb(var(--shadow) / 0.5); font-weight: 600; white-space: nowrap; }
.back svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.back[data-dir="up"] svg { transform: rotate(180deg); }
.back .num { font-weight: 400; color: var(--ocker); }
.sheet[data-folgt="false"] .back.show { display: inline-flex; }
.empty { padding: 30px 22px; color: var(--muted); display: none; }
.toast { position: absolute; left: 50%; top: 68px; transform: translateX(-50%); background: var(--rail); color: var(--rail-ink); border-radius: 8px; padding: 8px 14px; max-width: min(92%, 560px); font-size: 0.9rem; opacity: 0; pointer-events: none; transition: opacity 0.2s; z-index: 6; box-shadow: 0 0 0 1px var(--rail-line); }
.toast.show { opacity: 1; }

/* ───── Kontext ───── */
.context { background: var(--panel-2); border-left: 1px solid var(--line); display: none; flex-direction: column; min-width: 0; min-height: 0; z-index: 2; }
.app[data-kontext="offen"] .context { display: flex; }
.c-head { display: flex; align-items: center; gap: 9px; padding: 12px 12px 4px 20px; }
.c-head h2 { font-size: 1.24rem; }
.c-head .kmark { height: 22px; min-width: 22px; font-size: 13px; border-radius: 5px; }
.c-sub { padding: 0 20px 12px; color: var(--muted); font-size: 0.9rem; border-bottom: 1px solid var(--line); }
.c-list { overflow-y: auto; flex: 1; min-height: 0; padding: 0 0 60px; margin: 0; list-style: none; font-size: calc(15.5px * var(--fs)); }
.c-item { padding: 14px 20px 16px; border-bottom: 1px dashed var(--line-2); scroll-margin-top: 8px; }
.c-item.flash { background: var(--accent-soft); }
.c-item h3 { font: 600 1em/1.35 "Source Sans 3", system-ui, sans-serif; letter-spacing: 0; color: var(--st-episode); }
.c-item .det { color: var(--st-clock); font-size: 0.9em; margin-top: 1px; }
.c-item .det button { border: none; background: none; padding: 0; color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.c-item .det button:hover { color: var(--accent); }
.c-item .body { white-space: pre-line; margin-top: 6px; }
.c-item .imgs { margin-top: 10px; }
.c-item .img { max-width: 100%; }
.zeitlos { display: inline-block; font-size: 0.8em; color: var(--muted); border: 1px solid var(--line-2); border-radius: 999px; padding: 0 8px; margin-top: 6px; }

/* ───── Dialoge ───── */
dialog { border: none; border-radius: 12px; background: var(--panel); color: var(--ink); padding: 0; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.2), 0 24px 60px -10px rgb(0 0 0 / 0.55); max-width: min(92vw, 980px); }
dialog::backdrop { background: rgb(36 24 17 / 0.66); }
.d-head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 8px 20px; }
.d-head h2 { font-size: 1.24rem; flex: 1; }
.d-body { padding: 4px 20px 20px; }
#lb .d-body { padding: 0 20px 16px; }
#lb .big { background: #f3eedf; border-radius: 4px; overflow: hidden; line-height: 0; }
#lb figcaption { margin-top: 10px; color: var(--ink-2); max-width: 80ch; }
.keys { display: grid; grid-template-columns: auto 1fr; gap: 6px 18px; align-items: baseline; margin: 0; }
.keys dt { white-space: nowrap; } .keys dd { margin: 0; color: var(--ink-2); }
kbd { font: 600 0.82rem/1 "Source Sans 3", system-ui, sans-serif; border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 5px; padding: 3px 6px; background: var(--panel-2); display: inline-block; min-width: 1.7em; text-align: center; }

/* Assistent „Erweiterte Tonspurkontrolle“ */
.wiz { width: min(92vw, 600px); overflow: hidden; }
.wiz-head { background: var(--rail); color: var(--rail-ink); padding: 14px 12px 0 22px; --ink: var(--rail-ink); --ink-2: var(--rail-ink); }
.wiz-head .row { display: flex; align-items: center; gap: 10px; }
.wiz-head h2 { font-size: 1.3rem; flex: 1; }
/* Schritte als Wegstrecke: Punkte auf einer Linie, die Fahne steht am aktuellen */
.steps { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); margin: 20px 10px 0 0; padding: 0 0 12px; font-size: 0.86rem; color: var(--rail-muted); position: relative; }
.steps::before { content: ""; position: absolute; left: 5px; right: 33.3%; top: 5px; border-top: 2px dotted var(--rail-line); }
.steps li { position: relative; padding-top: 18px; }
.steps li::before { content: ""; position: absolute; left: 0; top: 0; width: 12px; height: 12px; border-radius: 50%; background: var(--rail); border: 2px solid var(--rail-muted); }
.steps li.done::before { background: var(--rail-muted); }
.steps li[aria-current="step"] { color: var(--rail-ink); font-weight: 600; }
.steps li[aria-current="step"]::before { background: var(--ocker); border-color: var(--ocker); }
.steps li[aria-current="step"]::after { content: ""; position: absolute; left: 5px; top: -15px; width: 13px; height: 17px; background: var(--ocker); clip-path: polygon(0 0, 15% 0, 15% 4%, 100% 24%, 15% 46%, 15% 100%, 0 100%); }
.wiz-body { padding: 18px 22px 6px; display: grid; gap: 14px; }
.wiz-body .lead { font-size: 1.04rem; max-width: 56ch; }
.gains { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.gains li { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; }
.gains .g-ic { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--k, var(--accent)) 15%, transparent); color: var(--k, var(--accent)); font-weight: 600; }
.gains .g-ic svg { width: 18px; height: 18px; }
.gains b { display: block; font-weight: 600; }
.gains span { color: var(--ink-2); }
.why { border-top: 1px dashed var(--line-2); padding-top: 12px; display: grid; gap: 8px; color: var(--ink-2); max-width: 60ch; }
.why b { color: var(--ink); font-weight: 600; }
.privacy { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; color: var(--ink); }
.privacy svg { width: 20px; height: 20px; color: var(--good); margin-top: 1px; }
.drop { border: 2px dashed var(--line-2); border-radius: 12px; padding: 22px 18px 20px; display: grid; justify-items: center; gap: 8px; text-align: center; background-color: var(--panel-2); background-image: radial-gradient(circle at 1px 1px, var(--dot) 1px, transparent 1.4px); background-size: 14px 14px; transition: border-color 0.15s, background-color 0.15s; }
.drop.over { border-color: var(--accent); background-color: var(--accent-soft); }
.drop .file { width: 46px; height: 56px; }
.drop code { font: 600 1rem/1.3 "Source Sans 3", system-ui, sans-serif; overflow-wrap: anywhere; }
.drop .or { color: var(--muted); font-size: 0.86rem; }
.wiz-err { display: grid; grid-template-columns: 22px 1fr; gap: 10px; background: var(--warn-soft); border-radius: 8px; padding: 10px 12px; }
.wiz-err svg { width: 20px; height: 20px; color: var(--warn); margin-top: 1px; }
.wiz-err dl { margin: 4px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 0 10px; font-size: 0.93rem; }
.wiz-err dt { color: var(--ink-2); } .wiz-err dd { margin: 0; overflow-wrap: anywhere; }
.hint { color: var(--ink-2); font-size: 0.93rem; max-width: 60ch; }
.done-top { display: grid; grid-template-columns: 44px 1fr; gap: 14px; align-items: center; }
.done-top .ok { width: 44px; height: 44px; border-radius: 50%; background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--good); display: grid; place-items: center; }
.done-top .ok svg { width: 24px; height: 24px; stroke-width: 1.8; }
.done-top h3 { font-size: 1.2rem; }
.howto { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 9px 14px; align-items: center; }
.howto dt { display: flex; gap: 4px; align-items: center; } .howto dd { margin: 0; color: var(--ink-2); }
.howto .ms { display: inline-grid !important; place-items: center; cursor: default; }
.wiz-foot { display: flex; align-items: center; gap: 8px; padding: 12px 22px 18px; }
.wiz [data-step] { display: none; }
.wiz[data-at="1"] [data-step="1"], .wiz[data-at="2"] [data-step="2"], .wiz[data-at="3"] [data-step="3"] { display: grid; }
.wiz-foot[data-step] { display: none; }
.wiz[data-at="1"] .wiz-foot[data-step="1"], .wiz[data-at="2"] .wiz-foot[data-step="2"], .wiz[data-at="3"] .wiz-foot[data-step="3"] { display: flex; }

/* ───── Schmaler ───── */
@media (max-width: 1180px) {
  .app, .app[data-kontext="offen"] { grid-template-columns: minmax(360px, 46fr) minmax(0, 54fr); }
  .context { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 54vw); z-index: 30; box-shadow: -18px 0 40px -18px rgb(var(--shadow) / 0.35); }
  .tl-lab .name { max-width: 15ch; }
  .wordmark { display: none; }
}
@media (max-width: 860px) {
  .app, .app[data-kontext="offen"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .stage { overflow: visible; }
  .proj { padding: 9px 14px 8px; gap: 8px; }
  .desk { padding: 14px 14px 10px; gap: 6px; flex: none; }
  .symbol { width: 26px; height: 26px; }
  .title { gap: 8px; }
  .title h1 { font-size: 1.5rem; }
  .title .sub { font-size: 0.85rem; padding-top: 3px; }
  .video { width: min(100%, calc(30dvh * 16 / 9)); }
  .transport { flex-wrap: nowrap; gap: 0; }
  .now { margin-left: 4px; gap: 6px; min-width: 0; }
  .now .clock { font-size: 1.15rem; }
  .now .vt { font-size: 0.86rem; white-space: nowrap; } .now .vt .w { display: none; }
  .now small, .vol, #back5, #fwd5 { display: none; }
  .tl { padding: 8px 10px 9px 10px; }
  .grid { top: 8px; bottom: 9px; }
  .tl-lab .name, .tl-lab .cap { display: none; }
  .tl-row.eps .tl-lab, .tl-row.marks .tl-lab, .tl-row.ruler .tl-lab { padding: 0; }
  .stage[data-spuren="zu"] .tl-lab { padding: 0; }
  .stage[data-spuren="zu"] #lanes > .lane, .stage[data-spuren="zu"] .tl .tl-head, .stage[data-spuren="zu"] .ton-known { display: none; }
  .tl-head .tl-lab:first-child { display: none; } .tl-head .tl-lab:last-child { grid-column: 1 / -1; }
  .grid span:nth-of-type(even) { display: none; }
  .stage[data-spuren="auf"] .lane .name { display: block; max-width: 9ch; font-size: 0.8rem; }
  .stage[data-spuren="auf"] .tl-lab { gap: 4px; padding-right: 6px; }
  .tl-foot, .facts { display: none; }
  .meta { display: grid; }
  .bar { padding: 8px 14px 8px; }
  .ln, .meta { padding-inline: 14px; }
  .ln { column-gap: 8px; grid-template-columns: var(--gut, calc(66px * var(--fs))) 18px minmax(0, 1fr); }
  .k-card::before { left: 14px; right: 14px; }
  .k-episode { margin-top: 10px; }
  .lage { width: 54px; }
  .context { width: 100%; }
  .btn .lbl { display: none; }
  .steps { font-size: 0.8rem; }
}
@media (min-width: 861px) { .only-narrow { display: none; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
@media print {
  body { overflow: visible; background: #fff; }
  .app { display: block; height: auto; }
  .stage, .bar, .back { display: none; }
  .scroll { overflow: visible; }
  .context { display: block; position: static; width: auto; border: none; }
  .k-episode { position: static; }
}

/* ───── Ergänzungen zum Entwurf ───── */
.video video { position: absolute; inset: 0; width: 100%; height: 100%; background: var(--frame); }
.app[data-video="fehlt"] .video video, .app[data-video="fehlt"] .v-play { display: none; }
#lb .big { background: var(--print); }
#lb .big img { display: block; max-width: min(86vw, 940px); max-height: 74vh; width: auto; height: auto; margin: auto; }
.noimg { font-style: italic; color: var(--muted); font-size: 0.9em; }
.warn-bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-radius: 8px; background: var(--warn-soft); color: var(--ink); font-size: 0.86rem; flex: none; }
.warn-bar svg { color: var(--warn); }
/* Lange Einsätze: nur Zeilen im Blick zeichnen. Der Episodenkopf klebt und bleibt deshalb außen vor. */
.ln:not(.k-episode) { content-visibility: auto; contain-intrinsic-size: auto 2.6em; }
/* Zoom der Zeitleiste: der Inhalt jeder Bahn sitzt in .zin, das breiter ist als die Bahn und verschoben wird. */
.tl-track { overflow: clip; overflow-clip-margin: 2px; }
.tl-row.eps .tl-track { overflow: visible; }
.eps .zclip { position: absolute; inset: 0; overflow: clip; overflow-clip-margin: 2px; border-radius: 999px; }
.zin { position: absolute; top: 0; bottom: 0; left: var(--zx, 0%); width: var(--zw, 100%); }
.grid { overflow: clip; }
.tl-row.ruler .tl-track { cursor: grab; }
.tl.panning, .tl.panning .tl-track { cursor: grabbing; }
.zoom { gap: 2px; }
.zoom .btn.small { min-width: 24px; padding: 0 6px; justify-content: center; }
.zoom .lvl { color: var(--muted); font-size: 0.76rem; min-width: 3.4em; text-align: right; }
.tl[data-zoom="1"] .zoom .lvl, .tl[data-zoom="1"] #zoom-all { visibility: hidden; }
/* Vollbild: Bild und Steuerleiste, sonst nichts */
.proj:fullscreen { justify-content: center; padding: 14px 24px; }
.proj:fullscreen .title { display: none; }
.proj:fullscreen .video { width: min(100%, calc((100dvh - 86px) * 16 / 9)); border-radius: 0; }
.proj::backdrop { background: var(--rail); }
.ic-fs-off { display: none; }
.proj:fullscreen .ic-fs-on { display: none; } .proj:fullscreen .ic-fs-off { display: block; }
.proj { container: proj / inline-size; }
@container proj (max-width: 700px) { .now small { display: none; } }
@container proj (max-width: 620px) { #now-dur { display: none; } }
@media (max-width: 860px) { .zoom { display: none; } .warn-bar { font-size: 0.8rem; } }
@media print { .ln:not(.k-episode) { content-visibility: visible; } }
`;
