import { describe, expect, it } from "vite-plus/test";
import { highlight, search, searchItems } from "../src/renderer/search.ts";
import type { SessionView } from "../src/shared/api.ts";

const h = (hh: number, mm: number) => (hh * 60 + mm) * 60_000;

// Erfundenes Beispiel, keine Forschungsdaten.
const view = {
  rows: [
    {
      id: "a1",
      label: "A1",
      deviceLabel: "Rekorder",
      fileName: "Marktplatz.wav",
      personName: "Kim",
      basis: null,
      startMs: h(10, 0),
    },
  ],
  transcript: [
    { sourceId: "a1", atMs: 5_000, clockMs: h(10, 0) + 5_000, speaker: "S1", text: "Wir treffen uns am Brunnen." },
    { sourceId: "a1", atMs: 65_000, clockMs: h(10, 1) + 5_000, speaker: "S2", text: "Die Straße ist gesperrt." },
  ],
  diary: [
    {
      number: 1,
      shortText: "Gespräch über Brunnenfest",
      fullText: null,
      notedAt: "10:30",
      window: { fromMs: h(10, 15), toMs: h(10, 30) },
      regions: [{ sourceId: "t1", pageLabel: "S. 1" }],
    },
  ],
  episodes: [{ index: 1, startMs: h(10, 0), endMs: h(10, 30), sourceLabels: ["A1"] }],
} as unknown as SessionView;

describe("Schnellsuche", () => {
  const items = searchItems(view);

  it("findet Mitschrift und Tagebuch ohne Rücksicht auf Groß-/Kleinschreibung", () => {
    const hits = search(items, "brunnen");
    expect(hits.map((x) => x.kind)).toEqual(["line", "diary"]);
    expect(hits[0]).toMatchObject({ target: "a1", atMs: 5_000 });
    expect(hits[1]).toMatchObject({ target: "t1" });
  });

  it("verlangt alle Wörter und faltet ß und Akzente", () => {
    expect(search(items, "STRASSE gesperrt")).toHaveLength(1);
    expect(search(items, "strasse brunnen")).toHaveLength(0);
    expect(search(items, "gespräch")).toHaveLength(1);
    expect(search(items, "gesprach")).toHaveLength(1);
  });

  it("findet über die Uhrzeit und den Dateinamen", () => {
    expect(search(items, "10:15").map((x) => x.kind)).toEqual(["diary"]);
    expect(search(items, "marktplatz").map((x) => x.kind)).toEqual(["source"]);
  });

  it("markiert die Treffer im Text", () => {
    expect(highlight("Am Brunnen", "brunnen")).toEqual([
      { text: "Am ", hit: false },
      { text: "Brunnen", hit: true },
    ]);
  });
});
