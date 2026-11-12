import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { addRegion, createEntry, deleteEntry, patchEntry, removeRegion } from "../src/main/diary.ts";
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
    // Die Seite reicht über beide Einträge.
    const page = view.rows.find((r) => r.id === p1.id)!;
    expect(formatClock(page.startMs!)).toBe("14:00:00");
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
});
