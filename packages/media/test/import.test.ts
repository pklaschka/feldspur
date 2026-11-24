/**
 * Schritt Einsammeln (`packages/media/src/import.ts`): Importplan eines erzeugten Feldtags und seine Übernahme ins
 * Projekt; dazu Fortschritt, Abbrechen und zweiter Versuch bei großen Ordnern.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { effectiveLocal, formatClock, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, ScanCache, scanPaths, type ImportCandidate, type ScanProgress } from "../src/import.ts";
import { hasFfmpeg, makeAudio, makeFieldDay, makeVideo } from "./fixtures.ts";

describe.skipIf(!hasFfmpeg())("Einsammeln eines Feldtags", () => {
  let dir: string;
  let plan: ImportCandidate[];
  const byName = (n: string) => plan.find((c) => c.fileName === n)!;

  // Angenommen: ein erfundener Feldtag mit Rekorder, zwei Kameraclips, zwei Handys und einer Tagebuchseite
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-import-"));
    makeFieldDay(dir);
    plan = await scanPaths([dir]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("findet alle Quellen, überspringt Begleitdateien", () => {
    expect(plan.map((c) => c.fileName).sort()).toEqual([
      "C0012.MP4",
      "C0013.MP4",
      "IMG_0231.jpg",
      "IMG_20260914_104050.jpg",
      "Tagebuch_S01.jpg",
      "ZOOM0004.m4a",
    ]);
  });

  it.each`
    datei                 | art
    ${"C0012.MP4"}        | ${"video"}
    ${"ZOOM0004.m4a"}     | ${"audio"}
    ${"Tagebuch_S01.jpg"} | ${"diary"}
    ${"IMG_0231.jpg"}     | ${"photo"}
  `("$datei wird als $art eingesammelt", ({ datei, art }) => {
    expect(byName(datei).kind).toBe(art);
  });

  it("liest Länge und Prüfsumme", () => {
    expect(byName("C0012.MP4").durationMs).toBeGreaterThanOrEqual(1900);
    expect(byName("IMG_0231.jpg").sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("liest Zeitbelege aus Metadaten, EXIF und Dateinamen", () => {
    expect(byName("C0012.MP4").evidence.map((e) => [e.kind, formatClock(e.localMs)])).toEqual([
      ["metadata", "08:18:47"], // wie geschrieben; umgerechnet wird beim Einordnen
    ]);
    expect(new Date(byName("C0012.MP4").evidence[0]!.utcMs!).toISOString()).toBe("2026-09-14T08:18:47.000Z");
    expect(byName("IMG_0231.jpg").evidence.map((e) => [e.detail, formatClock(e.localMs)])).toEqual([
      ["EXIF", "10:12:34"],
    ]);
    expect(byName("IMG_20260914_104050.jpg").evidence.map((e) => e.kind)).toEqual(["filename"]);
    expect(byName("Tagebuch_S01.jpg").evidence).toEqual([]);
  });

  it("gruppiert nach Gerät: Modell aus EXIF, sonst Dateinamen-Familie", () => {
    expect(byName("C0012.MP4").deviceKey).toBe(byName("C0013.MP4").deviceKey);
    expect(byName("IMG_0231.jpg").deviceLabel).toBe("Beispiel Handy Testperson A");
    expect(byName("IMG_0231.jpg").deviceKey).not.toBe(byName("IMG_20260914_104050.jpg").deviceKey);
  });

  it("übernimmt den Plan ins Projekt und ordnet nach Anker richtig ein", () => {
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14" });
    // Wenn: der Plan ins Projekt übernommen wird, dann sechs Quellen auf fünf Geräten mit Kurzzeichen
    const res = applyImport(store, session.id, plan);
    expect(res.sources).toHaveLength(6);
    expect(res.devicesCreated).toHaveLength(5);
    expect(res.sources.map((s) => s.label).sort()).toEqual(["A-01", "F-001", "F-002", "T-01", "V-01", "V-02"]);

    // Wenn: Rekorder Referenz ist und das Klatschen als Anker gesetzt, dann liegen beide Kameraclips richtig
    const src = (n: string) => res.sources.find((s) => s.fileName === n)!;
    store.setReferenceDevice(src("ZOOM0004.m4a").deviceId!);
    store.addAnchor({
      sessionId: session.id,
      kind: "clap",
      a: { sourceId: src("ZOOM0004.m4a").id, atMediaMs: 80_000 },
      b: { sourceId: src("C0012.MP4").id, atMediaMs: 20_000 },
    });
    const tl = resolveTimeline(store.loadResolveInput(session.id));
    expect(formatClock(tl.placements.get(src("C0012.MP4").id)!.startMs)).toBe("10:16:00");
    expect(formatClock(tl.placements.get(src("C0013.MP4").id)!.startMs)).toBe("10:40:10");

    // Wenn: dieselben Dateien noch einmal eingesammelt werden, dann entsteht nichts doppelt
    const again = applyImport(store, session.id, plan);
    expect(again.sources).toHaveLength(0);
    expect(again.duplicates).toHaveLength(6);
    store.close();
  });

  it("liest die BWF-Aufnahmezeit aus WAV-Dateien von Rekordern", async () => {
    // Angenommen: eine WAV-Datei mit BWF-Aufnahmebeginn 11:02:03
    const wav = join(dir, "ZOOM0005.WAV");
    makeAudio(wav, { seconds: 1, bwf: { date: "2026-09-14", time: "11:02:03" } });
    const [c] = await scanPaths([wav]);
    // Dann: wird er als Zeitbeleg gelesen
    expect(c!.evidence.map((e) => [e.detail, formatClock(e.localMs)])).toEqual([
      ["Metadaten (BWF Aufnahmebeginn)", "11:02:03"],
    ]);
  });

  it("liest creation_time mit „Z“ als UTC und rechnet in Ortszeit um", async () => {
    // Angenommen: ein Video mit creation_time 11:29:15 Z
    const sub = join(dir, "utc");
    mkdirSync(sub);
    makeVideo(join(sub, "MVI_0001.MP4"), { seconds: 1, creationTime: "2026-09-07T11:29:15.000000Z" });
    const cands = await scanPaths([sub]);
    // Wenn: es eingesammelt wird
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Beispiel", date: "2026-09-07" });
    const res = applyImport(store, session.id, cands);
    // Dann: gilt das Gerät als UTC, und das Video liegt um 13:29:15 Berliner Zeit
    expect(res.devicesCreated[0]!.timestampsAreUtc).toBe(true);
    const tl = resolveTimeline(store.loadResolveInput(session.id));
    expect(formatClock(tl.placements.get(res.sources[0]!.id)!.startMs)).toBe("13:29:15");
    store.close();
  });

  it("erkennt Geräte, die Ortszeit mit „Z“ schreiben, am Dateinamen", async () => {
    // Angenommen: zwei Videos, deren Dateiname dieselbe Uhrzeit trägt wie creation_time mit „Z“
    const sub = join(dir, "ortszeit");
    mkdirSync(sub);
    makeVideo(join(sub, "VID_20260907_140003.mp4"), { seconds: 1, creationTime: "2026-09-07T14:00:00.000000Z" });
    makeVideo(join(sub, "VID_20260907_141502.mp4"), { seconds: 1, creationTime: "2026-09-07T14:15:00.000000Z" });
    const cands = await scanPaths([sub]);
    // Wenn: sie eingesammelt werden
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Beispiel", date: "2026-09-07" });
    const res = applyImport(store, session.id, cands);
    // Dann: gilt das Gerät als Ortszeit, und 14:00 bleibt 14:00
    expect(res.devicesCreated).toHaveLength(1);
    expect(res.devicesCreated[0]!.timestampsAreUtc).toBe(false);
    const input = store.loadResolveInput(session.id);
    const first = res.sources.find((s) => s.fileName.endsWith("140003.mp4"))!;
    const meta = input.evidence.find((e) => e.sourceId === first.id && e.kind === "metadata")!;
    expect(formatClock(effectiveLocal(meta, input.devices[0], input.session.timeZone))).toBe("14:00:00");
    store.close();
  });
});

describe("Großer Ordner: Fortschritt, Abbrechen, zweiter Versuch", () => {
  let dir: string;
  const FILES = 6;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-ordner-"));
    // Notizen brauchen kein ffmpeg; je 256 KB, damit es etwas zu lesen gibt.
    for (let i = 1; i <= FILES; i++) writeFileSync(join(dir, `Notiz_${i}.txt`), Buffer.alloc(256 * 1024, i));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("meldet Anzahl, aktuelle Datei und gelesene Bytes bis zum Ende", async () => {
    // Wenn: der Ordner mit sechs Notizen gelesen wird
    const seen: ScanProgress[] = [];
    await scanPaths([dir], { onProgress: (p) => seen.push(p) });
    // Dann: nennt der Fortschritt die Datei, und am Ende stimmen Anzahl und Bytes
    const reading = seen.filter((p) => p.phase === "reading");
    expect(reading.length).toBeGreaterThan(0);
    expect(reading.some((p) => p.path.endsWith("Notiz_1.txt"))).toBe(true);
    expect(reading.at(-1)).toMatchObject({ done: FILES, total: FILES, bytesDone: FILES * 256 * 1024, path: "" });
    expect(reading.at(-1)!.bytesTotal).toBe(FILES * 256 * 1024);
  });

  it("ein Abbruch beendet den Scan, schreibt nichts, und ein neuer Versuch übernimmt Gelesenes", async () => {
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Beispiel", date: "2026-09-07" });
    const cache = new ScanCache();
    const ctrl = new AbortController();
    // Wenn: nach zwei gelesenen Dateien abgebrochen wird
    const scan = scanPaths([dir], {
      cache,
      signal: ctrl.signal,
      onProgress: (p) => p.phase === "reading" && p.done >= 2 && ctrl.abort(),
    });
    // Dann: endet der Scan mit Abbruch, nichts im Projekt, Gelesenes im Zwischenspeicher
    await expect(scan).rejects.toMatchObject({ name: "AbortError" });
    expect(store.listSources(session.id)).toEqual([]);
    expect(cache.size).toBeGreaterThanOrEqual(2);
    expect(cache.size).toBeLessThan(FILES);

    // Wenn: noch einmal gelesen wird, dann wird Gelesenes übernommen und das Ergebnis ist dasselbe wie ohne Abbruch
    let last: ScanProgress | undefined;
    const again = await scanPaths([dir], { cache, onProgress: (p) => (last = p) });
    expect(again).toHaveLength(FILES);
    expect(last!.reused).toBeGreaterThanOrEqual(2);
    expect(again).toEqual(await scanPaths([dir]));
    store.close();
  });

  it("eine veränderte Datei wird beim zweiten Versuch neu gelesen", async () => {
    const cache = new ScanCache();
    // Angenommen: eine Notiz wurde schon einmal gelesen
    const first = await scanPaths([join(dir, "Notiz_1.txt")], { cache });
    // Wenn: sie sich ändert und noch einmal gelesen wird
    writeFileSync(join(dir, "Notiz_1.txt"), "anders");
    const second = await scanPaths([join(dir, "Notiz_1.txt")], { cache });
    // Dann: hat sie eine neue Prüfsumme (danach wieder herstellen)
    expect(second[0]!.sha256).not.toBe(first[0]!.sha256);
    writeFileSync(join(dir, "Notiz_1.txt"), Buffer.alloc(256 * 1024, 1));
  });

  it("überspringt Unlesbares mit Hinweis statt alles abzubrechen", async () => {
    // Angenommen: ein Ordner mit einer guten Datei und einem toten Verweis
    const sub = join(dir, "mit-defekt");
    mkdirSync(sub);
    writeFileSync(join(sub, "gut.txt"), "ok");
    symlinkSync(join(sub, "gibt-es-nicht.mp4"), join(sub, "kaputt.mp4"));
    // Wenn: er gelesen wird
    const skipped: string[] = [];
    const found = await scanPaths([sub], { onSkipped: (p, m) => skipped.push(`${basename(p)}: ${m}`) });
    // Dann: kommt die gute Datei an, und der Verweis wird mit Grund übersprungen
    expect(found.map((c) => c.fileName)).toEqual(["gut.txt"]);
    expect(skipped).toEqual(["kaputt.mp4: übersprungen: nicht gefunden"]);
    rmSync(sub, { recursive: true, force: true });
  });
});
