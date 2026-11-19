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
    const input = testmarkt();
    const foto = input.sources.find((s) => s.id === "IMG_0231.jpg")!;
    foto.role = "context";
    const res = resolveTimeline(input);
    expect(res.placements.has("IMG_0231.jpg")).toBe(false);
    expect(res.context).toHaveLength(1);
    expect(res.context[0]).toMatchObject({ key: "source:IMG_0231.jpg", sourceId: "IMG_0231.jpg", position: 1 });
    expect(clock(res.context[0]!.wouldStartMs)).toBe(clock(resolveTimeline(testmarkt()).placements.get("IMG_0231.jpg")!.startMs));
    // Zurück: liegt genau wie vorher.
    foto.role = "timeline";
    expect(resolveTimeline(input).placements.get("IMG_0231.jpg")!.startMs).toBe(res.context[0]!.wouldStartMs);
  });

  it("Foto ohne Beleg als Kontext: kein Rückweg mit Uhrzeit", () => {
    const input = testmarkt();
    input.evidence = input.evidence.filter((e) => e.sourceId !== "IMG_0232.jpg");
    input.sources.find((s) => s.id === "IMG_0232.jpg")!.role = "context";
    const res = resolveTimeline(input);
    expect(res.context[0]!.wouldStartMs).toBeNull();
  });

  it("Kontext-Foto mit widersprüchlichen Belegen meldet keinen Widerspruch", () => {
    const input = testmarkt();
    input.evidence.push({ ...input.evidence.find((e) => e.sourceId === "IMG_0231.jpg")!, id: "x", kind: "filename", localMs: T(9, 0) });
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "context";
    const res = resolveTimeline(input);
    expect(res.placements.has("IMG_0231.jpg")).toBe(false);
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "timeline";
    expect(resolveTimeline(input).placements.get("IMG_0231.jpg")!.conflict.state).toBe("open");
  });

  it("Kontext-Eintrag ohne Notierzeit fehlt in der Chronologie und macht die Seite nicht unsicher", () => {
    const res = resolveTimeline(withMap());
    expect(res.diary.has("karte")).toBe(false);
    expect(res.context.map((c) => c.key)).toEqual(["entry:karte"]);
    const page = res.placements.get("Tagebuch_S01.jpg")!;
    expect(page.status).toBe("ok");
    expect(page.notes).toEqual([]);
  });

  it("Kontext-Eintrag mit Notierzeit: Angabe, aber keine Lage", () => {
    const input = withMap();
    input.diaryEntries.find((e) => e.id === "karte")!.notedAtMs = T(13, 5);
    const res = resolveTimeline(input);
    expect(res.diary.has("karte")).toBe(false);
    expect(clock(res.context[0]!.notedAtMs)).toBe("13:05:00");
    // Die Seite liegt weiter nur über den datierten Eintrag.
    expect(clock(res.placements.get("Tagebuch_S01.jpg")!.endMs)).toBe("10:12:00");
  });

  it("Seite nur mit Kontext liegt nicht auf der Zeitachse", () => {
    const input = withMap();
    input.diaryEntries = input.diaryEntries.filter((e) => e.id !== "d1");
    expect(resolveTimeline(input).placements.has("Tagebuch_S01.jpg")).toBe(false);
  });

  it("Seite mit Kontext und einem undatierten Chronologie-Eintrag bleibt „prüfen“ wie bisher", () => {
    const input = withMap();
    input.diaryEntries.push({ ...input.diaryEntries.find((e) => e.id === "d1")!, id: "offen", notedAtMs: null });
    const page = resolveTimeline(input).placements.get("Tagebuch_S01.jpg")!;
    expect(page.status).toBe("check");
    expect(page.notes).toEqual(["1 Eintrag ohne Uhrzeit"]);
  });

  it("Reihenfolge: gewünschte Stelle, dann Fundstelle; Text ohne Scan zuletzt", () => {
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
    const res = resolveTimeline(input);
    expect(res.context.map((c) => [c.position, c.key])).toEqual([
      [1, "source:IMG_0232.jpg"],
      [2, "source:IMG_0231.jpg"],
      [3, "entry:karte"],
      [4, "entry:text"],
    ]);
  });

  it("Verweise: nur von datierten Einträgen, nach Notierzeit", () => {
    const input = withMap();
    input.diaryEntries.find((e) => e.id === "d2")!.contextRefs = ["entry:karte"];
    input.diaryEntries.find((e) => e.id === "d1")!.contextRefs = ["entry:karte", "entry:karte"];
    const res = resolveTimeline(input);
    expect(res.context[0]!.mentionedBy.map((m) => m.entryId)).toEqual(["d1", "d2"]);
  });

  it("weiteres Bild einer Kontext-Quelle erscheint nicht eigenständig", () => {
    const input = testmarkt();
    const foto = input.sources.find((s) => s.id === "IMG_0231.jpg")!;
    foto.role = "context";
    input.sources.push({ ...foto, id: "rueckseite", label: "F-009", role: "timeline", partOf: "IMG_0231.jpg" });
    const res = resolveTimeline(input);
    expect(res.placements.has("rueckseite")).toBe(false);
    expect(res.context.map((c) => c.key)).toEqual(["source:IMG_0231.jpg"]);
  });

  it("andere Fotos desselben Geräts liegen unverändert", () => {
    const before = resolveTimeline(testmarkt()).placements.get("IMG_0232.jpg")!.startMs;
    const input = testmarkt();
    input.sources.find((s) => s.id === "IMG_0231.jpg")!.role = "context";
    expect(resolveTimeline(input).placements.get("IMG_0232.jpg")!.startMs).toBe(before);
  });

  it("ohne Kontext bleibt alles wie bisher", () => {
    expect(resolveTimeline(testmarkt()).context).toEqual([]);
  });
});
