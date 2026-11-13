/**
 * Einblendungen fürs Montagevideo, nur zum Zuordnen: oben Uhrzeit, Abschnitt, Einsatz und
 * Montage-ID; je Videofeld Kurzzeichen, Datei und Stelle im Original; unten die laufenden
 * Tonquellen. Gezeichnet mit Canvas in der Oberfläche, weil die LGPL-Fassung von ffmpeg keine
 * Schrift setzen kann. Das Hauptfeld bleibt durchsichtig, darunter liegen die Videos.
 */
import type { OverlayFrame, OverlayHeader, OverlayMedia } from "@feldspur/media";
import { formatClock } from "@feldspur/core/time";
import { H, LAYOUT, videoTiles, W } from "@feldspur/media/layout";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const TOP = LAYOUT.top.h;
const MAIN = LAYOUT.main;
const BOTTOM = LAYOUT.bottom;

const C = {
  bar: "rgba(16,23,27,0.94)",
  ink: "#e9eef0",
  muted: "#9aabb1",
  line: "#2c3a40",
  episode: "#ffe36a",
  audio: "#4cc6a2",
};
const FONT = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

function wrap(ctx: Ctx2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function truncate(ctx: Ctx2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Stelle in einer Datei, z. B. „0:12:34“. */
const pos = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};
const mediaText = (m: OverlayMedia) => `${m.label} · ${m.fileName} · ${pos(m.atMs)}`;

export function drawOverlay(ctx: Ctx2D, head: OverlayHeader, f: OverlayFrame): void {
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  // Oben: Uhrzeit, Abschnitt, rechts Einsatz und Montage-ID.
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = C.ink;
  ctx.font = `600 28px ${MONO}`;
  const clock = f.kind === "card" ? `≈ ${formatClock(f.clockMs).slice(0, 5)}` : formatClock(f.clockMs);
  ctx.fillText(clock, 16, TOP / 2 + 1);
  let x = 16 + ctx.measureText(clock).width + 18;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = f.kind === "episode" ? C.episode : C.muted;
  ctx.fillText(f.title, x, TOP / 2);
  x += ctx.measureText(f.title).width + 14;
  ctx.font = `14px ${FONT}`;
  const date = head.date.split("-").reverse().join(".");
  const right = `${head.title} · ${date} · ${head.modeLabel}`;
  ctx.font = `600 14px ${MONO}`;
  const idW = ctx.measureText(head.montageId).width;
  ctx.fillStyle = C.ink;
  ctx.fillText(head.montageId, W - 16 - idW, TOP / 2);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = C.muted;
  const rightText = truncate(ctx, right, W - x - idW - 48);
  ctx.fillText(rightText, W - 16 - idW - 14 - ctx.measureText(rightText).width, TOP / 2);

  // Videofelder: Herkunft unten links in jedem Feld.
  const tiles = videoTiles(f.tiles.length);
  ctx.font = `600 14px ${FONT}`;
  f.tiles.forEach((m, i) => {
    const b = tiles[i]!;
    const text = truncate(ctx, mediaText(m), b.w - 28);
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = C.bar;
    ctx.fillRect(b.x + 6, b.y + b.h - 34, w, 26);
    ctx.fillStyle = C.ink;
    ctx.fillText(text, b.x + 14, b.y + b.h - 21);
  });

  // Ohne Video: Hinweis bzw. Text der Tafel.
  if (!f.tiles.length) {
    ctx.textAlign = "center";
    const cx = MAIN.x + MAIN.w / 2;
    const cy = MAIN.y + MAIN.h / 2;
    if (f.kind === "card") {
      ctx.fillStyle = C.ink;
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(f.title, cx, cy - 50);
      ctx.font = `20px ${FONT}`;
      ctx.fillStyle = C.muted;
      wrap(ctx, f.body, MAIN.w - 240)
        .slice(0, 6)
        .forEach((l, i) => ctx.fillText(l, cx, cy + i * 30));
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = `500 22px ${FONT}`;
      ctx.fillText(f.sounds.length ? "Nur Ton" : "Keine Aufnahme", cx, cy);
    }
    ctx.textAlign = "left";
  }

  // Unten: laufende Tonquellen (ohne eigenes Bild).
  ctx.fillStyle = C.bar;
  ctx.fillRect(BOTTOM.x, BOTTOM.y, BOTTOM.w, BOTTOM.h);
  ctx.fillStyle = C.line;
  ctx.fillRect(BOTTOM.x, BOTTOM.y, BOTTOM.w, 1);
  ctx.font = `13px ${FONT}`;
  const y = BOTTOM.y + BOTTOM.h / 2;
  if (!f.sounds.length) {
    ctx.fillStyle = C.muted;
    ctx.fillText(f.tiles.length ? "Ton aus den Videos" : "Kein Ton", 16, y);
    return;
  }
  ctx.fillStyle = C.audio;
  ctx.fillText("Ton", 16, y);
  ctx.fillStyle = C.ink;
  ctx.fillText(truncate(ctx, f.sounds.map(mediaText).join("   ·   "), W - 70), 52, y);
}

let canvas: OffscreenCanvas | null = null;
export async function renderOverlays(head: OverlayHeader, frames: OverlayFrame[]): Promise<Uint8Array[]> {
  canvas ??= new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const out: Uint8Array[] = [];
  for (const f of frames) {
    drawOverlay(ctx, head, f);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}
