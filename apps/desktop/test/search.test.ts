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
  notes: [{ id: "n1", sourceId: "a1", fromMs: 120_000, toMs: null, text: "Hier noch abtippen", done: false }],
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
  // Angenommen: eine Aufnahme mit zwei Mitschriftzeilen, einer Notiz, einem Tagebucheintrag und einer Episode
  const items = searchItems(view);

  it("findet Mitschrift und Tagebuch ohne Rücksicht auf Groß-/Kleinschreibung", () => {
    const { hits } = search(items, "brunnen");
    expect(hits.map((x) => x.kind)).toEqual(["line", "diary"]);
    expect(hits[0]).toMatchObject({ target: "a1", atMs: 5_000 });
    expect(hits[1]).toMatchObject({ target: "t1" });
  });

  it.each`
    suche                  | treffer | fall
    ${"STRASSE gesperrt"}  | ${1}    | ${"ß als ss, beide Wörter in einer Zeile"}
    ${"strasse brunnen"}   | ${0}    | ${"Wörter in verschiedenen Zeilen"}
    ${"gespräch"}          | ${1}    | ${"mit Umlaut"}
    ${"gesprach"}          | ${1}    | ${"Umlaut ohne Punkte"}
  `("„$suche“ ergibt $treffer Treffer: $fall", ({ suche, treffer }) => {
    expect(search(items, suche).hits).toHaveLength(treffer);
  });

  it("findet über die Uhrzeit und den Dateinamen", () => {
    // Tagebuch steht an seiner Notierzeit.
    expect(search(items, "10:30").hits.map((x) => x.kind)).toContain("diary");
    expect(search(items, "10:15").hits.map((x) => x.kind)).not.toContain("diary");
    expect(search(items, "marktplatz").hits.map((x) => x.kind)).toEqual(["source"]);
  });

  it("findet Notizen an ihrer Stelle in der Aufnahme", () => {
    const [hit] = search(items, "abtippen").hits;
    expect(hit).toMatchObject({ kind: "note", target: "a1", atMs: 120_000, clockMs: h(10, 2) });
  });

  it("gibt Episoden mit ihrem Ende aus, damit die Zeitachse sie einpassen kann", () => {
    expect(items.find((x) => x.kind === "episode")).toMatchObject({ clockMs: h(10, 0), endMs: h(10, 30) });
  });

  it("zählt alle Treffer, auch wenn nur die ersten angezeigt werden", () => {
    // Angenommen: fünf Einträge mit „Eintrag“
    const many = Array.from({ length: 5 }, (_, i) => ({ ...items[0]!, text: `Eintrag ${i}` }));
    // Wenn: höchstens drei angezeigt werden, dann drei Treffer, gezählt fünf
    const r = search(many, "eintrag", 3);
    expect(r.hits).toHaveLength(3);
    expect(r.total).toBe(5);
    expect(search(many, "eintrag").total).toBe(5);
    // Wenn: nur Leerraum gesucht wird, dann nichts
    expect(search(many, "  ")).toEqual({ hits: [], total: 0 });
  });

  it("markiert die Treffer im Text", () => {
    expect(highlight("Am Brunnen", "brunnen")).toEqual([
      { text: "Am ", hit: false },
      { text: "Brunnen", hit: true },
    ]);
  });
});
