import { describe, expect, it } from "vite-plus/test";
import { resolveTimeline } from "../src/resolve.ts";
import { formatClock } from "../src/time.ts";
import { CONTEXT_DEFAULTS, T, testmarkt } from "./scenario.ts";

const clock = (ms: number | null | undefined) => (ms == null ? ms : formatClock(ms));

/** Testmarkt mit einer Karte (Kontext-Eintrag) auf Seite T-01 neben dem datierten Eintrag d1. */
function withMap() {
  const input = testmarkt();
  input.diaryEntries.push({
    id: "karte",
    sessionId: "s1",
    regions: [{ sourceId: "Tagebuch_S01.jpg", page: 0, x: 0, y: 0, w: 1, h: 0.4 }],
    notedAtMs: null,
    lookbackMs: null,
    mode: "short",
    shortText: "Standplan",
    fullText: "",
    ...CONTEXT_DEFAULTS,
    role: "context",
    title: "Karte 2: Standplan",
  });
  return input;
}

describe("Kontext: bewusst ohne Uhrzeit", () => {
  it("Foto mit EXIF als Kontext verlässt die Zeitachse, die Uhrzeit bleibt als Rückweg gemerkt", () => {
    // Angenommen: ein Foto mit EXIF-Zeit wird als Kontext geführt
    const input = testmarkt();
    const foto = input.sources.find((s) => s.id === "IMG_0231.jpg")!;
    foto.role = "context";
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: steht es als Kontext, mit der Uhrzeit, die es sonst hätte
    expect(res.placements.has("IMG_0231.jpg")).toBe(false);
    expect(res.context).toHaveLength(1);
    expect(res.context[0]).toMatchObject({ key: "source:IMG_0231.jpg", sourceId: "IMG_0231.jpg", position: 1 });
    expect(clock(res.context[0]!.wouldStartMs)).toBe(
      clock(resolveTimeline(testmarkt()).placements.get("IMG_0231.jpg")!.startMs),
    );
    // Zurück: liegt genau wie vorher.
    // Wenn: es zurück in die Chronologie kommt, dann liegt es genau wie vorher
    foto.role = "timeline";
    expect(resolveTimeline(input).placements.get("IMG_0231.jpg")!.startMs).toBe(res.context[0]!.wouldStartMs);
  });

  it("Foto ohne Beleg als Kontext: kein Rückweg mit Uhrzeit", () => {
    // Angenommen: ein Foto ohne Zeitbeleg als Kontext
    const input = testmarkt();
    input.evidence = input.evidence.filter((e) => e.sourceId !== "IMG_0232.jpg");
    input.sources.find((s) => s.id === "IMG_0232.jpg")!.role = "context";
    const res = resolveTimeline(input);
    // Dann: gibt es keine Uhrzeit für den Rückweg
    expect(res.context[0]!.wouldStartMs).toBeNull();
  });

  it("Kontext-Foto mit widersprüchlichen Belegen meldet keinen Widerspruch", () => {
    // Angenommen: ein Foto, dessen Dateiname den Metadaten widerspricht, als Kontext
    const input = testmarkt();
    input.evidence.push({
      ...input.evidence.find((e) => e.sourceId === "IMG_0231.jpg")!,
      id: "x",
      kind: "filename",
      localMs: T(9, 0),
    });
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "context";
    const res = resolveTimeline(input);
    // Dann: kein Widerspruch, solange es Kontext ist
    expect(res.placements.has("IMG_0231.jpg")).toBe(false);
    // Wenn: es zurück in die Chronologie kommt, dann ist der Widerspruch offen
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "timeline";
    expect(resolveTimeline(input).placements.get("IMG_0231.jpg")!.conflict.state).toBe("open");
  });

  it("Kontext-Eintrag ohne Notierzeit fehlt in der Chronologie und macht die Seite nicht unsicher", () => {
    // Angenommen: eine Karte ohne Notierzeit neben einem datierten Eintrag auf derselben Seite
    const res = resolveTimeline(withMap());
    // Dann: steht sie als Kontext, und die Seite gilt weiter als sicher
    expect(res.diary.has("karte")).toBe(false);
    expect(res.context.map((c) => c.key)).toEqual(["entry:karte"]);
    const page = res.placements.get("Tagebuch_S01.jpg")!;
    expect(page.status).toBe("ok");
    expect(page.notes).toEqual([]);
  });

  it("Kontext-Eintrag mit Notierzeit: Angabe, aber keine Lage", () => {
    // Angenommen: die Karte hat eine Notierzeit 13:05
    const input = withMap();
    input.diaryEntries.find((e) => e.id === "karte")!.notedAtMs = T(13, 5);
    const res = resolveTimeline(input);
    // Dann: wird die Zeit genannt, die Seite liegt aber weiter nur über den datierten Eintrag
    expect(res.diary.has("karte")).toBe(false);
    expect(clock(res.context[0]!.notedAtMs)).toBe("13:05:00");
    // Die Seite liegt weiter nur über den datierten Eintrag.
    expect(clock(res.placements.get("Tagebuch_S01.jpg")!.endMs)).toBe("10:12:00");
  });

  it("Seite nur mit Kontext liegt nicht auf der Zeitachse", () => {
    // Angenommen: auf der Seite steht nur noch die Karte
    const input = withMap();
    input.diaryEntries = input.diaryEntries.filter((e) => e.id !== "d1");
    // Dann: liegt die Seite nicht auf der Zeitachse
    expect(resolveTimeline(input).placements.has("Tagebuch_S01.jpg")).toBe(false);
  });

  it("Seite mit Kontext und einem undatierten Chronologie-Eintrag bleibt „prüfen“ wie bisher", () => {
    // Angenommen: Karte, datierter und undatierter Eintrag auf derselben Seite
    const input = withMap();
    input.diaryEntries.push({ ...input.diaryEntries.find((e) => e.id === "d1")!, id: "offen", notedAtMs: null });
    const page = resolveTimeline(input).placements.get("Tagebuch_S01.jpg")!;
    // Dann: bleibt die Seite „prüfen“ wegen des undatierten Eintrags
    expect(page.status).toBe("check");
    expect(page.notes).toEqual(["1 Eintrag ohne Uhrzeit"]);
  });

  it("Reihenfolge: gewünschte Stelle, dann Tagebuch vor Fotos; Text ohne Scan zuletzt", () => {
    // Angenommen: zwei Fotos (eins mit Wunschplatz 1), die Karte und ein Text ohne Scan als Kontext
    const input = withMap();
    const fotoA = input.sources.find((s) => s.id === "IMG_0231.jpg")!;
    const fotoB = input.sources.find((s) => s.id === "IMG_0232.jpg")!;
    fotoA.role = "context";
    fotoB.role = "context";
    fotoB.contextOrder = 1;
    input.diaryEntries.push({
      id: "text",
      sessionId: "s1",
      regions: [],
      notedAtMs: null,
      lookbackMs: null,
      mode: "full",
      shortText: "",
      fullText: "Zwischenstand",
      ...CONTEXT_DEFAULTS,
      role: "context",
    });
    // Wenn: Feldspur die Zeitachse berechnet
    const res = resolveTimeline(input);
    // Dann: erst der Wunschplatz, dann Tagebuch, dann Fotos, Text zuletzt
    expect(res.context.map((c) => [c.position, c.key])).toEqual([
      [1, "source:IMG_0232.jpg"],
      [2, "entry:karte"],
      [3, "source:IMG_0231.jpg"],
      [4, "entry:text"],
    ]);
  });

  it("Verweise: nur von datierten Einträgen, nach Notierzeit", () => {
    // Angenommen: zwei datierte Einträge verweisen auf die Karte, einer doppelt
    const input = withMap();
    input.diaryEntries.find((e) => e.id === "d2")!.contextRefs = ["entry:karte"];
    input.diaryEntries.find((e) => e.id === "d1")!.contextRefs = ["entry:karte", "entry:karte"];
    const res = resolveTimeline(input);
    // Dann: nennt die Karte beide einmal, nach Notierzeit
    expect(res.context[0]!.mentionedBy.map((m) => m.entryId)).toEqual(["d1", "d2"]);
  });

  it("weiteres Bild einer Kontext-Quelle erscheint nicht eigenständig", () => {
    // Angenommen: ein Kontext-Foto mit einer Rückseite als weiterem Bild
    const input = testmarkt();
    const foto = input.sources.find((s) => s.id === "IMG_0231.jpg")!;
    foto.role = "context";
    input.sources.push({ ...foto, id: "rueckseite", label: "F-009", role: "timeline", partOf: "IMG_0231.jpg" });
    const res = resolveTimeline(input);
    // Dann: steht nur das Foto im Kontext, die Rückseite nirgends eigenständig
    expect(res.placements.has("rueckseite")).toBe(false);
    expect(res.context.map((c) => c.key)).toEqual(["source:IMG_0231.jpg"]);
  });

  it("andere Fotos desselben Geräts liegen unverändert", () => {
    const before = resolveTimeline(testmarkt()).placements.get("IMG_0232.jpg")!.startMs;
    // Wenn: ein Foto des Handys Kontext wird
    const input = testmarkt();
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "context";
    // Dann: liegt das andere Foto wie vorher
    expect(resolveTimeline(input).placements.get("IMG_0232.jpg")!.startMs).toBe(before);
  });

  it("ohne Kontext bleibt alles wie bisher", () => {
    expect(resolveTimeline(testmarkt()).context).toEqual([]);
  });
});
