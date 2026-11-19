/** Reine Logik rund um die angefangene Zeile im Mitschreiben (ohne React, damit sie sich testen lässt). */
import { splitSpeaker } from "../format.ts";

export type PendingLine = { atMs: number; speaker: string; text: string };

/** Die Zeile, die Enter anlegen würde; null, wenn nichts Sinnvolles im Feld steht. */
export function takeDraft(draft: string, speaker: string, mark: number | null, posMs: number): PendingLine | null {
  const { speaker: sp, text } = splitSpeaker(draft);
  if (!text.trim()) return null;
  return { atMs: mark ?? posMs, speaker: sp ?? speaker, text };
}

/**
 * Anlegen fehlgeschlagen: Der Text kommt zurück ins Feld. Hat man inzwischen weitergetippt, steht der
 * zurückgeholte Text davor, mit der Marke der älteren Zeile.
 */
export function restoreDraft(
  current: { draft: string; mark: number | null },
  failed: PendingLine,
): { draft: string; mark: number } {
  if (!current.draft.trim()) return { draft: failed.text, mark: failed.atMs };
  const sep = /\s$/.test(failed.text) ? "" : " ";
  return { draft: failed.text + sep + current.draft, mark: Math.min(failed.atMs, current.mark ?? failed.atMs) };
}

/** Aufträge strikt nacheinander ausführen, damit schnell angelegte Zeilen in der Reihenfolge ankommen. */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const p = tail.then(job);
      tail = p.catch(() => {});
      return p;
    },
    /** Erst fertig, wenn alles bisher Eingereihte durch ist. */
    idle: () => tail.then(() => {}),
  };
}
