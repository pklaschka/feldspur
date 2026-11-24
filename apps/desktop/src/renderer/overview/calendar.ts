/**
 * Rechnen für den Feldkalender: Tage, Gruppen nach Ort, Lage und Uhrzeit auf der Achse. Ohne Oberfläche; genutzt von
 * `FieldCalendar.tsx` und `DayRow.tsx` im selben Ordner.
 */
import { hourLabel, type calendarAxis, type CalendarDay } from "@feldspur/media/field-calendar";
import type { OverviewSession } from "../../shared/api.ts";

/** Was der Feldkalender von einem Einsatz braucht, auch für die Grafik. */
export const calendarDays = (list: OverviewSession[]): CalendarDay[] =>
  list.map((s) => ({ date: s.date, title: s.title, place: s.place, marks: s.marks }));

/** Feldtage je Ort; die Orte in der Folge ihres ersten Tages, ohne Ort zuletzt. Innerhalb nach Datum. */
export function placeGroups(sessions: OverviewSession[]): { place: string; sessions: OverviewSession[] }[] {
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
export function clockLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  return `${hourLabel(Math.floor(min / 60) * 3_600_000)}:${String(((min % 60) + 60) % 60).padStart(2, "0")}`;
}

/** Achse des Feldkalenders: Uhrzeiten als ms seit Mitternacht (`fromMs`, `toMs`) und die Striche der vollen Stunden. */
export type Axis = ReturnType<typeof calendarAxis>;
/** Lage auf der Achse in Prozent. */
export const pos = (axis: Axis, ms: number) => ((ms - axis.fromMs) / (axis.toMs - axis.fromMs)) * 100;
