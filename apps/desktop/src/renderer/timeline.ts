/**
 * Zeichnen der Zeitachse auf Canvas. Reine Funktionen ohne React:
 * Layout (Zeilen, Elemente mit Pixelrechtecken), Treffersuche und Zeichnen.
 */
import type { DeviceRow, EpisodeRow, GapRow, SourceRow } from "../shared/api.ts";
import { hm } from "./format.ts";

export const MIN = 60_000;
export const RULER_H = 30;
export const EPISODE_H = 40;
export const TRACK_H = 46;

export interface Track {
  device: DeviceRow | null;
  rows: SourceRow[];
}

export type Item =
  | { type: "clip" | "point" | "diary"; row: SourceRow; track: number; t0: number; t1: number }
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

export function buildItems(tracks: Track[], episodes: EpisodeRow[] | null, gaps: GapRow[]): Item[] {
  const items: Item[] = [];
  for (const g of gaps) items.push({ type: "gap", gap: g, t0: g.startMs, t1: g.endMs });
  for (const e of episodes ?? []) items.push({ type: "episode", ep: e, t0: e.startMs, t1: e.endMs });
  tracks.forEach((tr, track) => {
    for (const r of tr.rows) {
      if (r.kind === "diary" && r.diaryWindow) {
        items.push({ type: "diary", row: r, track, t0: r.diaryWindow.fromMs, t1: r.diaryWindow.toMs });
      } else if (r.startMs !== null) {
        const clip = r.endMs !== null && r.endMs > r.startMs;
        items.push({ type: clip ? "clip" : "point", row: r, track, t0: r.startMs, t1: clip ? r.endMs! : r.startMs });
      }
    }
  });
  return items;
}

/** Element unter dem Zeiger; Punkte haben einen Fangradius. */
export function hitTest(items: Item[], s: Scale, x: number, y: number): Item | null {
  let best: Item | null = null;
  for (const it of items) {
    const x0 = xOf(s, it.t0);
    const x1 = Math.max(x0 + 2, xOf(s, it.t1));
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

function hatch(ctx: CanvasRenderingContext2D, color: string, bg: string | null): CanvasPattern | null {
  const c = new OffscreenCanvas(7, 7);
  const g = c.getContext("2d")!;
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
  return ctx.createPattern(c, "repeat");
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
      roundRect(ctx, x0, y, ww, 22, 5);
      ctx.fillStyle = p.ink;
      ctx.fill();
      ctx.fillStyle = p.panel;
      ctx.font = `600 11px ${p.sans}`;
      ctx.textBaseline = "middle";
      ctx.fillText(`E${it.ep.index}`, x0 + 6, y + 11);
    } else {
      const top = trackTop(it.track);
      const r = it.row;
      const k = kc(r.kind === "note" || r.kind === "gps" ? "other" : r.kind);
      const on = st.selected === r.id;
      const hov = st.hover !== null && "row" in st.hover && st.hover.row.id === r.id;
      if (it.type === "clip") {
        const y = top + 9;
        roundRect(ctx, x0, y, w, 28, 4);
        ctx.fillStyle = p.panel;
        ctx.fill();
        ctx.globalAlpha = hov ? 0.3 : 0.22;
        ctx.fillStyle = k;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.clip();
        const idle = hatch(ctx, alpha(k, 0.3), p.panel);
        for (const i of r.idle) {
          ctx.fillStyle = idle ?? p.sunken;
          ctx.fillRect(x(i.startMs), y, Math.max(1, x(i.endMs) - x(i.startMs)), 28);
        }
        ctx.fillStyle = k;
        ctx.fillRect(x0, y, 3, 28);
        ctx.fillStyle = p.warn;
        for (const t of r.loudAtMs) ctx.fillRect(x(t) - 1, y + 3, 2, 22);
        if (w > 30) {
          ctx.fillStyle = p.ink;
          ctx.textBaseline = "middle";
          ctx.font = `600 11px ${p.sans}`;
          const lw = ctx.measureText(r.label).width;
          ctx.fillText(r.label, x0 + 8, y + 14);
          ctx.font = `11px ${p.sans}`;
          ctx.fillText(r.fileName, x0 + 12 + lw, y + 14);
        }
        ctx.restore();
        outline(ctx, p, r.status, on, () => roundRect(ctx, x0, y, w, 28, 4));
      } else if (it.type === "diary") {
        const y = top + 9;
        const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        grad.addColorStop(0, alpha(k, 0.06));
        grad.addColorStop(1, alpha(k, hov ? 0.38 : 0.28));
        roundRect(ctx, x0, y, w, 28, [4, 0, 0, 4]);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.fillStyle = k;
        ctx.fillRect(x0 + w - 3, y, 3, 28);
        if (w > 30) {
          ctx.font = `600 11px ${p.sans}`;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(r.label, x0 + w - 9, y + 14);
        }
        outline(ctx, p, r.status, on, () => roundRect(ctx, x0, y, w, 28, [4, 0, 0, 4]));
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
        outline(ctx, p, r.status, on, () => roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 3));
      }
    }
    ctx.restore();
  }
}

function outline(ctx: CanvasRenderingContext2D, p: Palette, status: string, on: boolean, path: () => void) {
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
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = p.warn;
    ctx.stroke();
    ctx.restore();
  }
}
