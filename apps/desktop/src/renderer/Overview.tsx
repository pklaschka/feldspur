/**
 * Übersicht des Projekts (Issue #203, Gesamtkonzept #202): die Ebene über den Einsätzen. Je Feldtag eine Zeile mit
 * gezählten Tatsachen, darunter die Kennwerte als zwei Tabellen zum Kopieren in den Methodenteil. Die erste zeigt,
 * welche Aufzeichnungen in die gewählten Feldtage hineingeflossen sind, die zweite, was Feldspur daraus ausgibt.
 *
 * Feldspur zählt und misst hier nur. Farbe kennzeichnet Zustände (Ausgabe veraltet, Uhr ohne Abgleich), nie Mengen.
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
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
import {
  CALENDAR_KINDS,
  CALENDAR_LABEL,
  calendarAxis,
  dayStart,
  hourLabel,
  ofDay,
  type CalendarDay,
  type CalendarKind,
} from "@feldspur/media/field-calendar";
import type { Step } from "./App.tsx";
import { Button, cx, ErrorBanner, Panel, Pill, Toggle } from "./ui.tsx";

const api = window.feldspur;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „4 Einsätze · 07.09.2026 bis 14.09.2026“. */
function spanText(sessions: OverviewSession[]): string {
  const dates = sessions.map((s) => s.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return "Noch kein Einsatz";
  const days = first === last ? germanDate(first) : `${germanDate(first)} bis ${germanDate(last)}`;
  return `${count(sessions.length, "Einsatz", "Einsätze")} · ${days}`;
}

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
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [byPlace, setByPlace] = useState(loadByPlace);
  const groupByPlace = (on: boolean) => {
    setByPlace(on);
    try {
      localStorage.setItem(BY_PLACE_KEY, on ? "1" : "0");
    } catch {
      // ohne Speicher gilt die Wahl bis zum Neustart
    }
  };
  const [copied, setCopied] = useState<"table" | "markdown" | "failed" | null>(null);
  // Uhrzeit unter dem Mauszeiger: eine Linie durch alle Tage, damit sich dieselbe Uhrzeit über die Tage vergleichen
  // lässt. Ohne Neuzeichnen der Zeilen, nur eine Variable an der Liste.
  const daysRef = useRef<HTMLUListElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const hoverAt = (share: number | null) => {
    const ul = daysRef.current;
    if (!ul) return;
    if (share === null) {
      delete ul.dataset.hover;
      return;
    }
    ul.dataset.hover = "";
    ul.style.setProperty("--at", `${share * 100}%`);
    if (clockRef.current) clockRef.current.textContent = clockLabel(axis.fromMs + share * (axis.toMs - axis.fromMs));
  };
  const [saved, setSaved] = useState<string | null>(null);

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
  const groups = byPlace ? placeGroups(all) : [{ place: null, sessions: all }];
  const chosen = all.filter((s) => !skipped.has(s.sessionId));
  // Gewissheit im Kopf: Jeder Feldtag, aus dem sich etwas ausgeben lässt, hat eine Ausgabe, die zum Stand passt.
  const exportable = all.filter((s) => s.output.durationMs > 0);
  const allCurrent = exportable.length > 0 && exportable.every((s) => s.exported === "current");
  const tables = [materialTable(chosen), outputTable(chosen)];
  const days = (list: OverviewSession[]): CalendarDay[] =>
    list.map((s) => ({ date: s.date, title: s.title, place: s.place, marks: s.marks }));
  // Achse über alle Tage, damit sie beim Ab- und Anwählen stehen bleibt.
  const axis = calendarAxis(days(all));
  const saveCalendar = () =>
    // In der Reihenfolge wie angezeigt, also auf Wunsch nach Ort.
    void api.saveFieldCalendar(days(groups.flatMap((g) => g.sessions).filter((x) => !skipped.has(x.sessionId)))).then(
      (p) => p && setSaved(p),
      () => {},
    );
  const software = data
    ? softwareLine({
        version: data.citation.version,
        released: data.citation.released,
        doi: data.citation.versionDoi?.doi ?? ALL_VERSIONS_DOI,
      })
    : "";
  const toggle = (id: string) => {
    setCopied(null);
    setSaved(null);
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

  // „relative“ am Rollbereich: Sonst hängen die unsichtbaren Texte für Screenreader am Fenster statt an dieser
  // Fläche und erzeugen eine zweite Bildlaufleiste.
  return (
    <main className="relative col-span-2 overflow-auto" data-testid="overview">
      <header className="border-b border-line bg-panel px-6 pt-5 pb-4">
        <h1 className="flex flex-wrap items-baseline gap-x-3 text-[1.4rem] font-semibold">
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
        {data && all.length > 0 && (
          <>
            <Panel className="@container">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-[1.05rem] font-semibold">Feldkalender</h2>
                <span className="flex-1" />
                <span role="status" className="text-[0.9rem]">
                  {saved && (
                    <>
                      <span className="font-medium text-good">
                        <span aria-hidden>✓ </span>Gespeichert als {saved.split(/[\\/]/).pop()}
                      </span>{" "}
                      <Button variant="link" onClick={() => void api.showInFolder(saved)}>
                        Im Ordner zeigen
                      </Button>
                    </>
                  )}
                </span>
                <label className="inline-flex items-center gap-2 text-[0.9rem]">
                  <Toggle checked={byPlace} onChange={groupByPlace} label="Nach Ort gruppieren" />
                  Nach Ort gruppieren
                </label>
                <Button
                  disabled={chosen.length === 0}
                  onClick={saveCalendar}
                  title="Die gewählten Einsätze als SVG-Grafik, etwa für den Methodenteil"
                >
                  Als Grafik speichern…
                </Button>
              </div>
              <ul data-testid="overview-days" ref={daysRef} className="group/days">
                <li aria-hidden className={cx(ROW, "pb-1")}>
                  <div className="relative col-start-2 h-4 @[1150px]:col-start-3">
                    {axis.ticks.map((t) => {
                      const at = pos(axis, t);
                      return (
                        <span
                          key={t}
                          className={cx(
                            "absolute text-[0.75rem] text-muted tabular-nums",
                            // Am Rand bündig mit der Spur, damit die Uhrzeit nicht aus der Karte ragt.
                            at <= 0 ? "" : at >= 100 ? "-translate-x-full" : "-translate-x-1/2",
                          )}
                          style={{ left: `${at}%` }}
                        >
                          {hourLabel(t)}:00
                        </span>
                      );
                    })}
                    {/* Uhrzeit unter dem Mauszeiger, über allen Tagen dieselbe (Text und Lage setzt hoverAt). */}
                    <span
                      ref={clockRef}
                      data-testid="overview-hover-clock"
                      className="absolute -top-0.5 left-(--at) hidden -translate-x-1/2 rounded-sm bg-ink px-1.5 text-[0.75rem] leading-5 font-semibold text-panel tabular-nums group-data-hover/days:block"
                    />
                  </div>
                </li>
                {groups.map((g) => [
                  g.place !== null && (
                    <li
                      key={`ort:${g.place}`}
                      className="border-t border-line-2 pt-3 pb-0.5 text-[0.85rem] font-semibold text-ink-2"
                      data-testid="overview-place"
                    >
                      {g.place || "Ohne Ort"}
                      <span className="ml-2 font-normal text-muted">
                        {count(g.sessions.length, "Einsatz", "Einsätze")}
                      </span>
                    </li>
                  ),
                  ...g.sessions.map((s) => (
                    <DayRow
                      key={s.sessionId}
                      session={s}
                      axis={axis}
                      chosen={!skipped.has(s.sessionId)}
                      onToggle={() => toggle(s.sessionId)}
                      onOpen={onOpen}
                      onHover={hoverAt}
                    />
                  )),
                ])}
              </ul>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.85rem] text-muted">
                {CALENDAR_KINDS.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <Mark kind={k} legend />
                    {CALENDAR_LABEL[k]}
                  </span>
                ))}
                <span className="flex-1" />
                <span>
                  Klick in eine Spur öffnet den Einsatz in „Durchsehen“ an dieser Uhrzeit. Einsätze mit Häkchen gehen in
                  Kennwerte und Grafik ein.
                </span>
              </div>
            </Panel>
            <Panel>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-[1.05rem] font-semibold">Kennwerte</h2>
                <Pill>
                  {chosen.length === all.length
                    ? count(all.length, "Einsatz", "Einsätze")
                    : `${chosen.length} von ${count(all.length, "Einsatz", "Einsätzen")} gewählt`}
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
                      {copied === "table"
                        ? "Kopiert. Einfügen ergibt in Word, LibreOffice und Pages echte Tabellen."
                        : "Als Markdown kopiert"}
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
                  Montagevideo und Einsatztranskript sind, erklärt ein Mustertext, den du als Blockzitat übernehmen
                  kannst.{" "}
                  <Button variant="link" onClick={() => void api.openCitationLink(METHODS_HANDBOOK_URL)}>
                    „Im Methodenteil beschreiben“ im Handbuch
                    <span aria-hidden> ↗</span>
                    <span className="sr-only"> (öffnet im Browser)</span>
                  </Button>
                </p>
              </div>
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}

const BY_PLACE_KEY = "feldspur.overview-by-place";
function loadByPlace(): boolean {
  try {
    return localStorage.getItem(BY_PLACE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Feldtage je Ort; die Orte in der Folge ihres ersten Tages, ohne Ort zuletzt. Innerhalb nach Datum. */
function placeGroups(sessions: OverviewSession[]): { place: string; sessions: OverviewSession[] }[] {
  const by = new Map<string, OverviewSession[]>();
  for (const s of sessions) {
    const key = s.place.trim();
    by.set(key, [...(by.get(key) ?? []), s]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => Number(a === "") - Number(b === ""))
    .map(([place, list]) => ({ place, sessions: list }));
}

/** „10:42“ für eine Uhrzeit des Tages; über Mitternacht „+1 02:15“ wie an der Achse. */
function clockLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return `${hourLabel(Math.floor(min / 60) * 3_600_000)}:${String(((min % 60) + 60) % 60).padStart(2, "0")}`;
}

const EXPORTED_TEXT = { current: "Ausgabe aktuell", stale: "Ausgabe veraltet", none: "nicht ausgegeben" } as const;

/** Raster jeder Zeile des Feldkalenders: Häkchen, Tag, Spur, Fakten; schmal stehen Spur und Fakten unter dem Tag. */
const ROW =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 @[1150px]:grid-cols-[auto_14rem_minmax(0,1fr)_27rem] @[1500px]:grid-cols-[auto_18rem_minmax(0,1fr)_27rem]";

type Axis = ReturnType<typeof calendarAxis>;
/** Lage auf der Achse in Prozent. */
const pos = (axis: Axis, ms: number) => ((ms - axis.fromMs) / (axis.toMs - axis.fromMs)) * 100;

/** Spuren von oben nach unten, in der Reihenfolge der Legende. */
const LANE_TOP: Record<CalendarKind, number> = { audio: 6, video: 16, photo: 26, diary: 36 };
const KIND_BG: Record<CalendarKind, string> = {
  audio: "bg-k-audio",
  video: "bg-k-video",
  photo: "bg-k-photo",
  diary: "bg-k-diary",
};

/** Zeichen einer Art: Balken für Ton und Video, Raute für Fotos, Strich für Tagebuch. */
function Mark({ kind, legend, style }: { kind: CalendarKind; legend?: boolean; style?: CSSProperties }) {
  const shape =
    kind === "photo"
      ? "size-[7px] rotate-45"
      : kind === "diary"
        ? "h-[9px] w-[2px]"
        : legend
          ? "h-[6px] w-4 rounded-full"
          : "h-[6px] rounded-full";
  return <span aria-hidden className={cx(legend ? "inline-block" : "absolute", shape, KIND_BG[kind])} style={style} />;
}

function DayRow({
  session: s,
  axis,
  chosen,
  onToggle,
  onOpen,
  onHover,
}: {
  session: OverviewSession;
  axis: Axis;
  chosen: boolean;
  onToggle: () => void;
  onOpen: (sessionId: string, step?: Step, atMs?: number) => void;
  /** Anteil der Achse (0 bis 1) unter dem Mauszeiger; null, wenn er die Spur verlässt. */
  onHover: (share: number | null) => void;
}) {
  const label = `${germanDate(s.date)} ${s.title}`;
  /** Klick in die Spur: Uhrzeit an dieser Stelle; mit der Tastatur die erste Marke. */
  const openAt = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const first = s.marks.reduce((m, x) => Math.min(m, x.fromMs), Infinity);
    const atMs =
      e.detail === 0 || r.width === 0
        ? Number.isFinite(first)
          ? first
          : undefined
        : dayStart(s.date) + axis.fromMs + ((e.clientX - r.left) / r.width) * (axis.toMs - axis.fromMs);
    onOpen(s.sessionId, "review", atMs);
  };
  return (
    <li className={cx(ROW, "border-t border-line/70 py-2")}>
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
      <button
        className={cx(
          "relative col-start-2 h-[50px] w-full cursor-pointer overflow-hidden rounded-md border border-line bg-panel-2 focus-visible:outline-2 focus-visible:outline-accent @[1150px]:col-start-3",
          !chosen && "opacity-45",
        )}
        onClick={openAt}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (r.width > 0) onHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onMouseLeave={() => onHover(null)}
        aria-label={`${label}: in Durchsehen öffnen, an der angeklickten Uhrzeit`}
        data-testid="overview-strip"
      >
        {axis.ticks.map((t) => (
          <span
            key={t}
            aria-hidden
            className="absolute inset-y-0 w-px bg-line/70"
            style={{ left: `${pos(axis, t)}%` }}
          />
        ))}
        {s.marks.map((m, i) => {
          const from = pos(axis, ofDay(s.date, m.fromMs));
          const to = pos(axis, ofDay(s.date, m.toMs));
          const top = LANE_TOP[m.kind];
          return m.kind === "audio" || m.kind === "video" ? (
            <Mark key={i} kind={m.kind} style={{ left: `${from}%`, width: `max(3px, ${to - from}%)`, top }} />
          ) : (
            <Mark
              key={i}
              kind={m.kind}
              style={{
                left: `calc(${from}% - ${m.kind === "photo" ? 3.5 : 1}px)`,
                top: top - (m.kind === "diary" ? 1 : 0),
              }}
            />
          );
        })}
        {s.marks.length === 0 && (
          <span className="absolute inset-0 grid place-items-center text-[0.8rem] text-muted">
            <span className="rounded bg-panel-2 px-1.5">Noch nichts auf der Zeitachse</span>
          </span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-(--at) hidden w-px bg-ink group-data-hover/days:block"
        />
      </button>
      <div className={cx("col-start-2 grid gap-1 @[1150px]:col-start-4", !chosen && "opacity-60")}>
        {/* Gezähltes als Text, Zustände als Marken: so fällt auf, was noch etwas braucht. */}
        <p className="text-[0.85rem] text-ink-2 tabular-nums">
          {s.sources === 0
            ? "Noch nichts eingesammelt"
            : `${count(s.sources, "Quelle", "Quellen")} · Einsatztranskript mit ${count(s.output.lines, "Zeile", "Zeilen")}`}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {s.unsynced > 0 && <Pill tone="warn">{count(s.unsynced, "Geräteuhr", "Geräteuhren")} ohne Abgleich</Pill>}
          {s.sources === 0 ? (
            chosen && (
              <Button variant="link" onClick={() => onOpen(s.sessionId, "collect")}>
                Einsammeln<span aria-hidden> →</span>
                <span className="sr-only">: {label}</span>
              </Button>
            )
          ) : s.exported === "current" ? (
            <Pill tone="good">{EXPORTED_TEXT.current}</Pill>
          ) : (
            <>
              <Pill tone={s.exported === "stale" ? "warn" : "plain"}>{EXPORTED_TEXT[s.exported]}</Pill>
              {chosen && s.output.durationMs > 0 && (
                <Button variant="link" onClick={() => onOpen(s.sessionId, "export")}>
                  {s.exported === "stale" ? "Erneut ausgeben" : "Ausgeben"}
                  <span aria-hidden> →</span>
                  <span className="sr-only">: {label}</span>
                </Button>
              )}
            </>
          )}
        </div>
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
