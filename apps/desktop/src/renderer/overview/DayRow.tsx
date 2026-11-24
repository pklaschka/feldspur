/**
 * Zeile eines Einsatzes im Feldkalender der Übersicht (`apps/desktop/src/renderer/overview/FieldCalendar.tsx`). Die
 * Marken der Spur (`marks`) berechnet `packages/media/src/field-calendar.ts`; dieselben Marken zeichnet auch die
 * gespeicherte Grafik.
 */
import type { MouseEvent } from "react";
import { dayStart, ofDay, type CalendarKind } from "@feldspur/media/field-calendar";
import type { OverviewSession } from "../../shared/api.ts";
import { germanDate } from "../../shared/methods-table.ts";
import type { Step } from "../App.tsx";
import { Button, cx, Pill } from "../ui.tsx";
import { pos, type Axis } from "./calendar.ts";
import { Mark, ROW } from "./parts.tsx";
import { count } from "./text.ts";

const EXPORTED_TEXT = {
  current: "Ausgabe aktuell",
  stale: "Ausgabe veraltet",
  missing: "Ausgabe fehlt im Ordner",
  none: "nicht ausgegeben",
} as const;

/** Spuren von oben nach unten, in der Reihenfolge der Legende. */
const LANE_TOP: Record<CalendarKind, number> = { audio: 6, video: 16, photo: 26, diary: 36 };

/** Ein Einsatz im Feldkalender: Häkchen, Tag, Spur mit den Aufzeichnungen und gezählte Tatsachen mit Stand. */
export function DayRow({
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
          {/* Was weit weg vom Datum liegt, steht nicht im Feldkalender (#226); hier sieht man, dass es fehlt. */}
          {s.output.farFromDate > 0 && (
            <>
              <Pill tone="warn">{count(s.output.farFromDate, "Quelle", "Quellen")} weit weg vom Datum</Pill>
              {chosen && (
                <Button variant="link" onClick={() => onOpen(s.sessionId, "sync")}>
                  Abgleichen<span aria-hidden> →</span>
                  <span className="sr-only">: {label}</span>
                </Button>
              )}
            </>
          )}
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
              <Pill tone={s.exported === "none" ? "plain" : "warn"}>{EXPORTED_TEXT[s.exported]}</Pill>
              {chosen && s.output.durationMs > 0 && (
                <Button variant="link" onClick={() => onOpen(s.sessionId, "export")}>
                  {s.exported === "none" ? "Ausgeben" : "Erneut ausgeben"}
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
