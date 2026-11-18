import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addManualAnchor,
  addTimeEvidence,
  confirmPlacement,
  decideMany,
  decidePlacement,
  parseMediaPos,
  removeEvidence,
  replaceAnchor,
  setLevel,
  toggleEvidence,
} from "../src/main/edits.ts";
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

describe("Lage prüfen", () => {
  it("unsichere Lage bestätigen, zurücknehmen und durch Handeingabe ersetzen", () => {
    const { session, video } = seed();
    const before = row(session.id, video.id);
    expect(before.status).toBe("check"); // Kamera-Uhr unbekannt
    confirmPlacement(store, video.id, before.startMs!);
    const after = row(session.id, video.id);
    expect(after.status).toBe("ok");
    expect(after.startMs).toBe(before.startMs);
    expect(after.notes[0]).toBe("geprüft");
    const check = after.evidence[0]!;
    expect(check).toMatchObject({ kind: "checked", chosen: true, own: true });

    removeEvidence(store, check.id);
    expect(row(session.id, video.id).status).toBe("check");

    confirmPlacement(store, video.id, before.startMs!);
    addTimeEvidence(store, {
      sourceId: video.id,
      kind: "manual",
      clock: "10:30",
      atMedia: "",
      precision: "exact",
      note: "",
    });
    const manual = row(session.id, video.id);
    expect(manual.evidence.some((e) => e.kind === "checked")).toBe(false);
    expect(formatClock(manual.startMs!)).toBe("10:30:00");
  });

  it("bestätigt nichts, wenn sich die Lage inzwischen verschoben hat", () => {
    const { session, video } = seed();
    const r = row(session.id, video.id);
    expect(() => confirmPlacement(store, video.id, r.startMs! + 1000)).toThrow(/geändert/);
  });
});

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

describe("Feinabgleich", () => {
  it("ersetzt einen Anker durch einen fein justierten mit Millisekunden", () => {
    const { session, cam, audio, video } = seed();
    addManualAnchor(store, {
      aSourceId: audio.id,
      aAt: "1:20",
      bSourceId: video.id,
      bAt: "0:20",
      precision: "exact",
      note: "",
    });
    const old = buildSessionView(store, session.id).anchors[0]!;
    expect(old.a).toEqual({ sourceId: audio.id, atMs: 80_000 });
    replaceAnchor(store, old.id, {
      aSourceId: audio.id,
      aAt: "80.000",
      bSourceId: video.id,
      bAt: "20.347",
      precision: "exact",
      uncertaintyMs: 20,
      note: "Feinabgleich",
    });
    const view = buildSessionView(store, session.id);
    expect(view.anchors).toHaveLength(1);
    expect(view.anchors[0]!.b.atMs).toBe(20_347);
    expect(store.listAnchors(session.id)[0]!.uncertaintyMs).toBe(20);
    expect(view.devices.find((d) => d.id === cam.id)!.offsetMs).toBe(167_000 + 347);
  });

  it("ein justierter Vorschlag erledigt die übrigen Vorschläge des Geräts", () => {
    const { session, audio, video } = seed();
    store.replaceProposedAnchors(session.id, [
      {
        sessionId: session.id,
        kind: "clap",
        a: { sourceId: audio.id, atMediaMs: 80_000 },
        b: { sourceId: video.id, atMediaMs: 20_000 },
        uncertaintyMs: 20,
        note: "",
      },
      {
        sessionId: session.id,
        kind: "clap",
        a: { sourceId: audio.id, atMediaMs: 90_000 },
        b: { sourceId: video.id, atMediaMs: 30_100 },
        uncertaintyMs: 20,
        note: "",
      },
    ]);
    const [p] = buildSessionView(store, session.id).proposals;
    replaceAnchor(store, p!.anchorId, {
      aSourceId: audio.id,
      aAt: "80",
      bSourceId: video.id,
      bAt: "20.010",
      precision: "exact",
      uncertaintyMs: 20,
      note: "",
    });
    const view = buildSessionView(store, session.id);
    expect(view.proposals).toHaveLength(0);
    expect(view.anchors).toHaveLength(1);
  });
});

describe("Lautstärke", () => {
  it("speichert die Einstellung und zeigt die geltende Verstärkung", () => {
    const { session, audio, photo } = seed();
    expect(row(session.id, audio.id).level).toMatchObject({ mode: "auto", gainDb: 0, measured: false, compress: true });
    expect(row(session.id, photo.id).level).toBeNull();
    setLevel(store, audio.id, { mode: "manual", manualGainDb: 55, compress: false });
    expect(row(session.id, audio.id).level).toMatchObject({
      mode: "manual",
      manualGainDb: 40,
      gainDb: 40,
      compress: false,
    });
    expect(() => setLevel(store, photo.id, { mode: "auto", manualGainDb: 0, compress: true })).toThrow(/keinen Ton/);
  });

  it("automatisch: nach dem gemessenen Sprachpegel, alte Analysen werden nachgerechnet", () => {
    const { session, audio } = seed();
    // Analyse aus einer älteren Version: ohne Pegel, Hüllkurve −38 dBFS (1 Byte je Wert).
    const byte = Math.round(((-38 + 100) / 100) * 250);
    store.saveAudioAnalysis({
      sourceId: audio.id,
      envelope: new Uint8Array(500).fill(byte),
      envelopeRate: 100,
      noiseFloorDb: -60,
      idle: [],
      loudInIdle: [],
      version: 1,
      analyzedAt: new Date().toISOString(),
    });
    const level = row(session.id, audio.id).level!;
    expect(level.measured).toBe(true);
    expect(level.measuredDb).toBeCloseTo(-38, 0);
    expect(level.gainDb).toBeCloseTo(18, 0);
    expect(store.listAudioAnalyses(session.id)[0]!.speechLevelDb).toBeCloseTo(-38, 0);
  });
});

describe("Widerspruch entscheiden", () => {
  const at = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 14, h, m, s);
  /** Foto auf dem Rekorder-Gerät (Referenz): EXIF 10:32:07, Dateiname 10:45 (minutengenau). */
  function conflicted() {
    const seeded = seed();
    const rec = store.listDevices(seeded.session.id).find((d) => d.isReference)!;
    const mk = (n: number) => {
      const src = store.addSource({
        sessionId: seeded.session.id,
        deviceId: rec.id,
        kind: "photo",
        fileName: `IMG_${n}.jpg`,
        sha256: sha(100 + n),
        durationMs: null,
        originalPath: "/x",
        sizeBytes: 1,
        metadata: {},
      });
      const exif = store.addEvidence({
        sourceId: src.id,
        kind: "metadata",
        clock: "device",
        localMs: at(10, 32, 7 + n),
        uncertaintyMs: 1000,
        detail: "EXIF DateTimeOriginal",
      });
      const name = store.addEvidence({
        sourceId: src.id,
        kind: "filename",
        clock: "device",
        localMs: at(10, 45, 30),
        uncertaintyMs: 30_000,
        detail: "Dateiname",
      });
      return { src, exif, name };
    };
    return { ...seeded, mk };
  }

  it("verwendeten Beleg bestätigen: sicher, nachvollziehbar, auch nach dem Wiederöffnen", () => {
    const { session, mk } = conflicted();
    const { src, exif } = mk(0);
    const before = row(session.id, src.id);
    expect(before.status).toBe("check");
    expect(before.conflict).toMatchObject({ state: "open", severity: "strong" });
    decidePlacement(store, {
      sourceId: src.id,
      evidenceId: exif.id,
      expectedStartMs: before.startMs!,
      reason: "umbenannt",
    });
    const after = row(session.id, src.id);
    expect(after.status).toBe("ok");
    expect(after.conflict.state).toBe("decided");
    expect(after.decision).toMatchObject({ reason: "umbenannt", basisKind: "metadata", basisId: exif.id });
    expect(after.decision!.detail).toBe(
      "Entschieden: Metadaten gelten (10:32:07). Dateiname weicht ab (+13:23). Begründung: umbenannt",
    );

    const path = store.path;
    store.close();
    store = ProjectStore.open(path);
    const reopened = row(session.id, src.id);
    expect(reopened.conflict.state).toBe("decided");
    expect(reopened.decision?.reason).toBe("umbenannt");
  });

  it("anderen Beleg wählen: die Quelle rückt und übernimmt dessen Genauigkeit", () => {
    const { session, mk } = conflicted();
    const { src, name } = mk(0);
    const before = row(session.id, src.id);
    decidePlacement(store, { sourceId: src.id, evidenceId: name.id, expectedStartMs: before.startMs!, reason: "" });
    const after = row(session.id, src.id);
    expect(formatClock(after.startMs!)).toBe("10:45:30");
    expect(after.uncertaintyMs).toBe(30_000);
    expect(after.status).toBe("ok");
    expect(after.decision!.detail).toContain("Dateiname gilt");
  });

  it("neuer widersprechender Beleg: Entscheidung neu prüfen", () => {
    const { session, mk } = conflicted();
    const { src, exif } = mk(0);
    decidePlacement(store, {
      sourceId: src.id,
      evidenceId: exif.id,
      expectedStartMs: row(session.id, src.id).startMs!,
      reason: "",
    });
    store.addEvidence({
      sourceId: src.id,
      kind: "spoken",
      clock: "true",
      localMs: at(10, 31, 10),
      uncertaintyMs: 1000,
      detail: "angesagt",
    });
    const r = row(session.id, src.id);
    expect(r.status).toBe("check");
    expect(r.conflict.state).toBe("stale");
    expect(r.notes).toContain("Entscheidung neu prüfen");
  });

  it("verschobene Lage wird nicht entschieden", () => {
    const { session, mk } = conflicted();
    const { src, exif } = mk(0);
    const start = row(session.id, src.id).startMs!;
    expect(() =>
      decidePlacement(store, { sourceId: src.id, evidenceId: exif.id, expectedStartMs: start + 1, reason: "" }),
    ).toThrow(/geändert/);
    expect(row(session.id, src.id).decision).toBeNull();
  });

  it("gleichartige Widersprüche eines Geräts bilden eine Gruppe und lassen sich auf einmal entscheiden", () => {
    const { session, mk } = conflicted();
    const ids = [0, 1, 2].map((n) => mk(n).src.id);
    const view = buildSessionView(store, session.id);
    expect(view.conflictGroups).toHaveLength(1);
    expect(view.conflictGroups[0]).toMatchObject({ usedKind: "metadata", otherKind: "filename", sourceIds: ids });
    decideMany(store, { sourceIds: ids, kind: "metadata", reason: "Kamera benennt beim Kopieren um" });
    const after = buildSessionView(store, session.id);
    expect(after.conflictGroups).toHaveLength(0);
    for (const id of ids) expect(row(session.id, id).conflict.state).toBe("decided");
  });
});
