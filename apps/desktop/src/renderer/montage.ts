/**
 * Montage in der App abspielen: Rechenhilfen ohne Oberfläche (testbar). Die Ansicht dazu ist `MontageView.tsx`;
 * die Stücke (`PreviewPiece`) plant `packages/media/src/montage-preview.ts` mit demselben Plan wie das Montagevideo.
 */
import type { OverlayFrame } from "@feldspur/media";
import type { PreviewMedia, PreviewPiece } from "../shared/api.ts";

/**
 * Einblendung an einer Stelle der Montage, wie im Video: sekundenweise, die Uhr läuft außer
 * in Tafeln mit, je Datei die Stelle im Original.
 */
export function previewFrame(p: PreviewPiece, montageMs: number): OverlayFrame {
  const offset = Math.max(0, Math.floor((montageMs - p.fromMs) / 1000) * 1000);
  const media = (m: PreviewMedia) => ({ label: m.label, fileName: m.fileName, atMs: m.fromMs + offset });
  const shown = new Set(p.videos.map((v) => v.sourceId));
  return {
    montageMs: p.fromMs + offset,
    clockMs: p.kind === "card" ? p.clock0 : p.clock0 + offset,
    kind: p.kind,
    title: p.title,
    body: p.body,
    tiles: p.videos.map(media),
    sounds: p.audios.filter((a) => !shown.has(a.sourceId)).map(media),
  };
}

/** Index des Stücks an einer Stelle der Montage (ms ab Montagebeginn); die Stücke sind nach Beginn sortiert. */
export function pieceAt(pieces: PreviewPiece[], montageMs: number): number {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pieces[mid]!.fromMs <= montageMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
