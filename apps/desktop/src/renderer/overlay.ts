/**
 * Einblendungen fürs Montagevideo, nur zum Zuordnen: oben Uhrzeit, Abschnitt, Einsatz und
 * Montage-ID; je Videofeld Kurzzeichen, Datei und Stelle im Original; unten die laufenden
 * Tonquellen. Gezeichnet mit Canvas in der Oberfläche, weil die LGPL-Fassung von ffmpeg keine
 * Schrift setzen kann. Das Hauptfeld bleibt durchsichtig, darunter liegen die Videos.
 *
 * Zwei Wege führen hierher: Bei der Ausgabe fragt der Hauptprozess (`apps/desktop/src/main/export.ts`) über
 * `onOverlayRequest` an, `App.tsx` antwortet mit `renderOverlays` (PNG je Einblendung), und ffmpeg legt die Bilder
 * über das Video. Beim Ansehen in der App zeichnet `watch/player.ts` mit `drawOverlay` direkt auf seine Leinwand.
 * Maße und Felder kommen aus `packages/media/src/layout.ts` (`montageLayout`, je nach gewählter Auflösung, Issue #250),
 * damit beide Seiten dasselbe Raster nutzen.
 */
import type { OverlayFrame, OverlayHeader, OverlayMedia } from "@feldspur/media";
import { formatClock } from "@feldspur/core/time";
import { montageLayout, videoTiles, type MontageLayout } from "@feldspur/media/layout";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Farben und Schrift wie die App (Umbra der Seitenleiste, Papier, Ocker für Episoden, Moos für Ton).
const C = {
  bar: "rgba(28,20,14,0.94)",
  ink: "#f5ecdf",
  muted: "#c9b7a2",
  line: "#4a3427",
  episode: "#e8b95e",
  audio: "#a0c584",
};
const FONT = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

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

/**
 * Eine Einblendung auf eine Leinwand in Größe des Montagebilds (`layout.w` × `layout.h`) zeichnen: `head` für die ganze
 * Montage, `f` für den Moment. Schrift, Leisten und Abstände wachsen mit `layout.u`; bei 1280 × 720 ist er 1, und die
 * Zahlen unten sind die Pixel dort.
 */
export function drawOverlay(
  ctx: Ctx2D,
  head: OverlayHeader,
  f: OverlayFrame,
  layout: MontageLayout = montageLayout(),
): void {
  const { w: W, h: H, top, main: MAIN, bottom: BOTTOM, u } = layout;
  const TOP = top.h;
  /** Maß bei 1280 × 720 in Pixel dieses Formats. */
  const px = (n: number) => n * u;
  const font = (size: number, weight = "", family = FONT) => `${weight ? `${weight} ` : ""}${px(size)}px ${family}`;
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  // Oben: Uhrzeit, Abschnitt, rechts Einsatz und Montage-ID.
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, 0, W, TOP);
  ctx.fillStyle = C.ink;
  ctx.font = font(28, "600", MONO);
  const clock = f.kind === "card" ? `≈ ${formatClock(f.clockMs).slice(0, 5)}` : formatClock(f.clockMs);
  ctx.fillText(clock, px(16), TOP / 2 + px(1));
  let x = px(16) + ctx.measureText(clock).width + px(18);
  ctx.font = font(15, "600");
  ctx.fillStyle = f.kind === "episode" ? C.episode : C.muted;
  ctx.fillText(f.title, x, TOP / 2);
  x += ctx.measureText(f.title).width + px(14);
  const date = head.date.split("-").reverse().join(".");
  const right = `${head.title} · ${date} · ${head.modeLabel}`;
  // Die Montage-ID steht immer ganz, rechts in der Kopfzeile; der Text davor wird notfalls gekürzt.
  ctx.font = font(14, "600", MONO);
  const idW = ctx.measureText(head.montageId).width;
  ctx.fillStyle = C.ink;
  ctx.fillText(head.montageId, W - px(16) - idW, TOP / 2);
  ctx.font = font(14);
  ctx.fillStyle = C.muted;
  const rightText = truncate(ctx, right, W - x - idW - px(48));
  ctx.fillText(rightText, W - px(16) - idW - px(14) - ctx.measureText(rightText).width, TOP / 2);

  // Videofelder: Herkunft unten links in jedem Feld.
  const tiles = videoTiles(f.tiles.length, layout);
  ctx.font = font(14, "600");
  f.tiles.forEach((m, i) => {
    const b = tiles[i]!;
    const text = truncate(ctx, mediaText(m), b.w - px(28));
    const w = ctx.measureText(text).width + px(16);
    ctx.fillStyle = C.bar;
    ctx.fillRect(b.x + px(6), b.y + b.h - px(34), w, px(26));
    ctx.fillStyle = C.ink;
    ctx.fillText(text, b.x + px(14), b.y + b.h - px(21));
  });

  // Ohne Video: Hinweis bzw. Text der Tafel.
  if (!f.tiles.length) {
    ctx.textAlign = "center";
    const cx = MAIN.x + MAIN.w / 2;
    const cy = MAIN.y + MAIN.h / 2;
    if (f.kind === "card") {
      ctx.fillStyle = C.ink;
      ctx.font = font(30, "700");
      ctx.fillText(f.title, cx, cy - px(50));
      ctx.font = font(20);
      ctx.fillStyle = C.muted;
      // So viele Zeilen, wie unter dem Titel ins Hauptfeld passen (bei 1280 × 720 sechs).
      const room = Math.max(1, Math.min(6, Math.floor((MAIN.y + MAIN.h - cy - px(16)) / px(30)) + 1));
      wrap(ctx, f.body, MAIN.w - px(240))
        .slice(0, room)
        .forEach((l, i) => ctx.fillText(l, cx, cy + i * px(30)));
    } else {
      ctx.fillStyle = C.muted;
      ctx.font = font(22, "500");
      ctx.fillText(f.sounds.length ? "Nur Ton" : "Keine Aufnahme", cx, cy);
    }
    ctx.textAlign = "left";
  }

  // Unten: laufende Tonquellen (ohne eigenes Bild).
  ctx.fillStyle = C.bar;
  ctx.fillRect(BOTTOM.x, BOTTOM.y, BOTTOM.w, BOTTOM.h);
  ctx.fillStyle = C.line;
  ctx.fillRect(BOTTOM.x, BOTTOM.y, BOTTOM.w, Math.max(1, Math.round(px(1))));
  ctx.font = font(13);
  const y = BOTTOM.y + BOTTOM.h / 2;
  if (!f.sounds.length) {
    ctx.fillStyle = C.muted;
    ctx.fillText(f.tiles.length ? "Ton aus den Videos" : "Kein Ton", px(16), y);
    return;
  }
  ctx.fillStyle = C.audio;
  ctx.fillText("Ton", px(16), y);
  ctx.fillStyle = C.ink;
  ctx.fillText(truncate(ctx, f.sounds.map(mediaText).join("   ·   "), W - px(70)), px(52), y);
}

let canvas: OffscreenCanvas | null = null;
/** Einblendungen als PNG-Dateien (mit Durchsicht) im Format `format`, in der Reihenfolge von `frames`; für die Ausgabe. */
export async function renderOverlays(
  head: OverlayHeader,
  frames: OverlayFrame[],
  format: Parameters<typeof montageLayout>[0],
): Promise<Uint8Array[]> {
  const layout = montageLayout(format);
  if (!canvas || canvas.width !== layout.w || canvas.height !== layout.h)
    canvas = new OffscreenCanvas(layout.w, layout.h);
  const ctx = canvas.getContext("2d")!;
  const out: Uint8Array[] = [];
  for (const f of frames) {
    drawOverlay(ctx, head, f, layout);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}
