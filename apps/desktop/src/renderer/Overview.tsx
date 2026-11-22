/**
 * Übersicht des Projekts (Issue #203, Gesamtkonzept #202): die Ebene über den Einsätzen. Je Feldtag eine Zeile mit
 * gezählten Tatsachen, darunter die Kennwerte als zwei Tabellen zum Kopieren in den Methodenteil. Die erste zeigt,
 * welche Aufzeichnungen in die gewählten Feldtage hineingeflossen sind, die zweite, was Feldspur daraus ausgibt.
 *
 * Feldspur zählt und misst hier nur. Farbe kennzeichnet Zustände (Ausgabe veraltet, Uhr ohne Abgleich), nie Mengen.
 */
import { useEffect, useState } from "react";
import type { OverviewSession, ProjectOverview } from "../shared/api.ts";
import { ALL_VERSIONS_DOI } from "../shared/citation.ts";
import {
  germanDate,
  materialTable,
  METHODS_HANDBOOK_URL,
  methodsHtml,
  methodsMarkdown,
  methodsPlain,
  outputTable,
  softwareLine,
  type MethodsTable,
} from "../shared/methods-table.ts";
import type { Step } from "./App.tsx";
import { Button, cx, ErrorBanner, Panel, Pill } from "./ui.tsx";

const api = window.feldspur;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „4 Feldtage · 07.09.2026 bis 14.09.2026“. */
function spanText(sessions: OverviewSession[]): string {
  const dates = sessions.map((s) => s.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return "Noch kein Einsatz";
  const days = first === last ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`;
  return `${count(sessions.length, "Feldtag", "Feldtage")} · ${days}`;
}

export function Overview({
  name,
  onOpen,
}: {
  /** Name des Projekts. */
  name: string;
  /** Einen Einsatz öffnen, auf Wunsch gleich in einem bestimmten Schritt. */
  onOpen: (sessionId: string, step?: Step) => void;
}) {
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<"table" | "markdown" | "failed" | null>(null);

  useEffect(() => {
    let live = true;
    void api.projectOverview().then(
      (d) => live && setData(d),
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

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
    <main className="col-span-2 overflow-auto" data-testid="overview">
      <header className="border-b border-line bg-panel px-6 pt-5 pb-4">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-[1.4rem] font-semibold">
          {name}
          <span className="font-serif text-[1rem] font-normal text-muted italic">
            {data ? spanText(all) : "Übersicht"}
          </span>
        </h1>
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
              Hier stehen später alle Feldtage des Projekts nebeneinander, mit ihren Kennwerten für den Methodenteil.
              Lege links den ersten Einsatz an.
            </p>
          </Panel>
        )}
        {data && all.length > 0 && (
          <>
            <Panel>
              <h2 className="text-[1.05rem] font-semibold">Feldtage</h2>
              <p className="mb-2 max-w-[70ch] text-[0.85rem] text-muted">
                Das Häkchen bestimmt, welche Feldtage in die Kennwerte unten eingehen.
              </p>
              <ul data-testid="overview-days">
                {all.map((s) => (
                  <DayRow
                    key={s.sessionId}
                    session={s}
                    chosen={!skipped.has(s.sessionId)}
                    onToggle={() => toggle(s.sessionId)}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </Panel>
            <Panel>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-[1.05rem] font-semibold">Kennwerte</h2>
                <Pill>
                  {chosen.length === all.length
                    ? count(all.length, "Feldtag", "Feldtage")
                    : `${chosen.length} von ${count(all.length, "Feldtag", "Feldtagen")} gewählt`}
                </Pill>
                <span className="flex-1" />
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
              {chosen.length === 0 ? (
                <p className="text-[0.9rem] text-muted">Wähle mindestens einen Feldtag.</p>
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
                  <p className="mt-4 font-serif text-[0.9rem] leading-relaxed [overflow-wrap:anywhere]">{software}</p>
                </div>
              )}
              <p className="mt-3 max-w-[78ch] text-[0.85rem] text-muted">
                Feldspur zählt und misst hier nur, und zwar den Stand im Projekt. Was ein Montagevideo und ein
                Einsatztranskript sind, erklärt ein Mustertext im Handbuch, „Im Methodenteil beschreiben“. Du kannst ihn
                als Blockzitat übernehmen.{" "}
                <Button variant="link" onClick={() => void api.openCitationLink(METHODS_HANDBOOK_URL)}>
                  Mustertext im Handbuch
                  <span aria-hidden> ↗</span>
                  <span className="sr-only"> (öffnet im Browser)</span>
                </Button>
              </p>
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}

const EXPORTED_TEXT = { current: "Ausgabe aktuell", stale: "Ausgabe veraltet", none: "nicht ausgegeben" } as const;

function DayRow({
  session: s,
  chosen,
  onToggle,
  onOpen,
}: {
  session: OverviewSession;
  chosen: boolean;
  onToggle: () => void;
  onOpen: (sessionId: string, step?: Step) => void;
}) {
  const label = `${germanDate(s.date)} ${s.title}`;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-line/70 py-2 first:border-t-0 min-[900px]:grid-cols-[auto_minmax(0,17rem)_minmax(0,1fr)]">
      <input
        type="checkbox"
        className="size-4 accent-(--accent)"
        checked={chosen}
        onChange={onToggle}
        aria-label={`${label} in die Kennwerte aufnehmen`}
      />
      <button
        className="min-w-0 cursor-pointer rounded-md text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => onOpen(s.sessionId)}
        title="Einsatz öffnen"
      >
        <span className="block font-semibold [overflow-wrap:anywhere]">{s.title}</span>
        <span className="block text-[0.85rem] text-muted tabular-nums">
          {germanDate(s.date)}
          {s.place && ` · ${s.place}`}
        </span>
      </button>
      <div
        className={cx(
          "col-start-2 flex flex-wrap items-center gap-1.5 min-[900px]:col-start-3",
          !chosen && "opacity-60",
        )}
      >
        <Pill>{count(s.sources, "Quelle", "Quellen")}</Pill>
        {s.sources > 0 && <Pill>{count(s.output.lines, "Zeile", "Zeilen")}</Pill>}
        {s.unsynced > 0 && <Pill tone="warn">{count(s.unsynced, "Uhr", "Uhren")} ohne Abgleich</Pill>}
        {s.exported === "current" ? (
          <span className="inline-block rounded-full bg-[color-mix(in_srgb,var(--good)_14%,transparent)] px-2 text-[0.8rem] whitespace-nowrap text-good">
            {EXPORTED_TEXT.current}
          </span>
        ) : (
          <>
            <Pill tone={s.exported === "stale" ? "warn" : "plain"}>{EXPORTED_TEXT[s.exported]}</Pill>
            {chosen && s.output.durationMs > 0 && (
              <Button variant="link" onClick={() => onOpen(s.sessionId, "export")}>
                Ausgeben<span aria-hidden> →</span>
                <span className="sr-only">: {label}</span>
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

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
