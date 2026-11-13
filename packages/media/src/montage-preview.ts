/**
 * Montage zum Ansehen in der App: derselbe Ablauf wie im Montagevideo, aber ohne zu rechnen.
 * Die Oberfläche spielt die Originale an den richtigen Stellen ab und zeichnet die Einblendungen selbst.
 */
import type { ImageRef, Scaffold, ScaffoldEntry } from "./scaffold.ts";
import { canRenderStill } from "./stills.ts";
import { FPS, overlayTimeline, planPieces, type OverlayFrame, type OverlayTimeline } from "./montage-video.ts";

const FRAME_MS = 1000 / FPS;

export interface PreviewPiece {
  /** Grenzen in ms ab Montagebeginn. */
  fromMs: number;
  toMs: number;
  kind: OverlayFrame["kind"];
  clock0: number;
  title: string;
  body: string;
  sources: string[];
  video: { sourceId: string; fromMs: number } | null;
  audio: { sourceId: string; fromMs: number } | null;
  still: { image: ImageRef; caption: string } | null;
}

export interface MontagePreview {
  durationMs: number;
  timeline: OverlayTimeline;
  pieces: PreviewPiece[];
}

export function montagePreview(sc: Scaffold): MontagePreview {
  const sources = new Map(sc.input.sources.map((s) => [s.id, s]));
  // Wie beim Export: das erste Bild eines Eintrags, das sich als Standbild zeigen lässt.
  const images = new Map<string, ImageRef>();
  const stillFiles = new Map<ScaffoldEntry, string | null>();
  sc.entries.forEach((e, i) => {
    const ref = e.images.find((r) => {
      const s = sources.get(r.sourceId);
      return s && canRenderStill(s);
    });
    if (!ref) return;
    images.set(String(i), ref);
    stillFiles.set(e, String(i));
  });
  const pieces = planPieces(sc, stillFiles).map((p): PreviewPiece => ({
    fromMs: p.f0 * FRAME_MS,
    toMs: p.f1 * FRAME_MS,
    kind: p.kind,
    clock0: p.clock0,
    title: p.title,
    body: p.body,
    sources: p.sources,
    video: p.video && { sourceId: p.video.source.id, fromMs: p.video.fromMs },
    audio: p.audio && { sourceId: p.audio.source.id, fromMs: p.audio.fromMs },
    still: p.still && { image: images.get(p.still.file)!, caption: p.still.caption },
  }));
  return { durationMs: pieces.at(-1)?.toMs ?? 0, timeline: overlayTimeline(sc), pieces };
}
