/**
 * Laufende Ausgabe, oberhalb der Reiter und Einsätze gehalten: Wer während der Ausgabe den Reiter
 * oder den Einsatz wechselt, findet Fortschritt und Ergebnis beim Zurückkommen wieder.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ExportOutcome, ExportProgress } from "../shared/api.ts";

const api = window.feldspur;

export interface ExportJob {
  sessionId: string;
  video: boolean;
  progress: ExportProgress | null;
  /** Beginn des Videoschritts: Zeitpunkt und schon fertige Sekunden, für die Restzeit. */
  videoFrom: { at: number; done: number } | null;
}

interface ExportState {
  job: ExportJob | null;
  results: Record<string, ExportOutcome>;
  errors: Record<string, string>;
  start(sessionId: string, video: boolean): void;
}

const Ctx = createContext<ExportState | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [results, setResults] = useState<Record<string, ExportOutcome>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
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
  const start = (sessionId: string, video: boolean) => {
    if (job) return;
    setJob({ sessionId, video, progress: null, videoFrom: null });
    setErrors((x) => {
      const rest = { ...x };
      delete rest[sessionId];
      return rest;
    });
    api.exportSession(sessionId, { video }).then(
      (r) => {
        if (r) setResults((x) => ({ ...x, [sessionId]: r }));
        setJob(null);
      },
      (e: unknown) => {
        const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
        setErrors((x) => ({ ...x, [sessionId]: msg }));
        setJob(null);
      },
    );
  };
  return <Ctx.Provider value={{ job, results, errors, start }}>{children}</Ctx.Provider>;
}

export function useExport(): ExportState {
  const s = useContext(Ctx);
  if (!s) throw new Error("ExportProvider fehlt");
  return s;
}

/** Fortschritt als Prozent (0–100), grob über die Schritte gewichtet. */
export function percent(p: ExportProgress | null): number {
  if (!p) return 0;
  const frac = p.total ? p.done / p.total : 0;
  const steps: [string, number, number][] = [
    ["Standbilder", 0, 5],
    ["Montagevideo", 5, 95],
    ["Zeitgerüst", 95, 99],
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
