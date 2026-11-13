import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { linkFollowUps, mergeDevices, moveSource, removeSource, setFollows, setPartOf } from "../src/main/sources.ts";

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
    removeSource(store, p1b.id);
    expect(store.listSources(session.id).some((x) => x.id === p1b.id)).toBe(false);
    expect(store.listDevices(session.id).some((d) => d.id === diaryB.id)).toBe(false);
  });

  it("verschiebt eine Quelle in ein anderes oder neues Gerät", () => {
    const { session, p1b, diaryA } = seed();
    moveSource(store, p1b.id, diaryA.id);
    expect(store.getSource(p1b.id).deviceId).toBe(diaryA.id);
    moveSource(store, p1b.id, { newLabel: "Feldnotizen" });
    const dev = store.getDevice(store.getSource(p1b.id).deviceId!);
    expect(dev.label).toBe("Feldnotizen");
    expect(() => moveSource(store, p1b.id, { newLabel: "  " })).toThrow(/Namen/);
    expect(
      store
        .listDevices(session.id)
        .map((d) => d.label)
        .sort(),
    ).toEqual(["Feldnotizen", "GoPro", "Rekorder", "Tagebuch"]);
  });

  it("legt Geräte zusammen und reicht die Referenz weiter", () => {
    const { session, rec, gopro, g1 } = seed();
    mergeDevices(store, rec.id, gopro.id);
    expect(store.getSource(g1.id).deviceId).toBe(gopro.id);
    expect(store.listSources(session.id).filter((x) => x.deviceId === gopro.id)).toHaveLength(5);
    expect(store.getDevice(gopro.id).isReference).toBe(true);
    expect(() => mergeDevices(store, gopro.id, gopro.id)).toThrow();
  });

  it("verbindet Bilder zu einer Seite", () => {
    const { p1, p1b, a1, diaryA } = seed();
    setPartOf(store, p1b.id, p1.id);
    expect(store.getSource(p1b.id)).toMatchObject({ partOf: p1.id, deviceId: diaryA.id, kind: "diary" });
    expect(() => setPartOf(store, p1.id, p1b.id)).toThrow(/sich selbst/);
    expect(() => setPartOf(store, a1.id, p1.id)).toThrow(/Fotos und Tagebuchseiten/);
    setPartOf(store, p1b.id, null);
    expect(store.getSource(p1b.id).partOf).toBeNull();
  });

  it("erkennt Folgeaufnahmen an der Zeit und am GoPro-Namen, aber nicht über eine Lücke", () => {
    const { session, a1, a2, a3, g1, g2 } = seed();
    expect(linkFollowUps(store, session.id)).toBe(2);
    expect(store.getSource(a2.id).follows).toBe(a1.id);
    expect(store.getSource(a3.id).follows).toBeNull();
    expect(store.getSource(g2.id).follows).toBe(g1.id);
    expect(linkFollowUps(store, session.id)).toBe(0);
  });

  it("Folgeaufnahmen von Hand, ohne Kreise und Doppelungen", () => {
    const { a1, a2, a3, p1 } = seed();
    setFollows(store, a2.id, a1.id);
    setFollows(store, a3.id, a2.id);
    expect(() => setFollows(store, a1.id, a3.id)).toThrow(/Kreis/);
    expect(() => setFollows(store, a3.id, a1.id)).toThrow(/schon fort/);
    expect(() => setFollows(store, p1.id, a1.id)).toThrow(/Audio- und Video/);
    setFollows(store, a3.id, null);
    expect(store.getSource(a3.id).follows).toBeNull();
  });
});
