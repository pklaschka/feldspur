import { useRef, useState } from "react";
import { CALENDAR_KINDS, CALENDAR_LABEL, calendarAxis, hourLabel } from "@feldspur/media/field-calendar";
import type { OverviewSession } from "../../shared/api.ts";
import type { Step } from "../App.tsx";
import { readStored, writeStored } from "../stored.ts";
import { Button, cx, Panel, Toggle } from "../ui.tsx";
import { calendarDays, clockLabel, placeGroups, pos } from "./calendar.ts";
import { DayRow } from "./DayRow.tsx";
import { Mark, ROW } from "./parts.tsx";
import { count } from "./text.ts";

const api = window.feldspur;

const BY_PLACE_KEY = "feldspur.overview-by-place";
const loadByPlace = () => readStored(BY_PLACE_KEY) === "1";

/**
 * Karte „Feldkalender“: alle Einsätze untereinander auf einer Uhrzeit-Achse, auf Wunsch nach Ort gruppiert, mit
 * Häkchen für die Auswahl und dem Speichern als Grafik.
 */
export function FieldCalendar({
  sessions,
  skipped,
  onToggle,
  onOpen,
  saved,
  onSaved,
}: {
  /** Alle Einsätze, nach Datum. */
  sessions: OverviewSession[];
  /** Abgewählte Einsätze: Sie gehen nicht in Kennwerte und Grafik ein. */
  skipped: ReadonlySet<string>;
  onToggle: (sessionId: string) => void;
  onOpen: (sessionId: string, step?: Step, atMs?: number) => void;
  /** Pfad der zuletzt gespeicherten Grafik, für die Meldung. */
  saved: string | null;
  onSaved: (path: string) => void;
}) {
  const [byPlace, setByPlace] = useState(loadByPlace);
  const groupByPlace = (on: boolean) => {
    setByPlace(on);
    writeStored(BY_PLACE_KEY, on ? "1" : "0");
  };
  const groups = byPlace ? placeGroups(sessions) : [{ place: null, sessions }];
  const chosen = sessions.filter((s) => !skipped.has(s.sessionId));
  // Achse über alle Tage, damit sie beim Ab- und Anwählen stehen bleibt.
  const axis = calendarAxis(calendarDays(sessions));
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
  const saveCalendar = () =>
    // In der Reihenfolge wie angezeigt, also auf Wunsch nach Ort.
    void api
      .saveFieldCalendar(calendarDays(groups.flatMap((g) => g.sessions).filter((x) => !skipped.has(x.sessionId))))
      .then(
        (p) => p && onSaved(p),
        () => {},
      );
  return (
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
              <span className="ml-2 font-normal text-muted">{count(g.sessions.length, "Einsatz", "Einsätze")}</span>
            </li>
          ),
          ...g.sessions.map((s) => (
            <DayRow
              key={s.sessionId}
              session={s}
              axis={axis}
              chosen={!skipped.has(s.sessionId)}
              onToggle={() => onToggle(s.sessionId)}
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
  );
}
