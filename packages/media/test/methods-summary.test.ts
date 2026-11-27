/**
 * Zahlen je Einsatz für die Übersicht und die Tabelle zum Methodenteil (`packages/media/src/methods-summary.ts`,
 * `packages/media/src/methods-table.ts`), samt Quellen weit weg vom Datum des Einsatzes (#226).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, type ExportSettings } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { nearDay } from "../src/field-calendar.ts";
import { analyzeSession } from "../src/analyze.ts";
import { exportFingerprint } from "../src/export-state.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { methodsSummary } from "../src/methods-summary.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { outputTable } from "../src/methods-table.ts";
import { hasFfmpeg, makeDiaryPage, makePhoto, makeSyncAudio, makeSyncDay } from "./fixtures.ts";

const SETTINGS: ExportSettings = {
  video: true,
  resolve: false,
  mixAudio: true,
  realtime: true,
  deviceTracks: true,
  viewer: true,
  readme: true,
  changeLog: true,
  manifest: true,
  videoHeight: 720,
  videoFps: 25,
};

describe.skipIf(!hasFfmpeg())("Zahlen für die Tabelle zum Methodenteil", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const src = (n: string) => store.listSources(sessionId).find((s) => s.fileName === n)!;
  const summary = (settings = SETTINGS) => methodsSummary(store, sessionId, settings);
  const row = (kind: string) => summary().material.filter((r) => r.kind === kind);

  // Angenommen: ein abgeglichener Markttag mit Rekorder, Kamera, zwei Fotos, einer Tagebuchseite mit einem Eintrag
  // und einem abgetippten Eintrag ohne Scan
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-methoden-"));
    const raw = join(dir, "roh");
    makeSyncDay(raw);
    makeDiaryPage(join(raw, "Tagebuch_S01.jpg"), 1);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makePhoto(join(raw, "IMG_20260914_102000.jpg"), "0x2f6b3a");
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    store.setReferenceDevice(src("ZOOM0001.m4a").deviceId!);
    await analyzeSession(store, sessionId);
    for (const a of store.listAnchors(sessionId).filter((x) => x.proposed)) store.confirmAnchor(a.id);
    store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: src("Tagebuch_S01.jpg").id, page: 0, x: 0, y: 0, w: 1, h: 0.5 }],
      notedAtMs: Date.UTC(2026, 8, 14, 10, 12),
      mode: "short",
      shortText: "Ankunft, Stände bauen auf",
    });
    store.addDiaryEntry({
      sessionId,
      regions: [],
      notedAtMs: Date.UTC(2026, 8, 14, 10, 20),
      mode: "short",
      shortText: "Erster Kunde",
    });
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("zählt als Uhr ohne Abgleich nur Geräte mit eigener Uhr, das Tagebuch nicht", () => {
    // Angenommen: Rekorder (Referenz) und Kamera (Anker) sind abgeglichen, offen sind die Fotos und das Tagebuch
    const ohneUhr = store.listSources(sessionId).filter((s) => s.kind === "diary");
    expect(ohneUhr.length).toBeGreaterThan(0);
    // Dann: zählt nur das Fotogerät, so wie am Reiter „Abgleichen“
    expect(summary().unsynced).toBe(1);
  });

  it("zählt jede Datei genau einmal, je Art und Gerät", () => {
    const files = summary().material.reduce((n, r) => n + r.files, 0);
    expect(files).toBe(store.listSources(sessionId).length);
    expect(row("photo").reduce((n, r) => n + r.files, 0)).toBe(2);
  });

  it("summiert die Dauer nur bei Ton und Video", () => {
    const audio = store.listSources(sessionId).filter((s) => s.kind === "audio");
    expect(row("audio").reduce((n, r) => n + r.durationMs, 0)).toBe(audio.reduce((n, s) => n + (s.durationMs ?? 0), 0));
    expect(row("photo").every((r) => r.durationMs === 0)).toBe(true);
  });

  it("führt das Tagebuch in einer Zeile ohne Gerät und zählt auch Einträge ohne Scan", () => {
    expect(row("diary")).toEqual([expect.objectContaining({ device: "", files: 1, entries: 2 })]);
  });

  it("nennt je Zeile, worauf die Lagen beruhen", () => {
    // Fotos mit Uhrzeit im Dateinamen; die Tagebuchseite liegt an der notierten Uhrzeit
    expect(row("photo").map((r) => r.basis)).toEqual([{ filename: 2 }]);
    expect(row("diary")[0]!.basis).toEqual({ diary: 1 });
  });

  it("nennt die Korrektur der Geräteuhr, wo eine angewandt wurde", () => {
    // Die Kamera ist über einen Anker an den Rekorder (Referenzuhr) abgeglichen: ihre Uhr wird korrigiert
    const { resolved } = buildSessionTranscript(store, sessionId);
    const applied = new Set([...resolved.placements.values()].map((p) => p.deviceCorrectionMs).filter(Boolean));
    expect(applied.size).toBeGreaterThan(0);
    expect(new Set(summary().material.flatMap((r) => r.correctionsMs))).toEqual(applied);
    expect(row("audio").flatMap((r) => r.correctionsMs)).toEqual([]);
  });

  it("beschreibt die Ausgabe wie das Einsatztranskript: Zeilen, Länge und Montage-ID", () => {
    const transcript = buildSessionTranscript(store, sessionId, { mode: "realtime" });
    expect(summary().output).toMatchObject({
      lines: transcript.entries.length,
      durationMs: transcript.plan.durationMs,
      mode: "Echtzeit",
      montageId: transcript.header.montageId,
      video: true,
    });
  });

  it("führt eine Tagebuchseite, deren Einträge alle Kontext sind, als Kontext ohne Uhrzeit", () => {
    // Wenn: der Eintrag auf der Seite zum Kontext wird, dann zählt die Seite nicht mehr als „notierte Uhrzeit“
    const entry = store.listDiaryEntries(sessionId).find((e) => e.regions.length)!;
    store.history.record("Kontext", () => store.updateDiaryEntry(entry.id, { role: "context" }));
    expect(row("diary")[0]!.basis).toEqual({ context: 1 });
    // Wenn: rückgängig, dann ist alles wie vorher
    store.history.undo();
    expect(row("diary")[0]!.basis).toEqual({ diary: 1 });
  });

  it("weiß, ob die Ausgabe so schon vorliegt", () => {
    // Angenommen: noch nie ausgegeben
    expect(summary()).toMatchObject({ exported: "none", exportedAt: null });
    // Wenn: eine Ausgabe gespeichert ist, dann liegt sie so vor
    store.saveExportRecord({
      sessionId,
      exportedAt: "2026-09-15T08:00:00.000Z",
      dir,
      files: [],
      durationMs: 1000,
      options: SETTINGS,
      fingerprint: exportFingerprint(store, sessionId, SETTINGS),
    });
    expect(summary()).toMatchObject({ exported: "current", exportedAt: "2026-09-15T08:00:00.000Z" });
    // Wenn: mit anderen Einstellungen gefragt wird oder sich der Einsatz ändert, dann nicht mehr
    expect(summary({ ...SETTINGS, video: false }).exported).toBe("stale");
    store.updateSession(sessionId, { place: "Marktplatz" });
    expect(summary().exported).toBe("stale");
  });

  it("verspricht keine aktuelle Ausgabe, wenn ihre Dateien im Ordner fehlen (#229)", () => {
    // Angenommen: eine Ausgabe zum jetzigen Stand, deren Dateien aber nicht (mehr) im Ordner liegen
    store.saveExportRecord({
      sessionId,
      exportedAt: "2026-09-15T08:00:00.000Z",
      dir: join(dir, "gelöscht"),
      files: ["Feldtag_2026-09-14_Testmarkt.docx"],
      durationMs: 1000,
      options: SETTINGS,
      fingerprint: exportFingerprint(store, sessionId, SETTINGS),
    });
    // Dann: gilt sie als fehlend, nicht als aktuell
    expect(summary().exported).toBe("missing");
  });
});

describe.skipIf(!hasFfmpeg())("Quellen weit weg vom Datum des Einsatzes (#226)", () => {
  let dir: string;
  let store: ProjectStore;

  // Angenommen: eine Aufnahme vom 14.09.2026 und ein Foto, dessen Kamerauhr auf 2019 zurückgesetzt war
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-weitweg-"));
    makeSyncAudio(join(dir, "ZOOM0001.m4a"), { seconds: 4, creationTime: "2026-09-14T08:15:00.000000Z" });
    makePhoto(join(dir, "Foto.jpg"), "0x8a4fbf", {
      make: "Testwerk",
      model: "TK-1",
      dateTimeOriginal: "2019:01:01 00:00:10",
    });
    store = ProjectStore.open(":memory:");
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each`
    fall                         | datum           | weit | marken
    ${"Kamerauhr zurückgesetzt"} | ${"2026-09-14"} | ${1} | ${1}
    ${"Datum vertippt"}          | ${"2026-10-01"} | ${2} | ${0}
  `("$fall: $weit weit weg, Marken im Feldkalender: $marken", async ({ datum, weit, marken }) => {
    const sessionId = store.addSession({ title: `Weit weg ${datum}`, date: datum }).id;
    applyImport(store, sessionId, await scanPaths([dir]));
    const s = methodsSummary(store, sessionId, SETTINGS);
    // Dann: zählt die Zeile, was weit weg liegt
    expect(s.output.farFromDate).toBe(weit);
    // Und: im Feldkalender steht nur, was zum Tag gehört, so dass die Achse lesbar bleibt
    expect(s.marks).toHaveLength(marken);
    expect(s.marks.every((m) => nearDay(datum, m.fromMs) && nearDay(datum, m.toMs))).toBe(true);
    // Und: die Kennwerte nennen keine Länge mit fünfstelligen Stunden
    const umfang = outputTable([s]).rows.find((r) => r[1] === "Montagevideo")![3];
    expect(umfang).toBe(`Länge unklar, ${weit === 1 ? "1 Quelle" : `${weit} Quellen`} weit weg vom Datum, Echtzeit`);
  });
});
