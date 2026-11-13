/**
 * Montage zum Ansehen in der App: derselbe Ablauf wie im Montagevideo, aber ohne zu rechnen.
 * Die Oberfläche spielt die Originale an den richtigen Stellen ab und zeichnet die Einblendungen selbst.
 */
import type { ImageRef, Scaffold, ScaffoldEntry } from "./scaffold.ts";
import { canRenderStill } from "./stills.ts";
import { FPS } from "./layout.ts";
import {
  overlayTimeline,
  planPieces,
  type MediaRef,
  type OverlayFrame,
  type OverlayTimeline,
} from "./montage-video.ts";

const FRAME_MS = 1000 / FPS;

export interface PreviewMedia {
  sourceId: string;
  fromMs: number;
  label: string;
  kind: "audio" | "video";
}

export interface PreviewPiece {
  /** Grenzen in ms ab Montagebeginn. */
  fromMs: number;
  toMs: number;
  kind: OverlayFrame["kind"];
  clock0: number;
  title: string;
  body: string;
  sources: string[];
  videos: PreviewMedia[];
  /** Hauptquelle zuerst. */
  audios: PreviewMedia[];
  still: { image: (ImageRef & { pdf: boolean }) | null; caption: string; text: string } | null;
}

export interface MontagePreview {
  durationMs: number;
  timeline: OverlayTimeline;
  pieces: PreviewPiece[];
}

const isPdf = (name: string) => /\.pdf$/i.test(name);
const media = (m: MediaRef): PreviewMedia => ({
  sourceId: m.source.id,
  fromMs: m.fromMs,
  label: m.label,
  kind: m.source.kind === "video" ? "video" : "audio",
});

export function montagePreview(sc: Scaffold): MontagePreview {
  const sources = new Map(sc.input.sources.map((s) => [s.id, s]));
  // Wie beim Export: das erste Bild eines Eintrags, das sich als Standbild zeigen lässt.
  const images = new Map<string, ImageRef & { pdf: boolean }>();
  const stillFiles = new Map<ScaffoldEntry, string | null>();
  sc.entries.forEach((e, i) => {
    // Fotos und Scans; PDF-Seiten zeichnet die Oberfläche selbst.
    const ref = e.images.find((r) => {
      const s = sources.get(r.sourceId);
      return s && (canRenderStill(s) || isPdf(s.fileName));
    });
    if (!ref) return;
    images.set(String(i), { ...ref, pdf: isPdf(sources.get(ref.sourceId)!.fileName) });
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
    videos: p.videos.map(media),
    audios: p.audios.map(media),
    still: p.still && {
      image: p.still.file ? (images.get(p.still.file) ?? null) : null,
      caption: p.still.caption,
      text: p.still.text,
    },
  }));
  return { durationMs: pieces.at(-1)?.toMs ?? 0, timeline: overlayTimeline(sc), pieces };
}
