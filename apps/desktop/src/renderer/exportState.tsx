/**
 * Laufende Ausgabe, oberhalb der Reiter und Einsätze gehalten: Wer während der Ausgabe den Reiter
 * oder den Einsatz wechselt, findet Fortschritt und Ergebnis beim Zurückkommen wieder.
 *
 * Der Provider liegt in `App.tsx`. Gestartet und gezeigt wird im Schritt Ausgeben (`ExportStep.tsx`, `export/`);
 * `app/SessionPane.tsx` zeigt den Fortschritt am Reiter. Die Arbeit selbst macht der Hauptprozess
 * (`apps/desktop/src/main/ipc/export.ts`, `apps/desktop/src/main/export.ts`, darunter `packages/media/src/export.ts`)
 * und meldet Fortschritt über `onExportProgress`. Es läuft höchstens eine Ausgabe zur selben Zeit.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  EXPORT_CHECK_STEP,
  EXPORT_LEVELS_STEP,
  type ExportOutcome,
  type ExportProgress,
  type ExportRequestOptions,
  type OriginalsCheck,
  type ProjectExportRequest,
  type ProjectExportResult,
} from "../shared/api.ts";
import { errorText } from "./format.ts";

const api = window.feldspur;

/** Erster Schritt jeder Ausgabe, nach der Ordnerwahl. */
export const CHECK_STEP = EXPORT_CHECK_STEP;
/** Schritt der Ausgabe, der die Originale kopiert und prüft (done/total in Bytes, Issue #208). */
export const ORIGINALS_STEP = "Originale kopieren";

/** Die laufende Ausgabe. */
export interface ExportJob {
  sessionId: string;
  /** Mit Montagevideo; ohne geht es schnell, und der Fortschritt wird anders gewichtet (`percent`). */
  video: boolean;
  /** Mit Kopien der Originale (Issue #208): Das Kopieren bekommt dann einen eigenen Teil des Balkens. */
  originals?: boolean;
  progress: ExportProgress | null;
  /**
   * Gezeigter Anteil (0–100): `percent` des letzten Stands, aber nie kleiner als schon gezeigt. Ein Schritt, der
   * außer der Reihe oder ein zweites Mal gemeldet wird, lässt den Balken so nicht zurückspringen (Issue #257).
   */
  percent: number;
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

/**
 * Laufendes „Alle Einsätze ausgeben…“ (Issue #209): eine Folge einzelner Ausgaben. Die gerade laufende steht wie
 * jede andere in `job`, damit Reiter und Schritt „Ausgeben“ sie zeigen.
 */
export interface ProjectExportJob {
  /** Die gewählten Einsätze. */
  sessionIds: string[];
  /** Stelle des laufenden Einsatzes (ab 0) und Zahl der gewählten; null, solange noch keiner begonnen hat. */
  at: { index: number; total: number } | null;
  cancelling: boolean;
}

interface ExportState {
  job: ExportJob | null;
  /** „Alle Einsätze ausgeben…“, solange es läuft; danach `projectResult` oder `projectError`. */
  project: ProjectExportJob | null;
  projectResult: ProjectExportResult | null;
  projectError: string | null;
  /** Alle gewählten Einsätze in einen Projektordner ausgeben; tut nichts, solange eine Ausgabe läuft. */
  startProject(sessionIds: string[], opts: ProjectExportRequest): void;
  /** Ergebnis oder Fehler des letzten Laufs ausblenden. */
  dismissProject(): void;
  /** Letztes Ergebnis je Einsatz-Id; `errors` ebenso die letzte Fehlermeldung, bis zum nächsten Versuch. */
  results: Record<string, ExportOutcome>;
  errors: Record<string, string>;
  /** Abgebrochene Ausgaben je Einsatz, bis zum nächsten Versuch. */
  cancelled: Record<string, CancelledExport>;
  /** Nach der Prüfung angehaltene Ausgaben je Einsatz, bis zur Entscheidung oder zum nächsten Versuch. */
  held: Record<string, HeldExport>;
  /** Laufende Ausgabe abbrechen. */
  cancel(): void;
  /** Ausgabe starten; tut nichts, solange eine läuft. Den Zielordner erfragt der Hauptprozess, wenn keiner mitkommt. */
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
          return { ...j, progress: p, percent: Math.max(j.percent, percent(p, j.video, j.originals)), videoFrom };
        }),
      ),
    [],
  );
  const [project, setProject] = useState<ProjectExportJob | null>(null);
  const [projectResult, setProjectResult] = useState<ProjectExportResult | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  // Welche Schalter der laufende Lauf hat: Daraus gewichtet `percent` den Balken jedes Einsatzes.
  const projectOpts = useRef<ProjectExportRequest | null>(null);
  useEffect(
    () =>
      api.onProjectExportProgress((p) => {
        const opts = projectOpts.current;
        if (!opts) return;
        setProject((x) => (x ? { ...x, at: { index: p.index, total: p.total } } : x));
        // Jeder Einsatz beginnt mit einem frischen Balken; zwischen zwei Einsätzen und am Schluss läuft keiner.
        setJob((j) =>
          p.sessionId
            ? {
                sessionId: p.sessionId,
                video: opts.video,
                originals: opts.originals === true,
                progress: null,
                percent: 0,
                videoFrom: null,
                cancelling: j?.cancelling ?? false,
              }
            : null,
        );
      }),
    [],
  );
  const startProject = (sessionIds: string[], opts: ProjectExportRequest) => {
    if (job || project) return;
    projectOpts.current = opts;
    setProject({ sessionIds, at: null, cancelling: false });
    setProjectResult(null);
    setProjectError(null);
    const done = () => {
      projectOpts.current = null;
      setProject(null);
      setJob(null);
    };
    api.exportProject(sessionIds, opts).then(
      (r) => {
        if (r) {
          setProjectResult(r);
          // Was dieser Lauf für einen Einsatz geklärt hat, ersetzt ältere Meldungen in seinem Schritt „Ausgeben“.
          for (const x of r.sessions) {
            if (x.outcome !== "written") continue;
            setErrors((e) => without(e, x.sessionId));
            setCancelled((e) => without(e, x.sessionId));
            setHeld((e) => without(e, x.sessionId));
          }
        }
        done();
      },
      (e: unknown) => {
        setProjectError(errorText(e));
        done();
      },
    );
  };
  const dismissProject = () => {
    setProjectResult(null);
    setProjectError(null);
  };
  const start = (sessionId: string, opts: ExportRequestOptions, key?: string) => {
    if (job || project) return;
    setJob({
      sessionId,
      video: opts.video,
      originals: opts.originals === true,
      progress: null,
      percent: 0,
      videoFrom: null,
      cancelling: false,
    });
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
    if (project) {
      // Mitten in „Alle Einsätze ausgeben…“ gilt der Abbruch dem Ganzen, auch zwischen zwei Einsätzen.
      if (project.cancelling) return;
      setProject({ ...project, cancelling: true });
      if (job) setJob({ ...job, cancelling: true });
      void api.cancelProjectExport();
      return;
    }
    if (!job || job.cancelling) return;
    setJob({ ...job, cancelling: true });
    void api.cancelExport(job.sessionId);
  };
  const dismiss = (sessionId: string) => setHeld((x) => without(x, sessionId));
  return (
    <Ctx.Provider
      value={{
        job,
        project,
        projectResult,
        projectError,
        results,
        errors,
        cancelled,
        held,
        cancel,
        start,
        startProject,
        dismissProject,
        dismiss,
      }}
    >
      {children}
    </Ctx.Provider>
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

/** Stand und Steuerung der Ausgabe; nur unterhalb von `ExportProvider`. */
export function useExport(): ExportState {
  const s = useContext(Ctx);
  if (!s) throw new Error("ExportProvider fehlt");
  return s;
}

/**
 * Fortschritt eines gemeldeten Stands als Prozent (0–100), grob über die Schritte gewichtet. Ohne Video ist die Prüfung
 * der Originale fast die ganze Arbeit, mit Video das Montagevideo. Die Schrittnamen sind die, die
 * `packages/media/src/export.ts` und `apps/desktop/src/main/export.ts` melden; ein Schritt, der hier fehlt, ergibt 0.
 * Angezeigt wird `ExportJob.percent`, das nie hinter einen schon gezeigten Wert zurückfällt.
 */
export function percent(p: ExportProgress | null, video = true, originals = false): number {
  if (!p) return 0;
  const frac = p.total ? p.done / p.total : 0;
  const steps: [string, number, number][] = video
    ? [
        [CHECK_STEP, 0, 8],
        // Gemessen wird nur für das Montagevideo, und nur, was noch keinen Pegel hat.
        [EXPORT_LEVELS_STEP, 8, 10],
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
  const base = s ? s[1] + (s[2] - s[1]) * frac : 0;
  if (!originals) return Math.round(base);
  // Mit Originalen: Prüfen 0–5 %, Kopieren 5–35 %, alles Übrige rückt in 35–100 %.
  const checkEnd = steps[0]![2];
  if (p.step === ORIGINALS_STEP) return Math.round(5 + 30 * frac);
  if (p.step === CHECK_STEP) return Math.round(5 * frac);
  return s ? Math.round(35 + ((base - checkEnd) * 65) / (100 - checkEnd)) : 0;
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
  if (ms === null) return "Restzeit wird geschätzt…";
  if (ms < 60_000) return "noch unter einer Minute";
  const min = Math.round(ms / 60_000);
  if (min < 90) return `noch ca. ${min} Min.`;
  return `noch ca. ${(ms / 3_600_000).toFixed(1).replace(".", ",")} Std.`;
}
