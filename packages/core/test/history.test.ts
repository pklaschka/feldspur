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
