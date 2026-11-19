import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ProjectStore } from "../src/db/store.ts";
import { T } from "./scenario.ts";

const sha = (n: number) => n.toString(16).padStart(64, "0");

function setup() {
  const store = ProjectStore.open(":memory:");
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const device = store.addDevice({ sessionId: session.id, label: "Rekorder", isReference: true });
  const source = store.addSource({
    sessionId: session.id,
    deviceId: device.id,
    kind: "audio",
    fileName: "ZOOM0001.m4a",
    originalPath: "/x",
    sizeBytes: 1,
    sha256: sha(1),
    durationMs: 60_000,
    metadata: {},
  });
  store.addEvidence({
    sourceId: source.id,
    kind: "metadata",
    clock: "device",
    localMs: T(10, 15),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  return { store, session, device, source };
}

describe("Rückgängig und Wiederholen", () => {
  it("macht eine Änderung rückgängig und wiederholt sie", () => {
    const { store, device } = setup();
    expect(store.history.state()).toMatchObject({ undo: null, redo: null });
    store.history.record("Gerät umbenannt", () => store.updateDevice(device.id, { label: "Diktiergerät" }));
    expect(store.history.state().undo).toBe("Gerät umbenannt");
    expect(store.history.undo()).toBe("Gerät umbenannt");
    expect(store.getDevice(device.id).label).toBe("Rekorder");
    expect(store.history.state()).toMatchObject({ undo: null, redo: "Gerät umbenannt" });
    expect(store.history.redo()).toBe("Gerät umbenannt");
    expect(store.getDevice(device.id).label).toBe("Diktiergerät");
  });

  it("holt gelöschte Quellen samt abhängiger Zeilen zurück", () => {
    const { store, session, source } = setup();
    store.history.record("Quelle entfernt", () => store.deleteSource(source.id));
    expect(store.listSources(session.id)).toHaveLength(0);
    store.history.undo();
    expect(store.listSources(session.id).map((s) => s.id)).toEqual([source.id]);
    expect(store.listEvidence(session.id)).toHaveLength(1);
    store.history.redo();
    expect(store.listSources(session.id)).toHaveLength(0);
    store.history.undo();
    expect(store.listEvidence(session.id)).toHaveLength(1);
  });

  it("nennt die betroffenen Zeilen, damit die Oberfläche dorthin springen kann", () => {
    const { store, source } = setup();
    const line = store.history.record("Mitschrift geändert", () =>
      store.addTranscriptLine({ sourceId: source.id, atMs: 12_000, speaker: "", text: "Hallo" }),
    );
    store.history.undo();
    // Beim Rückgängigmachen verschwindet die Zeile; genannt wird sie trotzdem, mit ihren alten Werten.
    expect(store.history.lastTouched()).toEqual([
      { table: "transcript_lines", row: expect.objectContaining({ id: line.id, source_id: source.id, at_ms: 12_000 }) },
    ]);
    store.history.redo();
    expect(store.history.lastTouched()[0]).toMatchObject({ table: "transcript_lines", row: { id: line.id } });
  });

  it("mehrere Schritte nacheinander, neue Aktion verwirft Wiederholen", () => {
    const { store, device } = setup();
    store.history.record("A", () => store.updateDevice(device.id, { label: "A" }));
    store.history.record("B", () => store.updateDevice(device.id, { label: "B" }));
    store.history.undo();
    expect(store.getDevice(device.id).label).toBe("A");
    store.history.record("C", () => store.updateDevice(device.id, { label: "C" }));
    expect(store.history.state()).toMatchObject({ undo: "C", redo: null });
    store.history.undo();
    store.history.undo();
    expect(store.getDevice(device.id).label).toBe("Rekorder");
  });

  it("Aktionen ohne Änderung erzeugen keinen Schritt", () => {
    const { store } = setup();
    store.history.record("nichts", () => 1);
    expect(store.history.state().undo).toBeNull();
  });

  it("Änderungen außerhalb eines Schritts leeren den Verlauf", () => {
    const { store, device } = setup();
    store.history.record("A", () => store.updateDevice(device.id, { label: "A" }));
    store.updateDevice(device.id, { label: "von woanders" });
    expect(store.history.state()).toMatchObject({ undo: null, redo: null });
    expect(store.history.undo()).toBeNull();
    expect(store.getDevice(device.id).label).toBe("von woanders");
  });

  it("der Stand der letzten Ausgabe leert den Verlauf nicht und landet nicht im Protokoll", () => {
    const { store, device, session } = setup();
    store.history.record("A", () => store.updateDevice(device.id, { label: "A" }));
    const before = store.history.changeLog().length;
    store.saveExportRecord({
      sessionId: session.id,
      exportedAt: new Date().toISOString(),
      dir: "/aus",
      files: ["a.docx"],
      durationMs: 1000,
      options: { video: false, resolve: false, mixAudio: true, realtime: true, deviceTracks: false },
      fingerprint: { version: 1, content: "x", originals: {} },
    });
    expect(store.history.state().undo).toBe("A");
    expect(store.history.changeLog()).toHaveLength(before);
    expect(store.history.undo()).toBe("A");
    expect(store.getExportRecord(session.id)?.files).toEqual(["a.docx"]);
  });

  it("ein Fehler in der Aktion hinterlässt keinen Schritt", () => {
    const { store, device } = setup();
    expect(() =>
      store.history.record("kaputt", () => {
        store.updateDevice(device.id, { label: "halb" });
        throw new Error("geht nicht");
      }),
    ).toThrow("geht nicht");
    expect(store.getDevice(device.id).label).toBe("Rekorder");
    expect(store.history.state().undo).toBeNull();
  });
});

describe("Dauerhaftes Änderungsprotokoll", () => {
  it("hält jede Aktion mit Werten vorher und nachher fest", () => {
    const { store, device } = setup();
    store.history.record("Gerät umbenannt", () => store.updateDevice(device.id, { label: "Diktiergerät" }));
    const [step] = store.history.changeLog();
    expect(step).toMatchObject({ label: "Gerät umbenannt" });
    // updateDevice setzt erst die Referenzuhr zurück, dann alles: zwei Zeilen, die letzte mit dem neuen Namen.
    expect(step!.changes.at(-1)).toEqual({
      table: "devices",
      op: "update",
      rowKey: device.id,
      before: expect.objectContaining({ label: "Rekorder" }),
      after: expect.objectContaining({ label: "Diktiergerät" }),
    });
  });

  it("protokolliert Rückgängig und Wiederholen als eigene Schritte", () => {
    const { store, device } = setup();
    store.history.record("Gerät umbenannt", () => store.updateDevice(device.id, { label: "Diktiergerät" }));
    store.history.undo();
    store.history.redo();
    expect(
      store.history
        .changeLog()
        .map((s) => s.label)
        .slice(0, 3),
    ).toEqual(["Wiederholt: Gerät umbenannt", "Rückgängig: Gerät umbenannt", "Gerät umbenannt"]);
    expect(store.history.changeLog()[1]!.changes.find((c) => c.before?.label !== c.after?.label)).toMatchObject({
      before: { label: "Diktiergerät" },
      after: { label: "Rekorder" },
    });
  });

  it("fasst Änderungen ohne Beschriftung zu einem Schritt zusammen und überlebt das Schließen", () => {
    const dir = mkdtempSync(join(tmpdir(), "feldspur-log-"));
    const file = join(dir, "p.feldspur");
    try {
      const store = ProjectStore.open(file);
      const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
      store.addDevice({ sessionId: session.id, label: "A", isReference: true });
      const log = store.history.changeLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ label: null });
      expect(log[0]!.changes.map((c) => `${c.table}:${c.op}`)).toEqual([
        "project_meta:insert",
        "sessions:insert",
        "devices:insert",
      ]);
      store.close();
      const again = ProjectStore.open(file);
      expect(again.history.changeLog()).toHaveLength(1);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blättert mit before zu älteren Schritten", () => {
    const { store, device } = setup();
    for (const l of ["B", "C", "D"]) store.history.record(`→ ${l}`, () => store.updateDevice(device.id, { label: l }));
    const first = store.history.changeLog({ limit: 2 });
    expect(first.map((s) => s.label)).toEqual(["→ D", "→ C"]);
    const more = store.history.changeLog({ limit: 2, before: first.at(-1)!.step });
    // Ganz zu Beginn: das Anlegen ohne Beschriftung.
    expect(more.map((s) => s.label)).toEqual(["→ B", null]);
  });
});

describe("Einsatz löschen", () => {
  /** Alles, was zu einem Einsatz gehört, so wie der Store es liefert. */
  function snapshot(store: ProjectStore, sessionId: string) {
    return {
      sessions: store.listSessions(),
      devices: store.listDevices(sessionId),
      sources: store.listSources(sessionId),
      evidence: store.listEvidence(sessionId),
      anchors: store.listAnchors(sessionId),
      diary: store.listDiaryEntries(sessionId),
      transcript: store.listTranscript(sessionId),
      notes: store.listSourceNotes(sessionId),
      edits: store.listEpisodeEdits(sessionId),
      analyses: store.listAudioAnalyses(sessionId),
      exportRecord: store.getExportRecord(sessionId),
    };
  }

  function seed() {
    const { store, session, device, source } = setup();
    const cam = store.addDevice({ sessionId: session.id, label: "Kamera", isReference: false });
    const video = store.addSource({
      sessionId: session.id,
      deviceId: cam.id,
      kind: "video",
      fileName: "C0001.MP4",
      originalPath: "/v",
      sizeBytes: 1,
      sha256: sha(2),
      durationMs: 60_000,
      metadata: {},
    });
    const page = store.addSource({
      sessionId: session.id,
      deviceId: null,
      kind: "diary",
      fileName: "Tagebuch_S01.jpg",
      originalPath: "/t",
      sizeBytes: 1,
      sha256: sha(3),
      durationMs: null,
      metadata: {},
    });
    // Verweise zwischen Quellen (Folgeaufnahme) setzt SQLite beim Löschen auf NULL; auch das muss zurückkommen.
    store.updateSource(video.id, { follows: source.id });
    store.addAnchor({
      sessionId: session.id,
      kind: "clap",
      a: { sourceId: source.id, atMediaMs: 10_000 },
      b: { sourceId: video.id, atMediaMs: 5_000 },
    });
    store.addDiaryEntry({
      sessionId: session.id,
      regions: [{ sourceId: page.id }],
      notedAtMs: T(10, 12),
      lookbackMs: 60_000,
      mode: "short",
      shortText: "Ankunft",
    });
    store.addTranscriptLine({ sourceId: source.id, atMs: 1000, speaker: "A", text: "Hallo" });
    store.addSourceNote({ sourceId: source.id, fromMs: null, toMs: null, text: "nachhören", done: false });
    store.addEpisodeEdit({ sourceId: source.id, fromMs: 0, toMs: 1000, mode: "include" });
    store.saveAudioAnalysis({
      sourceId: source.id,
      envelope: new Uint8Array([1, 2, 3]),
      envelopeRate: 10,
      noiseFloorDb: -60,
      idle: [],
      loudInIdle: [],
      version: 1,
      analyzedAt: new Date().toISOString(),
    });
    store.saveExportRecord({
      sessionId: session.id,
      exportedAt: new Date().toISOString(),
      dir: "/aus",
      files: ["a.docx"],
      durationMs: 1000,
      options: { video: false, resolve: false, mixAudio: true, realtime: true, deviceTracks: false },
      fingerprint: { version: 1, content: "x", originals: {} },
    });
    const other = store.addSession({ title: "Anderer Tag", date: "2026-09-15", place: "", extra: {} });
    return { store, session, device, other };
  }

  it("entfernt Quellen, Belege, Tagebuch und Mitschrift; Rückgängig holt alles zurück", () => {
    const { store, session, other } = seed();
    const before = snapshot(store, session.id);
    expect(before.sources).toHaveLength(3);
    expect(before.anchors).toHaveLength(1);
    expect(before.analyses).toHaveLength(1);

    store.history.record("Einsatz gelöscht", () => store.deleteSession(session.id));
    expect(store.listSessions().map((s) => s.id)).toEqual([other.id]);
    const gone = snapshot(store, session.id);
    expect(gone).toMatchObject({
      devices: [],
      sources: [],
      evidence: [],
      anchors: [],
      diary: [],
      transcript: [],
      notes: [],
      edits: [],
      analyses: [],
      exportRecord: null,
    });

    expect(store.history.undo()).toBe("Einsatz gelöscht");
    expect(snapshot(store, session.id)).toEqual(before);
    store.history.redo();
    expect(store.listSessions().map((s) => s.id)).toEqual([other.id]);
    store.history.undo();
    expect(snapshot(store, session.id)).toEqual(before);
  });

  it("steht mit jeder Zeile im Änderungsprotokoll", () => {
    const { store, session } = seed();
    store.history.record("Einsatz gelöscht", () => store.deleteSession(session.id));
    const step = store.history.changeLog({ limit: 1 })[0]!;
    expect(step.label).toBe("Einsatz gelöscht");
    expect(new Set(step.changes.map((c) => c.table))).toEqual(
      new Set([
        "sessions",
        "devices",
        "sources",
        "time_evidence",
        "sync_anchors",
        "diary_entries",
        "transcript_lines",
        "source_notes",
        "episode_edits",
      ]),
    );
  });

  it("meldet einen unbekannten Einsatz", () => {
    const { store } = setup();
    expect(() => store.deleteSession("gibt-es-nicht")).toThrow(/Einsatz nicht gefunden/);
  });
});
