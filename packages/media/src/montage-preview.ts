/**
 * Montage zum Ansehen in der App: derselbe Ablauf wie im Montagevideo, aber ohne zu rechnen.
 * Die Oberfläche spielt die Originale an den richtigen Stellen ab und zeichnet die Einblendungen selbst.
 *
 * Einordnung: Schritt „Ansehen“ (Issue #131). Der Hauptprozess baut den Plan (`watchPreview` in
 * `apps/desktop/src/main/export.ts`) und schickt ihn per IPC an die Oberfläche (`Watch.tsx`, `watch/player.ts`). Die
 * Stücke stammen aus demselben `planPieces` wie das gerechnete Video (`packages/media/src/montage-video.ts`), hier
 * nur auf das gekürzt, was über IPC gehen kann (Kennungen und Zahlen statt ganzer Quellen, ms statt Bilder).
 */
import { DEFAULT_FORMAT, type MontageFormat } from "./layout.ts";
import {
  overlayHeader,
  planPieces,
  type MediaRef,
  type OverlayFrame,
  type OverlayHeader,
  type Piece,
} from "./montage-video.ts";
import type { SessionTranscript } from "./session-transcript.ts";

/** Eine laufende Aufnahme in einem Stück der Vorschau. */
export interface PreviewMedia {
  sourceId: string;
  /** Stelle in der Originaldatei am Beginn des Stücks, in ms. */
  fromMs: number;
  /** Kurzzeichen und Gerät, z. B. „V-01 Kamera Stativ“. */
  label: string;
  fileName: string;
  kind: "audio" | "video";
}

/** Ein Stück der Montage (`Piece`) für die Vorschau: Zeitraum, in dem dieselben Aufnahmen laufen, oder eine Tafel. */
export interface PreviewPiece {
  /** Grenzen in ms ab Montagebeginn. */
  fromMs: number;
  toMs: number;
  kind: OverlayFrame["kind"];
  /** Uhrzeit am Beginn des Stücks (Ortszeit des Einsatzes in ms, `LocalMs`). */
  clock0: number;
  title: string;
  body: string;
  videos: PreviewMedia[];
  /** Hauptquelle zuerst. */
  audios: PreviewMedia[];
}

/** Die ganze Vorschau: Kopfzeile wie im Video und die Stücke in ihrer Reihenfolge. */
export interface MontagePreview {
  durationMs: number;
  /** Auflösung und Bildrate des Montagevideos: Die Vorschau zeigt denselben Aufbau. */
  format: MontageFormat;
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

const toPreview = (p: Piece, fps: number): PreviewPiece => ({
  fromMs: (p.f0 * 1000) / fps,
  toMs: (p.f1 * 1000) / fps,
  kind: p.kind,
  clock0: p.clock0,
  title: p.title,
  body: p.body,
  videos: p.videos.map(media),
  audios: p.audios.map(media),
});

/** Vorschau aus einem fertigen Einsatztranskript; liest keine Datei und startet kein ffmpeg. */
export function montagePreview(transcript: SessionTranscript, format: MontageFormat = DEFAULT_FORMAT): MontagePreview {
  const pieces = planPieces(transcript, format.fps).map((p) => toPreview(p, format.fps));
  return { durationMs: pieces.at(-1)?.toMs ?? 0, format, header: overlayHeader(transcript), pieces };
}
