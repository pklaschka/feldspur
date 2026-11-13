/**
 * Montage zum Ansehen in der App: derselbe Ablauf wie im Montagevideo, aber ohne zu rechnen.
 * Die Oberfläche spielt die Originale an den richtigen Stellen ab und zeichnet die Einblendungen selbst.
 */
import { FPS } from "./layout.ts";
import {
  overlayHeader,
  planPieces,
  type MediaRef,
  type OverlayFrame,
  type OverlayHeader,
  type Piece,
} from "./montage-video.ts";
import type { Scaffold } from "./scaffold.ts";

const FRAME_MS = 1000 / FPS;

export interface PreviewMedia {
  sourceId: string;
  fromMs: number;
  label: string;
  fileName: string;
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
  videos: PreviewMedia[];
  /** Hauptquelle zuerst. */
  audios: PreviewMedia[];
}

export interface MontagePreview {
  durationMs: number;
  header: OverlayHeader;
  pieces: PreviewPiece[];
}

const media = (m: MediaRef): PreviewMedia => ({
  sourceId: m.source.id,
  fromMs: m.fromMs,
  label: m.label,
  fileName: m.source.fileName,
  kind: m.source.kind === "video" ? "video" : "audio",
});

const toPreview = (p: Piece): PreviewPiece => ({
  fromMs: p.f0 * FRAME_MS,
  toMs: p.f1 * FRAME_MS,
  kind: p.kind,
  clock0: p.clock0,
  title: p.title,
  body: p.body,
  videos: p.videos.map(media),
  audios: p.audios.map(media),
});

export function montagePreview(sc: Scaffold): MontagePreview {
  const pieces = planPieces(sc).map(toPreview);
  return { durationMs: pieces.at(-1)?.toMs ?? 0, header: overlayHeader(sc), pieces };
}
