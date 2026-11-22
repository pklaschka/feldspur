/**
 * Dialog „Tabelle für den Methodenteil“ (Issue #149): zwei Tabellen zum Kopieren in einen Aufsatz. Die erste zeigt,
 * welche Aufzeichnungen in die gewählten Einsätze hineingeflossen sind, die zweite, was Feldspur daraus ausgibt.
 * Es entsteht keine Datei; das Begleitprotokoll bleibt der vollständige Nachweis je Datei.
 */
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { ExportRequestOptions, MethodsOverview } from "../shared/api.ts";
import { ALL_VERSIONS_DOI } from "../shared/citation.ts";
import {
  germanDate,
  materialTable,
  methodsHtml,
  methodsMarkdown,
  methodsPlain,
  outputTable,
  softwareLine,
  withOutput,
  type MethodsTable,
} from "../shared/methods-table.ts";
import { Button, CloseButton, cx } from "./ui.tsx";

const api = window.feldspur;

/** Abschnitt im Handbuch mit dem Mustertext, der erklärt, was Montagevideo und Einsatztranskript sind. */
export const METHODS_HANDBOOK_URL = "https://purl.archive.org/feldspur#sec-methodenteil";

export function MethodsDialog({
  open,
  onOpenChange,
  options,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Die gerade gewählten Ausgabe-Einstellungen: Die Tabelle beschreibt die Ausgabe, die damit entsteht. */
  options: ExportRequestOptions;
}) {
  const [data, setData] = useState<MethodsOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<"table" | "markdown" | "failed" | null>(null);
  const { video, resolve, mixAudio, deviceTracks, viewer, realtime } = options;

  const [wasOpen, setWasOpen] = useState(false);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setCopied(null);
      setFailed(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api.methodsOverview({ video, resolve, mixAudio, deviceTracks, viewer, realtime }).then(
      (d) => live && setData(d),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [open, video, resolve, mixAudio, deviceTracks, viewer, realtime]);

  const all = data ? [...data.sessions].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const chosen = all.filter((s) => !skipped.has(s.sessionId));
  const tables = [materialTable(chosen), outputTable(chosen)];
  const software = data
    ? softwareLine({
        version: data.citation.version,
        released: data.citation.released,
        doi: data.citation.versionDoi?.doi ?? ALL_VERSIONS_DOI,
      })
    : "";
  // Die Tabelle beschreibt den Stand im Projekt. Liegt er so nicht als Ausgabe vor, passen Montage-ID und Umfang
  // nicht zu den Dateien, aus denen zitiert wird.
  const open_ = withOutput(chosen).filter((s) => s.exported !== "current");
  const toggle = (id: string) => {
    setCopied(null);
    setSkipped((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  const copy = (kind: "table" | "markdown") =>
    void (
      kind === "table"
        ? api.copyTable(methodsHtml(tables, software), methodsPlain(tables, software))
        : api.copyText(methodsMarkdown(tables, software))
    ).then(
      () => setCopied(kind),
      () => setCopied("failed"),
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(920px,94vw)] -translate-1/2 flex-col overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-2xl"
          data-testid="methods-dialog"
        >
          <div className="mb-1 flex items-center">
            <Dialog.Title className="text-base font-semibold">Tabelle für den Methodenteil</Dialog.Title>
            <span className="flex-1" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          <Dialog.Description className="mb-4 max-w-[70ch] text-[0.9rem] text-muted">
            Welche Aufzeichnungen in deine Einsätze hineingeflossen sind und was Feldspur daraus ausgibt, zum Kopieren
            in deinen Text. Feldspur zählt und misst hier nur. Den Nachweis je Datei führt weiter das Begleitprotokoll.
          </Dialog.Description>
          {failed && (
            <p role="alert" className="text-[0.9rem] text-bad">
              Die Tabelle ließ sich nicht berechnen: {failed}
            </p>
          )}
          {!data && !failed && <p className="text-[0.9rem] text-muted">Die Einsätze werden gezählt…</p>}
          {data && (
            <>
              {all.length > 1 && (
                <fieldset className="mb-4" data-testid="methods-sessions">
                  <legend className="mb-1 text-[0.75rem] tracking-wide text-muted uppercase">Einsätze</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {all.map((s) => (
                      <label key={s.sessionId} className="flex items-center gap-1.5 text-[0.9rem]">
                        <input
                          type="checkbox"
                          className="accent-(--accent)"
                          checked={!skipped.has(s.sessionId)}
                          onChange={() => toggle(s.sessionId)}
                        />
                        <span className="tabular-nums">{germanDate(s.date)}</span> {s.title}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {chosen.length === 0 ? (
                <p className="text-[0.9rem] text-muted">Wähle mindestens einen Einsatz.</p>
              ) : (
                <div className="grid gap-4 select-text" data-testid="methods-tables">
                  {tables.map((t) => (
                    <TableView key={t.caption} table={t} />
                  ))}
                  <p className="font-serif text-[0.9rem] leading-relaxed [overflow-wrap:anywhere]">{software}</p>
                </div>
              )}
              {open_.length > 0 && (
                <div
                  className="mt-4 rounded-lg border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft px-4 py-3 text-[0.9rem]"
                  role="status"
                  data-testid="methods-not-current"
                >
                  <p className="font-semibold">
                    {open_.length === 1
                      ? "Ein Einsatz liegt so noch nicht als Ausgabe vor."
                      : `${open_.length} Einsätze liegen so noch nicht als Ausgabe vor.`}
                  </p>
                  <ul className="mt-0.5 text-ink-2">
                    {open_.map((s) => (
                      <li key={s.sessionId}>
                        {germanDate(s.date)} {s.title}:{" "}
                        {s.exported === "stale" ? "seit der letzten Ausgabe geändert" : "noch nicht ausgegeben"}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-ink-2">
                    Die Tabelle beschreibt den Stand im Projekt. Gib diese Einsätze vorher aus, damit Montage-ID und
                    Umfang zu den Dateien passen, aus denen du zitierst.
                  </p>
                </div>
              )}
              <p className="mt-4 max-w-[70ch] text-[0.85rem] text-muted">
                Was ein Montagevideo und ein Einsatztranskript sind, erklärt ein Mustertext im Handbuch, „Im
                Methodenteil beschreiben“. Du kannst ihn als Blockzitat übernehmen.{" "}
                <Button variant="link" onClick={() => void api.openCitationLink(METHODS_HANDBOOK_URL)}>
                  Mustertext im Handbuch
                  <span aria-hidden> ↗</span>
                  <span className="sr-only"> (öffnet im Browser)</span>
                </Button>
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                {/* Immer da, damit Screenreader die Meldung ansagen; nur der Text wechselt. */}
                <span
                  role="status"
                  className={cx("text-[0.9rem] font-medium", copied === "failed" ? "text-bad" : "text-good")}
                >
                  {(copied === "table" || copied === "markdown") && (
                    <>
                      <span aria-hidden>✓ </span>
                      {copied === "table" ? "Als Tabelle kopiert" : "Als Markdown kopiert"}
                    </>
                  )}
                  {copied === "failed" &&
                    "Kopieren hat nicht geklappt. Markiere die Tabellen und kopiere sie von Hand."}
                </span>
                <Button disabled={chosen.length === 0} onClick={() => copy("markdown")}>
                  Als Markdown kopieren
                </Button>
                <Button variant="primary" disabled={chosen.length === 0} onClick={() => copy("table")}>
                  Tabellen kopieren
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TableView({ table }: { table: MethodsTable }) {
  return (
    <table className="w-full border-collapse text-[0.88rem]">
      <caption className="mb-1 text-left font-semibold">{table.caption}</caption>
      <thead>
        <tr className="border-b border-line-2 text-left text-[0.8rem] text-muted">
          {table.head.map((h) => (
            <th key={h} scope="col" className="py-1 pr-4 font-medium last:pr-0">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i} className="border-b border-line/60 align-top">
            {r.map((c, j) => (
              <td key={j} className="py-1 pr-4 tabular-nums last:pr-0 [overflow-wrap:anywhere]">
                {c}
              </td>
            ))}
          </tr>
        ))}
        {table.rows.length === 0 && (
          <tr>
            <td colSpan={table.head.length} className="py-1 text-muted">
              Nichts auszugeben: Keine Quelle liegt auf der Zeitachse.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
