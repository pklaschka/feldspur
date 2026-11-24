/**
 * Schritt „Ausgeben“: ein Ordner pro Einsatz mit Montagevideo, Einsatztranskript (.docx), Dokumentvariablen und
 * Begleitprotokoll.
 *
 * Eingebunden von `app/SessionPane.tsx`. Diese Datei setzt die Teile aus `export/` zusammen (Optionen, Fortschritt,
 * Ergebnis, Vorschau des Einsatztranskripts) und entscheidet, was gerade zu sehen ist. Die laufende Ausgabe hält
 * `exportState.tsx` oberhalb der Einsätze; gerechnet wird im Hauptprozess (`apps/desktop/src/main/export.ts`,
 * `apps/desktop/src/main/ipc/export.ts`, `packages/media`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionView } from "../shared/api.ts";
import { cancelledText, useExport } from "./exportState.tsx";
import { formatDuration } from "@feldspur/core/time";
import { MontageView } from "./MontageView.tsx";
import { todos, type Todo } from "./inspector/status.ts";
import { TodoList } from "./inspector/Summary.tsx";
import { Button, Notice, Panel, StepHeader } from "./ui.tsx";
import { ContextCard } from "./export/ContextCard.tsx";
import { ExportOptions } from "./export/ExportOptions.tsx";
import { ExportProgress } from "./export/ExportProgress.tsx";
import { ExportResult } from "./export/ExportResult.tsx";
import { useExportOptions } from "./export/options.ts";
import { PreCheckResult } from "./export/PreCheckResult.tsx";
import { TranscriptPreview } from "./export/TranscriptPreview.tsx";
import { useExportCard, useExportStatus, useTranscriptPreview } from "./export/hooks.ts";

const api = window.feldspur;

export function ExportStep({
  view,
  onGo,
  onView,
  onOriginals,
}: {
  view: SessionView;
  /** Zu einer offenen Aufgabe springen (Schritt und ggf. Quelle), aus der Liste „Noch offen“. */
  onGo: (t: Todo) => void;
  onView: (v: SessionView) => void;
  /** Dialog „Originaldateien“ (`Originals.tsx`) öffnen. */
  onOriginals: () => void;
}) {
  const [opts, set] = useExportOptions();
  const { video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, byEpisodes } = opts;
  const [watching, setWatching] = useState(false);
  const withEpisodes = view.session.episodes;
  // Echtzeit ist der Normalfall; nach Episoden geschnitten wird nur, wenn der Einsatz Episoden hat und es gewählt ist.
  const realtime = !(withEpisodes && byEpisodes);
  const ex = useExport();
  const sessionId = view.session.id;
  // Es läuft höchstens eine Ausgabe zur Zeit: `busy` = die dieses Einsatzes, `elsewhere` = die eines anderen.
  const busy = ex.job?.sessionId === sessionId;
  const elsewhere = !!ex.job && !busy;
  const justDone = busy ? null : (ex.results[sessionId] ?? null);
  const error = busy ? null : (ex.errors[sessionId] ?? null);
  const cancelled = busy ? null : (ex.cancelled[sessionId] ?? null);
  const settings = useMemo(
    () => ({ video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, realtime }),
    [video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, realtime],
  );
  // Stand der letzten Ausgabe steht in der Projektdatei und übersteht so auch einen Neustart.
  const status = useExportStatus(view, settings, busy, justDone);
  const result = busy || status?.record.sessionId !== sessionId ? null : status;
  const preview = useTranscriptPreview(view, realtime);
  // Hat die Prüfung der Originale (erster Schritt der Ausgabe) etwas gefunden, hält die Ausgabe an. Das Ergebnis
  // gilt nur für die Einstellung (mit/ohne Video) und die Pfade, mit denen geprüft wurde.
  const held = busy ? null : (ex.held[sessionId] ?? null);
  const paths = view.rows.map((r) => r.originalPath).join("\n");
  const found = held && held.opts.video === video && held.key === paths ? held : null;
  // Nach der Prüfung kennt die App die Prüfsummen: Zustand der Originale in der Ansicht auffrischen.
  const checkedJob = useRef(false);
  useEffect(() => {
    if (busy) {
      checkedJob.current = true;
      return;
    }
    if (!checkedJob.current) return;
    checkedJob.current = false;
    void api.getSession(sessionId).then(onView, () => {});
  }, [busy, sessionId, onView]);
  /** Ausgeben: erst Ordner wählen, dann prüft die Ausgabe als ersten Schritt die Originale (Issue #116). */
  const run = (reuse = false) => {
    ex.start(sessionId, { ...settings, reuseDir: reuse }, paths);
  };
  /** Nach der Prüfung bewusst weiter: gleiche Einstellungen, schon gewählter Ordner. */
  const proceed = () => {
    if (!found) return;
    ex.start(sessionId, { ...found.opts, reuseDir: false, dir: found.parent, acceptOriginals: true }, paths);
  };
  // Veraltet: Seit der letzten Ausgabe hat sich etwas geändert, das ihr Ergebnis bestimmt.
  const stale = !!result && result.differences.length > 0;
  // Zahlen für die Beleg-Karte, nur für eine aktuelle Ausgabe (dann gleichen sie denen der Ausgabe).
  const card = useExportCard(view, settings, result && !stale ? result.record.exportedAt : null);

  const empty = !preview || preview.durationMs <= 0;
  const open = todos(view);

  return (
    <>
      <StepHeader
        className="max-w-[1240px]"
        title="Ausgeben"
        summary="Ein Ordner pro Einsatz. Immer dabei sind Einsatztranskript für MAXQDA, Dokumentvariablen und Begleitprotokoll; was dazukommt, wählst du unten."
        help={
          <>
            <p className="mb-1.5">
              In MAXQDA das Einsatztranskript (.docx) als Transkript importieren und das Montagevideo als Mediendatei
              zuordnen. Die Zeitmarken <code>#hh:mm:ss-z#</code> zeigen auf Stellen im Video; die echte Uhrzeit steht in
              jeder Zeile dahinter.
            </p>
            <p className="mb-1.5">
              Das Video zeigt nur, was zum Zuordnen nötig ist: Uhrzeit, die laufenden Videos (gleichzeitige
              nebeneinander) mit Datei und Stelle im Original, die laufenden Tonquellen und eine Montage-ID, die auch im
              Kopf des Einsatztranskripts steht. Fotos und Tagebuch stehen im Einsatztranskript.
            </p>
            <p>
              Standard ist Echtzeit: Der ganze Einsatz läuft am Stück, Videozeit = Uhrzeit ab Beginn. Wer unter
              „Durchsehen“ Episoden einschaltet, kann stattdessen nach Episoden schneiden: Episoden laufen in voller
              Länge, Zeit dazwischen wird zu einer kurzen Tafel. Weitertippen kannst du in MAXQDA an jeder Stelle, weil
              jede Zeile schon eine Zeitmarke hat.
            </p>
          </>
        }
      />
      {result && !stale && !busy && !error && !cancelled ? (
        // Die Beleg-Karte ist selbst die Karte: kein Rahmen um den Rahmen.
        <div className="mb-5 max-w-[1240px] pr-1.5">
          <ExportResult
            status={result}
            card={card}
            fresh={!!justDone}
            disabled={!!found}
            onRerun={() => run(true)}
            onRerunElsewhere={() => run()}
          />
        </div>
      ) : (
        (busy || result || error || cancelled) && (
          <Panel className="mb-4 max-w-[1240px]">
            {busy && <ExportProgress job={ex.job!} onCancel={ex.cancel} />}
            {error && <Notice>Ausgabe fehlgeschlagen: {error}</Notice>}
            {cancelled && (
              <p className="text-[0.9rem]" role="status" data-testid="export-cancelled">
                {cancelledText(cancelled)}
              </p>
            )}
            {result && (
              <ExportResult
                status={result}
                card={card}
                fresh={!!justDone && !stale}
                disabled={!!ex.job || !!found}
                onRerun={() => run(true)}
                onRerunElsewhere={() => run()}
              />
            )}
          </Panel>
        )
      )}
      {/* Nebeneinander, sobald die Mitte breit genug ist (Containerbreite, nicht Fenster): so bleibt die Vorschau lesbar. */}
      <div className="@container max-w-[1240px]">
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Panel>
            <p className="font-serif text-[1.1rem] leading-snug" data-testid="export-summary">
              {!preview ? (
                "Die Montage wird berechnet…"
              ) : (
                <>
                  Das Montagevideo wird <b className="font-semibold">{formatDuration(preview.durationMs)}</b> lang
                  {withEpisodes ? (
                    <>
                      , mit <b className="font-semibold">{preview.episodes}</b>{" "}
                      {preview.episodes === 1 ? "Episode" : "Episoden"} und{" "}
                      <b className="font-semibold">{preview.cards}</b> {realtime ? "Zwischenzeiten" : "Zwischentafeln"}.
                    </>
                  ) : (
                    realtime && ", der ganze Einsatz in Echtzeit."
                  )}
                </>
              )}
              <Button
                variant="link"
                className="ml-2 font-sans text-[0.9rem]"
                disabled={empty}
                onClick={() => setWatching(true)}
              >
                Montage ansehen…
              </Button>
            </p>
            <MontageView
              sessionId={sessionId}
              realtime={realtime}
              open={watching}
              onOpenChange={setWatching}
              levels={new Map(view.rows.map((r) => [r.id, r.level]))}
            />
            <ExportOptions
              opts={opts}
              set={set}
              withEpisodes={withEpisodes}
              videoBytes={preview && !empty ? preview.videoBytes : null}
            />
            {view.context.length > 0 && <ContextCard view={view} onView={onView} />}
            {open.length > 0 && !empty && (
              <section className="mt-5 border-t border-line pt-3 text-[0.9rem]" data-testid="export-open">
                <b className="block font-semibold text-warn">Noch offen</b>
                <p className="mb-1.5 text-[0.85rem]">
                  Ausgeben geht trotzdem; was offen ist, steht dann so im Einsatztranskript, wie es gerade liegt.
                </p>
                <TodoList items={open} onGo={onGo} />
              </section>
            )}
            {found && (
              <PreCheckResult
                view={view}
                result={found.result}
                parent={found.parent}
                onOriginals={onOriginals}
                onContinue={proceed}
                onCancel={() => ex.dismiss(sessionId)}
              />
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!!ex.job || empty || !!found} onClick={() => run()}>
                {busy ? "Gibt aus…" : open.length ? "Trotzdem ausgeben…" : "Ausgeben…"}
              </Button>
              {empty && <span className="text-[0.9rem] text-muted">Noch keine Quelle mit Uhrzeit.</span>}
              {elsewhere && (
                <span className="text-[0.9rem] text-muted">Ein anderer Einsatz wird gerade ausgegeben.</span>
              )}
            </div>
          </Panel>
          <TranscriptPreview preview={preview} />
        </div>
      </div>
    </>
  );
}
