/**
 * Arbeitsnotizen zu Dateien anlegen, ändern, löschen; zur ganzen Datei oder zu einer Stelle bzw. Strecke darin.
 * Aufgerufen aus `ipc/review.ts` (Kanäle `note:…`), bedient in `src/renderer/Notes.tsx`.
 */
import type { ProjectStore, SourceNote } from "@feldspur/core";
import type { SourceNoteInput } from "../shared/api.ts";

/** Stelle auf die Länge der Aufnahme begrenzen; null bleibt null. */
function clampMs(max: number | null, ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined) return null;
  if (!Number.isFinite(ms)) throw new Error("Ungültige Stelle in der Aufnahme");
  return Math.min(Math.max(0, Math.round(ms)), max ?? Number.MAX_SAFE_INTEGER);
}

/** Strecke ordnen: Ende vor Beginn wird getauscht, Ende ohne Beginn ist nicht erlaubt. */
function range(max: number | null, fromMs: number | null | undefined, toMs: number | null | undefined) {
  let from = clampMs(max, fromMs);
  let to = clampMs(max, toMs);
  if (from === null) to = null;
  if (from !== null && to !== null && to < from) [from, to] = [to, from];
  if (from !== null && to === from) to = null;
  return { fromMs: from, toMs: to };
}

/** Gibt die Einsatz-Id zurück. */
export function addNote(s: ProjectStore, sourceId: string, input: SourceNoteInput): string {
  const src = s.getSource(sourceId);
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("Die Notiz ist leer");
  s.addSourceNote({ sourceId, text, done: input.done ?? false, ...range(src.durationMs, input.fromMs, input.toMs) });
  return src.sessionId;
}

/** Gibt die Einsatz-Id zurück. */
export function updateNote(s: ProjectStore, noteId: string, patch: SourceNoteInput): string {
  const n = s.getSourceNote(noteId);
  const src = s.getSource(n.sourceId);
  const next: Partial<SourceNote> = {};
  if (patch.fromMs !== undefined || patch.toMs !== undefined)
    Object.assign(
      next,
      range(
        src.durationMs,
        patch.fromMs !== undefined ? patch.fromMs : n.fromMs,
        patch.toMs !== undefined ? patch.toMs : n.toMs,
      ),
    );
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (!text) throw new Error("Die Notiz ist leer");
    next.text = text;
  }
  if (patch.done !== undefined) next.done = patch.done;
  s.updateSourceNote(noteId, next);
  return src.sessionId;
}

/** Gibt die Einsatz-Id zurück. */
export function deleteNote(s: ProjectStore, noteId: string): string {
  const n = s.getSourceNote(noteId);
  s.deleteSourceNote(noteId);
  return s.getSource(n.sourceId).sessionId;
}
