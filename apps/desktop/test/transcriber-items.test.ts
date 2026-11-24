/**
 * „Mitschreiben“: was neben den eigenen Zeilen in der Liste steht (Ereignisse anderer Quellen, Notizen) und die Auswahl
 * der Tonquelle (`apps/desktop/src/renderer/transcriber/items.ts`).
 */
import { describe, expect, it } from "vite-plus/test";
import { eventsIn, lastAtOrBefore, noteBands, sourceOptions } from "../src/renderer/transcriber/items.ts";
import type { SessionView, SourceNoteRow, SourceRow, TranscriptRow } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten.
const h = (hh: number, mm: number, ss = 0) => ((hh * 60 + mm) * 60 + ss) * 1000;
const row = (o: Partial<SourceRow> & { id: string }) =>
  ({
    label: o.id.toUpperCase(),
    fileName: `${o.id}.wav`,
    kind: "audio",
    deviceId: "d1",
    partOf: null,
    startMs: null,
    endMs: null,
    durationMs: null,
    ...o,
  }) as SourceRow;
const line = (id: string, atMs: number) => ({ id, atMs }) as TranscriptRow;

describe("lastAtOrBefore", () => {
  const lines = [line("a", 0), line("b", 1000), line("c", 1000), line("d", 5000)];
  it.each`
    stelleMs | zeile  | fall
    ${999}   | ${"a"} | ${"kurz vor der zweiten Zeile"}
    ${1000}  | ${"c"} | ${"genau an zwei Zeilen: die letzte"}
    ${4999}  | ${"c"} | ${"zwischen zwei Zeilen"}
    ${9999}  | ${"d"} | ${"hinter der letzten Zeile"}
  `("bei $stelleMs ms gilt Zeile $zeile: $fall", ({ stelleMs, zeile }) => {
    expect(lastAtOrBefore(lines, stelleMs)?.id).toBe(zeile);
  });
  it("vor der ersten Zeile und ohne Zeilen: keine", () => {
    expect(lastAtOrBefore(lines, -1)).toBeUndefined();
    expect(lastAtOrBefore([], 0)).toBeUndefined();
  });
});

describe("noteBands", () => {
  it("nur Notizen mit Strecke, erledigte grün", () => {
    // Angenommen: eine offene Notiz mit Strecke, eine ohne, eine erledigte mit Strecke
    const notes = [
      { fromMs: 0, toMs: 1000, done: false },
      { fromMs: 2000, toMs: null, done: false },
      { fromMs: 3000, toMs: 4000, done: true },
    ] as SourceNoteRow[];
    // Dann: gibt es Bänder nur für Notizen mit Strecke
    expect(noteBands(notes)).toEqual([
      { fromMs: 0, toMs: 1000, tone: "warn" },
      { fromMs: 3000, toMs: 4000, tone: "good" },
    ]);
  });
});

describe("sourceOptions", () => {
  it("erst dasselbe Gerät, dann mit Trennlinie die übrigen, jeweils natürlich sortiert", () => {
    // Angenommen: a2 und a10 auf demselben Gerät, b1 auf einem anderen
    const me = row({ id: "a2" });
    const opts = sourceOptions(me, [row({ id: "b1", deviceId: "d2" }), row({ id: "a10" }), me]);
    expect(opts.map((o) => [o.value, o.groupStart])).toEqual([
      ["a2", undefined],
      ["a10", undefined],
      ["b1", "Andere Geräte"],
    ]);
  });
});

describe("eventsIn", () => {
  // Angenommen: Aufnahme a1 von 10:00 bis 10:30; daneben ein Video, ein Foto mit Folgebild, eine spätere Aufnahme,
  // Mitschriftzeilen und ein Tagebucheintrag
  const me = row({ id: "a1", startMs: h(10, 0), endMs: h(10, 30) });
  const view = {
    rows: [
      me,
      row({ id: "v1", kind: "video", startMs: h(10, 5), deviceId: "d2" }),
      row({ id: "p1", kind: "photo", startMs: h(10, 6), deviceId: "d3" }),
      row({ id: "p2", kind: "photo", startMs: h(10, 6), partOf: "p1" }),
      row({ id: "late", kind: "audio", startMs: h(11, 0), deviceId: "d4" }),
    ],
    transcript: [
      { id: "t1", sourceId: "v1", atMs: 2000, clockMs: h(10, 5, 2), speaker: "S1", text: "Hallo" },
      { id: "t2", sourceId: "a1", atMs: 0, clockMs: h(10, 0), speaker: "", text: "eigene Zeile" },
      { id: "t3", sourceId: "v1", atMs: 0, clockMs: null, speaker: "", text: "ohne Zeit" },
    ],
    diary: [
      {
        id: "e1",
        number: 4,
        notedAt: "10:20",
        shortText: "Regen",
        fullText: null,
        window: { fromMs: h(10, 10), toMs: h(10, 20) },
        regions: [{ pageLabel: "T-01 S. 2" }],
      },
    ],
  } as unknown as SessionView;

  it("Beginn anderer Aufnahmen, Fotos, fremde Zeilen und Tagebuch, als Stelle in dieser Aufnahme", () => {
    // Dann: erscheinen nur Ereignisse in der eigenen Zeit, ohne eigene Zeilen, Folgebilder und Zeilen ohne Uhrzeit
    expect(eventsIn(view, me).map((e) => [e.atMs, e.text])).toEqual([
      [5 * 60_000, "V1 (Video) beginnt · v1.wav"],
      [6 * 60_000, "Foto P1 · p1.wav"],
      [5 * 60_000 + 2000, "V1: S1: Hallo"],
      [20 * 60_000, "Tagebuch T-01 S. 2, Eintrag 4 (notiert 10:20): Regen"],
    ]);
    // Dann: führt eine fremde Zeile zurück zu ihrer Aufnahme
    expect(eventsIn(view, me)[2]!.other).toEqual({
      sourceId: "v1",
      atMs: 2000,
      label: "V1",
      speaker: "S1",
      text: "Hallo",
    });
  });

  it("ohne Lage nichts", () => {
    expect(eventsIn(view, row({ id: "x" }))).toEqual([]);
  });
});
