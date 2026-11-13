import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { addManualAnchor, addTimeEvidence, parseMediaPos, removeEvidence, toggleEvidence } from "../src/main/edits.ts";
import { buildSessionView } from "../src/main/view.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-edits-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const sha = (n: number) => n.toString(16).padStart(64, "0");

/** Erfundener Einsatz: Rekorder (Referenz, 10:15), Kamera mit falscher Uhr, ein Foto ohne Zeit. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const rec = store.addDevice({
    sessionId: session.id,
    label: "Rekorder",
    isReference: true,
    offsetBasis: "reference",
  });
  const cam = store.addDevice({ sessionId: session.id, label: "Kamera" });
  const misc = store.addDevice({ sessionId: session.id, label: "Fotos" });
  const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {} };
  const audio = store.addSource({
    ...base,
    deviceId: rec.id,
    kind: "audio",
    fileName: "REC.m4a",
    sha256: sha(1),
    durationMs: 600_000,
  });
  const video = store.addSource({
    ...base,
    deviceId: cam.id,
    kind: "video",
    fileName: "C1.MP4",
    sha256: sha(2),
    durationMs: 60_000,
  });
  const photo = store.addSource({
    ...base,
    deviceId: misc.id,
    kind: "photo",
    fileName: "scan.jpg",
    sha256: sha(3),
    durationMs: null,
  });
  const at = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 14, h, m, s);
  store.addEvidence({
    sourceId: audio.id,
    kind: "metadata",
    clock: "device",
    localMs: at(10, 15),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  store.addEvidence({
    sourceId: video.id,
    kind: "metadata",
    clock: "device",
    localMs: at(10, 18, 47),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  return { session, cam, audio, video, photo };
}

const row = (sessionId: string, id: string) => buildSessionView(store, sessionId).rows.find((r) => r.id === id)!;

describe("Zeiten von Hand", () => {
  it("Stellen in Aufnahmen lesen", () => {
    expect(parseMediaPos("")).toBe(0);
    expect(parseMediaPos("3:20")).toBe(200_000);
    expect(parseMediaPos("1:03:20")).toBe(3_800_000);
    expect(parseMediaPos("12,5")).toBe(12_500);
    expect(() => parseMediaPos("drei")).toThrow();
  });

  it("Foto ohne Zeit bekommt eine Uhrzeit von Hand", () => {
    const { session, photo } = seed();
    expect(row(session.id, photo.id).status).toBe("unplaced");
    addTimeEvidence(store, {
      sourceId: photo.id,
      kind: "manual",
      clock: "10:40",
      atMedia: "",
      precision: "approx",
      note: "",
    });
    const r = row(session.id, photo.id);
    expect(formatClock(r.startMs!)).toBe("10:40:00");
    expect(r.evidence[0]).toMatchObject({ kind: "manual", own: true, chosen: true, uncertaintyMs: 60_000 });
  });

  it("angesagte Uhrzeit im Video gleicht die Kamera ab", () => {
    const { session, video, cam } = seed();
    // Bei 0:20 sagt jemand „zehn Uhr sechzehn und zwanzig Sekunden“; die Kamera zeigt dort 10:19:07.
    addTimeEvidence(store, {
      sourceId: video.id,
      kind: "spoken",
      clock: "10:16:20",
      atMedia: "0:20",
      precision: "exact",
      note: "",
    });
    const view = buildSessionView(store, session.id);
    const d = view.devices.find((x) => x.id === cam.id)!;
    expect(d.offsetBasis).toBe("spoken");
    expect(d.offsetMs).toBe(167_000);
    expect(formatClock(view.rows.find((r) => r.id === video.id)!.startMs!)).toBe("10:16:00");
  });

  it("Zeit von Hand in einem Clip richtet die Uhr des Geräts, die übrigen Clips folgen", () => {
    const { session, video, cam } = seed();
    const second = store.addSource({
      sessionId: session.id,
      originalPath: "/x",
      sizeBytes: 1,
      metadata: {},
      deviceId: cam.id,
      kind: "video",
      fileName: "C2.MP4",
      sha256: sha(9),
      durationMs: 60_000,
    });
    store.addEvidence({
      sourceId: second.id,
      kind: "metadata",
      clock: "device",
      localMs: Date.UTC(2026, 8, 14, 10, 42, 57),
      uncertaintyMs: 1000,
      detail: "Metadaten",
    });
    // Ohne die Option gilt die Angabe nur für den einen Clip.
    const t = { clock: "10:16:20", precision: "exact" as const, note: "", atMedia: "0:20", kind: "manual" as const };
    addTimeEvidence(store, { ...t, sourceId: video.id });
    expect(buildSessionView(store, session.id).devices.find((d) => d.id === cam.id)!.offsetMs).toBeNull();
    // Mit der Option wird aus der Angabe die Abweichung der Kamera (Uhr zeigte 10:19:07, echt 10:16:20).
    addTimeEvidence(store, { ...t, sourceId: video.id, syncDevice: true });
    const view = buildSessionView(store, session.id);
    const d = view.devices.find((x) => x.id === cam.id)!;
    expect(d).toMatchObject({ offsetBasis: "manual", offsetMs: 167_000 });
    expect(formatClock(view.rows.find((r) => r.id === second.id)!.startMs!)).toBe("10:40:10");
  });

  it("Geräteabgleich per Hand nur mit Geräteuhr und ohne Referenzgerät", () => {
    const { audio, photo } = seed();
    const t = { clock: "10:00", precision: "exact" as const, note: "", atMedia: "", kind: "manual" as const };
    expect(() => addTimeEvidence(store, { ...t, sourceId: audio.id, syncDevice: true })).toThrow(/Referenzuhr/);
    expect(() => addTimeEvidence(store, { ...t, sourceId: photo.id, syncDevice: true })).toThrow(/Geräteuhr/);
  });

  it("angesagte Zeit nur in Audio und Video, Stelle nicht hinter dem Ende", () => {
    const { photo, video } = seed();
    const t = { clock: "10:00", precision: "exact" as const, note: "" };
    expect(() => addTimeEvidence(store, { ...t, sourceId: photo.id, kind: "spoken", atMedia: "" })).toThrow(
      /Audio und Video/,
    );
    expect(() => addTimeEvidence(store, { ...t, sourceId: video.id, kind: "manual", atMedia: "5:00" })).toThrow(/Ende/);
    expect(() =>
      addTimeEvidence(store, { ...t, sourceId: video.id, kind: "manual", atMedia: "", clock: "25:00" }),
    ).toThrow();
  });

  it("gelesene Belege lassen sich abschalten, aber nicht löschen", () => {
    const { session, video } = seed();
    const ev = row(session.id, video.id).evidence[0]!;
    expect(() => removeEvidence(store, ev.id)).toThrow(/abschalten/);
    toggleEvidence(store, ev.id, false);
    expect(row(session.id, video.id).status).toBe("unplaced");
    toggleEvidence(store, ev.id, true);
    expect(row(session.id, video.id).startMs).not.toBeNull();
  });

  it("eigene Belege lassen sich löschen", () => {
    const { session, photo } = seed();
    addTimeEvidence(store, {
      sourceId: photo.id,
      kind: "manual",
      clock: "10:40",
      atMedia: "",
      precision: "rough",
      note: "geschätzt",
    });
    const ev = row(session.id, photo.id).evidence[0]!;
    expect(ev.detail).toBe("Von Hand: geschätzt");
    removeEvidence(store, ev.id);
    expect(row(session.id, photo.id).status).toBe("unplaced");
  });

  it("Anker von Hand verbindet Rekorder und Kamera", () => {
    const { session, audio, video, cam } = seed();
    addManualAnchor(store, {
      aSourceId: audio.id,
      aAt: "1:20",
      bSourceId: video.id,
      bAt: "0:20",
      precision: "exact",
      note: "Tür knallt",
    });
    const view = buildSessionView(store, session.id);
    expect(view.devices.find((d) => d.id === cam.id)!.offsetMs).toBe(167_000);
    expect(view.anchors).toEqual([
      expect.objectContaining({
        kind: "manual",
        description: "A-01 bei 1:20 = V-01 bei 0:20",
        note: "Tür knallt",
        conflictMs: null,
      }),
    ]);
    expect(() =>
      addManualAnchor(store, {
        aSourceId: audio.id,
        aAt: "0",
        bSourceId: audio.id,
        bAt: "1",
        precision: "exact",
        note: "",
      }),
    ).toThrow(/verschiedene/);
  });
});
