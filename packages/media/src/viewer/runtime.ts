/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * Verhalten des Viewers im Browser. Die Funktion wird über Function#toString in die HTML-Datei geschrieben und dort
 * aufgerufen. Deshalb: keine Importe zur Laufzeit (nur Typen), keine Bezüge auf andere Teile dieses Moduls, und nur
 * Sprachmittel und Web-APIs, die alle heutigen Browser kennen (nicht nur Chromium). Was nur manche Browser können
 * (Dateizugriff, WebCodecs), wird vorher geprüft.
 *
 * Die DOM-Typen gelten durch die Referenz oben für das ganze Paket; im Node-Code bitte trotzdem nicht verwenden.
 *
 * Einordnung: Teil des Viewers aus dem Schritt „Ausgeben“. `viewerScript` (`packages/media/src/viewer/html.ts`)
 * bettet die Funktion ein; in der App selbst läuft sie nie. Das HTML-Gerüst mit allen IDs und die Daten (`D`,
 * Typ `ViewerData`) kommen aus `html.ts`, das Aussehen aus `style.ts`. Aufbau unten: Hilfen, Zustand (`S`), Zeilen,
 * Kontext, Bilder, Zeitleiste, Video, Tonspuren, Suche, Ansicht, Tasten, Start. Es gibt kein Framework: Das Skript
 * setzt `data-`-Attribute und CSS-Variablen, den Rest erledigt das CSS.
 * Kommentare innerhalb der Funktion können mit in der ausgegebenen HTML-Datei landen, deshalb dort sparsam bleiben.
 */
import type { ViewerData } from "./html.ts";
import type { Mp4AudioInfo, Mp4AudioTrack, readMp4Audio } from "./mp4-audio.ts";

/**
 * Einstieg des Viewers, einmal beim Laden der Seite aufgerufen. `readMp4` ist `readMp4Audio`
 * (`packages/media/src/viewer/mp4-audio.ts`), als Argument übergeben, weil die Funktion nichts von außen kennen darf.
 * Zeiten ohne Zusatz sind hier Sekunden Videozeit (wie `video.currentTime`), die Daten in `D` dagegen ms.
 */
export function viewerMain(readMp4: typeof readMp4Audio): void {
  // ───── Hilfen ─────
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const el = (tag: string, cls?: string, text?: string | number) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  };
  const p2 = (n: number) => String(n).padStart(2, "0");
  const D = JSON.parse($("feldspur-daten").textContent || "{}") as ViewerData;
  // Freigabe des Videos merken unter den ersten beiden Blöcken der Montage-ID: Die stehen für das Video,
  // der dritte Block nur für den Textstand.
  const videoKey = D.montageId.split("-").slice(0, 3).join("-");
  const DUR = Math.max(0.001, D.durationMs / 1000);
  const clamp = (t: number) => Math.min(DUR, Math.max(0, t));
  /** Uhrzeit (ms) an einer Stelle des Videos (s); in einer Tafel steht sie still. */
  const clockMsAt = (t: number) => {
    const ms = t * 1000;
    const s = D.segments.find((x) => ms >= x.m0 && ms < x.m1) ?? D.segments[D.segments.length - 1];
    if (!s) return 0;
    return s.k === "c" ? s.c0 : s.c0 + Math.min(ms - s.m0, s.c1 - s.c0);
  };
  const fmtClock = (ms: number, sec = true) => new Date(ms).toISOString().slice(11, sec ? 19 : 16);
  const clock = (t: number, sec = true) => fmtClock(clockMsAt(t), sec);
  const vt = (t: number) => {
    const a = Math.floor(t);
    return `${Math.floor(a / 3600)}:${p2(Math.floor(a / 60) % 60)}:${p2(a % 60)}`;
  };
  const stamp = (t: number) => {
    const z = Math.round(t * 10);
    const s = Math.floor(z / 10);
    return `#${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}-${z % 10}#`;
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const pct = (t: number) => `${(t / DUR) * 100}%`;
  const app = $("app");
  const vid = $<HTMLVideoElement>("vid");
  const tr = $("tr");
  const sc = $("scroll");

  // ───── Zustand ─────
  const S = {
    // Aktuelle Stelle in Sekunden Videozeit.
    t: 0,
    playing: false,
    rate: 1,
    // „Text läuft mit“: Das Einsatztranskript scrollt zur aktuellen Zeile.
    follow: true,
    // Index der aktuellen Zeile in `entries`, −1 = keine.
    cur: -1,
    q: "",
    hits: [] as { e: Entry; m: HTMLElement }[],
    hit: -1,
    // Solo und stumm geschaltete Gerätespuren (Index in `lanes`).
    solo: new Set<number>(),
    mute: new Set<number>(),
    // Tonspuren: nur die Mischung · Video von früher bekannt, Zugriff noch zu bestätigen · Einzelspuren frei.
    ton: "mix" as "mix" | "bekannt" | "frei",
    // Bis dahin (performance.now) gilt Scrollen als vom Skript ausgelöst und beendet das Mitlaufen nicht.
    progUntil: 0,
    userMuted: false,
    volume: 1,
    // Das Montagevideo liegt nicht neben der HTML-Datei oder lässt sich nicht laden.
    missing: false,
    // Sichtbarer Ausschnitt der Zeitleiste (s) und ihre Maße in px: Breite der Beschriftung, Breite der Bahn.
    v0: 0,
    v1: DUR,
    tlLab: 0,
    tlW: 0,
    // Von Hand gewählte Videodatei und, wo der Browser das kann, ihr Dateizugriff (zum Merken der Freigabe).
    picked: null as File | null,
    pickedHandle: null as FileSystemFileHandle | null,
    knownHandle: null as FileSystemFileHandle | null,
  };
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // ───── Zeilen (stehen schon als HTML in der Seite) ─────
  interface Entry {
    li: HTMLElement;
    t: number;
    kind: string;
    body: HTMLElement | null;
    text: string;
  }
  const entries: Entry[] = [...tr.children].map((li) => {
    const h = li as HTMLElement;
    const body = h.classList.contains("k-episode") ? null : h.querySelector<HTMLElement>(".tx > .body");
    return {
      li: h,
      t: Number(h.dataset.m) / 1000,
      kind: (/\bk-(\w+)/.exec(h.className) ?? ["", ""])[1]!,
      body,
      text: body?.textContent ?? "",
    };
  });
  const hiddenKinds = new Set<string>();
  // Beginn einer Aufnahme, Sync-Hinweis und Tafel teilen sich einen Schalter („Beginn, Sync, Leerlauf“).
  const GROUP_OF: Record<string, string> = { start: "tech", sync: "tech", card: "tech" };
  const visible = (e: Entry) => !hiddenKinds.has(GROUP_OF[e.kind] ?? e.kind);
  entries.forEach((e) =>
    e.li.addEventListener("click", (ev) => {
      const sel = getSelection();
      if ((sel && !sel.isCollapsed) || (ev.target as HTMLElement).closest(".img, .ref")) return;
      seek(e.t, true);
    }),
  );

  function fillText(node: HTMLElement, text: string): number {
    // Nur Textknoten, nie innerHTML mit Daten.
    node.textContent = "";
    const q = S.q.toLowerCase();
    if (!q) {
      node.textContent = text;
      return 0;
    }
    let i = 0;
    let n = 0;
    const low = text.toLowerCase();
    for (;;) {
      const j = low.indexOf(q, i);
      if (j < 0) break;
      node.append(text.slice(i, j), el("mark", "", text.slice(j, j + q.length)));
      i = j + q.length;
      n++;
    }
    node.append(text.slice(i));
    return n;
  }

  // Zeilenarten ein- und ausblenden
  const GROUPS: [string, string, string][] = [
    ["line", "Mitschrift", "var(--ink-2)"],
    ["diary", "Tagebuch", "var(--st-diary)"],
    ["photo", "Fotos", "var(--st-photo)"],
    ["tech", "Beginn, Sync, Leerlauf", "var(--st-start)"],
  ];
  for (const [k, label, col] of GROUPS) {
    const n = entries.filter((e) => (GROUP_OF[e.kind] ?? e.kind) === k).length;
    if (!n) continue;
    const b = el("label", "kind");
    const box = el("input") as HTMLInputElement;
    box.type = "checkbox";
    box.checked = true;
    box.dataset.n = String(n);
    box.dataset.k = k;
    b.style.setProperty("--c", col);
    b.append(box, el("i"), label, el("span", "num", n));
    box.addEventListener("change", () => {
      if (box.checked) hiddenKinds.delete(k);
      else hiddenKinds.add(k);
      tr.classList.toggle(`no-${k}`, !box.checked);
      filterState();
      search();
    });
    $("chips").append(b);
  }
  function filterState() {
    const off = [...$("chips").querySelectorAll<HTMLInputElement>("input:not(:checked)")];
    const n = off.reduce((a, b) => a + Number(b.dataset.n), 0);
    $("hidden-n").hidden = $("filtered").hidden = !off.length;
    $("hidden-n").textContent = `−${n}`;
    $("filtered-t").textContent = `${n} Zeilen sind ausgeblendet.`;
  }
  $("show-all").addEventListener("click", () => {
    $("chips")
      .querySelectorAll<HTMLInputElement>("input")
      .forEach((b) => {
        b.checked = true;
        tr.classList.remove(`no-${b.dataset.k}`);
      });
    hiddenKinds.clear();
    filterState();
    search();
  });

  // ───── Kontext ─────
  const ctxBtn = document.getElementById("ctx-btn");
  const ctxItems = [...document.querySelectorAll<HTMLElement>(".c-item")].map((li) => {
    const body = li.querySelector<HTMLElement>(".body");
    return { li, body, text: body?.textContent ?? "" };
  });
  function toggleContext(open?: boolean) {
    if (!ctxBtn) return;
    const now = open ?? app.dataset.kontext !== "offen";
    app.dataset.kontext = now ? "offen" : "zu";
    ctxBtn.setAttribute("aria-expanded", String(now));
    if (now) $("ctx-close").focus({ preventScroll: true });
    else ctxBtn.focus({ preventScroll: true });
    requestAnimationFrame(layoutTimeline);
  }
  function openContext(id: string) {
    toggleContext(true);
    const li = document.getElementById(id);
    if (!li) return;
    li.scrollIntoView({ block: "start", behavior: reduce.matches ? "auto" : "smooth" });
    li.classList.add("flash");
    setTimeout(() => li.classList.remove("flash"), 1600);
  }
  ctxBtn?.addEventListener("click", () => toggleContext());
  $("ctx-close").addEventListener("click", () => toggleContext(false));
  document.querySelectorAll<HTMLElement>(".det button[data-m]").forEach((b) =>
    b.addEventListener("click", () => {
      seek(Number(b.dataset.m) / 1000, true);
      if (innerWidth <= 860) toggleContext(false);
    }),
  );
  document.querySelectorAll<HTMLElement>(".ref[data-ctx]").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openContext(b.dataset.ctx!);
    }),
  );

  // ───── Bilder groß ─────
  document.querySelectorAll<HTMLButtonElement>("button.img").forEach((b) =>
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const img = b.querySelector("img");
      if (!img) return;
      const caption = img.alt;
      $("lb-h").textContent = caption.split(" · ")[0] ?? caption;
      const big = img.cloneNode() as HTMLImageElement;
      big.removeAttribute("loading");
      big.removeAttribute("width");
      big.removeAttribute("height");
      $("lb-img").replaceChildren(big);
      $("lb-cap").textContent = caption;
      $<HTMLDialogElement>("lb").showModal();
    }),
  );
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement;
      if (t === d || t.closest("[data-close]")) d.close();
    });
  });
  $("keys-btn").addEventListener("click", () => $<HTMLDialogElement>("keys").showModal());

  // ───── Zeitleiste ─────
  const tl = $("tl");
  const eps = $("eps");
  for (const s of D.segments) {
    const isEp = s.k === "e";
    const b = el(isEp ? "button" : "div", `seg ${isEp ? "ep" : "gap"}`, isEp && s.n ? `Episode ${s.n}` : "");
    b.style.left = pct(s.m0 / 1000);
    b.style.width = `calc(${pct((s.m1 - s.m0) / 1000)} - 2px)`;
    if (isEp) {
      (b as HTMLButtonElement).type = "button";
      b.title = `${s.n ? `Episode ${s.n}` : "Aufnahmen"}: ${fmtClock(s.c0)}–${fmtClock(s.c1)}`;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        seek(s.m0 / 1000, true);
      });
      b.dataset.m0 = String(s.m0);
      b.dataset.m1 = String(s.m1);
    } else b.title = `Zwischenzeit ${fmtClock(s.c0)}–${fmtClock(s.c1)}`;
    eps.append(b);
  }
  for (const e of entries) {
    if (e.kind !== "photo" && e.kind !== "diary") continue;
    const i = el("i", `tick ${e.kind}`);
    i.style.left = pct(e.t);
    i.title = `${e.li.querySelector(".hd")?.textContent?.replace(/:\s*$/, "") ?? ""} · ${clock(e.t, false)}`;
    $("marks").append(i);
  }
  const IC_AUDIO = "M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2ZM4 8a4 4 0 0 0 8 0M8 12v2.5";
  const IC_VIDEO =
    "M3 5.5h7.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1ZM11.5 8.2 15 6v6l-3.5-2.2";
  const waves: { path: Element; data: Uint8Array; step: number; t0: number; dur: number }[] = [];
  const lanes = D.lanes.map((lane, n) => {
    const row = el("div", `tl-row lane k-${lane.kind}`);
    const lab = el("div", "tl-lab");
    lab.insertAdjacentHTML(
      "beforeend",
      `<span class="badge-k"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="${lane.kind === "video" ? IC_VIDEO : IC_AUDIO}"/></svg></span>`,
    );
    const name = el("span", "name", lane.title);
    name.title = lane.title + (lane.ref ? " (Referenzuhr)" : "");
    lab.append(name);
    if (lane.ref)
      lab.insertAdjacentHTML(
        "beforeend",
        '<svg class="ref" viewBox="0 0 13 14" role="img" aria-label="Referenzuhr"><title>Referenzuhr</title><path d="M1.5 1v12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1.5 1.2 12 4.2 1.5 7.2Z" fill="currentColor"/></svg>',
      );
    let s: HTMLElement | null = null;
    let m: HTMLElement | null = null;
    // Solo- und Stumm-Knopf nur, wenn das Gerät eine eigene Tonspur im Video hat (Spur 0 ist die Mischung).
    if (lane.audio > 0) {
      s = el("button", "ms solo", "S");
      m = el("button", "ms mute", "M");
      for (const b of [s, m]) {
        (b as HTMLButtonElement).type = "button";
        b.setAttribute("aria-pressed", "false");
      }
      s.setAttribute("aria-label", `Nur ${lane.title} hören`);
      s.title = `Nur diese Spur hören (${n + 1})`;
      m.setAttribute("aria-label", `${lane.title} stumm`);
      m.title = "Stumm";
      s.addEventListener("click", () => {
        toggleSet(S.solo, n);
        mix();
      });
      m.addEventListener("click", () => {
        toggleSet(S.mute, n);
        mix();
      });
      lab.append(s, m);
    }
    const track = el("div", "tl-track");
    const zin = el("div", "zin");
    for (const c of lane.clips) {
      const d = el("div", "clip");
      d.style.left = pct(c.m0 / 1000);
      d.style.width = pct((c.m1 - c.m0) / 1000);
      d.title = `${c.label} · ${c.file} · ${clock(c.m0 / 1000)}–${clock(c.m1 / 1000 - 0.001)}`;
      if (c.w && c.ws) {
        // Hüllkurve der Aufnahme; gezeichnet wird nur der sichtbare Ausschnitt (drawWaves).
        const bin = atob(c.w);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        const t0 = c.m0 / 1000;
        const dur = Math.max(0.001, (c.m1 - c.m0) / 1000);
        d.insertAdjacentHTML(
          "beforeend",
          '<svg preserveAspectRatio="none" aria-hidden="true"><path fill="none" stroke="currentColor" vector-effect="non-scaling-stroke" style="stroke-width:1.5px"/></svg>',
        );
        const svg = d.firstElementChild!;
        svg.setAttribute("viewBox", `0 0 ${dur} 100`);
        waves.push({ path: svg.firstElementChild!, data, step: c.ws / 1000, t0, dur });
      }
      d.append(el("span", "", c.label));
      zin.append(d);
    }
    track.append(zin);
    row.append(lab, track);
    $("lanes").append(row);
    return { lane, row, s, m };
  });
  if (!D.lanes.length) $("tl-head").hidden = true;
  const toggleSet = (set: Set<number>, n: number) => (set.has(n) ? set.delete(n) : set.add(n));
  const audible = (n: number) => !S.mute.has(n) && (!S.solo.size || S.solo.has(n));
  const controllable = lanes.filter((l) => l.lane.audio > 0);
  // Gerätespuren gibt es nur, wenn das Video sie hat (ab zwei Geräten mit Ton).
  $("ton-btn").hidden = controllable.length < 2;

  const seekEl = $<HTMLInputElement>("seek");
  seekEl.max = String(Math.floor(DUR));
  seekEl.addEventListener("input", () => seek(Number(seekEl.value)));

  // Zoom: sichtbarer Ausschnitt v0…v1 (s). Die Bahnen verschieben nur ihren Inhalt (.zin).
  const MIN_SPAN = Math.min(DUR, 20);
  function setView(v0: number, v1: number) {
    const span = Math.min(DUR, Math.max(MIN_SPAN, v1 - v0));
    let a = v0;
    if (a + span > DUR) a = DUR - span;
    if (a < 0) a = 0;
    S.v0 = a;
    S.v1 = a + span;
    tl.style.setProperty("--zx", `${(-a / span) * 100}%`);
    tl.style.setProperty("--zw", `${(DUR / span) * 100}%`);
    const z = DUR / span;
    tl.dataset.zoom = z < 1.01 ? "1" : "n";
    $("zoom-lvl").textContent = ` · ${z < 10 ? z.toFixed(1).replace(".", ",") : Math.round(z)}×`;
    // Beschriftung der Episoden bleibt sichtbar, auch wenn ihr Anfang links aus dem Ausschnitt ragt.
    eps.querySelectorAll<HTMLElement>(".seg.ep").forEach((b) => {
      const cut = ((S.v0 - Number(b.dataset.m0) / 1000) / span) * S.tlW;
      b.style.paddingLeft = cut > 0 ? `${cut + 11}px` : "";
    });
    drawGrid();
    queueWaves();
    placeHead();
  }
  function zoomAt(factor: number, at: number) {
    const span = S.v1 - S.v0;
    const next = Math.min(DUR, Math.max(MIN_SPAN, span * factor));
    const f = (at - S.v0) / span;
    setView(at - f * next, at - f * next + next);
  }
  /** Wellenformen: ein Strich je BAR_PX, nur im sichtbaren Ausschnitt (und etwas darüber hinaus). */
  const BAR_PX = 1.6;
  function drawWaves() {
    if (!S.tlW) return;
    const span = S.v1 - S.v0;
    for (const w of waves) {
      // Strichbreite in Sekunden: an ein festes Raster gebunden, damit beim Verschieben nichts flimmert.
      const bar = Math.max(w.step, (span / S.tlW) * BAR_PX);
      const a = Math.max(0, Math.floor((S.v0 - span * 0.5 - w.t0) / bar));
      const b = Math.min(Math.ceil(w.dur / bar), Math.ceil((S.v1 + span * 0.5 - w.t0) / bar));
      let d = "";
      for (let k = a; k < b; k++) {
        const i0 = Math.floor((k * bar) / w.step);
        const i1 = Math.min(w.data.length, Math.max(i0 + 1, Math.floor(((k + 1) * bar) / w.step)));
        let v = 0;
        for (let i = i0; i < i1; i++) if (w.data[i]! > v) v = w.data[i]!;
        const h = (0.05 + (v / 255) * 0.95) * 46;
        d += `M${((k + 0.5) * bar).toFixed(3)} ${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
      }
      w.path.setAttribute("d", d);
      // Weit vergrößert werden die Striche breiter, damit kein Kamm entsteht.
      (w.path as SVGElement).style.strokeWidth = `${Math.max(1.5, (bar / span) * S.tlW - 0.6).toFixed(2)}px`;
    }
  }
  let waveFrame = 0;
  const queueWaves = () => {
    if (waveFrame) return;
    waveFrame = requestAnimationFrame(() => {
      waveFrame = 0;
      drawWaves();
    });
  };
  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
  function drawGrid() {
    const g = $("grid");
    g.textContent = "";
    if (!S.tlW) return;
    const span = S.v1 - S.v0;
    const step = STEPS.find((s) => (s / span) * S.tlW >= 78) ?? STEPS[STEPS.length - 1]!;
    // In Echtzeit nach Uhrzeit runden (volle Viertelstunden), sonst nach Videozeit.
    const offset = D.realtime ? (clockMsAt(0) / 1000) % step : 0;
    for (let t = Math.ceil((S.v0 + offset) / step) * step - offset; t <= S.v1; t += step) {
      const x = ((t - S.v0) / span) * S.tlW;
      if (x < 30 || x > S.tlW - 20) continue;
      const i = el("i");
      i.style.left = `${x}px`;
      const lbl = D.realtime ? clock(t, step < 60) : vt(t);
      const s = el("span", "num", lbl);
      s.style.left = `${x}px`;
      g.append(i, s);
    }
  }
  /** Misst die Zeitleiste neu aus (nach Größenänderung, Vollbild, Auf- und Zuklappen) und zeichnet nach. */
  function layoutTimeline() {
    const a = tl.getBoundingClientRect();
    const b = eps.parentElement!.parentElement!.getBoundingClientRect();
    S.tlLab = b.left - a.left;
    S.tlW = b.width;
    tl.style.setProperty("--lab", `${S.tlLab}px`);
    tl.style.setProperty("--tlw", `${S.tlW}px`);
    $("stage").style.setProperty("--lab", `${S.tlLab}px`);
    drawGrid();
    queueWaves();
    placeHead();
  }
  function placeHead() {
    const span = S.v1 - S.v0;
    const x = ((S.t - S.v0) / span) * S.tlW;
    const ph = $("ph");
    ph.style.visibility = x < -1 || x > S.tlW + 1 ? "hidden" : "visible";
    ph.style.transform = `translateX(${x}px)`;
  }
  /** Beim Abspielen und Springen bleibt der Zeitzeiger im Ausschnitt. */
  function keepInView() {
    const span = S.v1 - S.v0;
    if (span >= DUR) return;
    if (S.t < S.v0 || S.t > S.v1 - span * 0.04) setView(S.t - span * 0.1, S.t + span * 0.9);
  }
  const tAt = (ev: { clientX: number }) => {
    const r = tl.getBoundingClientRect();
    return clamp(S.v0 + ((ev.clientX - r.left - S.tlLab) / (S.tlW || 1)) * (S.v1 - S.v0));
  };
  let drag: "seek" | "pan" | null = null;
  let panFrom = { x: 0, v0: 0 };
  tl.addEventListener("pointerdown", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest("button") || !t.closest(".tl-track")) return;
    tl.setPointerCapture(ev.pointerId);
    if (t.closest("#ruler")) {
      drag = "pan";
      panFrom = { x: ev.clientX, v0: S.v0 };
      tl.classList.add("panning");
      return;
    }
    drag = "seek";
    seek(tAt(ev));
  });
  tl.addEventListener("pointermove", (ev) => {
    if (drag === "pan") {
      const span = S.v1 - S.v0;
      const v0 = panFrom.v0 - ((ev.clientX - panFrom.x) / (S.tlW || 1)) * span;
      setView(v0, v0 + span);
      return;
    }
    if (drag === "seek") seek(tAt(ev));
    const tip = $("tip");
    if (!(ev.target as HTMLElement).closest(".tl-track") && !drag) {
      tip.style.display = "none";
      return;
    }
    const t = tAt(ev);
    tip.style.display = "block";
    tip.style.left = `${S.tlLab + ((t - S.v0) / (S.v1 - S.v0)) * S.tlW}px`;
    tip.textContent = `${clock(t)} · Video ${vt(t)}`;
  });
  const endDrag = () => {
    drag = null;
    tl.classList.remove("panning");
  };
  tl.addEventListener("pointerup", endDrag);
  tl.addEventListener("pointercancel", endDrag);
  tl.addEventListener("pointerleave", () => ($("tip").style.display = "none"));
  // Mausrad zoomt (ohne Strg), Umschalt+Rad oder seitliches Wischen verschiebt.
  tl.addEventListener(
    "wheel",
    (ev) => {
      if (!(ev.target as HTMLElement).closest(".tl-track, .grid") && !(ev.target as HTMLElement).closest(".tl")) return;
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      const dx = ev.deltaX * unit;
      const dy = ev.deltaY * unit;
      const span = S.v1 - S.v0;
      if (ev.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        const d = ((ev.shiftKey && !dx ? dy : dx) / (S.tlW || 1)) * span;
        setView(S.v0 + d, S.v1 + d);
        return;
      }
      zoomAt(Math.exp(dy * 0.0016), tAt(ev));
    },
    { passive: false },
  );
  $("zoom-in").addEventListener("click", () => zoomAt(0.5, S.t >= S.v0 && S.t <= S.v1 ? S.t : (S.v0 + S.v1) / 2));
  $("zoom-out").addEventListener("click", () => zoomAt(2, S.t >= S.v0 && S.t <= S.v1 ? S.t : (S.v0 + S.v1) / 2));
  $("zoom-all").addEventListener("click", () => setView(0, DUR));
  addEventListener("resize", layoutTimeline);

  // ───── Video ─────
  function setMissing(on: boolean) {
    S.missing = on;
    app.dataset.video = on ? "fehlt" : "ok";
    if (on) setPlayingUi(false);
  }
  vid.addEventListener("error", () => setMissing(true));
  vid.querySelector("source")?.addEventListener("error", () => setMissing(true));
  vid.addEventListener("loadedmetadata", () => {
    setMissing(false);
    const d = vid.duration;
    const warn = $("warn");
    if (Number.isFinite(d) && Math.abs(d - DUR) > 2) {
      $("warn-t").textContent =
        `Das Video ist ${vt(d)} lang, erwartet sind ${vt(DUR)}. Vielleicht gehört es zu einer anderen Ausgabe: Die Zeilen passen dann nicht zum Bild.`;
      warn.hidden = false;
    } else warn.hidden = true;
    const native = nativeTracks();
    if (native && native.length > 1 && native.length === D.audio.length) nativeOk = true;
    if (Math.abs(vid.currentTime - S.t) > 0.3) vid.currentTime = S.t;
  });
  function setPlayingUi(on: boolean) {
    S.playing = on;
    $("video").dataset.playing = String(on);
    $("play").setAttribute("aria-label", on ? "Anhalten" : "Abspielen");
    $("play-ic").innerHTML = on ? '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>' : '<path d="M4.5 2.5v11l9-5.5z"/>';
  }
  // Abspielen läuft immer über das <video>; `S.playing` und die Tonwiedergabe folgen seinen Ereignissen unten.
  function setPlaying(on: boolean) {
    if (S.missing) return;
    if (on) {
      if (S.t >= DUR - 0.05) seek(0);
      void vid.play().catch(() => setPlayingUi(false));
      engine?.ctx.resume().catch(() => {});
    } else vid.pause();
  }
  vid.addEventListener("play", () => {
    setPlayingUi(true);
    requestAnimationFrame(tick);
  });
  vid.addEventListener("pause", () => {
    setPlayingUi(false);
    engineStop();
  });
  vid.addEventListener("ended", () => setPlayingUi(false));
  vid.addEventListener("playing", () => engineRestart());
  vid.addEventListener("waiting", () => engineStop());
  vid.addEventListener("seeking", () => engineStop());
  vid.addEventListener("seeked", () => {
    if (!vid.paused) engineRestart();
  });
  vid.addEventListener("ratechange", () => mix());
  vid.addEventListener("timeupdate", () => {
    if (!S.playing) {
      S.t = vid.currentTime;
      update();
    }
  });
  function tick() {
    if (!S.playing) return;
    S.t = clamp(vid.currentTime);
    update();
    keepInView();
    requestAnimationFrame(tick);
  }
  /** Zur Stelle `t` (s) springen; `follow` schaltet „Text läuft mit“ wieder ein. */
  function seek(t: number, follow?: boolean) {
    S.t = clamp(t);
    if (!S.missing && vid.readyState > 0) vid.currentTime = S.t;
    keepInView();
    // Erst die aktuelle Zeile bestimmen, dann mitlaufen: sonst scrollt der Text zur vorigen Zeile.
    update();
    if (follow) setFollow(true, true);
  }
  /** Alles nachziehen, was von der aktuellen Stelle abhängt: Uhr, Zeitzeiger, Episode, aktuelle Zeile. */
  function update() {
    $("now-clock").textContent = clock(S.t);
    $("now-vt-t").textContent = vt(S.t);
    seekEl.value = String(Math.floor(S.t));
    seekEl.setAttribute("aria-valuetext", `Uhrzeit ${clock(S.t)}, Video ${vt(S.t)}`);
    placeHead();
    const ms = S.t * 1000;
    eps.querySelectorAll<HTMLElement>(".seg.ep").forEach((b) => {
      const on = ms >= Number(b.dataset.m0) && ms < Number(b.dataset.m1);
      if (on) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    // Aktuelle Zeile: die letzte sichtbare Zeile, die schon begonnen hat (Episodenköpfe zählen nicht).
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid]!.t <= S.t + 0.005) lo = mid + 1;
      else hi = mid;
    }
    let cur = lo - 1;
    while (cur >= 0 && (entries[cur]!.kind === "episode" || !visible(entries[cur]!))) cur--;
    if (cur !== S.cur) {
      if (S.cur >= 0) entries[S.cur]?.li.removeAttribute("aria-current");
      S.cur = cur;
      if (cur >= 0) entries[cur]!.li.setAttribute("aria-current", "true");
      if (S.follow) toCurrent(false);
    }
    backState();
  }
  const rel = (li: HTMLElement) => li.getBoundingClientRect().top - sc.getBoundingClientRect().top;
  function toCurrent(always: boolean) {
    const li = S.cur >= 0 ? entries[S.cur]!.li : null;
    if (!li) return;
    const top = rel(li);
    const h = sc.clientHeight;
    // Nur schieben, wenn die Zeile den ruhigen Bereich verlässt: so steht der Text die meiste Zeit still.
    if (!always && top > Math.max(h * 0.12, 70) && top + li.offsetHeight < h * 0.7) return;
    S.progUntil = performance.now() + 900;
    scrollTarget = li;
    sc.scrollTo({
      top: Math.max(0, sc.scrollTop + top - Math.max(h * 0.28, 76)),
      behavior: reduce.matches ? "auto" : "smooth",
    });
  }
  // Zeilen außerhalb des Bildes haben nur eine geschätzte Höhe (content-visibility, Bilder laden spät). Steht die
  // Zeile nach dem Scrollen nicht, wo sie hin sollte, einmal ohne Animation nachrücken.
  let scrollTarget: HTMLElement | null = null;
  sc.addEventListener("scrollend", () => {
    const li = scrollTarget;
    scrollTarget = null;
    if (!li || !S.follow || S.cur < 0 || entries[S.cur]!.li !== li) return;
    const top = rel(li);
    const want = Math.max(sc.clientHeight * 0.28, 76);
    if (Math.abs(top - want) < 24) return;
    S.progUntil = performance.now() + 300;
    sc.scrollTo({ top: Math.max(0, sc.scrollTop + top - want), behavior: "auto" });
  });
  function setFollow(on: boolean, quiet?: boolean) {
    S.follow = on;
    $("sheet").dataset.folgt = String(on);
    $("follow").setAttribute("aria-checked", String(on));
    if (on) toCurrent(!quiet);
    backState();
  }
  /** Knopf „zurück zur aktuellen Stelle“: nur ohne Mitlaufen und wenn die aktuelle Zeile aus dem Bild ist. */
  function backState() {
    const li = S.cur >= 0 ? entries[S.cur]!.li : null;
    const b = $("back");
    if (!li) {
      b.classList.remove("show");
      return;
    }
    const top = rel(li);
    const out = top + li.offsetHeight < 30 || top > sc.clientHeight - 10;
    b.classList.toggle("show", !S.follow && out);
    b.dataset.dir = top < 0 ? "up" : "down";
    $("back-t").textContent = `· ${clock(S.t)}`;
  }
  // Mitlaufen endet nur, wenn jemand selbst scrollt (Rad, Finger, Rollbalken, Bildtasten).
  let userAt = -1e9;
  const user = () => {
    userAt = performance.now();
    S.progUntil = 0;
  };
  for (const n of ["wheel", "touchstart", "touchmove"]) sc.addEventListener(n, user, { passive: true });
  // Rollbalken: der Klick trifft den Scrollbereich selbst. Ein Klick auf eine Zeile ist kein Scrollen.
  sc.addEventListener("pointerdown", (ev) => ev.target === sc && user(), { passive: true });
  sc.addEventListener("keydown", (ev) => {
    if (["PageUp", "PageDown", "Home", "End"].includes(ev.key)) user();
  });
  sc.addEventListener(
    "scroll",
    () => {
      const now = performance.now();
      if (S.follow && now > S.progUntil && now - userAt < 1500) setFollow(false);
      else backState();
    },
    { passive: true },
  );
  $("back").addEventListener("click", () => setFollow(true));
  $("follow").addEventListener("click", () => setFollow(!S.follow));
  $("play").addEventListener("click", () => setPlaying(!S.playing));
  $("video").addEventListener("click", (ev) => {
    if (!(ev.target as HTMLElement).closest(".v-missing")) setPlaying(!S.playing);
  });
  $("video").addEventListener("dblclick", (ev) => {
    if (!(ev.target as HTMLElement).closest(".v-missing")) toggleFullscreen();
  });
  $("back5").addEventListener("click", () => seek(S.t - 5));
  $("fwd5").addEventListener("click", () => seek(S.t + 5));
  let toastTimer = 0;
  function toast(s: string) {
    const t = $("toast");
    t.textContent = s;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600) as unknown as number;
  }
  $("copy").addEventListener("click", async () => {
    const s = `${D.title} ${D.date} · Uhrzeit ${clock(S.t)} · ${stamp(S.t)} · ${D.montageId}`;
    try {
      history.replaceState(null, "", `#t=${Math.floor(S.t)}`);
    } catch {
      // Manche Browser erlauben das bei file:// nicht; die Stelle steht dann nur im kopierten Text.
    }
    try {
      await navigator.clipboard.writeText(s);
      toast(`Stelle kopiert: ${s}`);
    } catch {
      toast(s);
    }
  });
  function setRate(r: number) {
    S.rate = r;
    vid.playbackRate = r;
    $("rate").textContent = `${String(r).replace(".", ",")}×`;
  }
  $("rate").addEventListener("click", () => setRate(RATES[(RATES.indexOf(S.rate) + 1) % RATES.length]!));
  function applyVolume() {
    // Spielt der Viewer die Gerätespuren selbst, bleibt das Video stumm, sonst wäre die Mischung doppelt zu hören.
    const engineOn = engineWanted();
    vid.muted = S.userMuted || engineOn;
    vid.volume = S.volume;
    if (engine) engine.master.gain.value = S.userMuted ? 0 : S.volume;
    $("mute").setAttribute("aria-pressed", String(S.userMuted));
  }
  $("mute").addEventListener("click", () => {
    S.userMuted = !S.userMuted;
    applyVolume();
  });
  $<HTMLInputElement>("volume").addEventListener("input", (ev) => {
    S.volume = Number((ev.target as HTMLInputElement).value) / 100;
    applyVolume();
  });
  $("spuren-btn").addEventListener("click", () => {
    const open = $("stage").dataset.spuren !== "auf";
    $("stage").dataset.spuren = open ? "auf" : "zu";
    $("spuren-btn").setAttribute("aria-expanded", String(open));
    layoutTimeline();
  });

  // Vollbild: Bild und Steuerleiste.
  const proj = $("proj");
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (proj.requestFullscreen) void proj.requestFullscreen().catch(() => {});
  }
  if (!document.fullscreenEnabled) $("fs").hidden = true;
  $("fs").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    $("fs").setAttribute("aria-label", document.fullscreenElement ? "Vollbild verlassen" : "Vollbild");
    requestAnimationFrame(layoutTimeline);
  });

  // Video fehlt: selbst wählen. Die gewählte Datei gilt danach auch als Freigabe der Einzelspuren.
  async function pickVideo(): Promise<{ file: File; handle: FileSystemFileHandle | null } | null> {
    const w = window as unknown as {
      showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>;
    };
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({
          id: "feldspur-viewer",
          types: [{ description: "Montagevideo", accept: { "video/mp4": [".mp4"] } }],
        });
        return h ? { file: await h.getFile(), handle: h } : null;
      } catch (e) {
        if ((e as Error).name === "AbortError") return null;
      }
    }
    return new Promise((resolve) => {
      const input = el("input") as HTMLInputElement;
      input.type = "file";
      input.accept = "video/mp4,.mp4";
      input.addEventListener("change", () => {
        const f = input.files?.[0];
        resolve(f ? { file: f, handle: null } : null);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }
  $("pick-video").addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const got = await pickVideo();
    if (!got) return;
    S.picked = got.file;
    S.pickedHandle = got.handle;
    vid.src = URL.createObjectURL(got.file);
  });

  // ───── Tonspuren ─────
  // Standard: die Mischung (Spur 1), so wie jeder Player sie spielt. Erst nach der Freigabe spielt der Viewer
  // die Gerätespuren selbst: Datei lesen (readMp4), Pakete mit WebCodecs entschlüsseln, über Web Audio synchron
  // zum (dann stummen) Video ausgeben. Safari kann mehrere Tonspuren selbst (audioTracks).
  interface NativeTrack {
    enabled: boolean;
  }
  const nativeTracks = () =>
    (vid as unknown as { audioTracks?: { length: number; [i: number]: NativeTrack } }).audioTracks;
  // Der Browser bietet die Tonspuren des Videos selbst an (gesetzt, sobald das Video geladen ist).
  let nativeOk = false;
  const canEngine = () =>
    typeof (window as unknown as { AudioDecoder?: unknown }).AudioDecoder === "function" &&
    typeof AudioContext === "function";

  /** Eigene Tonwiedergabe der Gerätespuren aus der freigegebenen Videodatei. */
  interface Engine {
    file: File;
    info: Mp4AudioInfo;
    ctx: AudioContext;
    master: GainNode;
    /** Ein Regler je Tonspur der Datei (Index wie `info.audio`). */
    gains: GainNode[];
    /** Entschlüsselte Blöcke, Schlüssel „Spur:Block“. */
    cache: Map<string, Promise<{ buf: AudioBuffer; start: number } | null>>;
    sources: Set<AudioBufferSourceNode>;
    scheduled: Set<string>;
    /** Dieser Zeitpunkt der Audio-Uhr (`ctx`) entspricht dieser Videozeit (`v`); null = steht. */
    anchor: { ctx: number; v: number } | null;
    /** Zählt bei jedem Halt hoch: Blöcke, die für einen früheren Lauf bestellt wurden, werden verworfen. */
    gen: number;
    timer: number;
  }
  let engine: Engine | null = null;
  // Der Ton wird in Blöcken von so vielen Sekunden entschlüsselt und eingeplant.
  const BLOCK = 2;

  // Die eigene Wiedergabe springt nur ein, wenn wirklich etwas solo oder stumm ist, und nur bei normalem Tempo:
  // schneller oder langsamer kann sie nicht, dann bleibt es bei der Mischung des Videos.
  function engineWanted() {
    return S.ton === "frei" && !nativeOk && !!engine && (S.solo.size > 0 || S.mute.size > 0) && S.rate === 1;
  }
  function makeEngine(file: File, info: Mp4AudioInfo): Engine {
    const ctx = new AudioContext({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const gains = info.audio.map(() => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    });
    return {
      file,
      info,
      ctx,
      master,
      gains,
      cache: new Map(),
      sources: new Set(),
      scheduled: new Set(),
      anchor: null,
      gen: 0,
      timer: 0,
    };
  }
  const lowerBound = (a: Float64Array, x: number) => {
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  async function decodeBlock(e: Engine, tk: Mp4AudioTrack, b: number) {
    const t0 = b * BLOCK;
    const i0 = lowerBound(tk.times, t0);
    const i1 = lowerBound(tk.times, t0 + BLOCK);
    if (i1 <= i0) return null;
    // Zwei Pakete davor zum Einschwingen des Decoders; ihre Ausgabe wird verworfen.
    const p0 = Math.max(0, i0 - 2);
    let from = Infinity;
    let to = 0;
    for (let i = p0; i < i1; i++) {
      from = Math.min(from, tk.offsets[i]!);
      to = Math.max(to, tk.offsets[i]! + tk.sizes[i]!);
    }
    const bytes = new Uint8Array(await e.file.slice(from, to).arrayBuffer());
    const outs: AudioData[] = [];
    let failed: unknown = null;
    const dec = new AudioDecoder({
      output: (d) => outs.push(d),
      error: (err) => (failed = err),
    });
    dec.configure({
      codec: tk.codec,
      sampleRate: tk.sampleRate,
      numberOfChannels: tk.channels,
      ...(tk.config ? { description: tk.config } : {}),
    });
    for (let i = p0; i < i1; i++) {
      const o = tk.offsets[i]! - from;
      dec.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: Math.round(tk.times[i]! * 1e6),
          duration: Math.round(tk.durations[i]! * 1e6),
          data: bytes.subarray(o, o + tk.sizes[i]!),
        }),
      );
    }
    await dec.flush().catch((err) => (failed = err));
    if (dec.state !== "closed") dec.close();
    const keep = outs.filter((d) => d.timestamp >= tk.times[i0]! * 1e6 - 500);
    for (const d of outs) if (!keep.includes(d)) d.close();
    if (failed || !keep.length) {
      for (const d of keep) d.close();
      return null;
    }
    const first = keep[0]!;
    const channels = first.numberOfChannels;
    const total = keep.reduce((a, d) => a + d.numberOfFrames, 0);
    const buf = e.ctx.createBuffer(channels, total, first.sampleRate);
    let at = 0;
    for (const d of keep) {
      for (let c = 0; c < channels; c++) {
        const tmp = new Float32Array(d.numberOfFrames);
        d.copyTo(tmp, { planeIndex: c, format: "f32-planar" });
        buf.copyToChannel(tmp, c, at);
      }
      at += d.numberOfFrames;
      d.close();
    }
    return { buf, start: first.timestamp / 1e6 };
  }
  function block(e: Engine, k: number, b: number) {
    const key = `${k}:${b}`;
    let p = e.cache.get(key);
    if (!p) {
      p = decodeBlock(e, e.info.audio[k]!, b).catch(() => null);
      e.cache.set(key, p);
      // Höchstens etwa eine Minute Ton je Spur im Speicher.
      if (e.cache.size > 30 * e.info.audio.length) e.cache.delete(e.cache.keys().next().value!);
    }
    return p;
  }
  /** Tonspuren, die gerade zu hören sein sollen (Indizes im Video). */
  const wantedTracks = () => lanes.filter((l, n) => l.lane.audio > 0 && audible(n)).map((l) => l.lane.audio);
  /** Plant die nächsten Sekunden Ton ein (alle 200 ms) und setzt neu an, wenn Bild und Ton auseinanderlaufen. */
  function pump() {
    const e = engine;
    if (!e || !e.anchor) return;
    const now = e.ctx.currentTime;
    const vNow = e.anchor.v + (now - e.anchor.ctx);
    if (Math.abs(vid.currentTime - vNow) > 0.12 && now > e.anchor.ctx + 0.3) {
      engineRestart();
      return;
    }
    const gen = e.gen;
    const b0 = Math.floor(Math.max(0, vNow) / BLOCK);
    const b1 = Math.floor((vNow + 4) / BLOCK);
    for (const k of wantedTracks())
      for (let b = b0; b <= b1; b++) {
        const key = `${k}:${b}`;
        if (e.scheduled.has(key)) continue;
        e.scheduled.add(key);
        void block(e, k, b).then((r) => {
          if (!r || e.gen !== gen || !e.anchor) return;
          const when = e.anchor.ctx + (r.start - e.anchor.v);
          const src = e.ctx.createBufferSource();
          src.buffer = r.buf;
          src.connect(e.gains[k]!);
          const soon = e.ctx.currentTime + 0.02;
          if (when >= soon) src.start(when);
          else if (soon - when < r.buf.duration) src.start(soon, soon - when);
          else return;
          e.sources.add(src);
          src.addEventListener("ended", () => e.sources.delete(src));
        });
      }
  }
  function engineStop() {
    const e = engine;
    if (!e) return;
    e.gen++;
    e.anchor = null;
    clearInterval(e.timer);
    for (const s of e.sources) {
      try {
        s.stop();
      } catch {
        // schon beendet
      }
    }
    e.sources.clear();
    e.scheduled.clear();
  }
  function engineRestart() {
    engineStop();
    const e = engine;
    if (!e || !engineWanted() || vid.paused) return;
    void e.ctx.resume().catch(() => {});
    const lead = 0.15;
    e.anchor = { ctx: e.ctx.currentTime + lead, v: vid.currentTime + lead };
    pump();
    e.timer = setInterval(pump, 200) as unknown as number;
  }

  /** Wendet Solo und Stumm an: Knöpfe, Beschriftung, Tonspuren des Browsers oder eigene Wiedergabe. */
  function mix() {
    const solos = lanes.filter((_, n) => S.solo.has(n));
    const mutes = lanes.filter((_, n) => S.mute.has(n));
    const custom = S.ton === "frei" && (solos.length > 0 || mutes.length > 0);
    lanes.forEach((l, n) => {
      l.s?.setAttribute("aria-pressed", String(S.solo.has(n)));
      l.m?.setAttribute("aria-pressed", String(S.mute.has(n)));
      l.row.dataset.hoerbar = String(!custom || (l.lane.audio > 0 && audible(n)));
    });
    $("mix-reset").hidden = !solos.length && !mutes.length;
    const names = (ls: typeof lanes) => ls.map((l) => l.lane.title).join(", ");
    $("mix-state").textContent =
      custom && S.rate !== 1 && !nativeOk
        ? `Bei ${String(S.rate).replace(".", ",")}× ist die Mischung zu hören`
        : solos.length
          ? `Nur ${names(solos)}`
          : mutes.length
            ? `Stumm: ${names(mutes)}`
            : S.ton === "frei"
              ? "Zu hören: alle Geräte"
              : "Zu hören: Mischung";
    if (nativeOk && S.ton === "frei") {
      const list = nativeTracks();
      if (list) {
        const want = new Set(custom ? wantedTracks() : [0]);
        for (let k = 0; k < list.length; k++) list[k]!.enabled = want.has(k);
      }
    }
    if (engine) engine.gains.forEach((g, k) => (g.gain.value = wantedTracks().includes(k) ? 1 : 0));
    applyVolume();
    engineRestart();
  }
  $("mix-reset").addEventListener("click", () => {
    S.solo.clear();
    S.mute.clear();
    mix();
  });

  // Assistent „Erweiterte Tonspurkontrolle“
  const ton = $<HTMLDialogElement>("ton");
  function setTon(z: "mix" | "bekannt" | "frei") {
    S.ton = z;
    app.dataset.ton = z;
    if (z !== "frei") {
      S.solo.clear();
      S.mute.clear();
    }
    $("ton-lbl").textContent = z === "frei" ? "Einzelspuren" : "Erweiterte Tonspurkontrolle";
    $("ton-btn").title =
      z === "frei"
        ? "Die Einzelspuren sind freigegeben. Klick zeigt die Kurzanleitung."
        : "Jedes Gerät einzeln hören, stumm oder solo schalten";
    mix();
    layoutTimeline();
  }
  function tonStep(n: number) {
    ton.dataset.at = String(n);
    [...$("ton-steps").children].forEach((li, i) => {
      li.classList.toggle("done", i + 1 < n);
      if (i + 1 === n) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    if (n !== 2) $("ton-err").hidden = true;
  }
  function tonOpen(n: number) {
    tonStep(n);
    const supported = nativeOk || canEngine();
    $("ton-unsupported").hidden = supported;
    $("ton-next").hidden = !supported;
    if (!ton.open) ton.showModal();
    // focusVisible kennt noch nicht jeder Browser; ohne zeigt er nach einem Tastendruck den Fokusring, das ist recht.
    (ton.querySelector<HTMLElement>(`.wiz-foot[data-step="${n}"] .fill`) ?? $("ton-pick")).focus({
      focusVisible: false,
    } as FocusOptions);
  }
  function tonError(head: string, got: string) {
    $("ton-err-h").textContent = head;
    $("ton-got").textContent = got;
    $("ton-err").hidden = false;
  }
  $("ton-exp").textContent = `${D.mediaFile} · ${vt(DUR)} · ${D.audio.length} Tonspuren`;
  $("ton-found").textContent = `${D.audio.length} Tonspuren gefunden: ${D.audio.join(", ")}.`;

  // Freigabe merken (nur Chrome und Edge können einen Dateizugriff speichern), in IndexedDB (nichts sonst wird gespeichert).
  function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    return new Promise((resolve) => {
      try {
        const r = indexedDB.open("feldspur-viewer", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("videos");
        r.onerror = () => resolve(undefined);
        r.onsuccess = () => {
          try {
            const req = fn(r.result.transaction("videos", mode).objectStore("videos"));
            req.onsuccess = () => resolve(req.result as T);
            req.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        };
      } catch {
        resolve(undefined);
      }
    });
  }

  /**
   * Freigabe: prüft, ob `file` das erwartete Montagevideo ist (Zahl der Tonspuren, Dauer) und ob der Browser den Ton
   * entschlüsseln kann, und schaltet dann die Einzelspuren frei. `quiet`: ohne Meldungen im Assistenten (beim
   * Wiedererkennen nach dem Laden). `handle` wird, wenn vorhanden, für das nächste Mal gemerkt.
   */
  async function grant(file: File, handle: FileSystemFileHandle | null, quiet = false): Promise<boolean> {
    $("ton-wait").hidden = quiet;
    $("ton-err").hidden = true;
    let info: Mp4AudioInfo | null = null;
    try {
      info = await readMp4(async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()), file.size);
    } catch {
      info = null;
    }
    $("ton-wait").hidden = true;
    if (!info || info.audio.length !== D.audio.length || Math.abs(info.durationS - DUR) > 2) {
      if (!quiet)
        tonError(
          "Das ist ein anderes Video.",
          `${file.name} · ${info ? `${vt(info.durationS)} · ${info.audio.length} Tonspuren` : "kein MP4-Video"}`,
        );
      return false;
    }
    const tk = info.audio[1] ?? info.audio[0]!;
    const support = await AudioDecoder.isConfigSupported({
      codec: tk.codec,
      sampleRate: tk.sampleRate,
      numberOfChannels: tk.channels,
      ...(tk.config ? { description: tk.config } : {}),
    }).catch(() => ({ supported: false }));
    if (!support.supported) {
      if (!quiet) tonError("Dieser Browser kann den Ton nicht lesen.", `${file.name} · ${tk.codec}`);
      return false;
    }
    if (engine) {
      engineStop();
      void engine.ctx.close().catch(() => {});
    }
    engine = makeEngine(file, info);
    if (handle) await idb("readwrite", (s) => s.put(handle, videoKey));
    setTon("frei");
    return true;
  }
  async function grantAndShow(file: File, handle: FileSystemFileHandle | null) {
    if (await grant(file, handle)) tonOpen(3);
  }
  $("ton-btn").addEventListener("click", () => tonOpen(S.ton === "frei" ? 3 : 1));
  $("ton-next").addEventListener("click", () => {
    if (nativeOk) {
      setTon("frei");
      tonOpen(3);
    } else if (S.picked) {
      tonStep(2);
      void grantAndShow(S.picked, S.pickedHandle);
    } else tonOpen(2);
  });
  $("ton-prev").addEventListener("click", () => tonStep(1));
  $("ton-pick").addEventListener("click", async () => {
    const got = await pickVideo();
    if (got) await grantAndShow(got.file, got.handle);
  });
  $("ton-again").addEventListener("click", async () => {
    const h = S.knownHandle as unknown as {
      requestPermission?: (o: unknown) => Promise<string>;
      getFile: () => Promise<File>;
    } | null;
    if (!h?.requestPermission) return;
    const p = await h.requestPermission({ mode: "read" }).catch(() => "denied");
    if (p !== "granted") return;
    if (await grant(await h.getFile(), S.knownHandle, true))
      toast("Einzelspuren sind wieder frei. S und M stehen an den Gerätespuren.");
    else tonOpen(2);
  });
  {
    const dz = $("ton-drop");
    for (const n of ["dragenter", "dragover"])
      dz.addEventListener(n, (ev) => {
        ev.preventDefault();
        dz.classList.add("over");
      });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dz.classList.remove("over");
      const item = ev.dataTransfer?.items[0] as
        | (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
        | undefined;
      const handlePromise = item?.getAsFileSystemHandle?.().catch(() => null);
      const f = ev.dataTransfer?.files[0];
      if (!f) return;
      const h = await handlePromise;
      await grantAndShow(f, h && h.kind === "file" ? (h as FileSystemFileHandle) : null);
    });
  }

  // ───── Suche ─────
  function search() {
    S.q = $<HTMLInputElement>("q").value.trim();
    S.hits = [];
    for (const e of entries) {
      if (!e.body) continue;
      const n = fillText(e.body, e.text);
      if (n && visible(e)) e.body.querySelectorAll("mark").forEach((m) => S.hits.push({ e, m }));
    }
    let inCtx = 0;
    for (const c of ctxItems) if (c.body) inCtx += fillText(c.body, c.text);
    $("marks")
      .querySelectorAll(".hit")
      .forEach((n) => n.remove());
    for (const h of S.hits) {
      const i = el("i", "tick hit");
      i.style.left = pct(h.e.t);
      $("marks").append(i);
    }
    const has = !!S.q;
    $("q-prev").hidden = $("q-next").hidden = !has || !S.hits.length;
    $("hit-legend").hidden = !has || !S.hits.length;
    S.hit = -1;
    $("q-cnt").textContent = has
      ? (S.hits.length ? `${S.hits.length} Treffer` : "kein Treffer") + (inCtx ? ` · ${inCtx} im Kontext` : "")
      : "";
    $("empty").style.display = entries.some((e) => e.kind !== "episode" && e.kind !== "end" && visible(e))
      ? "none"
      : "block";
    // Ungültiger Wert, damit `update` die aktuelle Zeile neu bestimmt (die Sichtbarkeit kann sich geändert haben).
    S.cur = -2;
    update();
  }
  function gotoHit(d: number) {
    if (!S.hits.length) return;
    if (S.hit >= 0) S.hits[S.hit]!.m.classList.remove("cur");
    S.hit = (S.hit + d + S.hits.length) % S.hits.length;
    const h = S.hits[S.hit]!;
    h.m.classList.add("cur");
    $("q-cnt").textContent = `${S.hit + 1} von ${S.hits.length}`;
    if (S.follow) setFollow(false);
    S.progUntil = performance.now() + 900;
    sc.scrollTo({
      top: Math.max(0, sc.scrollTop + rel(h.e.li) - sc.clientHeight * 0.3),
      behavior: reduce.matches ? "auto" : "smooth",
    });
  }
  const q = $<HTMLInputElement>("q");
  q.addEventListener("input", search);
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      gotoHit(ev.shiftKey ? -1 : 1);
    }
    if (ev.key === "Escape") {
      q.value = "";
      search();
      q.blur();
    }
  });
  $("q-next").addEventListener("click", () => gotoHit(1));
  $("q-prev").addEventListener("click", () => gotoHit(-1));

  // ───── Ansicht ─────
  // Schaltergruppe (Schriftgröße, Zeitangabe am Rand, hell/dunkel): genau ein Knopf ist gedrückt.
  function seg3(id: string, fn: (v: string) => void) {
    $(id).addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest("button");
      if (!b) return;
      $(id)
        .querySelectorAll("button")
        .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      fn(b.dataset.v ?? "");
    });
  }
  seg3("fsz", (v) => document.documentElement.style.setProperty("--fs", v));
  seg3("zeit", (v) => (tr.dataset.zeit = v));
  seg3("theme", (v) => {
    if (v) document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
  });
  document.addEventListener("click", (ev) => {
    const m = $<HTMLDetailsElement>("ansicht");
    if (m.open && !m.contains(ev.target as Node)) m.open = false;
  });

  // ───── Tasten (angelehnt an Feldspur: F8/F9 = 5 s, F7 = Tempo) ─────
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.isComposing) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      q.focus();
      q.select();
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    const target = ev.target as HTMLElement;
    const inField = target.closest("input:not([type=range]), textarea, select");
    if (ev.key === "Escape") {
      const m = $<HTMLDetailsElement>("ansicht");
      if (m.open) m.open = false;
      else if (app.dataset.kontext === "offen") toggleContext(false);
      return;
    }
    if (inField) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const onButton = target.closest("button, summary, a");
    const step = (d: number) => {
      let i = S.cur;
      do i += d;
      while (entries[i] && (entries[i]!.kind === "episode" || !visible(entries[i]!)));
      if (entries[i]) seek(entries[i]!.t, true);
    };
    const center = () => (S.t >= S.v0 && S.t <= S.v1 ? S.t : (S.v0 + S.v1) / 2);
    const act: Record<string, () => boolean | void> = {
      " ": () => {
        if (onButton) return false;
        setPlaying(!S.playing);
      },
      k: () => setPlaying(!S.playing),
      ArrowLeft: () => {
        if (target === seekEl) return false;
        seek(S.t - 5);
      },
      ArrowRight: () => {
        if (target === seekEl) return false;
        seek(S.t + 5);
      },
      F8: () => seek(S.t - 5),
      F9: () => seek(S.t + 5),
      j: () => seek(S.t - 30),
      l: () => seek(S.t + 30),
      ArrowUp: () => step(-1),
      ArrowDown: () => step(1),
      n: () => {
        const list = D.segments.filter((s) => s.k === "e").map((s) => s.m0 / 1000);
        const nx = ev.shiftKey ? list.filter((t) => t < S.t - 2).pop() : list.find((t) => t > S.t + 0.5);
        if (nx !== undefined) seek(nx, true);
      },
      F7: () => {
        const i = RATES.indexOf(S.rate) + (ev.shiftKey ? 1 : -1);
        if (RATES[i]) setRate(RATES[i]);
      },
      m: () => $("mute").click(),
      f: () => toggleFullscreen(),
      t: () => setFollow(!S.follow),
      c: () => toggleContext(),
      "+": () => zoomAt(0.5, center()),
      "=": () => zoomAt(0.5, center()),
      "-": () => zoomAt(2, center()),
      "/": () => q.focus(),
      "?": () => $<HTMLDialogElement>("keys").showModal(),
      "0": () => $("mix-reset").click(),
    };
    const fn = act[k];
    const lane = /^[1-9]$/.test(k) ? lanes[Number(k) - 1] : undefined;
    if (lane && lane.lane.audio > 0) {
      ev.preventDefault();
      if (S.ton !== "frei") {
        toast("Einzelne Tonspuren gibt es nach der Freigabe: „Erweiterte Tonspurkontrolle“ unter dem Video.");
        return;
      }
      const n = lanes.indexOf(lane);
      const only = S.solo.has(n) && S.solo.size === 1;
      S.solo.clear();
      if (!only) S.solo.add(n);
      mix();
      return;
    }
    if (fn && fn() !== false) ev.preventDefault();
  });

  // ───── Start ─────
  // Eine Adresse mit „#t=Sekunden“ öffnet an dieser Stelle (der Knopf „Stelle kopieren“ setzt sie).
  const ht = /^#t=(\d+)/.exec(location.hash);
  if (ht) S.t = clamp(Number(ht[1]));
  $("now-dur").textContent = ` von ${vt(DUR)}`;
  layoutTimeline();
  setView(0, DUR);
  mix();
  update();
  S.progUntil = performance.now() + 500;
  toCurrent(true);
  void document.fonts?.ready.then(() => {
    layoutTimeline();
    S.progUntil = performance.now() + 500;
    toCurrent(true);
  });
  // Schon einmal freigegeben? Dann nur kurz nachfragen (Chrome, Edge).
  if (controllable.length >= 2 && "showOpenFilePicker" in window && canEngine())
    void idb<FileSystemFileHandle>("readonly", (s) => s.get(videoKey)).then(async (h) => {
      if (!h) return;
      S.knownHandle = h;
      const q = (h as unknown as { queryPermission?: (o: unknown) => Promise<string> }).queryPermission;
      const p = q ? await q.call(h, { mode: "read" }).catch(() => "prompt") : "prompt";
      if (p === "granted" && (await grant(await h.getFile(), h, true))) return;
      setTon("bekannt");
    });
  // Für Tests und zum Nachsehen in der Konsole.
  (window as unknown as { feldspur: unknown }).feldspur = {
    S,
    D,
    seek,
    setView,
    mix,
    setTon,
    tonOpen,
    grant,
    get engine() {
      return engine;
    },
  };
}
