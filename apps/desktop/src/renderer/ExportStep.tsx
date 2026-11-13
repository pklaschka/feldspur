/**
 * Schritt „Ausgeben“: ein Ordner pro Einsatz mit Montagevideo, Zeitgerüst (.docx) und Begleitprotokoll.
 */
import { useEffect, useState } from "react";
import type { ScaffoldPreview, SessionView } from "../shared/api.ts";
import { percent, remainingMs, remainingText, useExport } from "./exportState.tsx";
import { formatDuration } from "@feldspur/core/time";
import { MontageView } from "./MontageView.tsx";
import { Button, Notice, Panel, StepHeader, Toggle } from "./ui.tsx";

const api = window.feldspur;

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo zum Zuordnen: Uhrzeit, Videos und Ton mit Herkunft, Montage-ID"],
  [/\.docx$/, "Zeitgerüst für MAXQDA, mit Zeitmarken zum Video, Mitschrift und Bildern"],
  [/\.csv$/, "Begleitprotokoll: Herkunft und Zeitnachweis jeder Datei"],
  [/\.fcpxml$/, "Schnittliste für DaVinci Resolve (Datei › Importieren › Timeline)"],
];

export function ExportStep({ view }: { view: SessionView }) {
  const [preview, setPreview] = useState<ScaffoldPreview | null>(null);
  const [video, setVideo] = useState(true);
  const [resolve, setResolve] = useState(false);
  const [watching, setWatching] = useState(false);
  const [mixAudio, setMixAudio] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const ex = useExport();
  const sessionId = view.session.id;
  const busy = ex.job?.sessionId === sessionId;
  const elsewhere = !!ex.job && !busy;
  const progress = busy ? ex.job!.progress : null;
  const result = busy ? null : (ex.results[sessionId] ?? null);
  const error = busy ? null : (ex.errors[sessionId] ?? null);

  useEffect(() => {
    let live = true;
    void api.previewExport(sessionId, realtime).then(
      (p) => live && setPreview(p),
      () => live && setPreview(null),
    );
    return () => {
      live = false;
    };
  }, [view, sessionId, realtime]);
  const run = () => ex.start(sessionId, { video, resolve, mixAudio, realtime });

  const fact = (n: number | string, label: string) => (
    <div className="grid">
      <b className="text-2xl font-semibold tabular-nums">{n}</b>
      <span className="text-[0.8rem] text-muted">{label}</span>
    </div>
  );
  const empty = !preview || preview.durationMs <= 0;
  const pct = percent(progress);

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
            <p className="mb-1.5">
              Das Video zeigt nur, was zum Zuordnen nötig ist: Uhrzeit, die laufenden Videos (gleichzeitige
              nebeneinander) mit Datei und Stelle im Original, die laufenden Tonquellen und eine Montage-ID, die auch im
              Kopf des Zeitgerüsts steht. Fotos und Tagebuch stehen im Zeitgerüst.
            </p>
            <p>
              Episoden laufen in voller Länge, Zeit dazwischen wird zu einer kurzen Tafel. In Echtzeit läuft der ganze
              Einsatz am Stück, auch die Zeit ohne Episode. Weitertippen kannst du in MAXQDA an jeder Stelle, weil jede
              Zeile schon eine Zeitmarke hat.
            </p>
          </>
        }
      />
      <div className="grid max-w-[1100px] gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Panel>
          <div className="flex gap-8">
            {fact(preview ? formatDuration(preview.durationMs) : "–", "Videolänge")}
            {fact(preview?.episodes ?? "–", "Episoden")}
            {fact(preview?.cards ?? "–", realtime ? "Zwischenzeiten" : "Zwischentafeln")}
          </div>
          <label className="mt-4 flex items-center gap-2.5 text-[0.9rem]">
            <Toggle checked={realtime} onChange={setRealtime} label="In Echtzeit statt nach Episoden" />
            In Echtzeit statt nach Episoden
          </label>
          <p className="mt-1 pl-[2.4rem] text-[0.8rem] text-muted">
            Der ganze Einsatz am Stück, auch die Zeit zwischen den Episoden. Länger, aber Videozeit = Uhrzeit ab Beginn.
          </p>
          <Button className="mt-4" disabled={empty} onClick={() => setWatching(true)}>
            Montage ansehen
          </Button>
          <MontageView sessionId={sessionId} realtime={realtime} open={watching} onOpenChange={setWatching} />
          <label className="mt-5 flex items-center gap-2.5 text-[0.9rem]">
            <Toggle checked={video} onChange={setVideo} label="Montagevideo mit ausgeben" />
            Montagevideo mit ausgeben
          </label>
          <p className="mt-1 pl-[2.4rem] text-[0.8rem] text-muted">
            Dauert je nach Länge einige Minuten; bei der nächsten Ausgabe wird nur neu gerechnet, was sich geändert hat.
            Ohne Video entstehen nur Zeitgerüst und Protokoll.
          </p>
          <label className="mt-3 flex items-center gap-2.5 text-[0.9rem]">
            <Toggle checked={mixAudio} onChange={setMixAudio} label="Ton aller Geräte mischen" />
            Ton aller Geräte mischen
          </label>
          <p className="mt-1 pl-[2.4rem] text-[0.8rem] text-muted">
            Laufen mehrere Aufnahmen gleichzeitig, liegt ihr Ton übereinander. Aus: nur die Hauptquelle (Referenzgerät,
            sonst die längste). Bei ungenauem Abgleich klingt die Mischung hallig.
          </p>
          <label className="mt-3 flex items-center gap-2.5 text-[0.9rem]">
            <Toggle checked={resolve} onChange={setResolve} label="Schnittliste für DaVinci Resolve" />
            Schnittliste für DaVinci Resolve
          </label>
          <p className="mt-1 pl-[2.4rem] text-[0.8rem] text-muted">
            Dieselbe Montage als FCPXML, mit Markern für Mitschrift und Ereignisse. Resolve rechnet dann selbst; die
            Einblendungen (Uhrzeit, Herkunft, Montage-ID) fehlen dort.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" disabled={!!ex.job || empty} onClick={run}>
              {busy ? "Gibt aus…" : "Ausgeben…"}
            </Button>
            {empty && <span className="text-[0.85rem] text-muted">Noch keine Quelle mit Uhrzeit.</span>}
            {elsewhere && (
              <span className="text-[0.85rem] text-muted">Ein anderer Einsatz wird gerade ausgegeben.</span>
            )}
          </div>
          {busy && (
            <p className="mt-2 text-[0.8rem] text-muted">
              Du kannst währenddessen weiterarbeiten oder den Reiter wechseln; die Ausgabe läuft weiter. Änderungen ab
              jetzt kommen erst in die nächste Ausgabe.
            </p>
          )}
          {error && (
            <div className="mt-4">
              <Notice>Ausgabe fehlgeschlagen: {error}</Notice>
            </div>
          )}
          {busy && (
            <div className="mt-4" data-testid="export-progress">
              <div className="mb-1 flex justify-between text-[0.8rem] text-muted">
                <span>{progress?.step ?? "Vorbereiten"}</span>
                <span className="tabular-nums">
                  {progress?.step === "Montagevideo" && `${remainingText(remainingMs(ex.job))} · `}
                  {pct} %
                </span>
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
