/**
 * Feldkalender der Übersicht (`packages/media/src/field-calendar.ts`): Achse, Stundenbeschriftung und die SVG-Grafik.
 */
import { describe, expect, it } from "vite-plus/test";
import { calendarAxis, fieldCalendarSvg, hourLabel, type CalendarDay } from "../src/field-calendar.ts";

const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00Z`);

/** Erfundene Tage: Ton am Vormittag, ein Foto, ein Tagebucheintrag. */
const tag = (date: string, title: string, von: string, bis: string): CalendarDay => ({
  date,
  title,
  place: "Markt <Ost>",
  marks: [
    { kind: "audio", fromMs: at(date, von), toMs: at(date, bis) },
    { kind: "photo", fromMs: at(date, von), toMs: at(date, von) },
    { kind: "diary", fromMs: at(date, bis), toMs: at(date, bis) },
  ],
});

describe("Feldkalender", () => {
  it("legt Tage mit verschiedenem Datum auf dieselbe Uhrzeit-Achse, auf volle Stunden gerundet", () => {
    const axis = calendarAxis([tag("2026-09-14", "A", "09:40", "11:10"), tag("2026-09-15", "B", "10:00", "12:20")]);
    expect(axis.fromMs).toBe(9 * 3_600_000);
    expect(axis.toMs).toBe(13 * 3_600_000);
    expect(axis.ticks.map(hourLabel)).toEqual(["09", "10", "11", "12", "13"]);
  });

  it("zeigt ohne Marken einen gewöhnlichen Arbeitstag", () => {
    const axis = calendarAxis([{ date: "2026-09-14", title: "leer", place: "", marks: [] }]);
    expect([axis.fromMs, axis.toMs].map(hourLabel)).toEqual(["08", "18"]);
  });

  it("schreibt eine eigenständige SVG-Grafik mit Tagen, Legende und maskierten Texten", () => {
    const svg = fieldCalendarSvg([tag("2026-09-14", "Wochenmarkt & Co", "10:00", "11:00")]);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).toContain(">Wochenmarkt &amp; Co<");
    expect(svg).toContain(">14.09.2026 · Markt &lt;Ost&gt;<");
    for (const l of ["Ton", "Video", "Fotos", "Tagebuch"]) expect(svg).toContain(`>${l}</text>`);
    expect(svg).not.toMatch(/<script|href=|<image/);
  });

  it("gibt langen Titeln mehr Platz, statt sie in die Spuren ragen zu lassen", () => {
    // Angenommen: ein Titel mit 50 Zeichen (bei 7 px je Zeichen breiter als die übliche linke Spalte)
    const lang = "Sommerfest der Nachbarschaftsinitiative Alter Hafen";
    const svg = fieldCalendarSvg([tag("2026-09-19", lang, "10:00", "11:00")]);
    // Dann: steht der Titel ungekürzt da, und die erste Stunde beginnt erst rechts von ihm
    expect(svg).toContain(`>${lang}<`);
    const ersteStunde = Number(/<line x1="([\d.]+)"/.exec(svg)![1]);
    expect(ersteStunde).toBeGreaterThan(16 + lang.length * 7);
  });

  it("kürzt nur sehr lange Titel und lässt rechts Platz für die letzte Uhrzeit", () => {
    const svg = fieldCalendarSvg([tag("2026-09-19", "Lang ".repeat(30), "10:00", "11:00")]);
    expect(svg).toMatch(/Lang Lang[^<]*…</);
    const breite = Number(/width="(\d+)"/.exec(svg)![1]);
    const stunden = [...svg.matchAll(/<text x="([\d.]+)" y="\d+" text-anchor="middle"/g)].map((m) => Number(m[1]));
    const letzteStunde = Math.max(...stunden);
    expect(breite - letzteStunde).toBeGreaterThanOrEqual(20);
  });
});
