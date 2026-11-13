/**
 * Standbilder für Zeitgerüst und Montage: Fotos verkleinert, Tagebuch-Rahmen ausgeschnitten.
 * Läuft über ffmpeg, die Originale bleiben unberührt.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Source } from "@feldspur/core";
import type { ImageRef } from "./scaffold.ts";
import { toolPaths } from "./tools.ts";

const run = promisify(execFile);

export interface Still {
  data: Buffer;
  width: number;
  height: number;
}

const RASTER = /\.(jpe?g|png|webp|tiff?|bmp|gif|heic|heif)$/i;

/** Lässt sich der Ausschnitt mit ffmpeg erzeugen? PDFs nicht (dafür bräuchte es einen PDF-Renderer). */
export function canRenderStill(src: Source): boolean {
  return RASTER.test(src.fileName);
}

/** Größe aus dem JPEG-Kopf (SOF-Marker). */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Standbild als JPEG, höchstens maxWidth breit. Ein Rahmen (relative Koordinaten)
 * schneidet den Ausschnitt aus. Gibt null zurück, wenn die Datei kein Rasterbild ist.
 */
export async function renderStill(
  src: Source,
  ref: ImageRef,
  outDir: string,
  opts: { maxWidth?: number; name: string },
): Promise<Still | null> {
  if (!canRenderStill(src)) return null;
  const maxW = opts.maxWidth ?? 1000;
  const r = ref.region;
  const filters: string[] = [];
  if (r && (r.w < 0.999 || r.h < 0.999)) {
    const f = (v: number) => v.toFixed(5);
    filters.push(`crop=iw*${f(r.w)}:ih*${f(r.h)}:iw*${f(r.x)}:ih*${f(r.y)}`);
  }
  // Nie vergrößern; gerade Maße für spätere Videonutzung.
  filters.push(`scale='min(${maxW},iw)':-2`);
  const out = join(outDir, `${opts.name}.jpg`);
  await run(toolPaths().ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    src.originalPath,
    "-vf",
    filters.join(","),
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out,
  ]);
  const data = await readFile(out);
  const size = jpegSize(data);
  if (!size) throw new Error(`Standbild ohne lesbare Größe: ${src.fileName}`);
  return { data, ...size };
}
