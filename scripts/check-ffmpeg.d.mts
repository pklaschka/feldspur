/**
 * Typen zu `scripts/check-ffmpeg.mjs` (reines JavaScript, das `node` direkt startet), damit der Test
 * `scripts/check-ffmpeg.test.ts` es typgeprüft einbinden kann.
 */
export type Kind = "decoders" | "encoders" | "demuxers" | "muxers" | "filters";
export const REQUIRED: Record<Kind, string[]>;
export function parseList(text: string): Set<string>;
export function missing(
  lists: Partial<Record<string, Set<string>>>,
  required?: Partial<Record<string, string[]>>,
): Partial<Record<string, string[]>>;
export function checkFfmpeg(ffmpeg: string): string[];
