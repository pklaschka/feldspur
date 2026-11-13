/**
 * Einblendungen fürs Montagevideo: Uhrzeit-Leiste oben, Zeitleisten unten, Texte der Tafeln.
 * Gezeichnet mit Canvas in der Oberfläche, weil die LGPL-Fassung von ffmpeg keine Schrift setzen kann.
 * Das Hauptfeld bleibt durchsichtig, darunter liegt das Video oder Standbild.
 */
import type { OverlayFrame, OverlayTimeline } from "@feldspur/media";
import { formatClock, formatDuration } from "@feldspur/core/time";

const W = 1280;
const H = 720;
const TOP = 52;
const MAIN = { x: 0, y: 52, w: 944, h: 531 };
const SIDE = { x: 944, y: 52, w: W - 944, h: 531 };
const BOTTOM = { y: 583, h: H - 583 };
const ZOOM_MS = 5 * 60_000;

const C = {
  bar: "rgba(16,23,27,0.94)",
  panel: "#16201f",
  ink: "#e9eef0",
  muted: "#9aabb1",
  line: "#2c3a40",
  accent: "#8fb0ff",
  play: "#ff6b6b",
  video: "#7fa2ff",
  audio: "#4cc6a2",
  photo: "#b98be6",
  diary: "#e09566",
  other: "#9aabb1",
  episode: "rgba(255,227,106,0.22)",
};
const KIND_COLOR: Record<string, string> = {
  video: C.video,
  audio: C.audio,
  photo: C.photo,
  diary: C.diary,
};
const FONT = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number): string[] {
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

function truncate(ctx: OffscreenCanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Eine Zeitleiste: Episoden als Band, Aufnahmen als Balken je Spur, Fotos/Tagebuch als Striche. */
function drawTimeline(
  ctx: OffscreenCanvasRenderingContext2D,
  tl: OverlayTimeline,
  box: { x: number; y: number; w: number; h: number },
  from: number,
  to: number,
  now: number,
  labels: boolean,
) {
  const x = (t: number) => box.x + ((t - from) / (to - from)) * box.w;
  const clip = (t: number) => Math.max(box.x, Math.min(box.x + box.w, x(t)));
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.fillStyle = C.panel;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  for (const e of tl.episodes) {
    if (e.toMs < from || e.fromMs > to) continue;
    ctx.fillStyle = C.episode;
    ctx.fillRect(clip(e.fromMs), box.y, clip(e.toMs) - clip(e.fromMs), box.h);
  }
  const rows = tl.tracks.length + 1;
  const rowH = (box.h - 4) / rows;
  tl.tracks.forEach((t, i) => {
    const y = box.y + 2 + i * rowH;
    ctx.fillStyle = KIND_COLOR[t.kind] ?? C.other;
    for (const s of t.spans) {
      if (s.toMs < from || s.fromMs > to) continue;
      const x0 = clip(s.fromMs);
      const x1 = Math.max(x0 + 2, clip(s.toMs));
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x0, y + rowH * 0.2, x1 - x0, rowH * 0.6);
      ctx.globalAlpha = 1;
      if (labels && x1 - x0 > 40) {
        ctx.fillStyle = "#0b1012";
        ctx.font = `600 ${Math.min(11, rowH * 0.5)}px ${MONO}`;
        ctx.textBaseline = "middle";
        ctx.fillText(truncate(ctx, s.label, x1 - x0 - 6), x0 + 3, y + rowH / 2);
        ctx.fillStyle = KIND_COLOR[t.kind] ?? C.other;
      }
    }
  });
  const py = box.y + 2 + tl.tracks.length * rowH;
  for (const p of tl.points) {
    if (p.atMs < from || p.atMs > to) continue;
    ctx.fillStyle = KIND_COLOR[p.kind] ?? C.other;
    ctx.fillRect(x(p.atMs) - 1, py + rowH * 0.15, 2, rowH * 0.7);
  }
  // Abspielkopf.
  ctx.fillStyle = C.play;
  ctx.fillRect(x(now) - 1, box.y, 2, box.h);
  ctx.restore();
  // Achse.
  ctx.fillStyle = C.muted;
  ctx.font = `11px ${MONO}`;
  ctx.textBaseline = "top";
  const span = to - from;
  const step = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000].find((s) => span / s <= 8) ?? 7_200_000;
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    const tx = x(t);
    ctx.fillRect(tx, box.y + box.h, 1, 3);
    const label = formatClock(t).slice(0, 5);
    ctx.fillText(label, Math.min(box.x + box.w - 34, Math.max(box.x, tx - 16)), box.y + box.h + 4);
  }
}

export function drawOverlay(ctx: OffscreenCanvasRenderingContext2D, tl: OverlayTimeline, f: OverlayFrame): void {
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  // Oben: Uhrzeit, Abschnitt, laufende Quellen, Einsatz.
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = C.ink;
  ctx.font = `600 28px ${MONO}`;
  const clock = f.kind === "card" ? `≈ ${formatClock(f.clockMs).slice(0, 5)}` : formatClock(f.clockMs);
  ctx.fillText(clock, 16, TOP / 2 + 1);
  let x = 16 + ctx.measureText(clock).width + 18;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = f.kind === "episode" ? "#ffe36a" : C.muted;
  ctx.fillText(f.title, x, TOP / 2);
  x += ctx.measureText(f.title).width + 14;
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = C.muted;
  const right = `${tl.title} · ${tl.date.split("-").reverse().join(".")}`;
  const rightW = ctx.measureText(right).width;
  ctx.fillText(truncate(ctx, f.sources.join(" · "), W - x - rightW - 40), x, TOP / 2);
  ctx.fillText(right, W - 16 - rightW, TOP / 2);

  // Hauptfeld: bei Episoden ohne Video und bei leeren Tafeln ein Hinweis, bei Standbildern eine Unterschrift.
  if (f.kind === "episode" && !f.hasVideo) {
    ctx.fillStyle = C.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(
      f.sources.length ? `Nur Ton: ${f.sources[0]}` : "Keine Aufnahme",
      MAIN.x + MAIN.w / 2,
      MAIN.y + MAIN.h / 2,
    );
    ctx.textAlign = "left";
  }
  if (f.kind === "card") {
    ctx.fillStyle = C.ink;
    ctx.textAlign = "center";
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(f.title, MAIN.x + MAIN.w / 2, MAIN.y + MAIN.h / 2 - 50);
    ctx.font = `20px ${FONT}`;
    ctx.fillStyle = C.muted;
    wrap(ctx, f.body, MAIN.w - 120).forEach((l, i) =>
      ctx.fillText(l, MAIN.x + MAIN.w / 2, MAIN.y + MAIN.h / 2 + i * 30),
    );
    ctx.textAlign = "left";
  }
  if (f.kind === "item") {
    const lines = wrap(((ctx.font = `16px ${FONT}`), ctx), `${f.title} · ${f.body}`, MAIN.w - 40).slice(0, 3);
    const h = lines.length * 22 + 16;
    ctx.fillStyle = C.bar;
    ctx.fillRect(MAIN.x, MAIN.y + MAIN.h - h, MAIN.w, h);
    ctx.fillStyle = C.ink;
    lines.forEach((l, i) => ctx.fillText(l, MAIN.x + 20, MAIN.y + MAIN.h - h + 19 + i * 22));
  }

  // Seitenspalte: Unterschrift zum Standbild (das Bild selbst setzt ffmpeg darunter).
  ctx.fillStyle = C.bar;
  ctx.fillRect(SIDE.x, SIDE.y + SIDE.h - 32, SIDE.w, 32);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = f.hasStill && f.kind === "episode" ? C.ink : C.muted;
  ctx.fillText(
    truncate(ctx, f.kind === "episode" ? f.caption || "Foto/Tagebuch erscheinen hier" : "", SIDE.w - 20),
    SIDE.x + 10,
    SIDE.y + SIDE.h - 16,
  );
  ctx.fillStyle = C.line;
  ctx.fillRect(SIDE.x, SIDE.y, 1, SIDE.h);

  // Unten: ganzer Einsatz und mitlaufender Ausschnitt (±2,5 Min.).
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, BOTTOM.y, W, BOTTOM.h);
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textBaseline = "middle";
  ctx.fillText("Ganzer Einsatz", 12, BOTTOM.y + 12);
  ctx.fillText("±2,5 Min.", 12, BOTTOM.y + 68);
  ctx.fillText(`Video ${formatDuration(f.montageMs)}`, W - 90, BOTTOM.y + 12);
  const pad = (tl.toMs - tl.fromMs) * 0.01 || 60_000;
  drawTimeline(
    ctx,
    tl,
    { x: 100, y: BOTTOM.y + 6, w: W - 200, h: 34 },
    tl.fromMs - pad,
    tl.toMs + pad,
    f.clockMs,
    false,
  );
  drawTimeline(
    ctx,
    tl,
    { x: 100, y: BOTTOM.y + 62, w: W - 116, h: 52 },
    f.clockMs - ZOOM_MS / 2,
    f.clockMs + ZOOM_MS / 2,
    f.clockMs,
    true,
  );
}

let canvas: OffscreenCanvas | null = null;
export async function renderOverlays(tl: OverlayTimeline, frames: OverlayFrame[]): Promise<Uint8Array[]> {
  canvas ??= new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const out: Uint8Array[] = [];
  for (const f of frames) {
    drawOverlay(ctx, tl, f);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}
