/**
 * „Alle Einsätze ausgeben…“ in der Übersicht (Issue #209): Fortschritt und Ergebnis des Projektordners. Den Lauf hält
 * `apps/desktop/src/renderer/exportState.tsx` oberhalb der Ansichten, damit er einen Wechsel in einen Einsatz
 * übersteht; gerechnet wird im Hauptprozess (`apps/desktop/src/main/project-export.ts`).
 *
 * Die Karte erscheint nur, solange ein Lauf läuft oder sein Ergebnis noch nicht weggeklickt ist.
 */
import type { ProjectExportResult, ProjectExportSession } from "../../shared/api.ts";
import { germanDate } from "../../shared/methods-table.ts";
import type { Step } from "../App.tsx";
import { ExportProgress } from "../export/ExportProgress.tsx";
import { inDir } from "../export/text.ts";
import type { ExportJob, ProjectExportJob } from "../exportState.tsx";
import { Button, cx, Panel } from "../ui.tsx";
import { count } from "./text.ts";

const api = window.feldspur;

/** Was aus einem Einsatz wurde, in Worten; „held“ und „failed“ bringen ihren eigenen Satz mit (`detail`). */
const OUTCOME_TEXT: Record<ProjectExportSession["outcome"], string> = {
  written: "Neu ausgegeben",
  unchanged: "Unverändert, nicht neu ausgegeben",
  empty: "Nichts auszugeben: keine Quelle mit Uhrzeit",
  held: "Angehalten",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  pending: "Nicht mehr begonnen",
};

/** Liegt der Einsatz nach dem Lauf so im Ordner, wie er jetzt ist? */
const settled = (x: ProjectExportSession) => x.outcome === "written" || x.outcome === "unchanged";

/** „3 Einsätze neu ausgegeben, 1 unverändert übernommen.“ */
function resultSummary(r: ProjectExportResult): string {
  const written = r.sessions.filter((x) => x.outcome === "written").length;
  const unchanged = r.sessions.filter((x) => x.outcome === "unchanged").length;
  const parts = [
    written ? `${count(written, "Einsatz", "Einsätze")} neu ausgegeben` : "",
    unchanged ? `${unchanged} unverändert übernommen` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "";
}

export function ProjectExport({
  project,
  job,
  result,
  error,
  settings,
  titles,
  onCancel,
  onRetry,
  onDismiss,
  onOpen,
}: {
  /** Der laufende Lauf; null, sobald er fertig ist. */
  project: ProjectExportJob | null;
  /** Die Ausgabe des Einsatzes, der gerade an der Reihe ist. */
  job: ExportJob | null;
  result: ProjectExportResult | null;
  error: string | null;
  /** Was je Einsatz ausgegeben wird, in einem Satz. */
  settings: string;
  /** Titel und Datum je Einsatz-Id, für die Zeile „Einsatz 2 von 4“. */
  titles: ReadonlyMap<string, string>;
  onCancel: () => void;
  /** Noch einmal in denselben Ordner; `accept` übergeht die Auffälligkeiten der Originale dieses Einsatzes. */
  onRetry: (result: ProjectExportResult, accept?: string) => void;
  onDismiss: () => void;
  onOpen: (sessionId: string, step?: Step) => void;
}) {
  if (!project && !result && !error) return null;
  return (
    <Panel>
      <div data-testid="project-export">
        {project && (
          <>
            <h2 className="text-[1.05rem] font-semibold">Projektordner wird geschrieben</h2>
            <p className="mt-1 mb-3 max-w-[78ch] text-[0.88rem] text-muted">{settings}</p>
            {job && project.at ? (
              <>
                <p className="mb-1.5 text-[0.9rem] font-medium" data-testid="project-export-at">
                  Einsatz {project.at.index + 1} von {project.at.total}
                  <span className="font-normal text-ink-2"> · {titles.get(job.sessionId) ?? ""}</span>
                </p>
                <ExportProgress job={job} onCancel={onCancel} />
              </>
            ) : (
              <div className="flex items-center gap-3 text-[0.9rem]" role="status">
                <span>
                  {project.cancelling
                    ? "Bricht ab…"
                    : project.at
                      ? "Schreibt die gemeinsame LIESMICH…"
                      : "Sieht nach, welche Einsätze sich seit ihrer Ausgabe geändert haben…"}
                </span>
                <span className="flex-1" />
                <Button size="sm" disabled={project.cancelling} onClick={onCancel}>
                  Abbrechen
                </Button>
              </div>
            )}
          </>
        )}
        {!project && error && (
          <div className="flex flex-wrap items-start gap-3">
            <p role="alert" className="min-w-0 flex-1 text-[0.9rem] text-bad">
              Der Projektordner ließ sich nicht schreiben: {error}
            </p>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Schließen
            </Button>
          </div>
        )}
        {!project && result && (
          <>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-56 flex-[1_1_0%]">
                <h2
                  className={cx("text-[1.05rem] font-semibold", result.complete ? "text-good" : "text-warn")}
                  data-testid="project-export-result"
                >
                  {result.complete ? (
                    <>
                      <span aria-hidden>✓ </span>Projektordner geschrieben
                    </>
                  ) : result.cancelled ? (
                    "Abgebrochen. Der Projektordner ist nicht vollständig."
                  ) : (
                    "Der Projektordner ist noch nicht vollständig"
                  )}
                </h2>
                <p className="mt-1 max-w-[78ch] text-[0.88rem] text-ink-2 [overflow-wrap:anywhere]">
                  {result.complete
                    ? `${resultSummary(result)} Darüber liegt die LIESMICH mit Feldkalender und den Tabellen über alle Einsätze.`
                    : "Die gemeinsame LIESMICH entsteht erst, wenn jeder gewählte Einsatz in seinem jetzigen Stand im Ordner liegt. Was schon ausgegeben ist, bleibt und wird beim nächsten Mal nicht neu gerechnet."}
                </p>
                <p className="mt-1 text-[0.85rem] text-muted [overflow-wrap:anywhere]">{result.dir}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result.complete ? (
                  <Button onClick={() => void api.openProjectReadme()}>LIESMICH öffnen</Button>
                ) : (
                  <Button onClick={() => onRetry(result)}>Erneut ausgeben</Button>
                )}
                <Button
                  onClick={() =>
                    void api.showInFolder(result.complete ? inDir(result.dir, "LIESMICH.html") : result.dir)
                  }
                >
                  Im Ordner zeigen
                </Button>
                <Button variant="ghost" onClick={onDismiss}>
                  Schließen
                </Button>
              </div>
            </div>
            <ul className="mt-3 border-t border-line/70" data-testid="project-export-sessions">
              {result.sessions.map((x) => (
                <li
                  key={x.sessionId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line/70 py-1.5 text-[0.9rem]"
                >
                  <span className="min-w-0 basis-72 font-medium [overflow-wrap:anywhere]">
                    <span className="font-normal text-muted tabular-nums">{germanDate(x.date)}</span> {x.title}
                  </span>
                  <span
                    className={cx(
                      "min-w-0 flex-1 basis-64",
                      settled(x) || x.outcome === "empty" ? "text-ink-2" : "text-warn",
                    )}
                  >
                    {OUTCOME_TEXT[x.outcome]}
                    {x.detail && (x.outcome === "held" || x.outcome === "failed") ? `: ${x.detail}` : ""}
                  </span>
                  {x.outcome === "held" && !x.blocking && (
                    <Button variant="link" onClick={() => onRetry(result, x.sessionId)}>
                      Trotzdem ausgeben
                      <span className="sr-only">: {x.title}</span>
                    </Button>
                  )}
                  {(x.outcome === "held" || x.outcome === "failed") && (
                    <Button variant="link" onClick={() => onOpen(x.sessionId, "export")}>
                      Im Einsatz ansehen<span aria-hidden> →</span>
                      <span className="sr-only">: {x.title}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Panel>
  );
}
