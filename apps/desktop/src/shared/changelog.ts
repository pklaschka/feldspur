/**
 * Änderungsprotokoll lesbar machen: Bereiche und Arten auf Deutsch, je Änderung die Felder, die sich geändert haben.
 * Wird in der Oberfläche und für die CSV-Ausgabe genutzt.
 */
import type { ChangeEntry, ChangeStep } from "@feldspur/core";

export const TABLE_LABEL: Record<string, string> = {
  project_meta: "Projekt",
  sessions: "Einsatz",
  persons: "Person",
  devices: "Gerät",
  sources: "Quelle",
  time_evidence: "Zeitbeleg",
  sync_anchors: "Anker",
  diary_entries: "Tagebucheintrag",
  transcript_lines: "Mitschrift",
  source_notes: "Notiz",
  episode_edits: "Episoden-Anpassung",
};

/**
 * Beschriftung eines Schritts. Schritte ohne eigene Beschriftung entstehen außerhalb von Rückgängig (Einsammeln,
 * Tonspur-Abgleich); ihr Name ergibt sich aus dem, was sie geändert haben.
 */
export function stepLabel(s: Pick<ChangeStep, "label" | "changes">): string {
  if (s.label) return s.label;
  if (s.changes.some((c) => ["sources", "devices", "time_evidence"].includes(c.table))) return "Dateien eingesammelt";
  if (s.changes.length && s.changes.every((c) => c.table === "sync_anchors")) return "Anker vorgeschlagen";
  return "Automatisch geändert";
}

/** Feldnamen, die im Protokoll häufig vorkommen, lesbar; unbekannte bleiben wie in der Datenbank. */
export const FIELD_LABEL: Record<string, string> = {
  kind: "Art",
  clock: "Uhr",
  local_ms: "Zeit (Geräteuhr)",
  utc_ms: "Zeit (UTC)",
  at_media_ms: "Stelle in der Datei",
  uncertainty_ms: "Genauigkeit",
  detail: "Angabe",
  raw: "Rohwert",
  enabled: "eingeschaltet",
  decision: "Entscheidung",
  source_id: "Quelle",
  label: "Beschriftung",
  offset_ms: "Uhrabweichung",
  timestamps_are_utc: "Zeitstempel in UTC",
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

const KIND_TEXT: Record<string, string> = {
  metadata: "Metadaten",
  filename: "Dateiname",
  spoken: "angesagt",
  anchor: "Anker",
  manual: "von Hand",
  checked: "geprüft",
};

/** Gespeicherte Entscheidung (Spalte `decision` eines Zeitbelegs) lesbar: „Stand beim Entscheiden: …“. */
export function decisionText(v: unknown): string | null {
  let d: unknown = v;
  if (typeof v === "string") {
    try {
      d = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== "object" || !("seen" in d) || !Array.isArray(d.seen)) return null;
  const sign = (ms: number) => {
    const s = Math.round(Math.abs(ms) / 1000);
    const t =
      s >= 3600
        ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return ms === 0 ? "±0" : `${ms < 0 ? "−" : "+"}${t}`;
  };
  const seen = (d.seen as { kind: string; differenceMs: number }[])
    .map((x) => `${KIND_TEXT[x.kind] ?? x.kind} ${sign(x.differenceMs)}`)
    .join(" · ");
  const reason = "reason" in d && typeof d.reason === "string" && d.reason ? `; Begründung: ${d.reason}` : "";
  return `Stand beim Entscheiden: ${seen || "keine weiteren Belege"}${reason}`;
}

/** Wert für die Anzeige: lange Texte gekürzt, leer als „—“. Entscheidungen lesbar statt als JSON. */
export function showValue(v: unknown, max = 80, field?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "decision") return decisionText(v) ?? "—";
  if (typeof v === "number") {
    // Zeiten als Uhrzeit, Spannen in Sekunden; der Rohwert steht in der CSV-Ausgabe.
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
    if (field === "local_ms") return iso(v);
    if (field === "utc_ms") return `${iso(v)} UTC`;
    if (field === "uncertainty_ms") return `± ${(v / 1000).toLocaleString("de-DE")} s`;
    if (field === "at_media_ms") return `${(v / 1000).toLocaleString("de-DE")} s`;
  }
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
