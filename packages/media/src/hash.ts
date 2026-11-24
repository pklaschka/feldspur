/**
 * Prüfsumme (SHA-256) einer Datei. Sie weist nach, dass eine Quelle noch dieselbe Originaldatei ist.
 *
 * Einordnung: gerechnet beim Einsammeln (`packages/media/src/import.ts`), beim Prüfen und Wiederfinden der Originale
 * (`packages/media/src/integrity.ts`) und für die Prüfsummenliste der Ausgabe (`packages/media/src/export.ts`).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface HashOptions {
  /** Bricht das Lesen ab (wirft einen AbortError); nötig bei mehrstündigen Videos. */
  signal?: AbortSignal;
  /** Gelesene Bytes bisher, für Fortschrittsanzeigen. */
  onBytes?: (bytes: number) => void;
}

/** SHA-256 einer Datei, gestreamt (auch für mehrstündige Videos). */
export async function sha256File(path: string, opts: HashOptions = {}): Promise<string> {
  const hash = createHash("sha256");
  let bytes = 0;
  opts.signal?.throwIfAborted();
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20, signal: opts.signal })) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
    opts.onBytes?.(bytes);
  }
  return hash.digest("hex");
}
