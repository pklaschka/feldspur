/** Montage in der App abspielen: Rechenhilfen ohne Oberfläche (testbar). */
import type { OverlayFrame } from "@feldspur/media";
import type { PreviewPiece } from "../shared/api.ts";

/** Einblendung an einer Stelle der Montage (wie im Video: Uhr läuft in Episoden sekundengenau mit). */
export function previewFrame(p: PreviewPiece, montageMs: number): OverlayFrame {
  const k = Math.floor((montageMs - p.fromMs) / 1000);
  return {
    montageMs,
    clockMs: p.kind === "episode" ? p.clock0 + k * 1000 : p.clock0,
    kind: p.kind,
    title: p.title,
    sources: p.sources,
    caption: p.still?.caption ?? "",
    body: p.body,
    hasVideo: !!p.video,
    hasStill: !!p.still,
  };
}

/** Stück an einer Stelle der Montage. */
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
