/**
 * Kennwerte der Übersicht (`apps/desktop/src/renderer/Overview.tsx`). Die Tabellen und ihre Fassungen zum Kopieren
 * (HTML, Text, Markdown) baut `apps/desktop/src/shared/methods-table.ts`.
 */
import type { OverviewSession } from "../../shared/api.ts";
import {
  materialTable,
  METHODS_HANDBOOK_URL,
  methodsHtml,
  methodsMarkdown,
  methodsPlain,
  outputTable,
  type MethodsTable,
} from "../../shared/methods-table.ts";
import { Button, cx, Panel, Pill } from "../ui.tsx";
import { count } from "./text.ts";

const api = window.feldspur;

/** Was zuletzt kopiert wurde, für die Meldung; "failed", wenn das Kopieren nicht geklappt hat. */
export type Copied = "table" | "markdown" | "failed" | null;

/**
 * Karte „Kennwerte“: zwei Tabellen über die gewählten Einsätze zum Kopieren in den Methodenteil. Die erste zeigt,
 * was hineingeflossen ist, die zweite, was Feldspur daraus ausgibt.
 */
export function Metrics({
  total,
  chosen,
  software,
  copied,
  onCopied,
}: {
  /** Zahl aller Einsätze im Projekt. */
  total: number;
  /** Die gewählten Einsätze, nach Datum. */
  chosen: OverviewSession[];
  /** Zeile zur Software unter den Tabellen. */
  software: string;
  copied: Copied;
  onCopied: (c: Copied) => void;
}) {
  const tables = [materialTable(chosen), outputTable(chosen)];
  const copy = (kind: "table" | "markdown") =>
    void (
      kind === "table"
        ? api.copyTable(methodsHtml(tables, software), methodsPlain(tables, software))
        : api.copyText(methodsMarkdown(tables, software))
    ).then(
      () => onCopied(kind),
      () => onCopied("failed"),
    );
  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[1.05rem] font-semibold">Kennwerte</h2>
        <Pill>
          {chosen.length === total
            ? count(total, "Einsatz", "Einsätze")
            : `${chosen.length} von ${count(total, "Einsatz", "Einsätzen")} gewählt`}
        </Pill>
        <span className="flex-1" />
        {/* Immer da, damit Screenreader die Meldung ansagen; nur der Text wechselt. */}
        <span role="status" className={cx("text-[0.9rem] font-medium", copied === "failed" ? "text-bad" : "text-good")}>
          {(copied === "table" || copied === "markdown") && (
            <>
              <span aria-hidden>✓ </span>
              {copied === "table"
                ? "Kopiert. Einfügen ergibt in Word, LibreOffice und Pages echte Tabellen."
                : "Als Markdown kopiert"}
            </>
          )}
          {copied === "failed" && "Kopieren hat nicht geklappt. Markiere die Tabellen und kopiere sie von Hand."}
        </span>
        <Button disabled={chosen.length === 0} onClick={() => copy("markdown")}>
          Als Markdown kopieren
        </Button>
        <Button variant="primary" disabled={chosen.length === 0} onClick={() => copy("table")}>
          Tabellen kopieren
        </Button>
      </div>
      {chosen.length === 0 ? (
        <p className="text-[0.9rem] text-muted">
          Kein Einsatz gewählt. Setze oben im Feldkalender ein Häkchen, dann stehen hier die Kennwerte.
        </p>
      ) : (
        <div className="@container select-text" data-testid="overview-tables">
          {/*
                    Nebeneinander nur, wenn beide Tabellen ohne Umbruch Platz haben: Dann teilen sie sich ein
                    Zeilenraster (Überschrift, Kopfzeile und Zeilen auf gleicher Höhe). Sonst stehen sie untereinander.
                  */}
          <div className="grid items-start gap-x-10 gap-y-5 @[1400px]:grid-cols-2">
            {tables.map((t) => (
              <TableView key={t.caption} table={t} />
            ))}
          </div>
          <p className="mt-3 max-w-[110ch] text-[0.88rem] text-ink-2 [overflow-wrap:anywhere]">{software}</p>
        </div>
      )}
      <div className="mt-5 border-t border-line pt-3">
        <p className="max-w-[78ch] text-[0.85rem] text-muted">
          Die Tabellen zählen und messen den jetzigen Stand im Projekt, auch wenn eine Ausgabe älter ist. Was
          Montagevideo und Einsatztranskript sind, erklärt ein Mustertext, den du als Blockzitat übernehmen kannst.{" "}
          <Button variant="link" onClick={() => void api.openCitationLink(METHODS_HANDBOOK_URL)}>
            „Im Methodenteil beschreiben“ im Handbuch
            <span aria-hidden> ↗</span>
            <span className="sr-only"> (öffnet im Browser)</span>
          </Button>
        </p>
      </div>
    </Panel>
  );
}

/** Eine Tabelle auf dem Bildschirm. Kopiert wird nicht dieses HTML, sondern die Fassung aus `methodsHtml`. */
function TableView({ table }: { table: MethodsTable }) {
  return (
    <table className="w-full border-collapse text-[0.88rem]">
      <caption className="pb-1 text-left font-semibold">{table.caption}</caption>
      <thead>
        <tr className="border-b border-line-2 text-left text-[0.8rem] text-muted">
          {table.head.map((h) => (
            <th key={h} scope="col" className="h-7 pr-5 align-bottom font-medium whitespace-nowrap last:pr-0">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i} className="border-b border-line/60 align-top">
            {r.map((c, j) => (
              <td
                key={j}
                className={cx(
                  "h-8 py-1.5 pr-5 leading-5 tabular-nums last:pr-0",
                  // Kurze Zellen (Zahlen, Endungen, Montage-ID) brechen nie um; lange Texte nur an Wortgrenzen.
                  c.length <= 24 ? "whitespace-nowrap" : "wrap-break-word",
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
        {table.rows.length === 0 && (
          <tr>
            <td colSpan={table.head.length} className="h-8 py-1.5 text-muted">
              Nichts auszugeben: Keine Quelle liegt auf der Zeitachse.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
