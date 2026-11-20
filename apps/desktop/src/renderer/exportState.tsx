/**
 * Laufende Ausgabe, oberhalb der Reiter und Einsätze gehalten: Wer während der Ausgabe den Reiter
 * oder den Einsatz wechselt, findet Fortschritt und Ergebnis beim Zurückkommen wieder.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  EXPORT_CHECK_STEP,
  type ExportOutcome,
  type ExportProgress,
  type ExportRequestOptions,
  type OriginalsCheck,
} from "../shared/api.ts";
import { errorText } from "./format.ts";

const api = window.feldspur;

/** Erster Schritt jeder Ausgabe, nach der Ordnerwahl. */
export const CHECK_STEP = EXPORT_CHECK_STEP;

export interface ExportJob {
  sessionId: string;
  video: boolean;
  progress: ExportProgress | null;
  /** Beginn des Videoschritts: Zeitpunkt und schon fertige Sekunden, für die Restzeit. */
  videoFrom: { at: number; done: number } | null;
  /** Abbrechen ist angefordert, ffmpeg wird beendet. */
  cancelling: boolean;
}

/**
 * Ausgabe, die nach der Prüfung der Originale angehalten hat: Etwas fehlt oder ist verändert. Die Person entscheidet;
 * „Trotzdem ausgeben“ nutzt dieselben Einstellungen und den schon gewählten Ordner.
 */
export interface HeldExport {
  result: OriginalsCheck;
  parent: string;
  opts: ExportRequestOptions;
  /** Was der Aufrufer zum Ergebnis merken will (der Schritt „Ausgeben“: die geprüften Pfade). */
  key?: string;
}

/** Wie eine abgebrochene Ausgabe lief: mit Video bleiben fertige Abschnitte im Zwischenspeicher. */
export interface CancelledExport {
  video: boolean;
}

interface ExportState {
  job: ExportJob | null;
  results: Record<string, ExportOutcome>;
  errors: Record<string, string>;
  /** Abgebrochene Ausgaben je Einsatz, bis zum nächsten Versuch. */
  cancelled: Record<string, CancelledExport>;
  /** Nach der Prüfung angehaltene Ausgaben je Einsatz, bis zur Entscheidung oder zum nächsten Versuch. */
  held: Record<string, HeldExport>;
  /** Laufende Ausgabe abbrechen. */
  cancel(): void;
  start(sessionId: string, opts: ExportRequestOptions, key?: string): void;
  /** Angehaltene Ausgabe verwerfen (Abbrechen im Hinweis). */
  dismiss(sessionId: string): void;
}

const Ctx = createContext<ExportState | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [results, setResults] = useState<Record<string, ExportOutcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cancelled, setCancelled] = useState<Record<string, CancelledExport>>({});
  const [held, setHeld] = useState<Record<string, HeldExport>>({});
  useEffect(
    () =>
      api.onExportProgress((p) =>
        setJob((j) => {
          if (!j || j.sessionId !== p.sessionId) return j;
          const videoFrom = p.step === "Montagevideo" ? (j.videoFrom ?? { at: Date.now(), done: p.done }) : j.videoFrom;
          return { ...j, progress: p, videoFrom };
        }),
      ),
    [],
  );
  const start = (sessionId: string, opts: ExportRequestOptions, key?: string) => {
    if (job) return;
    setJob({ sessionId, video: opts.video, progress: null, videoFrom: null, cancelling: false });
    setErrors((x) => without(x, sessionId));
    setCancelled((x) => without(x, sessionId));
    setHeld((x) => without(x, sessionId));
    api.exportSession(sessionId, opts).then(
      (r) => {
        if (r && "cancelled" in r) setCancelled((x) => ({ ...x, [sessionId]: { video: opts.video } }));
        else if (r && "originals" in r)
          setHeld((x) => ({ ...x, [sessionId]: { result: r.originals, parent: r.parent, opts, key } }));
        else if (r) setResults((x) => ({ ...x, [sessionId]: r }));
        setJob(null);
      },
      (e: unknown) => {
        const msg = errorText(e);
        setErrors((x) => ({ ...x, [sessionId]: msg }));
        setJob(null);
      },
    );
  };
  const cancel = () => {
    if (!job || job.cancelling) return;
    setJob({ ...job, cancelling: true });
    void api.cancelExport(job.sessionId);
  };
  const dismiss = (sessionId: string) => setHeld((x) => without(x, sessionId));
  return (
    <Ctx.Provider value={{ job, results, errors, cancelled, held, cancel, start, dismiss }}>{children}</Ctx.Provider>
  );
}

function without<T>(x: Record<string, T>, key: string): Record<string, T> {
  const rest = { ...x };
  delete rest[key];
  return rest;
}

/** Hinweis nach einem Abbruch. Fertige Abschnitte gibt es nur, wenn ein Video gerechnet wurde. */
export function cancelledText(c: CancelledExport): string {
  return c.video
    ? "Abgebrochen. Fertige Videoabschnitte bleiben im Zwischenspeicher, ein neuer Versuch geht schneller."
    : "Abgebrochen. Die Ausgabe ist nicht vollständig.";
}

export function useExport(): ExportState {
  const s = useContext(Ctx);
  if (!s) throw new Error("ExportProvider fehlt");
  return s;
}

/**
 * Fortschritt als Prozent (0–100), grob über die Schritte gewichtet. Ohne Video ist die Prüfung der Originale fast
 * die ganze Arbeit, mit Video das Montagevideo.
 */
export function percent(p: ExportProgress | null, video = true): number {
  if (!p) return 0;
  const frac = p.total ? p.done / p.total : 0;
  const steps: [string, number, number][] = video
    ? [
        [CHECK_STEP, 0, 10],
        ["Standbilder", 10, 15],
        ["Montagevideo", 15, 95],
        ["Einsatztranskript", 95, 99],
        ["Fertig", 100, 100],
      ]
    : [
        [CHECK_STEP, 0, 85],
        ["Standbilder", 85, 90],
        ["Einsatztranskript", 90, 99],
        ["Fertig", 100, 100],
      ];
  const s = steps.find(([name]) => name === p.step);
  return s ? Math.round(s[1] + (s[2] - s[1]) * frac) : 0;
}

/** Geschätzte Restzeit des Videos in ms, sobald genug gerechnet ist (mind. 10 s Laufzeit). */
export function remainingMs(job: ExportJob | null, now = Date.now()): number | null {
  const p = job?.progress;
  const from = job?.videoFrom;
  if (!p || !from || p.step !== "Montagevideo") return null;
  const elapsed = now - from.at;
  const done = p.done - from.done;
  if (elapsed < 10_000 || done <= 0) return null;
  return (elapsed / done) * (p.total - p.done);
}

/** „noch ca. 25 Min.“ */
export function remainingText(ms: number | null): string {
  if (ms === null) return "Restzeit wird geschätzt …";
  if (ms < 60_000) return "noch unter einer Minute";
  const min = Math.round(ms / 60_000);
  if (min < 90) return `noch ca. ${min} Min.`;
  return `noch ca. ${(ms / 3_600_000).toFixed(1).replace(".", ",")} Std.`;
}
