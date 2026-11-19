import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createContextText,
  moveContext,
  setContext,
  setContextDetails,
  setEntryRefs,
  sortContextByPage,
} from "../src/main/context.ts";
import { createEntry, deleteEntry, patchEntry } from "../src/main/diary.ts";
import { buildSessionView } from "../src/main/view.ts";
import { todos } from "../src/renderer/inspector/status.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-context-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const sha = (n: number) => n.toString(16).padStart(64, "0");
const T = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 14, h, m, s);

/** Erfundener Einsatz: Rekorder (Referenz), Handy mit Foto (EXIF 09:41:12) und Foto ohne Zeit, zwei Tagebuchseiten. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const rec = store.addDevice({
    sessionId: session.id,
    label: "Rekorder",
    isReference: true,
    offsetBasis: "reference",
  });
  const handy = store.addDevice({ sessionId: session.id, label: "Handy", clockOffsetMs: 0, offsetBasis: "reference" });
  const buch = store.addDevice({ sessionId: session.id, label: "Tagebuch" });
  const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {}, durationMs: null };
  const audio = store.addSource({
    ...base,
    deviceId: rec.id,
    kind: "audio",
    fileName: "REC.m4a",
    sha256: sha(1),
    durationMs: 3_600_000,
  });
  store.addEvidence({
    sourceId: audio.id,
    kind: "metadata",
    clock: "device",
    localMs: T(9, 30),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  const dated = store.addSource({ ...base, deviceId: handy.id, kind: "photo", fileName: "IMG_1.jpg", sha256: sha(2) });
  store.addEvidence({
    sourceId: dated.id,
    kind: "metadata",
    clock: "device",
    localMs: T(9, 41, 12),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  const bare = store.addSource({ ...base, deviceId: handy.id, kind: "photo", fileName: "Karte.jpg", sha256: sha(3) });
  const diaryBase = { ...base, deviceId: buch.id, kind: "diary" as const, durationMs: null };
  const p1 = store.addSource({ ...diaryBase, fileName: "S01.jpg", sha256: sha(4) });
  const p2 = store.addSource({ ...diaryBase, fileName: "S02.jpg", sha256: sha(5) });
  return { session, audio, dated, bare, p1, p2 };
}

const view = (sessionId: string) => buildSessionView(store, sessionId);
const row = (sessionId: string, id: string) => view(sessionId).rows.find((r) => r.id === id)!;

describe("Kontext führen (Issue #108)", () => {
  it("Foto ohne Zeit als Kontext: nicht mehr „ohne Uhrzeit“, offener Punkt verschwindet", () => {
    const { session, bare } = seed();
    const noTime = (v: ReturnType<typeof view>) => todos(v).find((t) => t.text.includes("keine Uhrzeit"))?.text;
    expect(noTime(view(session.id))).toBe("3 Quellen haben noch keine Uhrzeit.");
    setContext(store, `source:${bare.id}`, true);
    const v = view(session.id);
    expect(row(session.id, bare.id).status).toBe("context");
    expect(v.context.map((c) => c.key)).toEqual([`source:${bare.id}`]);
    expect(noTime(v)).toBe("2 Quellen haben noch keine Uhrzeit.");
  });

  it("datiertes Foto: verlässt die Zeitachse, Rückweg nennt die Uhrzeit, zurück liegt es wie vorher", () => {
    const { session, dated } = seed();
    const before = row(session.id, dated.id).startMs;
    setContext(store, `source:${dated.id}`, true);
    const c = view(session.id).context[0]!;
    expect(row(session.id, dated.id).startMs).toBeNull();
    expect(c.wouldStartMs).toBe(before);
    expect(c.canReturn).toBe(true);
    setContext(store, `source:${dated.id}`, false);
    expect(row(session.id, dated.id).startMs).toBe(before);
    expect(view(session.id).context).toEqual([]);
  });

  it("Ton und Video können kein Kontext sein", () => {
    const { audio } = seed();
    expect(() => setContext(store, `source:${audio.id}`, true)).toThrow("Ton und Video können kein Kontext sein.");
  });

  it("leere Tagebuchseite als Kontext: ein Eintrag über die ganze Seite, keine Randnotiz mehr offen", () => {
    const { session, p1 } = seed();
    setContext(store, `source:${p1.id}`, true);
    const v = view(session.id);
    expect(v.diary.filter((e) => e.role === "context")).toHaveLength(1);
    expect(row(session.id, p1.id).status).toBe("context");
    expect(todos(v).find((t) => t.text.includes("ohne Randnotiz"))?.text).toBe("1 Tagebuchseite ohne Randnotiz.");
    // Zurück: Die Einträge der Seite stehen wieder in der Chronologie (ohne Uhrzeit).
    setContext(store, `source:${p1.id}`, false);
    expect(row(session.id, p1.id).status).not.toBe("context");
  });

  it("Seite mit datiertem Eintrag lässt sich nicht als Ganzes umstellen", () => {
    const { p1 } = seed();
    const e = createEntry(store, p1.id, { x: 0, y: 0, w: 1, h: 0.5 }).entry.id;
    patchEntry(store, e, { notedAt: "10:24" });
    expect(() => setContext(store, `source:${p1.id}`, true)).toThrow();
  });

  it("gemischte Seite: Karte als Kontext, Eintrag darunter datiert; Seite liegt weiter auf der Achse", () => {
    const { session, p1 } = seed();
    const karte = createEntry(store, p1.id, { x: 0, y: 0, w: 1, h: 0.4 }).entry.id;
    const notiz = createEntry(store, p1.id, { x: 0, y: 0.5, w: 1, h: 0.5 }).entry.id;
    patchEntry(store, notiz, { notedAt: "10:24" });
    setContext(store, `entry:${karte}`, true);
    setContextDetails(store, `entry:${karte}`, { title: " Karte 2: Standplan ", made: "am Vorabend" });
    const v = view(session.id);
    expect(v.context).toMatchObject([{ key: `entry:${karte}`, title: "Karte 2: Standplan", made: "am Vorabend" }]);
    expect(row(session.id, p1.id).status).not.toBe("context");
    expect(row(session.id, p1.id).startMs).not.toBeNull();
  });

  it("Reihenfolge: ↑↓ einen Schritt, Nach Seite ordnen, zurückkehrendes Stück bekommt seine Stelle wieder", () => {
    const { session, dated, bare, p1 } = seed();
    setContext(store, `source:${bare.id}`, true);
    setContext(store, `source:${dated.id}`, true);
    setContext(store, `source:${p1.id}`, true);
    const keys = () => view(session.id).context.map((c) => c.key);
    const pageKey = keys()[2]!;
    expect(keys()).toEqual([`source:${bare.id}`, `source:${dated.id}`, pageKey]);
    moveContext(store, pageKey, 1);
    expect(keys()).toEqual([pageKey, `source:${bare.id}`, `source:${dated.id}`]);
    // hin, zurück, hin: wieder an Stelle 2
    setContext(store, `source:${bare.id}`, false);
    expect(keys()).toEqual([pageKey, `source:${dated.id}`]);
    setContext(store, `source:${bare.id}`, true);
    expect(keys()).toEqual([pageKey, `source:${bare.id}`, `source:${dated.id}`]);
    sortContextByPage(store, session.id);
    expect(keys()[0]).toBe(pageKey); // Tagebuch vor Fotos
    expect(view(session.id).context.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it("Verweise: am datierten Eintrag, Erwähnt in, und weg, wenn das Ziel gelöscht wird", () => {
    const { session, p1, bare } = seed();
    setContext(store, `source:${bare.id}`, true);
    const notiz = createEntry(store, p1.id, { x: 0, y: 0, w: 1, h: 1 }).entry.id;
    patchEntry(store, notiz, { notedAt: "10:24" });
    const text = createContextText(store, session.id, { title: "Zwischenstand", text: "erste Runde" });
    setEntryRefs(store, notiz, [`source:${bare.id}`, `entry:${text}`, `entry:${text}`, `entry:${notiz}`]);
    let v = view(session.id);
    expect(v.diary.find((e) => e.id === notiz)!.refs).toEqual([`source:${bare.id}`, `entry:${text}`]);
    expect(v.context.find((c) => c.entryId === text)!.mentionedBy).toMatchObject([
      { entryId: notiz, notedAt: "10:24" },
    ]);
    deleteEntry(store, text);
    v = view(session.id);
    expect(v.diary.find((e) => e.id === notiz)!.refs).toEqual([`source:${bare.id}`]);
  });

  it("Text ohne Scan: bearbeitbar, kein Rückweg in die Chronologie", () => {
    const { session } = seed();
    const id = createContextText(store, session.id, { title: "", text: "" });
    patchEntry(store, id, { fullText: "Liste der Stände" });
    const c = view(session.id).context[0]!;
    expect(c).toMatchObject({ find: "Text ohne Scan", textEditable: true, canReturn: false, text: "Liste der Stände" });
    expect(() => setContext(store, `entry:${id}`, false)).toThrow();
  });

  it("Summary-Zähler: Kontext zählt nicht als offen", () => {
    const { session, bare, dated } = seed();
    setContext(store, `source:${bare.id}`, true);
    setContext(store, `source:${dated.id}`, true);
    const v = view(session.id);
    expect(v.rows.filter((r) => r.status === "unplaced")).toHaveLength(2); // die beiden Tagebuchseiten
    expect(v.rows.filter((r) => r.status === "context")).toHaveLength(2);
  });
});
