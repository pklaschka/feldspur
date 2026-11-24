/**
 * Änderungen an einem Einsatz, wie sie die Schritte „Abgleichen“ und „Durchsehen“ auslösen
 * (`apps/desktop/src/main/edits.ts`): Lage bestätigen, Uhrzeiten von Hand, Feinabgleich, Lautstärke, Widersprüche
 * entscheiden, Vorschläge übernehmen. Geprüft am Hauptprozess ohne Oberfläche; die Erwartung ist meist die neue Ansicht
 * des Einsatzes (`SessionView`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  addManualAnchor,
  addTimeEvidence,
  clearDeviceChecks,
  confirmAnchors,
  confirmPlacement,
  decideMany,
  decidePlacement,
  parseClock,
  parseClockNear,
  parseClockOnDate,
  parseMediaPos,
  pickBestPerDevice,
  removeEvidence,
  replaceAnchor,
  setLevel,
  toggleEvidence,
} from "../src/main/edits.ts";
import { createEntry, patchEntry } from "../src/main/diary.ts";
import { updateSessionDetails } from "../src/main/session.ts";
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
  it("Bestätigungen eines Geräts gesammelt entfernen", () => {
    const { session, cam, video } = seed();
    // Angenommen: eine Lage der Kamera ist bestätigt
    confirmPlacement(store, video.id, row(session.id, video.id).startMs!);
    const device = () => buildSessionView(store, session.id).allDevices.find((d) => d.id === cam.id)!;
    expect(device().checkedCount).toBe(1);
    // Wenn: die Bestätigungen der Kamera entfernt werden, dann ist die Lage wieder zu prüfen
    expect(clearDeviceChecks(store, cam.id)).toBe(session.id);
    expect(device().checkedCount).toBe(0);
    expect(row(session.id, video.id).status).toBe("check");
  });

  it("unsichere Lage bestätigen, zurücknehmen und durch Handeingabe ersetzen", () => {
    const { session, video } = seed();
    // Angenommen: die Lage des Videos ist unsicher, denn die Kamera-Uhr ist unbekannt
    const before = row(session.id, video.id);
    expect(before.status).toBe("check"); // Kamera-Uhr unbekannt
    // Wenn: sie bestätigt wird, dann gilt sie als sicher, an derselben Stelle, mit eigenem Beleg „geprüft“
    confirmPlacement(store, video.id, before.startMs!);
    const after = row(session.id, video.id);
    expect(after.status).toBe("ok");
    expect(after.startMs).toBe(before.startMs);
    expect(after.notes[0]).toBe("geprüft");
    const check = after.evidence[0]!;
    expect(check).toMatchObject({ kind: "checked", chosen: true, own: true });

    // Wenn: die Bestätigung entfernt wird, dann ist sie wieder zu prüfen
    removeEvidence(store, check.id);
    expect(row(session.id, video.id).status).toBe("check");

    // Wenn: nach erneuter Bestätigung eine Zeit von Hand kommt, dann ersetzt sie die Bestätigung
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

describe("Einsatzdatum ändern", () => {
  it("geprüfte Lage aus Metadaten bleibt auf dem Tag der Datei, Prüfung einer Handeingabe wandert mit", () => {
    const { session, video, photo } = seed();
    // Angenommen: das Video ist nach Metadaten bestätigt, das Foto nach einer Zeit von Hand
    const before = row(session.id, video.id);
    confirmPlacement(store, video.id, before.startMs!);
    addTimeEvidence(store, {
      sourceId: photo.id,
      kind: "manual",
      clock: "10:40",
      atMedia: "",
      precision: "approx",
      note: "",
    });
    const photoBefore = row(session.id, photo.id);
    confirmPlacement(store, photo.id, photoBefore.startMs!);

    // Wenn: das Einsatzdatum einen Tag später gesetzt wird
    updateSessionDetails(store, session.id, { date: "2026-09-15" });

    // Dann: bleibt das Video auf dem Tag seiner Datei, das Foto wandert mit
    const videoAfter = row(session.id, video.id);
    expect(videoAfter.startMs).toBe(before.startMs);
    expect(videoAfter.evidence.find((e) => e.chosen)?.kind).toBe("checked");
    expect(row(session.id, photo.id).startMs).toBe(photoBefore.startMs! + 86_400_000);
  });
});

describe("Zeiten von Hand", () => {
  it.each`
    eingabe      | ms           | fall
    ${""}        | ${0}         | ${"leer ist der Anfang"}
    ${"3:20"}    | ${200_000}   | ${"Minuten und Sekunden"}
    ${"1:03:20"} | ${3_800_000} | ${"Stunden"}
    ${"12,5"}    | ${12_500}    | ${"Sekunden mit Komma"}
    ${"320"}     | ${200_000}   | ${"Ziffern ohne Doppelpunkt"}
    ${"10320"}   | ${3_800_000} | ${"Ziffern mit Stunden"}
    ${"45"}      | ${45_000}    | ${"nur Sekunden"}
  `("Stelle „$eingabe“ in einer Aufnahme ist $ms ms: $fall", ({ eingabe, ms }) => {
    expect(parseMediaPos(eingabe)).toBe(ms);
  });

  it.each`
    eingabe   | fehler        | fall
    ${"390"}  | ${/Sekunden/} | ${"90 Sekunden gibt es nicht"}
    ${"drei"} | ${/./}        | ${"Wörter"}
  `("Stelle „$eingabe“ wird abgelehnt: $fall", ({ eingabe, fehler }) => {
    expect(() => parseMediaPos(eingabe)).toThrow(fehler);
  });

  it("Foto ohne Zeit bekommt eine Uhrzeit von Hand", () => {
    const { session, photo } = seed();
    expect(row(session.id, photo.id).status).toBe("unplaced");
    // Wenn: das Foto ohne Zeit eine ungefähre Uhrzeit von Hand bekommt
    addTimeEvidence(store, {
      sourceId: photo.id,
      kind: "manual",
      clock: "10:40",
      atMedia: "",
      precision: "approx",
      note: "",
    });
    // Dann: liegt es dort, auf die Minute genau
    const r = row(session.id, photo.id);
    expect(formatClock(r.startMs!)).toBe("10:40:00");
    expect(r.evidence[0]).toMatchObject({ kind: "manual", own: true, chosen: true, uncertaintyMs: 60_000 });
  });

  it("angesagte Uhrzeit im Video gleicht die Kamera ab", () => {
    const { session, video, cam } = seed();
    // Wenn: bei 0:20 jemand „zehn Uhr sechzehn und zwanzig Sekunden“ sagt (die Kamera zeigt dort 10:19:07)
    addTimeEvidence(store, {
      sourceId: video.id,
      kind: "spoken",
      clock: "10:16:20",
      atMedia: "0:20",
      precision: "exact",
      note: "",
    });
    // Dann: weicht die Kamera um 2:47 ab, und das Video beginnt um 10:16
    const view = buildSessionView(store, session.id);
    const d = view.devices.find((x) => x.id === cam.id)!;
    expect(d.offsetBasis).toBe("spoken");
    expect(d.offsetMs).toBe(167_000);
    expect(formatClock(view.rows.find((r) => r.id === video.id)!.startMs!)).toBe("10:16:00");
  });

  it("Zeit von Hand in einem Clip richtet die Uhr des Geräts, die übrigen Clips folgen", () => {
    const { session, video, cam } = seed();
    // Angenommen: ein zweiter Clip derselben Kamera
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
    // Wenn: eine Zeit von Hand ohne Geräteabgleich eingetragen wird, dann gilt sie nur für den einen Clip
    const t = { clock: "10:16:20", precision: "exact" as const, note: "", atMedia: "0:20", kind: "manual" as const };
    addTimeEvidence(store, { ...t, sourceId: video.id });
    expect(buildSessionView(store, session.id).devices.find((d) => d.id === cam.id)!.offsetMs).toBeNull();
    // Wenn: sie mit Geräteabgleich eingetragen wird, dann wird daraus die Abweichung der Kamera
    // (Uhr zeigte 10:19:07, echt 10:16:20), und der zweite Clip rückt mit
    addTimeEvidence(store, { ...t, sourceId: video.id, syncDevice: true });
    const view = buildSessionView(store, session.id);
    const d = view.devices.find((x) => x.id === cam.id)!;
    expect(d).toMatchObject({ offsetBasis: "manual", offsetMs: 167_000 });
    expect(formatClock(view.rows.find((r) => r.id === second.id)!.startMs!)).toBe("10:40:10");
  });

  it("Geräteabgleich per Hand nur mit Geräteuhr und ohne Referenzgerät", () => {
    const { audio, photo } = seed();
    const t = { clock: "10:00", precision: "exact" as const, note: "", atMedia: "", kind: "manual" as const };
    // Wenn: der Abgleich am Referenzgerät oder an einer Quelle ohne Geräteuhr versucht wird, dann lehnt die App ab
    expect(() => addTimeEvidence(store, { ...t, sourceId: audio.id, syncDevice: true })).toThrow(/Referenzuhr/);
    expect(() => addTimeEvidence(store, { ...t, sourceId: photo.id, syncDevice: true })).toThrow(/Geräteuhr/);
  });

  it("angesagte Zeit nur in Audio und Video, Stelle nicht hinter dem Ende", () => {
    const { photo, video } = seed();
    const t = { clock: "10:00", precision: "exact" as const, note: "" };
    // Wenn: ein Foto eine angesagte Zeit, eine Stelle hinter dem Ende oder 25 Uhr bekommen soll, dann lehnt die App ab
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
    // Wenn: der Beleg aus den Metadaten gelöscht werden soll, dann lehnt die App ab
    expect(() => removeEvidence(store, ev.id)).toThrow(/abschalten/);
    // Wenn: er abgeschaltet wird, dann hat das Video keine Lage mehr
    toggleEvidence(store, ev.id, false);
    expect(row(session.id, video.id).status).toBe("unplaced");
    // Wenn: er wieder eingeschaltet wird, dann liegt es wieder
    toggleEvidence(store, ev.id, true);
    expect(row(session.id, video.id).startMs).not.toBeNull();
  });

  it("eigene Belege lassen sich löschen", () => {
    const { session, photo } = seed();
    // Angenommen: das Foto hat eine grobe Zeit von Hand mit Notiz
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
    // Wenn: sie gelöscht wird, dann hat das Foto keine Lage mehr
    removeEvidence(store, ev.id);
    expect(row(session.id, photo.id).status).toBe("unplaced");
  });

  it("Anker von Hand verbindet Rekorder und Kamera", () => {
    const { session, audio, video, cam } = seed();
    // Wenn: 1:20 im Ton und 0:20 im Video als derselbe Moment gesetzt werden
    addManualAnchor(store, {
      aSourceId: audio.id,
      aAt: "1:20",
      bSourceId: video.id,
      bAt: "0:20",
      precision: "exact",
      note: "Tür knallt",
    });
    // Dann: weicht die Kamera um 2:47 ab, und der Anker ist beschrieben
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
    // Wenn: ein Anker zweimal dieselbe Quelle verbindet, dann lehnt die App ab
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
    // Angenommen: ein Anker von Hand auf ganze Sekunden
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
    // Wenn: er fein justiert auf Millisekunden ersetzt wird
    replaceAnchor(store, old.id, {
      aSourceId: audio.id,
      aAt: "80.000",
      bSourceId: video.id,
      bAt: "20.347",
      precision: "exact",
      uncertaintyMs: 20,
      note: "Feinabgleich",
    });
    // Dann: bleibt es ein Anker, mit Millisekunden in Lage und Abweichung
    const view = buildSessionView(store, session.id);
    expect(view.anchors).toHaveLength(1);
    expect(view.anchors[0]!.b.atMs).toBe(20_347);
    expect(store.listAnchors(session.id)[0]!.uncertaintyMs).toBe(20);
    expect(view.devices.find((d) => d.id === cam.id)!.offsetMs).toBe(167_000 + 347);
  });

  it("ein justierter Vorschlag erledigt die übrigen Vorschläge des Geräts", () => {
    const { session, audio, video } = seed();
    // Angenommen: zwei Klatscher-Vorschläge zwischen Ton und Video
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
    // Wenn: der erste fein justiert übernommen wird
    replaceAnchor(store, p!.anchorId, {
      aSourceId: audio.id,
      aAt: "80",
      bSourceId: video.id,
      bAt: "20.010",
      precision: "exact",
      uncertaintyMs: 20,
      note: "",
    });
    // Dann: ist auch der zweite erledigt
    const view = buildSessionView(store, session.id);
    expect(view.proposals).toHaveLength(0);
    expect(view.anchors).toHaveLength(1);
  });
});

describe("Lautstärke", () => {
  it("speichert die Einstellung und zeigt die geltende Verstärkung", () => {
    const { session, audio, photo } = seed();
    // Angenommen: der Ton steht auf automatisch, ein Foto hat keine Lautstärke
    expect(row(session.id, audio.id).level).toMatchObject({ mode: "auto", gainDb: 0, measured: false, compress: true });
    expect(row(session.id, photo.id).level).toBeNull();
    // Wenn: von Hand 55 dB eingestellt werden, dann gelten höchstens 40
    setLevel(store, audio.id, { mode: "manual", manualGainDb: 55, compress: false });
    expect(row(session.id, audio.id).level).toMatchObject({
      mode: "manual",
      manualGainDb: 40,
      gainDb: 40,
      compress: false,
    });
    // Wenn: ein Foto eine Lautstärke bekommen soll, dann lehnt die App ab
    expect(() => setLevel(store, photo.id, { mode: "auto", manualGainDb: 0, compress: true })).toThrow(/keinen Ton/);
  });

  it("automatisch: nach dem gemessenen Sprachpegel, alte Analysen werden nachgerechnet", () => {
    const { session, audio } = seed();
    // Angenommen: eine Analyse aus einer älteren Version, ohne Pegel, Hüllkurve −38 dBFS (1 Byte je Wert)
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
    // Dann: gilt der Pegel als gemessen, und die Verstärkung bringt ihn auf −20 dB
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
    // Angenommen: ein Foto, dessen EXIF-Zeit und Dateiname sich stark widersprechen
    const before = row(session.id, src.id);
    expect(before.status).toBe("check");
    expect(before.conflict).toMatchObject({ state: "open", severity: "strong" });
    // Wenn: die EXIF-Zeit mit Begründung bestätigt wird
    decidePlacement(store, {
      sourceId: src.id,
      evidenceId: exif.id,
      expectedStartMs: before.startMs!,
      reason: "umbenannt",
    });
    // Dann: ist die Lage sicher und die Entscheidung samt Begründung nachzulesen
    const after = row(session.id, src.id);
    expect(after.status).toBe("ok");
    expect(after.conflict.state).toBe("decided");
    expect(after.decision).toMatchObject({ reason: "umbenannt", basisKind: "metadata", basisId: exif.id });
    expect(after.decision!.detail).toBe(
      "Entschieden: Metadaten gelten (10:32:07). Dateiname weicht ab (+13:23). Begründung: umbenannt",
    );

    // Wenn: das Projekt neu geöffnet wird, dann gilt die Entscheidung weiter
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
    // Wenn: im Widerspruch der Dateiname gewählt wird
    decidePlacement(store, { sourceId: src.id, evidenceId: name.id, expectedStartMs: before.startMs!, reason: "" });
    // Dann: rückt das Foto auf 10:45:30, nur minutengenau, und gilt als entschieden
    const after = row(session.id, src.id);
    expect(formatClock(after.startMs!)).toBe("10:45:30");
    expect(after.uncertaintyMs).toBe(30_000);
    expect(after.status).toBe("ok");
    expect(after.decision!.detail).toContain("Dateiname gilt");
  });

  it("neuer widersprechender Beleg: Entscheidung neu prüfen", () => {
    const { session, mk } = conflicted();
    const { src, exif } = mk(0);
    // Angenommen: der Widerspruch ist zugunsten der EXIF-Zeit entschieden
    decidePlacement(store, {
      sourceId: src.id,
      evidenceId: exif.id,
      expectedStartMs: row(session.id, src.id).startMs!,
      reason: "",
    });
    // Wenn: eine angesagte Zeit dazukommt, die wieder widerspricht
    store.addEvidence({
      sourceId: src.id,
      kind: "spoken",
      clock: "true",
      localMs: at(10, 31, 10),
      uncertaintyMs: 1000,
      detail: "angesagt",
    });
    // Dann: ist die Entscheidung neu zu prüfen
    const r = row(session.id, src.id);
    expect(r.status).toBe("check");
    expect(r.conflict.state).toBe("stale");
    expect(r.notes).toContain("Entscheidung neu prüfen");
  });

  it("verschobene Lage wird nicht entschieden", () => {
    const { session, mk } = conflicted();
    const { src, exif } = mk(0);
    const start = row(session.id, src.id).startMs!;
    // Wenn: die Lage sich inzwischen verschoben hat, dann lehnt die App die Entscheidung ab
    expect(() =>
      decidePlacement(store, { sourceId: src.id, evidenceId: exif.id, expectedStartMs: start + 1, reason: "" }),
    ).toThrow(/geändert/);
    expect(row(session.id, src.id).decision).toBeNull();
  });

  it("gleichartige Widersprüche eines Geräts bilden eine Gruppe und lassen sich auf einmal entscheiden", () => {
    const { session, mk } = conflicted();
    // Angenommen: drei Fotos desselben Geräts mit demselben Widerspruch
    const ids = [0, 1, 2].map((n) => mk(n).src.id);
    // Dann: bilden sie eine Gruppe
    const view = buildSessionView(store, session.id);
    expect(view.conflictGroups).toHaveLength(1);
    expect(view.conflictGroups[0]).toMatchObject({ usedKind: "metadata", otherKind: "filename", sourceIds: ids });
    // Wenn: die Gruppe auf einmal entschieden wird, dann sind alle drei entschieden
    decideMany(store, { sourceIds: ids, kind: "metadata", reason: "Kamera benennt beim Kopieren um" });
    const after = buildSessionView(store, session.id);
    expect(after.conflictGroups).toHaveLength(0);
    for (const id of ids) expect(row(session.id, id).conflict.state).toBe("decided");
  });
});

describe("Uhrzeiten prüfen", () => {
  it.each`
    eingabe         | teile
    ${"9:05"}       | ${{ h: 9, mi: 5, se: 0 }}
    ${" 23.59.59 "} | ${{ h: 23, mi: 59, se: 59 }}
    ${"00:00"}      | ${{ h: 0, mi: 0, se: 0 }}
  `("zerlegt „$eingabe“", ({ eingabe, teile }) => {
    expect(parseClock(eingabe)).toEqual(teile);
  });

  it.each`
    eingabe       | meldung
    ${"99:99"}    | ${"„99:99“ ist keine gültige Uhrzeit (hh:mm oder hh:mm:ss)."}
    ${"24:00"}    | ${"keine gültige Uhrzeit"}
    ${"12:60"}    | ${"keine gültige Uhrzeit"}
    ${"12:30:60"} | ${"keine gültige Uhrzeit"}
    ${"abc"}      | ${"„abc“ ist keine gültige Uhrzeit"}
  `("weist „$eingabe“ mit verständlichem Fehler ab", ({ eingabe, meldung }) => {
    expect(() => parseClock(eingabe)).toThrow(meldung);
  });

  it("erlaubt für Randnotizen keine Sekunden", () => {
    expect(parseClock("10:15", { seconds: false })).toEqual({ h: 10, mi: 15, se: 0 });
    // Wenn: eine Randnotiz Sekunden hat, dann lehnt die App mit Hinweis auf hh:mm ab
    expect(() => parseClock("10:15:30", { seconds: false })).toThrow("„10:15:30“ ist keine gültige Uhrzeit (hh:mm).");
    expect(() => parseClockOnDate("2024-05-01", "99:99", { seconds: false })).toThrow(
      "„99:99“ ist keine gültige Uhrzeit (hh:mm).",
    );
  });
});

describe("Alle eindeutigen Vorschläge übernehmen", () => {
  it("je Gerät den sichersten, ohne Fehler und als ein Verlaufsschritt", () => {
    const { session, cam, audio, video } = seed();
    // Angenommen: zwei Vorschläge für zwei Clips derselben Kamera, einer schwach, einer stark
    const video2 = store.addSource({
      sessionId: session.id,
      deviceId: cam.id,
      originalPath: "/x",
      sizeBytes: 1,
      metadata: {},
      kind: "video",
      fileName: "C2.MP4",
      sha256: sha(4),
      durationMs: 60_000,
    });
    const proposal = (sourceId: string, confidence: number) => ({
      sessionId: session.id,
      kind: "clap" as const,
      a: { sourceId: audio.id, atMediaMs: 20_000 },
      b: { sourceId, atMediaMs: 0 },
      confidence,
    });
    const [weak, strong] = store.replaceProposedAnchors(session.id, [
      proposal(video.id, 0.6),
      proposal(video2.id, 0.9),
    ]);
    const before = store.history.state().serial;

    // Wenn: alle übernommen werden, dazu einer, den es nicht gibt
    const n = store.history.record("2 Vorschläge übernommen", () =>
      confirmAnchors(store, session.id, [weak!.id, strong!.id, "gibt-es-nicht"]),
    );

    // Dann: gilt nur der starke, in einem Verlaufsschritt
    expect(n).toBe(1);
    const anchors = store.listAnchors(session.id);
    expect(anchors.map((a) => [a.id, a.proposed])).toEqual([[strong!.id, false]]);
    expect(store.history.state().serial).toBe(before + 1);
    // Wenn: rückgängig, dann sind beide wieder Vorschläge
    expect(store.history.undo()).toBe("2 Vorschläge übernommen");
    expect(store.listAnchors(session.id).filter((a) => a.proposed)).toHaveLength(2);
  });

  it("wählt je Gerät die höchste Sicherheit, Vorschläge ohne Gerät zählen einzeln", () => {
    expect(
      // Angenommen: zwei Vorschläge der Kamera, einer vom Handy ohne Sicherheit, zwei ohne Gerät
      pickBestPerDevice([
        { id: "a", deviceId: "cam", confidence: 0.6 },
        { id: "b", deviceId: "cam", confidence: 0.8 },
        { id: "c", deviceId: "phone", confidence: null },
        { id: "d", deviceId: null, confidence: 0.7 },
        { id: "e", deviceId: null, confidence: 0.7 },
      ]),
    ).toEqual(["b", "c", "d", "e"]);
  });
});

describe("Einsatz über Mitternacht (Issue #152)", () => {
  const d = (day: number, h: number, m: number, sec = 0) => Date.UTC(2026, 8, day, h, m, sec);

  it("ordnet Uhrzeiten ohne Datum dem Tag zu, der zu den Aufnahmen passt", () => {
    // Wenn: die Aufnahmen über Mitternacht gehen, dann gilt der Tag, der zu ihnen passt
    const night = { fromMs: d(14, 23, 55), toMs: d(15, 0, 5) };
    expect(parseClockNear("2026-09-14", "00:02", night)).toBe(d(15, 0, 2));
    expect(parseClockNear("2026-09-14", "23:58", night)).toBe(d(14, 23, 58));
    // Wenn: an einer Stelle kurz nach Mitternacht noch der alte Tag angesagt wird, dann gilt der alte Tag
    const point = { fromMs: d(15, 0, 0, 5), toMs: d(15, 0, 0, 5) };
    expect(parseClockNear("2026-09-14", "23:59:50", point)).toBe(d(14, 23, 59, 50));
    expect(parseClockNear("2026-09-14", "00:03:10", point)).toBe(d(15, 0, 3, 10));
    // Wenn: die Aufnahmen nicht über Mitternacht gehen, dann bleibt es beim Einsatztag, auch weit daneben
    const day = { fromMs: d(14, 8, 0), toMs: d(14, 9, 0) };
    expect(parseClockNear("2026-09-14", "21:00", day)).toBe(d(14, 21, 0));
    expect(parseClockNear("2026-09-14", "00:30", day)).toBe(d(14, 0, 30));
    expect(parseClockNear("2026-09-14", "00:30", null)).toBe(d(14, 0, 30));
  });

  it("Randnotiz und angesagte Uhrzeit nach Mitternacht landen am Folgetag", () => {
    // Angenommen: ein Einsatz am 14.9., Ton ab 23:55, Video ab 0:03 des Folgetags, eine Tagebuchseite
    const session = store.addSession({ title: "Nacht", date: "2026-09-14", place: "", extra: {} });
    const rec = store.addDevice({ sessionId: session.id, label: "Rekorder" });
    const cam = store.addDevice({ sessionId: session.id, label: "Kamera" });
    const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {} };
    const audio = store.addSource({
      ...base,
      deviceId: rec.id,
      kind: "audio",
      fileName: "REC.m4a",
      sha256: sha(11),
      durationMs: 600_000,
    });
    const video = store.addSource({
      ...base,
      deviceId: cam.id,
      kind: "video",
      fileName: "C2.MP4",
      sha256: sha(12),
      durationMs: 60_000,
    });
    const page = store.addSource({
      ...base,
      deviceId: null,
      kind: "diary",
      fileName: "S01.jpg",
      sha256: sha(13),
      durationMs: null,
    });
    const ev = { kind: "metadata" as const, clock: "device" as const, uncertaintyMs: 1000, detail: "Metadaten" };
    store.addEvidence({ ...ev, sourceId: audio.id, localMs: d(14, 23, 55) });
    store.addEvidence({ ...ev, sourceId: video.id, localMs: d(15, 0, 3) });

    // Wenn: eine Randnotiz um 00:02 notiert wird, dann am Folgetag
    const entry = createEntry(store, page.id, { x: 0, y: 0, w: 1, h: 1 }).entry.id;
    patchEntry(store, entry, { notedAt: "00:02" });
    expect(store.getDiaryEntry(entry).notedAtMs).toBe(d(15, 0, 2));

    // Wenn: im Video 00:03:10 angesagt wird, dann ebenso, ohne Widerspruch
    addTimeEvidence(store, {
      sourceId: video.id,
      kind: "spoken",
      clock: "00:03:10",
      atMedia: "0:10",
      precision: "exact",
      note: "",
    });
    const spoken = store.listEvidence(session.id).find((e) => e.kind === "spoken")!;
    expect(spoken.localMs).toBe(d(15, 0, 3, 10));
    const placed = resolveTimeline(store.loadResolveInput(session.id)).placements.get(video.id)!;
    expect(placed.startMs).toBe(d(15, 0, 3));
    expect(placed.conflicts).toEqual([]);
  });
});
