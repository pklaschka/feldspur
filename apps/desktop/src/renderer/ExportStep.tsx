/**
 * Schritt „Ausgeben“: ein Ordner pro Einsatz mit Montagevideo, Zeitgerüst (.docx) und Begleitprotokoll.
 */
import { useEffect, useState } from "react";
import type { ExportOutcome, ExportProgress, ScaffoldPreview, SessionView } from "../shared/api.ts";
import { formatDuration } from "@feldspur/core/time";
import { Button, Notice, Panel, StepHeader, Toggle } from "./ui.tsx";

const api = window.feldspur;
type Guard = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo: alle Episoden am Stück, Zwischentafeln für Fotos und Tagebuch"],
  [/\.docx$/, "Zeitgerüst für MAXQDA, mit Zeitmarken zum Video, Mitschrift und Bildern"],
  [/\.csv$/, "Begleitprotokoll: Herkunft und Zeitnachweis jeder Datei"],
];

export function ExportStep({ view, guard }: { view: SessionView; guard: Guard }) {
  const [preview, setPreview] = useState<ScaffoldPreview | null>(null);
  const [video, setVideo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const sessionId = view.session.id;

  useEffect(() => {
    let live = true;
    void api.previewExport(sessionId).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId]);
  useEffect(() => api.onExportProgress(setProgress), []);

  const run = async () => {
    setBusy(true);
    setResult(null);
    setProgress(null);
    const r = await guard(() => api.exportSession(sessionId, { video }));
    setBusy(false);
    setProgress(null);
    if (r) setResult(r);
  };

  const fact = (n: number | string, label: string) => (
    <div className="grid">
      <b className="text-2xl font-semibold tabular-nums">{n}</b>
      <span className="text-[0.8rem] text-muted">{label}</span>
    </div>
  );
  const empty = !preview || preview.durationMs <= 0;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <StepHeader
        title="Ausgeben"
        summary="Ein Ordner pro Einsatz: Montagevideo, Zeitgerüst für MAXQDA und Begleitprotokoll."
        help={
          <>
            <p className="mb-1.5">
              In MAXQDA das Zeitgerüst (.docx) als Transkript importieren und das Montagevideo als Mediendatei zuordnen.
              Die Zeitmarken <code>#hh:mm:ss-z#</code> zeigen auf Stellen im Video; die echte Uhrzeit steht in jeder
              Zeile dahinter.
            </p>
            <p>
              Episoden laufen im Video in voller Länge. Zeit ohne Aufnahme wird zu einer kurzen Zwischentafel, Fotos und
              Tagebucheinträge darin bekommen je drei Sekunden. Weitertippen kannst du in MAXQDA an jeder Stelle, weil
              jede Zeile schon eine Zeitmarke hat.
            </p>
          </>
        }
      />
      <div className="grid max-w-[1100px] gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Panel>
          <div className="flex gap-8">
            {fact(preview ? formatDuration(preview.durationMs) : "–", "Videolänge")}
            {fact(preview?.episodes ?? "–", "Episoden")}
            {fact(preview?.cards ?? "–", "Zwischentafeln")}
          </div>
          <label className="mt-5 flex items-center gap-2.5 text-[0.9rem]">
            <Toggle checked={video} onChange={setVideo} label="Montagevideo mit ausgeben" />
            Montagevideo mit ausgeben
          </label>
          <p className="mt-1 pl-[2.4rem] text-[0.8rem] text-muted">
            Dauert je nach Länge einige Minuten. Ohne Video entstehen nur Zeitgerüst und Protokoll.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" disabled={busy || empty} onClick={() => void run()}>
              {busy ? "Gibt aus…" : "Ausgeben…"}
            </Button>
            {empty && <span className="text-[0.85rem] text-muted">Noch keine Quelle mit Uhrzeit.</span>}
          </div>
          {busy && (
            <div className="mt-4" data-testid="export-progress">
              <div className="mb-1 flex justify-between text-[0.8rem] text-muted">
                <span>{progress?.step ?? "Vorbereiten"}</span>
                {progress && progress.total > 1 && (
                  <span className="tabular-nums">
                    {progress.done} / {progress.total}
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {result && (
            <div className="mt-5" data-testid="export-result">
              <Notice>
                Fertig. {result.files.length} Dateien im Ordner „{fileName(result.dir)}“.
              </Notice>
              <ul className="mt-3 grid gap-2">
                {result.files.map((f) => (
                  <li key={f} className="text-[0.85rem]">
                    <span className="font-medium break-all">{fileName(f)}</span>
                    <span className="block text-[0.8rem] text-muted">
                      {FILE_ROLE.find(([re]) => re.test(f))?.[1] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
              <Button size="sm" className="mt-3" onClick={() => void api.showInFolder(result.files[0] ?? result.dir)}>
                Im Ordner zeigen
              </Button>
            </div>
          )}
        </Panel>
        <Panel className="min-w-0">
          <h3 className="mb-2 text-[0.9rem] font-semibold">Vorschau des Zeitgerüsts</h3>
          <ol
            className="max-h-[60vh] overflow-y-auto font-mono text-[0.78rem] leading-relaxed text-ink-2"
            data-testid="scaffold-preview"
          >
            {preview?.lines.map((l, i) => (
              <li key={i} className="border-b border-line/60 py-1 break-words">
                {l}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
