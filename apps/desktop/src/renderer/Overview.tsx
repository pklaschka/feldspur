/**
 * Übersicht des Projekts (Issue #203, Gesamtkonzept #202): die Ebene über den Einsätzen. Je Feldtag eine Zeile mit
 * gezählten Tatsachen, darunter die Kennwerte als zwei Tabellen zum Kopieren in den Methodenteil. Die erste zeigt,
 * welche Aufzeichnungen in die gewählten Feldtage hineingeflossen sind, die zweite, was Feldspur daraus ausgibt.
 *
 * Feldspur zählt und misst hier nur. Farbe kennzeichnet Zustände (Ausgabe veraltet, Uhr ohne Abgleich), nie Mengen.
 *
 * Darunter die Angaben zum Datensatz (Issue #206, `overview/DatasetCard.tsx`), die jede Ausgabe nennt.
 *
 * Im Kopf steht „Alle Einsätze ausgeben…“ (Issue #209): die Einsätze mit Häkchen in einen gemeinsamen Projektordner,
 * mit den Schaltern aus dem Schritt „Ausgeben“. Fortschritt und Ergebnis zeigt `overview/ProjectExport.tsx`.
 *
 * Gezeigt von `App.tsx` anstelle eines Einsatzes. Die Zahlen rechnet der Hauptprozess bei jedem Öffnen neu
 * (`projectOverview`, `apps/desktop/src/main/export.ts`); die beiden Karten liegen in `overview/` (`FieldCalendar`,
 * `Metrics`), der Text der Tabellen kommt aus `apps/desktop/src/shared/methods-table.ts`.
 */
import { useEffect, useState } from "react";
import type { ProjectExportRequest, ProjectExportResult, ProjectOverview } from "../shared/api.ts";
import { ALL_VERSIONS_DOI } from "../shared/citation.ts";
import { germanDate, softwareLine } from "../shared/methods-table.ts";
import type { Step } from "./App.tsx";
import { useExportOptions } from "./export/options.ts";
import { useExport } from "./exportState.tsx";
import { Button, ErrorBanner, Panel } from "./ui.tsx";
import { FieldCalendar } from "./overview/FieldCalendar.tsx";
import { Metrics, type Copied } from "./overview/Metrics.tsx";
import { DatasetCard } from "./overview/DatasetCard.tsx";
import { ProjectExport } from "./overview/ProjectExport.tsx";
import { settingsText, spanText } from "./overview/text.ts";

const api = window.feldspur;

export function Overview({
  name,
  onOpen,
}: {
  /** Name des Projekts. */
  name: string;
  /** Einen Einsatz öffnen, auf Wunsch gleich in einem bestimmten Schritt und (in Durchsehen) an einer Uhrzeit. */
  onOpen: (sessionId: string, step?: Step, atMs?: number) => void;
}) {
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** Abgewählte Einsätze (ids): Sie zählen in Kennwerten und Grafik nicht mit. Wird nicht gespeichert. */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // Meldungen der beiden Karten liegen hier, weil jede Änderung der Auswahl sie zurücknimmt.
  const [copied, setCopied] = useState<Copied>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const ex = useExport();
  const [exportOpts] = useExportOptions();
  // Nach „Alle Einsätze ausgeben…“ neu zählen: Der Stand der Ausgaben hat sich geändert.
  const projectResult = ex.projectResult;
  useEffect(() => {
    let live = true;
    void api.projectOverview().then(
      (d) => live && setData(d),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [projectResult]);

  const all = data ? [...data.sessions].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const chosen = all.filter((s) => !skipped.has(s.sessionId));
  // Gewissheit im Kopf: Jeder Feldtag, aus dem sich etwas ausgeben lässt, hat eine Ausgabe, die zum Stand passt.
  const exportable = all.filter((s) => s.output.durationMs > 0);
  const allCurrent = exportable.length > 0 && exportable.every((s) => s.exported === "current");
  // Zeile unter den Tabellen: Feldspur mit Version und DOI (DOI dieser Version, falls schon nachgeschlagen).
  const software = data
    ? softwareLine({
        version: data.citation.version,
        released: data.citation.released,
        doi: data.citation.versionDoi?.doi ?? ALL_VERSIONS_DOI,
      })
    : "";
  // „Alle Einsätze ausgeben…“: die Schalter des Schritts „Ausgeben“; geschnitten wird nach Episoden nur dort, wo ein
  // Einsatz welche bildet (das entscheidet der Hauptprozess je Einsatz).
  const request: ProjectExportRequest = {
    video: exportOpts.video,
    resolve: exportOpts.resolve,
    mixAudio: exportOpts.mixAudio,
    deviceTracks: exportOpts.deviceTracks,
    viewer: exportOpts.viewer,
    readme: exportOpts.readme,
    changeLog: exportOpts.changeLog,
    manifest: exportOpts.manifest,
    roCrate: exportOpts.roCrate,
    originals: exportOpts.originals,
    realtime: !exportOpts.byEpisodes,
  };
  const toExport = chosen.filter((s) => s.output.durationMs > 0);
  const exporting = !!ex.job || !!ex.project;
  const exportAll = () =>
    ex.startProject(
      toExport.map((s) => s.sessionId),
      request,
    );
  const retry = (r: ProjectExportResult, accept?: string) =>
    ex.startProject(
      r.sessions.map((x) => x.sessionId),
      { ...request, dir: r.dir, accept: accept ? [accept] : undefined },
    );
  const toggle = (id: string) => {
    setCopied(null);
    setSaved(null);
    setSkipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  // „relative“ am Rollbereich: Sonst hängen die unsichtbaren Texte für Screenreader am Fenster statt an dieser
  // Fläche und erzeugen eine zweite Bildlaufleiste.
  return (
    <main className="relative col-span-2 overflow-auto" data-testid="overview">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-6 pt-5 pb-4">
        <h1 className="flex min-w-0 flex-[1_1_0%] flex-wrap items-baseline gap-x-3 text-[1.4rem] font-semibold">
          {name}
          <span className="font-serif text-[1rem] font-normal text-muted italic">
            {data ? spanText(all) : "Übersicht"}
          </span>
          {allCurrent && (
            <span className="font-sans text-[0.9rem] font-medium text-good" data-testid="overview-all-current">
              <span aria-hidden>✓ </span>
              {exportable.length === 1 ? "Ausgabe aktuell" : "Alle Ausgaben aktuell"}
            </span>
          )}
        </h1>
        {all.length > 0 && (
          <Button
            variant="primary"
            disabled={exporting || toExport.length === 0}
            onClick={exportAll}
            title={`Die Einsätze mit Häkchen in einen gemeinsamen Projektordner. ${settingsText(exportOpts)}`}
            data-testid="overview-export-all"
          >
            {ex.project
              ? "Gibt aus…"
              : chosen.length === all.length
                ? "Alle Einsätze ausgeben…"
                : `${toExport.length} von ${all.length} Einsätzen ausgeben…`}
          </Button>
        )}
      </header>
      <div className="grid max-w-[1640px] gap-4 p-5">
        <ErrorBanner />
        {failed && (
          <p role="alert" className="text-[0.9rem] text-bad">
            Die Übersicht ließ sich nicht berechnen: {failed}
          </p>
        )}
        {!data && !failed && <p className="text-[0.9rem] text-muted">Die Einsätze werden gezählt…</p>}
        {data && all.length === 0 && (
          <Panel>
            <h2 className="mb-1 text-[1.05rem] font-semibold">Noch kein Einsatz</h2>
            <p className="max-w-[60ch] text-muted">
              Hier liegen später alle Einsätze des Projekts untereinander auf einer Uhrzeit-Achse, darunter die
              Kennwerte für den Methodenteil. Lege links unter „Einsätze“ den ersten Einsatz an.
            </p>
          </Panel>
        )}
        <ProjectExport
          project={ex.project}
          job={ex.project ? ex.job : null}
          result={ex.projectResult}
          error={ex.projectError}
          settings={settingsText(exportOpts)}
          titles={new Map(all.map((s) => [s.sessionId, `${s.title} · ${germanDate(s.date)}`]))}
          onCancel={ex.cancel}
          onRetry={retry}
          onDismiss={ex.dismissProject}
          onOpen={onOpen}
        />
        {data && all.length > 0 && (
          <>
            <FieldCalendar
              sessions={all}
              skipped={skipped}
              onToggle={toggle}
              onOpen={onOpen}
              saved={saved}
              onSaved={setSaved}
            />
            <Metrics total={all.length} chosen={chosen} software={software} copied={copied} onCopied={setCopied} />
          </>
        )}
        {data && (
          <DatasetCard
            saved={data.dataset}
            researchers={data.researchers}
            projectName={name}
            onSaved={(dataset) => setData({ ...data, dataset })}
          />
        )}
      </div>
    </main>
  );
}
