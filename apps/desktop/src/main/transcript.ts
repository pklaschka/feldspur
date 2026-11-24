/**
 * Mitschrift: Zeilen zu Ton- und Videoquellen anlegen, ändern, löschen. Aufgerufen aus `ipc/review.ts` (Kanäle
 * `transcript:…`), bedient in `src/renderer/Transcriber.tsx`.
 *
 * Eine Zeile hängt an einer Stelle der Aufnahme (ms ab Dateibeginn), nie an einer Uhrzeit: Die Uhrzeit ergibt sich
 * erst aus der Lage der Quelle und wandert mit, wenn sich der Abgleich ändert.
 */
import type { ProjectStore, TranscriptLine } from "@feldspur/core";
import type { TranscriptPatch } from "../shared/api.ts";

const AV = new Set(["audio", "video"]);

/** Stelle auf die Länge der Aufnahme begrenzen. */
function clampAt(s: ProjectStore, sourceId: string, atMs: number): number {
  if (!Number.isFinite(atMs)) throw new Error("Stelle in der Aufnahme fehlt");
  const src = s.getSource(sourceId);
  const max = src.durationMs ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(0, Math.round(atMs)), max);
}

/** Neue Zeile an einer Stelle der Aufnahme; Sprecher und Text ohne Leerraum am Rand. */
export function addLine(
  s: ProjectStore,
  sourceId: string,
  line: { atMs: number; speaker: string; text: string },
): TranscriptLine {
  const src = s.getSource(sourceId);
  if (!AV.has(src.kind)) throw new Error(`${src.label} ist keine Ton- oder Videoaufnahme`);
  return s.addTranscriptLine({
    sourceId,
    atMs: clampAt(s, sourceId, line.atMs),
    speaker: line.speaker.trim(),
    text: line.text.trim(),
  });
}

/** Gibt die Einsatz-Id zurück. */
export function updateLine(s: ProjectStore, lineId: string, patch: TranscriptPatch): string {
  const l = s.getTranscriptLine(lineId);
  const next: Partial<TranscriptLine> = {};
  if (patch.atMs !== undefined) next.atMs = clampAt(s, l.sourceId, patch.atMs);
  if (patch.speaker !== undefined) next.speaker = patch.speaker.trim();
  if (patch.text !== undefined) next.text = patch.text.trim();
  s.updateTranscriptLine(lineId, next);
  return s.getSource(l.sourceId).sessionId;
}

/** Gibt die Einsatz-Id zurück. */
export function deleteLine(s: ProjectStore, lineId: string): string {
  const l = s.getTranscriptLine(lineId);
  s.deleteTranscriptLine(lineId);
  return s.getSource(l.sourceId).sessionId;
}

/**
 * Fertiges Transkript (z. B. aus Whisper) an eine Aufnahme hängen. "replace" löscht die bisherige
 * Mitschrift dieser Aufnahme. Zeilen hinter dem Ende der Aufnahme werden verworfen.
 */
export function importLines(
  s: ProjectStore,
  sourceId: string,
  lines: { atMs: number; speaker: string; text: string }[],
  mode: "append" | "replace",
): { sessionId: string; count: number; dropped: number } {
  const src = s.getSource(sourceId);
  if (!AV.has(src.kind)) throw new Error(`${src.label} ist keine Ton- oder Videoaufnahme`);
  const max = src.durationMs ?? Number.MAX_SAFE_INTEGER;
  const keep = lines.filter((l) => l.atMs <= max + 1000);
  s.transaction(() => {
    if (mode === "replace")
      for (const l of s.listTranscript(src.sessionId)) if (l.sourceId === sourceId) s.deleteTranscriptLine(l.id);
    for (const l of keep) addLine(s, sourceId, l);
  });
  return { sessionId: src.sessionId, count: keep.length, dropped: lines.length - keep.length };
}
