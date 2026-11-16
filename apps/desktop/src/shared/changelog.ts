/**
 * Änderungsprotokoll lesbar machen: Bereiche und Arten auf Deutsch, je Änderung die Felder, die sich geändert haben.
 * Wird in der Oberfläche und für die CSV-Ausgabe genutzt.
 */
import type { ChangeEntry } from "@feldspur/core";

export const TABLE_LABEL: Record<string, string> = {
  project_meta: "Projekt",
  sessions: "Einsatz",
  persons: "Person",
  devices: "Gerät",
  sources: "Quelle",
  evidence: "Zeitbeleg",
  anchors: "Anker",
  diary_entries: "Tagebucheintrag",
  transcript_lines: "Mitschrift",
  source_notes: "Notiz",
  episode_edits: "Episoden-Anpassung",
};

export const OP_LABEL: Record<ChangeEntry["op"], string> = {
  insert: "angelegt",
  update: "geändert",
  delete: "gelöscht",
};

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Geänderte Felder; beim Anlegen und Löschen alle gefüllten Felder. */
export function fieldChanges(c: ChangeEntry): FieldChange[] {
  const keys = [...new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})])];
  return keys
    .map((field) => ({ field, before: c.before?.[field] ?? null, after: c.after?.[field] ?? null }))
    .filter((f) =>
      c.op === "update"
        ? JSON.stringify(f.before) !== JSON.stringify(f.after)
        : (f.before ?? f.after) !== null && (f.before ?? f.after) !== "",
    );
}

/** Wert für die Anzeige: lange Texte gekürzt, leer als „—“. */
export function showValue(v: unknown, max = 80): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
