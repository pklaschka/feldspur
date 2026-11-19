import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addRegion,
  createEntry,
  deleteEntry,
  moveRegion,
  patchEntry,
  removeRegion,
  setRegionPage,
} from "../src/main/diary.ts";
import { setPageNumbering } from "../src/main/edits.ts";
import { buildSessionView } from "../src/main/view.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-diary-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Erfundener Einsatz mit zwei Tagebuchseiten. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const dev = store.addDevice({ sessionId: session.id, label: "Tagebuch" });
  const base = {
    sessionId: session.id,
    deviceId: dev.id,
    kind: "diary" as const,
    originalPath: "/x",
    sizeBytes: 1,
    metadata: {},
    durationMs: null,
  };
  const p1 = store.addSource({ ...base, fileName: "S01.jpg", sha256: "1".padStart(64, "0") });
  const p2 = store.addSource({ ...base, fileName: "S02.jpg", sha256: "2".padStart(64, "0") });
  return { session, p1, p2 };
}

describe("Tagebuch abtippen", () => {
  it("zwei Einträge auf einer Seite, jeder mit eigener Zeit", () => {
    const { session, p1 } = seed();
    const a = createEntry(store, p1.id, { x: 0.1, y: 0.5, w: 0.8, h: 0.3 }).entry;
    const b = createEntry(store, p1.id, { x: 0.1, y: 0.1, w: 0.8, h: 0.3 }).entry;
    patchEntry(store, a.id, { notedAt: "14:23", shortText: "Streit am Käsestand", mode: "short" });
    patchEntry(store, b.id, { notedAt: "14:05", lookbackMin: 5, fullText: "Ankunft, viel los.", mode: "full" });
    const view = buildSessionView(store, session.id);
    // Nummern nach Lage auf der Seite: oben zuerst.
    expect(view.diary.map((d) => [d.number, d.id])).toEqual([
      [1, b.id],
      [2, a.id],
    ]);
    const [first, second] = view.diary;
    expect(first!.window).toEqual({ fromMs: expect.any(Number), toMs: expect.any(Number) });
    expect(formatClock(first!.window!.fromMs)).toBe("14:00:00");
    expect(formatClock(second!.window!.fromMs)).toBe("14:08:00"); // 15 Min. Standard
    expect(second!.shortText).toBe("Streit am Käsestand");
    // Die Seite steht von der ersten bis zur letzten Notierzeit.
    const page = view.rows.find((r) => r.id === p1.id)!;
    expect(formatClock(page.startMs!)).toBe("14:05:00");
    expect(formatClock(page.endMs!)).toBe("14:23:00");
  });

  it("Eintrag läuft über zwei Seiten", () => {
    const { session, p1, p2 } = seed();
    const e = createEntry(store, p1.id, { x: 0, y: 0.7, w: 1, h: 0.3 }).entry;
    addRegion(store, e.id, p2.id, { x: 0, y: 0, w: 1, h: 0.2 });
    patchEntry(store, e.id, { notedAt: "15:00" });
    const view = buildSessionView(store, session.id);
    expect(view.diary[0]!.regions.map((r) => r.pageLabel)).toEqual(["T-01", "T-02"]);
    expect(view.rows.find((r) => r.id === p2.id)!.startMs).not.toBeNull();
    removeRegion(store, e.id, 1);
    expect(buildSessionView(store, session.id).diary[0]!.regions).toHaveLength(1);
    removeRegion(store, e.id, 0);
    expect(buildSessionView(store, session.id).diary).toHaveLength(0);
  });

  it("Doppelseiten: erst links, dann rechts, mit Seitenzahlen aus dem Notizbuch", () => {
    const { session, p1, p2 } = seed();
    // Rechts oben wurde vor links unten angelegt; gezählt wird trotzdem links zuerst.
    const right = createEntry(store, p1.id, { x: 0.55, y: 0.05, w: 0.4, h: 0.3 }).entry;
    const left = createEntry(store, p1.id, { x: 0.05, y: 0.6, w: 0.4, h: 0.3 }).entry;
    const next = createEntry(store, p2.id, { x: 0.05, y: 0.1, w: 0.4, h: 0.3 }).entry;
    setPageNumbering(store, [
      { sourceId: p1.id, firstPage: 11, spread: true },
      { sourceId: p2.id, firstPage: 13, spread: true },
    ]);
    const view = buildSessionView(store, session.id);
    expect(view.diary.map((d) => [d.id, d.regions[0]!.pageLabel])).toEqual([
      [left.id, "T-01 · S. 11"],
      [right.id, "T-01 · S. 12"],
      [next.id, "T-02 · S. 13"],
    ]);
    expect(view.rows.find((r) => r.id === p1.id)).toMatchObject({ firstPage: 11, pageSpread: true });
    // Zählung wieder entfernen: Kurzzeichen und Hälfte bleiben.
    setPageNumbering(store, [{ sourceId: p1.id, firstPage: null, spread: true }]);
    expect(buildSessionView(store, session.id).diary[1]!.regions[0]!.pageLabel).toBe("T-01 rechts");
    expect(() => setPageNumbering(store, [{ sourceId: p1.id, firstPage: -1, spread: false }])).toThrow();
  });

  it("Seitenzahl von Hand am Eintrag, auch über der Zählung des Scans", () => {
    const { session, p1 } = seed();
    const e = createEntry(store, p1.id, { x: 0.05, y: 0.1, w: 0.4, h: 0.3 }).entry;
    setPageNumbering(store, [{ sourceId: p1.id, firstPage: 11, spread: true }]);
    setRegionPage(store, e.id, 0, 23);
    let r = buildSessionView(store, session.id).diary[0]!.regions[0]!;
    expect(r).toMatchObject({ pageLabel: "T-01 · S. 23", pageNo: 23, pageNoOwn: true });
    setRegionPage(store, e.id, 0, null);
    r = buildSessionView(store, session.id).diary[0]!.regions[0]!;
    expect(r).toMatchObject({ pageLabel: "T-01 · S. 11", pageNo: 11, pageNoOwn: false });
    expect(store.getDiaryEntry(e.id).regions[0]).not.toHaveProperty("pageNo");
    expect(() => setRegionPage(store, e.id, 3, 1)).toThrow();
  });

  it("Rahmen werden auf die Seite begrenzt, zu kleine abgelehnt", () => {
    const { p1 } = seed();
    const e = createEntry(store, p1.id, { x: 0.9, y: -0.2, w: 0.5, h: 0.5 }).entry;
    expect(e.regions[0]).toMatchObject({ x: 0.9, y: 0, h: 0.5 });
    expect(e.regions[0]!.w).toBeCloseTo(0.1);
    expect(() => createEntry(store, p1.id, { x: 0.5, y: 0.5, w: 0.001, h: 0.2 })).toThrow(/zu klein/);
  });

  it("Eingaben werden geprüft, Löschen entfernt den Eintrag", () => {
    const { session, p1 } = seed();
    const e = createEntry(store, p1.id, { x: 0, y: 0, w: 1, h: 1 }).entry;
    expect(() => patchEntry(store, e.id, { notedAt: "später" })).toThrow();
    expect(() => patchEntry(store, e.id, { lookbackMin: -3 })).toThrow();
    patchEntry(store, e.id, { notedAt: "" });
    deleteEntry(store, e.id);
    expect(buildSessionView(store, session.id).diary).toHaveLength(0);
  });

  it("neuer Eintrag übernimmt die Form des zuletzt angelegten, „Nur Scan“ nicht", () => {
    const { session, p1, p2 } = seed();
    const a = createEntry(store, p1.id, { x: 0, y: 0, w: 1, h: 0.3 }).entry;
    expect(a.mode).toBe("short");
    patchEntry(store, a.id, { mode: "full" });
    const b = createEntry(store, p1.id, { x: 0, y: 0.4, w: 1, h: 0.3 }).entry;
    expect(b.mode).toBe("full");
    patchEntry(store, b.id, { mode: "scan" });
    // Über die Seite hinweg, am Scan-Eintrag vorbei: der letzte abgetippte war Volltext.
    expect(createEntry(store, p2.id, { x: 0, y: 0, w: 1, h: 0.3 }).entry.mode).toBe("full");
    // Anderer Einsatz fängt wieder mit Kurzform an.
    const other = store.addSession({ title: "Zweiter Tag", date: "2026-09-15", place: "", extra: {} });
    const dev = store.addDevice({ sessionId: other.id, label: "Tagebuch" });
    const p3 = store.addSource({
      ...store.getSource(p1.id),
      id: undefined,
      sessionId: other.id,
      deviceId: dev.id,
      sha256: "3".padStart(64, "0"),
    });
    expect(createEntry(store, p3.id, { x: 0, y: 0, w: 1, h: 0.3 }).entry.mode).toBe("short");
    expect(buildSessionView(store, session.id).diary).toHaveLength(3);
  });

  it("Rahmen verschieben und in der Größe ändern, Seite und Seitenzahl bleiben", () => {
    const { p1, p2 } = seed();
    const e = createEntry(store, p1.id, { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }).entry;
    addRegion(store, e.id, p2.id, { x: 0, y: 0, w: 1, h: 0.5 });
    setRegionPage(store, e.id, 1, 7);
    moveRegion(store, e.id, 1, { x: 0.2, y: 0.3, w: 0.6, h: 0.4 });
    const [first, second] = store.getDiaryEntry(e.id).regions;
    expect(first).toMatchObject({ sourceId: p1.id, x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
    expect(second).toMatchObject({ sourceId: p2.id, page: 0, x: 0.2, y: 0.3, w: 0.6, h: 0.4, pageNo: 7 });
    // Über den Rand hinaus wird begrenzt, zu klein abgelehnt, falscher Rahmen gemeldet.
    moveRegion(store, e.id, 0, { x: 0.8, y: 0.9, w: 0.5, h: 0.5 });
    expect(store.getDiaryEntry(e.id).regions[0]).toMatchObject({ x: 0.8, y: 0.9 });
    expect(store.getDiaryEntry(e.id).regions[0]!.w).toBeCloseTo(0.2);
    expect(store.getDiaryEntry(e.id).regions[0]!.h).toBeCloseTo(0.1);
    expect(() => moveRegion(store, e.id, 0, { x: 0, y: 0, w: 0.001, h: 0.5 })).toThrow(/zu klein/);
    expect(() => moveRegion(store, e.id, 5, { x: 0, y: 0, w: 0.5, h: 0.5 })).toThrow(/nicht gefunden/);
  });
});
