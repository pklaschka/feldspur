/**
 * Zeichnen der Zeitachse auf Canvas. Reine Funktionen ohne React:
 * Layout (Zeilen, Elemente mit Pixelrechtecken), Treffersuche und Zeichnen.
 */
import type { DeviceRow, DiaryEntryRow, EpisodeRow, GapRow, SourceRow, TranscriptRow } from "../shared/api.ts";
import { clock, hm } from "./format.ts";

export const MIN = 60_000;
export const RULER_H = 30;
export const EPISODE_H = 40;
/** Höhe einer Spur; auf großen Bildschirmen höher (setTrackHeight), damit die Achse den Platz nutzt. */
export let TRACK_H = 52;
/** Höhe der Balken in einer Spur. */
let BAR_H = 32;
let BAR_Y = (TRACK_H - BAR_H) / 2;
export function setTrackHeight(h: number): void {
  TRACK_H = h;
  BAR_H = Math.round(h * 0.62);
  BAR_Y = (TRACK_H - BAR_H) / 2;
}
/** Kurze Clips bleiben sichtbar und anklickbar. */
export const MIN_CLIP_W = 6;

export interface Track {
  device: DeviceRow | null;
  rows: SourceRow[];
}

export type Item =
  | { type: "clip" | "point"; row: SourceRow; track: number; t0: number; t1: number }
  | { type: "diary"; row: SourceRow; track: number; t0: number; t1: number; entry: DiaryEntryRow }
  | { type: "episode"; ep: EpisodeRow; t0: number; t1: number }
  | { type: "gap"; gap: GapRow; t0: number; t1: number };

export interface Scale {
  /** Zeit am linken Rand der Leinwand (ms, lokale Uhrzeit). */
  start: number;
  pxPerMin: number;
}

export const xOf = (s: Scale, t: number) => ((t - s.start) / MIN) * s.pxPerMin;
export const tOf = (s: Scale, x: number) => s.start + (x / s.pxPerMin) * MIN;

export function trackTop(i: number): number {
  return RULER_H + EPISODE_H + i * TRACK_H;
}

export function buildItems(
  tracks: Track[],
  episodes: EpisodeRow[] | null,
  gaps: GapRow[],
  diary: DiaryEntryRow[],
): Item[] {
  const items: Item[] = [];
  for (const g of gaps) items.push({ type: "gap", gap: g, t0: g.startMs, t1: g.endMs });
  for (const e of episodes ?? []) items.push({ type: "episode", ep: e, t0: e.startMs, t1: e.endMs });
  tracks.forEach((tr, track) => {
    for (const r of tr.rows) {
      if (r.kind === "diary") continue;
      if (r.startMs !== null) {
        const clip = r.endMs !== null && r.endMs > r.startMs;
        items.push({ type: clip ? "clip" : "point", row: r, track, t0: r.startMs, t1: clip ? r.endMs! : r.startMs });
      }
    }
  });
  // Tagebuch: ein Balken pro Eintrag, auf der Spur der Seite, auf der er beginnt.
  for (const e of diary) {
    if (!e.window) continue;
    const first = e.regions[0];
    const track = tracks.findIndex((t) => t.rows.some((r) => r.id === first?.sourceId));
    const row = tracks[track]?.rows.find((r) => r.id === first?.sourceId);
    if (track < 0 || !row) continue;
    items.push({ type: "diary", row, track, t0: e.window.fromMs, t1: e.window.toMs, entry: e });
  }
  return items;
}

/** Element unter dem Zeiger; Punkte haben einen Fangradius. */
export function hitTest(items: Item[], s: Scale, x: number, y: number): Item | null {
  let best: Item | null = null;
  for (const it of items) {
    const x0 = xOf(s, it.t0);
    const x1 = Math.max(x0 + (it.type === "clip" ? MIN_CLIP_W : 2), xOf(s, it.t1));
    if (it.type === "episode" || it.type === "gap") {
      if (y >= RULER_H + 9 && y <= RULER_H + 31 && x >= x0 && x <= x1) best = it.type === "episode" ? it : (best ?? it);
      continue;
    }
    const top = trackTop(it.track);
    if (y < top || y > top + TRACK_H) continue;
    if (it.type === "point") {
      if (Math.abs(x - x0) <= 8) return it;
    } else if (x >= x0 && x <= x1) {
      best = it;
    }
  }
  return best;
}

export function tickStep(pxPerMin: number): number {
  for (const m of [1, 2, 5, 10, 15, 30, 60, 120]) if (m * pxPerMin >= 64) return m * MIN;
  return 240 * MIN;
}

interface Palette {
  panel: string;
  panel2: string;
  sunken: string;
  ink: string;
  muted: string;
  line: string;
  line2: string;
  accent: string;
  warn: string;
  kinds: Record<string, string>;
  sans: string;
  mono: string;
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    panel: v("--panel"),
    panel2: v("--panel-2"),
    sunken: v("--sunken"),
    ink: v("--ink"),
    muted: v("--muted"),
    line: v("--line"),
    line2: v("--line-2"),
    accent: v("--accent"),
    warn: v("--warn"),
    kinds: {
      video: v("--k-video"),
      audio: v("--k-audio"),
      photo: v("--k-photo"),
      diary: v("--k-diary"),
      other: v("--k-other"),
    },
    sans: v("--font-sans") || "system-ui, sans-serif",
    mono: v("--font-mono") || "monospace",
  };
}

/** "#rrggbb" + Deckkraft → "rgba(…)". */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${a})`;
}

/**
 * Schraffur als Muster. Die 7×7-Kachel und das Muster werden zwischengespeichert: früher entstand bei jedem
 * Zeichnen (also bei jeder Mausbewegung) für jeden Clip mit Leerlauf eine neue Leinwand. Auf macOS erschöpfte das
 * die Grafikspeicher („Failed to allocate IOSurface of size 7x7“) und ließ die Zeitachse flackern.
 */
const hatchTiles = new Map<string, OffscreenCanvas>();
const hatchPatterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();
function hatch(ctx: CanvasRenderingContext2D, color: string, bg: string | null): CanvasPattern | null {
  const key = `${color}|${bg ?? ""}`;
  let byCtx = hatchPatterns.get(ctx);
  if (!byCtx) hatchPatterns.set(ctx, (byCtx = new Map()));
  if (byCtx.has(key)) return byCtx.get(key)!;
  let tile = hatchTiles.get(key);
  if (!tile) {
    tile = new OffscreenCanvas(7, 7);
    // Ohne Grafikkarte im Speicher halten: die Kachel ist winzig und wird nur als Vorlage gelesen.
    const g = tile.getContext("2d", { willReadFrequently: true })!;
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, 7, 7);
    }
    g.strokeStyle = color;
    g.lineWidth = 2.2;
    g.beginPath();
    for (const o of [-7, 0, 7]) {
      g.moveTo(o, 7);
      g.lineTo(o + 7, 0);
    }
    g.stroke();
    hatchTiles.set(key, tile);
  }
  const pattern = ctx.createPattern(tile, "repeat");
  byCtx.set(key, pattern);
  return pattern;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export interface DrawState {
  scale: Scale;
  width: number;
  height: number;
  tracks: Track[];
  items: Item[];
  selected: string | null;
  hover: Item | null;
  /** Abspielposition (Ortszeit) oder null. */
  playheadMs: number | null;
  /** Mitschrift je Quelle, nach Stelle sortiert; wird in den Clips als Textvorschau gezeigt. */
  transcripts: Map<string, TranscriptRow[]>;
  /** Hüllkurven je Quelle (0–250, logarithmisch) für die Wellenform in den Clips. */
  envelopes?: Map<string, Envelope>;
  /** Gerade gezogene Episodengrenze: neue Lage als Vorschau. */
  dragEdge?: { t: number } | null;
}

export interface Envelope {
  /** Werte je Sekunde. */
  rate: number;
  data: Uint8Array;
}

const EPISODE_ROW = { top: RULER_H + 9, bottom: RULER_H + 31 };

/** Grenze einer Episode unter dem Zeiger (± 5 px), zum Ziehen. */
export function edgeAt(
  items: Item[],
  s: Scale,
  x: number,
  y: number,
): { index: number; edge: "start" | "end"; t: number } | null {
  if (y < EPISODE_ROW.top - 2 || y > EPISODE_ROW.bottom + 2) return null;
  let best: { index: number; edge: "start" | "end"; t: number; d: number } | null = null;
  for (const it of items) {
    if (it.type !== "episode") continue;
    for (const edge of ["start", "end"] as const) {
      const t = edge === "start" ? it.t0 : it.t1;
      const d = Math.abs(xOf(s, t) - x);
      if (d <= 5 && (!best || d < best.d)) best = { index: it.ep.index, edge, t, d };
    }
  }
  return best && { index: best.index, edge: best.edge, t: best.t };
}

/** Laute Stelle in einer Zwischenzeit unter dem Zeiger (± 6 px): daraus wird auf Klick eine Mini-Episode. */
export function loudAt(items: Item[], s: Scale, x: number, y: number): number | null {
  if (y < EPISODE_ROW.top || y > EPISODE_ROW.bottom) return null;
  for (const it of items) {
    if (it.type !== "gap") continue;
    for (const t of it.gap.loudAtMs) if (Math.abs(xOf(s, t) - x) <= 6) return t;
  }
  return null;
}

/** Mitschrift je Quelle, sortiert, nur Zeilen mit Text. */
export function groupTranscript(lines: TranscriptRow[]): Map<string, TranscriptRow[]> {
  const map = new Map<string, TranscriptRow[]>();
  for (const l of lines) {
    if (!l.text.trim()) continue;
    const list = map.get(l.sourceId) ?? [];
    list.push(l);
    map.set(l.sourceId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.atMs - b.atMs);
  return map;
}

/** Text eines Tagebucheintrags für die Vorschau: Kurzfassung, sonst erste Zeile des Volltexts. */
export function diaryPreview(e: DiaryEntryRow): string {
  const t = e.shortText.trim() || e.fullText.trim();
  return t.split(/\r?\n/)[0]!.trim();
}

/** Letzte Zeile der Mitschrift, die an oder vor dieser Stelle beginnt. */
export function lineAt(lines: TranscriptRow[] | undefined, atMs: number): TranscriptRow | null {
  if (!lines?.length) return null;
  let found: TranscriptRow | null = null;
  for (const l of lines) {
    if (l.atMs > atMs) break;
    found = l;
  }
  return found;
}

/** Text auf eine Breite kürzen, mit „…“. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}…` : "";
}

export function draw(ctx: CanvasRenderingContext2D, p: Palette, st: DrawState): void {
  const { scale: s, width: W, height: H } = st;
  const x = (t: number) => xOf(s, t);
  const kc = (kind: string) => p.kinds[kind] ?? p.kinds.other!;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = p.panel;
  ctx.fillRect(0, 0, W, H);

  // Lineal
  ctx.fillStyle = p.panel2;
  ctx.fillRect(0, 0, W, RULER_H);
  const step = tickStep(s.pxPerMin);
  const tEnd = tOf(s, W);
  ctx.font = `11px ${p.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (let t = Math.ceil(s.start / step) * step; t <= tEnd; t += step) {
    const xx = Math.round(x(t)) + 0.5;
    ctx.strokeStyle = p.line;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(xx, RULER_H);
    ctx.lineTo(xx, H);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.line2;
    ctx.beginPath();
    ctx.moveTo(xx, RULER_H - 5);
    ctx.lineTo(xx, RULER_H);
    ctx.stroke();
    ctx.fillStyle = p.muted;
    ctx.fillText(hm(t), xx, RULER_H - 9);
  }
  // Zeilentrenner
  ctx.strokeStyle = p.line;
  for (const y of [RULER_H, RULER_H + EPISODE_H, ...st.tracks.map((_, i) => trackTop(i + 1))]) {
    ctx.beginPath();
    ctx.moveTo(0, y - 0.5);
    ctx.lineTo(W, y - 0.5);
    ctx.stroke();
  }

  const visible = (it: Item) => x(it.t1) >= -20 && x(it.t0) <= W + 20;
  // Wo das nächste Element derselben Spur beginnt: Beschriftungen neben Clips dürfen nicht hineinragen.
  const nextStart = new Map<Item, number>();
  const byTrack = new Map<number, Item[]>();
  for (const it of st.items) {
    if (it.type === "episode" || it.type === "gap") continue;
    byTrack.set(it.track, [...(byTrack.get(it.track) ?? []), it]);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.t0 - b.t0);
    list.forEach((it, i) => {
      const next = list.slice(i + 1).find((n) => n.t0 > it.t1);
      if (next) nextStart.set(it, x(next.t0) - (next.type === "point" ? 10 : 0));
    });
  }
  const gapPattern = hatch(ctx, p.sunken, null);

  for (const it of st.items) {
    if (!visible(it)) continue;
    const x0 = x(it.t0);
    const w = Math.max(2, x(it.t1) - x0);
    ctx.save();
    if (it.type === "gap") {
      const y = RULER_H + 9;
      roundRect(ctx, x0, y, w, 22, 5);
      ctx.fillStyle = gapPattern ?? p.sunken;
      ctx.fill();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = p.line2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = p.warn;
      for (const t of it.gap.loudAtMs) ctx.fillRect(Math.round(x(t)) - 1, y + 3, 3, 16);
      if (it.gap.loudAtMs.length && w > 60) {
        ctx.fillStyle = p.warn;
        ctx.font = `500 11px ${p.sans}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${it.gap.loudAtMs.length}× laut`, x0 + w / 2, y + 11);
      }
    } else if (it.type === "episode") {
      const y = RULER_H + 9;
      const ww = Math.max(24, w);
      roundRect(ctx, x0 + 0.5, y + 0.5, ww - 1, 21, 5);
      ctx.fillStyle = p.panel;
      ctx.fill();
      ctx.fillStyle = alpha(p.accent, hovEp(st, it) ? 0.22 : 0.12);
      ctx.fill();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = p.accent;
      ctx.font = `600 11px ${p.sans}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`E${it.ep.index}`, x0 + 6, y + 11);
    } else {
      const top = trackTop(it.track);
      const r = it.row;
      const k = kc(r.kind === "note" || r.kind === "gps" ? "other" : r.kind);
      const on = st.selected === r.id;
      const hov = st.hover !== null && "row" in st.hover && st.hover.row.id === r.id;
      if (it.type === "clip") {
        const y = top + BAR_Y;
        const w = Math.max(MIN_CLIP_W, x(it.t1) - x0);
        roundRect(ctx, x0, y, w, BAR_H, 4);
        ctx.fillStyle = p.panel;
        ctx.fill();
        ctx.globalAlpha = hov ? 0.3 : 0.22;
        ctx.fillStyle = k;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.clip();
        const env = r.startMs !== null ? st.envelopes?.get(r.id) : undefined;
        if (env) waveform(ctx, env, r.startMs!, x, x0, w, y, BAR_H, alpha(k, 0.45), W);
        const idle = hatch(ctx, alpha(k, 0.3), p.panel);
        for (const i of r.idle) {
          ctx.fillStyle = idle ?? p.sunken;
          ctx.fillRect(x(i.startMs), y, Math.max(1, x(i.endMs) - x(i.startMs)), BAR_H);
        }
        ctx.fillStyle = k;
        ctx.fillRect(x0, y, 3, BAR_H);
        ctx.fillStyle = p.warn;
        for (const t of r.loudAtMs) ctx.fillRect(x(t) - 1, y + 3, 2, BAR_H - 6);
        const lines = r.startMs !== null ? st.transcripts.get(r.id) : undefined;
        const withText = !!lines?.length && w >= 40;
        if (withText) transcriptPreview(ctx, p, lines!, r.startMs!, x, x0, w, y, k, W);
        ctx.restore();
        clipLabel(ctx, p, r.label, r.fileName, x0, w, y, nextStart.get(it) ?? W, withText);
        outline(ctx, p, r.status, on, () => roundRect(ctx, x0, y, w, BAR_H, 4));
      } else if (it.type === "diary") {
        const y = top + BAR_Y;
        const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        grad.addColorStop(0, alpha(k, 0.06));
        grad.addColorStop(1, alpha(k, hov ? 0.38 : 0.28));
        roundRect(ctx, x0, y, w, BAR_H, [4, 0, 0, 4]);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.fillStyle = k;
        ctx.fillRect(x0 + w - 3, y, 3, BAR_H);
        outline(ctx, p, r.status, on, () => roundRect(ctx, x0, y, w, BAR_H, [4, 0, 0, 4]));
      } else {
        const cy = top + TRACK_H / 2;
        ctx.translate(x0, cy);
        ctx.rotate(Math.PI / 4);
        const sz = hov ? 15 : 13;
        roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 3);
        ctx.lineWidth = 4;
        ctx.strokeStyle = p.panel;
        ctx.stroke();
        ctx.fillStyle = k;
        ctx.fill();
        ctx.lineWidth = 1;
        const ring = sz + 6;
        outline(ctx, p, r.status, on, () => roundRect(ctx, -ring / 2, -ring / 2, ring, ring, 4), true);
      }
    }
    ctx.restore();
  }

  diaryTexts(ctx, p, st, x);

  if (st.playheadMs !== null) {
    const px = Math.round(x(st.playheadMs)) + 0.5;
    if (px >= 0 && px <= W) {
      ctx.save();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, RULER_H - 13);
      ctx.lineTo(px, H);
      ctx.stroke();
      // Der Abspielkopf als Feldmarker, wie im App-Symbol: Fahne an der Mastspitze.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(px, RULER_H - 14);
      ctx.lineTo(px + 9, RULER_H - 11);
      ctx.lineTo(px, RULER_H - 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Vorschau beim Ziehen einer Episodengrenze: gestrichelte Linie mit Uhrzeit.
  if (st.dragEdge) {
    const px = Math.round(x(st.dragEdge.t)) + 0.5;
    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, RULER_H);
    ctx.lineTo(px, H);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = clock(st.dragEdge.t);
    ctx.font = `600 11px ${p.mono}`;
    const tw = ctx.measureText(label).width + 8;
    const lx = Math.min(Math.max(2, px - tw / 2), W - tw - 2);
    ctx.fillStyle = p.accent;
    roundRect(ctx, lx, 2, tw, 16, 4);
    ctx.fill();
    ctx.fillStyle = p.panel;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, lx + tw / 2, 10);
    ctx.restore();
  }
}

/**
 * Beschriftung der Tagebuchbalken, nach allen Balken gezeichnet, damit überlappende Bezugszeiträume
 * den Text nicht verdecken. Jeder Eintrag bekommt den Platz seit der Notierzeit des vorigen Eintrags
 * derselben Spur: Nummer rechts an der Notierzeit, davor so viel Text, wie hineinpasst.
 */
function diaryTexts(ctx: CanvasRenderingContext2D, p: Palette, st: DrawState, x: (t: number) => number) {
  const diary = st.items.filter((it): it is Extract<Item, { type: "diary" }> => it.type === "diary");
  const byTrack = new Map<number, typeof diary>();
  for (const it of diary) byTrack.set(it.track, [...(byTrack.get(it.track) ?? []), it]);
  ctx.save();
  ctx.textBaseline = "middle";
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.t1 - b.t1);
    list.forEach((it, i) => {
      const x0 = x(it.t0);
      const x1 = Math.max(x0 + 2, x(it.t1));
      if (x1 < -20 || x0 > st.width + 20) return;
      const left = Math.max(x0, i > 0 ? x(list[i - 1]!.t1) : -Infinity) + 8;
      const right = x1 - 9;
      const cy = trackTop(it.track) + BAR_Y + BAR_H / 2;
      const label = `${it.row.label} · ${it.entry.number}`;
      ctx.font = `600 11px ${p.sans}`;
      const lw = ctx.measureText(label).width;
      if (right - left < lw) return;
      ctx.fillStyle = p.ink;
      ctx.textAlign = "right";
      ctx.fillText(label, right, cy);
      const text = diaryPreview(it.entry);
      if (!text) return;
      ctx.font = `11px ${p.sans}`;
      // Bei breiten Balken (gezoomt) steht der Text links am Platz, sonst direkt vor der Nummer.
      const fitted = fitText(ctx, text, right - lw - 10 - left);
      if (fitted.length < 4) return;
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = "left";
      ctx.fillText(fitted, left, cy);
      ctx.globalAlpha = 1;
    });
  }
  ctx.restore();
}

/**
 * Mitschrift im Clip: kleine Striche an jeder Zeile, und wo Platz bis zur nächsten Zeile ist,
 * der Anfang des Texts. Der Clip ist schon als Zeichenbereich gesetzt.
 */
function transcriptPreview(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  lines: TranscriptRow[],
  startMs: number,
  x: (t: number) => number,
  x0: number,
  w: number,
  y: number,
  color: string,
  W: number,
) {
  const ty = y + BAR_H - 9;
  ctx.font = `10.5px ${p.sans}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const end = Math.min(x0 + w, W + 20);
  for (let i = 0; i < lines.length; i++) {
    const lx = x(startMs + lines[i]!.atMs);
    if (lx > end) break;
    const nx = i + 1 < lines.length ? Math.min(end, x(startMs + lines[i + 1]!.atMs)) : end;
    if (nx < -20) continue;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(lx), y + BAR_H - 15, 1.5, 12);
    // Ist der Zeilenanfang links aus dem Bild gerollt, bleibt der Text am Rand lesbar.
    const tx = Math.max(lx + 5, 4);
    const room = nx - tx - 5;
    if (room < 28) continue;
    const l = lines[i]!;
    const fitted = fitText(ctx, l.speaker ? `${l.speaker}: ${l.text}` : l.text, room);
    if (fitted.length < 3) continue;
    ctx.fillStyle = p.ink;
    ctx.globalAlpha = 0.8;
    ctx.fillText(fitted, tx, ty);
    ctx.globalAlpha = 1;
  }
}

/** Hüllkurve als gespiegelte Wellenform in der Mitte des Clips, je Bildschirmspalte der lauteste Wert. */
function waveform(
  ctx: CanvasRenderingContext2D,
  env: Envelope,
  startMs: number,
  x: (t: number) => number,
  x0: number,
  w: number,
  y: number,
  h: number,
  color: string,
  W: number,
) {
  const from = Math.max(0, Math.floor(x0));
  const to = Math.min(W, Math.ceil(x0 + w));
  if (to <= from) return;
  const msPerPx = x(startMs + 60_000) - x(startMs) > 0 ? 60_000 / (x(startMs + 60_000) - x(startMs)) : 0;
  if (!msPerPx) return;
  const mid = y + h / 2;
  const maxH = h / 2 - 3;
  ctx.fillStyle = color;
  for (let px = from; px < to; px++) {
    const t0 = (px - x0) * msPerPx;
    const i0 = Math.max(0, Math.floor((t0 / 1000) * env.rate));
    const i1 = Math.min(env.data.length, Math.max(i0 + 1, Math.ceil(((t0 + msPerPx) / 1000) * env.rate)));
    let m = 0;
    for (let i = i0; i < i1; i++) if (env.data[i]! > m) m = env.data[i]!;
    // Leises Rauschen (unterste 40 %) ausblenden, damit Sprache heraussticht.
    const v = Math.max(0, (m / 250 - 0.4) / 0.6);
    if (v <= 0) continue;
    const hh = Math.max(1, v * maxH);
    ctx.fillRect(px, mid - hh, 1, hh * 2);
  }
}

function hovEp(st: DrawState, it: Item): boolean {
  return st.hover?.type === "episode" && it.type === "episode" && st.hover.ep.index === it.ep.index;
}

/**
 * Beschriftung eines Clips: passt sie hinein, steht sie im Clip; sonst die Kurzbezeichnung daneben,
 * aber nur bis zum nächsten Element der Spur. Nie zwei Texte übereinander.
 */
function clipLabel(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  label: string,
  fileName: string,
  x0: number,
  w: number,
  y: number,
  limit: number,
  /** Unten im Clip steht Mitschrift: Beschriftung nach oben rücken. */
  top = false,
) {
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `600 11px ${p.sans}`;
  const lw = ctx.measureText(label).width;
  ctx.font = `11px ${p.sans}`;
  const fw = ctx.measureText(fileName).width;
  const cy = top ? y + 9 : y + BAR_H / 2;
  if (w >= lw + 16) {
    roundRect(ctx, x0, y, w, BAR_H, 4);
    ctx.clip();
    ctx.fillStyle = p.ink;
    ctx.font = `600 11px ${p.sans}`;
    ctx.fillText(label, x0 + 8, cy);
    if (w >= lw + fw + 22) {
      ctx.font = `11px ${p.sans}`;
      ctx.fillStyle = p.muted;
      ctx.fillText(fileName, x0 + 13 + lw, cy);
    }
  } else if (x0 + w + 6 + lw <= limit - 4) {
    ctx.fillStyle = p.muted;
    ctx.font = `600 11px ${p.sans}`;
    ctx.fillText(label, x0 + w + 6, cy);
  }
  ctx.restore();
}

function outline(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  status: string,
  on: boolean,
  path: () => void,
  solid = false,
) {
  if (on) {
    ctx.save();
    path();
    ctx.setLineDash([]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.accent;
    ctx.shadowColor = p.accent;
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
  } else if (status === "check") {
    ctx.save();
    path();
    ctx.setLineDash(solid ? [] : [4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = p.warn;
    ctx.stroke();
    ctx.restore();
  }
}
