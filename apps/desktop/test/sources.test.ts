import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createEntry, patchEntry } from "../src/main/diary.ts";
import {
  linkFollowUps,
  mergeDevices,
  moveSource,
  removeSource,
  setFollows,
  setPartOf,
  setSourceKind,
} from "../src/main/sources.ts";
import { buildSessionView } from "../src/main/view.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-src-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const sha = () => (++n).toString(16).padStart(64, "0");

/** Erfundener Einsatz: Rekorder mit drei geteilten Dateien, zwei Tagebücher, eine GoPro. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const rec = store.addDevice({
    sessionId: session.id,
    label: "Rekorder",
    isReference: true,
    offsetBasis: "reference",
  });
  const diaryA = store.addDevice({ sessionId: session.id, label: "Tagebuch" });
  const diaryB = store.addDevice({ sessionId: session.id, label: "Scan" });
  const gopro = store.addDevice({ sessionId: session.id, label: "GoPro" });
  const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {} };
  const audio = (fileName: string, durationMs: number) =>
    store.addSource({ ...base, deviceId: rec.id, kind: "audio", fileName, sha256: sha(), durationMs });
  const a1 = audio("REC001.WAV", 3_600_000);
  const a2 = audio("REC002.WAV", 3_600_000);
  const a3 = audio("REC003.WAV", 1_200_000);
  // Rekorder schreibt den Beginn jeder Datei; a3 hat eine Lücke (neu gestartet).
  for (const [src, h] of [
    [a1, 9],
    [a2, 10],
    [a3, 11.5],
  ] as const) {
    store.addEvidence({
      sourceId: src.id,
      kind: "metadata",
      clock: "device",
      localMs: Date.UTC(2026, 8, 14, Math.floor(h), (h % 1) * 60),
      uncertaintyMs: 1000,
      detail: "Metadaten",
    });
  }
  const page = (fileName: string, deviceId: string) =>
    store.addSource({ ...base, deviceId, kind: "diary", fileName, sha256: sha(), durationMs: null });
  const p1 = page("S01.jpg", diaryA.id);
  const p1b = page("Scan_0007.jpg", diaryB.id);
  const g1 = store.addSource({
    ...base,
    deviceId: gopro.id,
    kind: "video",
    fileName: "GX010042.MP4",
    sha256: sha(),
    durationMs: 500_000,
  });
  const g2 = store.addSource({
    ...base,
    deviceId: gopro.id,
    kind: "video",
    fileName: "GX020042.MP4",
    sha256: sha(),
    durationMs: 200_000,
  });
  return { session, rec, diaryA, diaryB, gopro, a1, a2, a3, p1, p1b, g1, g2 };
}

describe("Quellen pflegen", () => {
  it("entfernt eine Quelle und das dann leere Gerät", () => {
    const { session, p1b, diaryB } = seed();
    // Wenn: die einzige Seite eines Tagebuchs entfernt wird, dann ist auch das Tagebuch weg
    removeSource(store, p1b.id);
    expect(store.listSources(session.id).some((x) => x.id === p1b.id)).toBe(false);
    expect(store.listDevices(session.id).some((d) => d.id === diaryB.id)).toBe(false);
  });

  it("verschiebt eine Quelle in ein anderes oder neues Gerät", () => {
    const { session, p1b, diaryA } = seed();
    // Wenn: die Seite in ein anderes Tagebuch verschoben wird, dann gehört sie dorthin
    moveSource(store, p1b.id, diaryA.id);
    expect(store.getSource(p1b.id).deviceId).toBe(diaryA.id);
    // Wenn: sie in ein neues Gerät verschoben wird, dann trägt es den Namen
    moveSource(store, p1b.id, { newLabel: "Feldnotizen" });
    const dev = store.getDevice(store.getSource(p1b.id).deviceId!);
    expect(dev.label).toBe("Feldnotizen");
    // Wenn: der Name leer ist, dann lehnt die App ab
    expect(() => moveSource(store, p1b.id, { newLabel: "  " })).toThrow(/Namen/);
    // Dann: ist das leere alte Tagebuch weg
    expect(
      store
        .listDevices(session.id)
        .map((d) => d.label)
        .sort(),
    ).toEqual(["Feldnotizen", "GoPro", "Rekorder", "Tagebuch"]);
  });

  it("legt Geräte zusammen und reicht die Referenz weiter", () => {
    const { session, rec, gopro, g1 } = seed();
    // Wenn: der Rekorder in die GoPro übergeht, dann liegen alle Quellen dort und die GoPro wird Referenzuhr
    mergeDevices(store, rec.id, gopro.id);
    expect(store.getSource(g1.id).deviceId).toBe(gopro.id);
    expect(store.listSources(session.id).filter((x) => x.deviceId === gopro.id)).toHaveLength(5);
    expect(store.getDevice(gopro.id).isReference).toBe(true);
    // Wenn: ein Gerät mit sich selbst zusammengelegt werden soll, dann lehnt die App ab
    expect(() => mergeDevices(store, gopro.id, gopro.id)).toThrow();
  });

  it("verbindet Bilder zu einer Seite", () => {
    const { p1, p1b, a1, diaryA } = seed();
    // Wenn: ein Bild an eine Seite gehängt wird, dann wird es Tagebuch und kommt ins selbe Gerät
    setPartOf(store, p1b.id, p1.id);
    expect(store.getSource(p1b.id)).toMatchObject({ partOf: p1.id, deviceId: diaryA.id, kind: "diary" });
    // Wenn: eine Seite an sich selbst oder Ton an eine Seite soll, dann lehnt die App ab
    expect(() => setPartOf(store, p1.id, p1b.id)).toThrow(/sich selbst/);
    expect(() => setPartOf(store, a1.id, p1.id)).toThrow(/Fotos und Tagebuchseiten/);
    // Wenn: die Verbindung gelöst wird, dann steht das Bild wieder allein
    setPartOf(store, p1b.id, null);
    expect(store.getSource(p1b.id).partOf).toBeNull();
  });

  it("ein angehängtes Foto wird Tagebuchseite mit T-Kurzzeichen", () => {
    const { p1, session } = seed();
    // Angenommen: ein Foto F-001 allein auf dem Gerät Fotos
    const fotos = store.addDevice({ sessionId: session.id, label: "Fotos" });
    const f = store.addSource({
      sessionId: session.id,
      deviceId: fotos.id,
      kind: "photo",
      originalPath: "/x",
      fileName: "IMG_0001.jpg",
      sizeBytes: 1,
      sha256: sha(),
      durationMs: null,
      metadata: {},
    });
    expect(f.label).toBe("F-001");
    // Wenn: es an eine Tagebuchseite gehängt wird, dann heißt es T-03 und das leere Gerät ist weg
    setPartOf(store, f.id, p1.id);
    expect(store.getSource(f.id)).toMatchObject({ kind: "diary", label: "T-03" });
    expect(store.listDevices(session.id).some((d) => d.id === fotos.id)).toBe(false);
  });

  it("erkennt Folgeaufnahmen an der Zeit und am GoPro-Namen, aber nicht über eine Lücke", () => {
    const { session, a1, a2, a3, g1, g2 } = seed();
    // Wenn: Folgeaufnahmen gesucht werden, dann gelten a2 und g2 als Fortsetzung, a3 nach der Lücke nicht
    expect(linkFollowUps(store, session.id)).toBe(2);
    expect(store.getSource(a2.id).follows).toBe(a1.id);
    expect(store.getSource(a3.id).follows).toBeNull();
    expect(store.getSource(g2.id).follows).toBe(g1.id);
    // Wenn: noch einmal gesucht wird, dann kommt nichts dazu
    expect(linkFollowUps(store, session.id)).toBe(0);
  });

  it("Folgeaufnahmen lassen sich von Hand setzen, ohne Kreise und Doppelungen", () => {
    const { a1, a2, a3, p1 } = seed();
    // Angenommen: a2 setzt a1 fort, a3 setzt a2 fort
    setFollows(store, a2.id, a1.id);
    setFollows(store, a3.id, a2.id);
    // Wenn: daraus ein Kreis, eine zweite Fortsetzung oder ein Foto würde, dann lehnt die App ab
    expect(() => setFollows(store, a1.id, a3.id)).toThrow(/Kreis/);
    expect(() => setFollows(store, a3.id, a1.id)).toThrow(/schon fort/);
    expect(() => setFollows(store, p1.id, a1.id)).toThrow(/Audio- und Video/);
    // Wenn: die Fortsetzung gelöst wird, dann steht a3 allein
    setFollows(store, a3.id, null);
    expect(store.getSource(a3.id).follows).toBeNull();
  });
});

describe("Bild als Tagebuchseite oder Foto behandeln", () => {
  const exif = { make: "Fairphone", model: "FP5", dateTimeOriginal: "2026:09:14 10:12:34" };

  /** Ein abfotografiertes Notizbuch: Handyfoto mit EXIF, dazu ein weiteres Bild derselben Seite. */
  function seedPhoto() {
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
    const phone = store.addDevice({
      sessionId: session.id,
      label: "Fairphone FP5",
      matchKey: "model:fairphone fp5",
      isReference: true,
      offsetBasis: "reference",
    });
    const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, durationMs: null, metadata: { exif } };
    const photo = store.addSource({ ...base, deviceId: phone.id, kind: "photo", fileName: "IMG_1.jpg", sha256: sha() });
    store.addEvidence({
      sourceId: photo.id,
      kind: "metadata",
      clock: "device",
      localMs: Date.UTC(2026, 8, 14, 10, 12, 34),
      uncertaintyMs: 1000,
      detail: "EXIF",
    });
    const part = store.addSource({ ...base, deviceId: phone.id, kind: "photo", fileName: "IMG_2.jpg", sha256: sha() });
    setPartOf(store, part.id, photo.id);
    return { session, phone, photo, part };
  }

  it("ein Foto wird Tagebuchseite: Kurzzeichen F→T, Gerät Tagebuch, leeres Altgerät weg, rückgängig zu machen", () => {
    const { session, phone, photo, part } = seedPhoto();
    expect(store.getSource(photo.id).label).toBe("F-001");
    // Wenn: das Foto mit weiterem Bild Tagebuchseite wird
    store.history.record("Bildart geändert", () => setSourceKind(store, photo.id, "diary"));
    const page = store.getSource(photo.id);
    // Dann: heißen beide T, liegen im neuen Tagebuch, und das leere Handy-Gerät ist weg
    const devices = store.listDevices(session.id);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ label: "Tagebuch", matchKey: "diary" });
    expect(page).toMatchObject({ kind: "diary", label: "T-01", deviceId: devices[0]!.id });
    expect(store.getSource(part.id)).toMatchObject({ kind: "diary", label: "T-02", deviceId: devices[0]!.id });
    // Wenn: nur das weitere Bild Foto werden soll, dann lehnt die App ab
    expect(() => setSourceKind(store, part.id, "photo")).toThrow(/Hauptseite/);

    // Wenn: rückgängig, dann ist alles wie vorher, das Handy wieder Referenzuhr
    expect(store.history.undo()).toBe("Bildart geändert");
    expect(store.getSource(photo.id)).toMatchObject({ kind: "photo", label: "F-001", deviceId: phone.id });
    expect(store.getSource(part.id)).toMatchObject({ kind: "photo", deviceId: phone.id });
    expect(store.getDevice(phone.id).isReference).toBe(true);
  });

  it("nutzt ein vorhandenes Tagebuch-Gerät", () => {
    const { session, photo } = seedPhoto();
    // Angenommen: es gibt schon ein Tagebuch-Gerät
    const diary = store.addDevice({ sessionId: session.id, label: "Tagebuch", matchKey: "diary" });
    // Wenn: das Foto Tagebuchseite wird, dann kommt es dorthin
    setSourceKind(store, photo.id, "diary");
    expect(store.getSource(photo.id).deviceId).toBe(diary.id);
  });

  it("Tagebuchseite liegt nur nach ihren Randnotizen; als Foto wieder nach EXIF", () => {
    const { session, photo } = seedPhoto();
    const row = () => buildSessionView(store, session.id).rows.find((r) => r.id === photo.id)!;
    // Angenommen: das Foto liegt nach seinen EXIF-Daten
    expect(row().startMs).toBe(Date.UTC(2026, 8, 14, 10, 12, 34));
    // Wenn: es Tagebuchseite wird
    setSourceKind(store, photo.id, "diary");
    // Dann: bleibt die Seite ohne Lage, denn die Aufnahmezeit des Fotos ist keine Notierzeit
    expect(row().startMs).toBeNull();
    expect(store.listEvidence(session.id).filter((e) => e.sourceId === photo.id)).toHaveLength(1);
    // Wenn: eine Randnotiz mit Notierzeit dazukommt, dann liegt die Seite danach und kann kein Foto mehr werden
    const e = createEntry(store, photo.id, { x: 0, y: 0, w: 1, h: 1 }).entry;
    patchEntry(store, e.id, { notedAt: "14:30" });
    expect(row().startMs).toBe(Date.UTC(2026, 8, 14, 14, 30));
    expect(() => setSourceKind(store, photo.id, "photo")).toThrow(/einen Tagebucheintrag/);

    // Wenn: die Notiz gelöscht und die Seite wieder Foto wird
    store.deleteDiaryEntry(e.id);
    setSourceKind(store, photo.id, "photo");
    // Dann: heißt es wieder F-001 und liegt nach EXIF
    const back = store.getSource(photo.id);
    expect(back).toMatchObject({ kind: "photo", label: "F-001" }); // F-001 ist wieder frei
    // Dann: kommt es wie beim Einsammeln zum Gerät nach dem Modell aus den EXIF-Daten
    expect(store.getDevice(back.deviceId!)).toMatchObject({ matchKey: "model:fairphone fp5", label: "Fairphone FP5" });
    expect(row().startMs).toBe(Date.UTC(2026, 8, 14, 10, 12, 34));
  });

  it("eine als Tagebuch eingesammelte Datei bekommt als Foto ihre Zeitbelege nach", () => {
    const { session, diaryA } = seed();
    // Angenommen: ein Bild mit Uhrzeit im Namen wurde als Tagebuchseite eingesammelt
    const scan = store.addSource({
      sessionId: session.id,
      deviceId: diaryA.id,
      kind: "diary",
      originalPath: "/x",
      fileName: "pics_20260914_101500.png",
      sizeBytes: 1,
      sha256: sha(),
      durationMs: null,
      metadata: {},
    });
    // Wenn: es Foto wird
    setSourceKind(store, scan.id, "photo");
    // Dann: heißt es F-001, liegt bei den Fotos, und die Uhrzeit aus dem Namen gilt als Beleg
    const src = store.getSource(scan.id);
    expect(src.label).toBe("F-001");
    expect(store.getDevice(src.deviceId!).label).toMatch(/^Fotos/);
    expect(store.getDevice(diaryA.id).id).toBe(diaryA.id); // hat noch S01.jpg
    const evs = store.listEvidence(session.id).filter((e) => e.sourceId === scan.id);
    expect(evs.map((e) => e.kind)).toEqual(["filename"]);
  });

  it("nur Fotos und Tagebuchseiten lassen sich umstellen", () => {
    const { a1 } = seed();
    expect(() => setSourceKind(store, a1.id, "diary")).toThrow(/Nur Fotos/);
  });
});
