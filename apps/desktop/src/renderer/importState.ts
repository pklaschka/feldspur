/**
 * Laufendes Einsammeln, außerhalb der Ansicht gehalten (Issue #73): Wer während eines großen Imports den Schritt
 * wechselt, findet Fortschritt und Abbrechen beim Zurückkommen wieder. Die eigentliche Arbeit läuft im Hauptprozess.
 */
import { useSyncExternalStore } from "react";
import type { ImportProgress, ImportResult, SessionView } from "../shared/api.ts";

const api = window.feldspur;

export interface ImportJob {
  sessionId: string;
  progress: ImportProgress | null;
  /** Erste Meldung beim Lesen: Zeitpunkt und schon gelesene Bytes (ohne übernommene), für die Restzeit. */
  readingFrom: { at: number; bytes: number } | null;
  cancelling: boolean;
}

type ImportNotice =
  | { kind: "done"; text: string; warnings: { fileName: string; message: string }[] }
  | { kind: "cancelled"; read: number; total: number };

interface State {
  job: ImportJob | null;
  notices: Record<string, ImportNotice>;
}

let state: State = { job: null, notices: {} };
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Wer gerade die Ansicht des Einsatzes zeigt und das Ergebnis übernehmen will. */
const sinks = new Map<string, (v: SessionView) => void>();

/** Ansicht beim Einsammeln anmelden; gibt die Abmeldung zurück. */
export function registerImportView(sessionId: string, onView: (v: SessionView) => void): () => void {
  sinks.set(sessionId, onView);
  return () => {
    if (sinks.get(sessionId) === onView) sinks.delete(sessionId);
  };
}

api.onImportProgress((p) => {
  const j = state.job;
  if (!j || j.sessionId !== p.sessionId) return;
  const own = p.bytesDone - p.bytesReused;
  const readingFrom = p.phase === "reading" ? (j.readingFrom ?? { at: Date.now(), bytes: own }) : j.readingFrom;
  set({ ...state, job: { ...j, progress: p, readingFrom } });
});

export function useImport(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function dismissImportNotice(sessionId: string): void {
  const rest = { ...state.notices };
  delete rest[sessionId];
  set({ ...state, notices: rest });
}

/** Zusammenfassung nach dem Einsammeln: „3 Quellen übernommen · 1 schon vorhanden“. */
function doneText(r: Exclude<ImportResult, { cancelled: unknown }>): string {
  const parts = [`${r.added} ${r.added === 1 ? "Quelle" : "Quellen"} übernommen`];
  if (r.duplicates) parts.push(`${r.duplicates} schon vorhanden`);
  if (r.relinked)
    parts.push(`${r.relinked} fehlende ${r.relinked === 1 ? "Originaldatei" : "Originaldateien"} neu verknüpft`);
  return parts.join(" · ");
}

/**
 * Einsammeln starten. `guard` zeigt Fehler an und liefert dann undefined. Ein Abbruch ist kein Fehler: Es wurde
 * nichts übernommen, und die Meldung sagt, wie viele Dateien schon gelesen waren.
 */
export async function startImport(
  sessionId: string,
  paths: string[],
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>,
): Promise<void> {
  if (!paths.length || state.job) return;
  dismissImportNotice(sessionId);
  set({ ...state, job: { sessionId, progress: null, readingFrom: null, cancelling: false } });
  const r = await guard(() => api.importPaths(sessionId, paths));
  set({ ...state, job: null });
  if (!r) return;
  if ("cancelled" in r) {
    set({ ...state, notices: { ...state.notices, [sessionId]: { kind: "cancelled", ...r.cancelled } } });
    return;
  }
  sinks.get(sessionId)?.(r.view);
  set({
    ...state,
    notices: { ...state.notices, [sessionId]: { kind: "done", text: doneText(r), warnings: r.warnings } },
  });
}

export function cancelImport(): void {
  const j = state.job;
  if (!j || j.cancelling) return;
  set({ ...state, job: { ...j, cancelling: true } });
  void api.cancelImport(j.sessionId);
}

/** Geschätzte Restzeit in ms nach gelesenen Bytes; null, solange es zu früh für eine Schätzung ist (5 s). */
export function importRemainingMs(job: ImportJob | null, now = Date.now()): number | null {
  const p = job?.progress;
  const from = job?.readingFrom;
  if (!p || !from || p.phase !== "reading") return null;
  const elapsed = now - from.at;
  const read = p.bytesDone - p.bytesReused - from.bytes;
  if (elapsed < 5_000 || read <= 0) return null;
  return (elapsed / read) * (p.bytesTotal - p.bytesDone);
}

/** Anteil 0–100 nach Bytes (Prüfsummen bestimmen die Dauer), bei leeren Dateien nach Anzahl. */
export function importPercent(p: ImportProgress | null): number {
  if (!p || p.phase !== "reading") return 0;
  if (p.bytesTotal > 0) return Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
  return p.total ? Math.round((p.done / p.total) * 100) : 0;
}
