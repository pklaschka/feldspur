import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { addLine, deleteLine, updateLine } from "../src/main/transcript.ts";
import { buildSessionView } from "../src/main/view.ts";
import { splitSpeaker } from "../src/renderer/format.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-tr-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Erfundener Einsatz: Rekorder ab 10:15:00, zehn Minuten. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  const rec = store.addDevice({
    sessionId: session.id,
    label: "Rekorder",
    isReference: true,
    offsetBasis: "reference",
  });
  const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {}, deviceId: rec.id };
  const audio = store.addSource({
    ...base,
    kind: "audio",
    fileName: "ZOOM0001.m4a",
    sha256: "1".padStart(64, "0"),
    durationMs: 600_000,
  });
  const photo = store.addSource({
    ...base,
    kind: "photo",
    fileName: "IMG.jpg",
    sha256: "2".padStart(64, "0"),
    durationMs: null,
  });
  store.addEvidence({
    sourceId: audio.id,
    kind: "metadata",
    clock: "device",
    localMs: Date.UTC(2026, 8, 14, 10, 15),
    atMediaMs: 0,
    uncertaintyMs: 0,
    detail: "Metadaten",
  });
  return { session, audio, photo };
}

describe("Mitschrift", () => {
  it("legt Zeilen an, rechnet die Uhrzeit aus dem Abgleich und begrenzt die Stelle", () => {
    const { session, audio } = seed();
    addLine(store, audio.id, { atMs: 70_000, speaker: " H ", text: " Zwölf Jahre " });
    addLine(store, audio.id, { atMs: 9_999_999, speaker: "", text: "Ende" });
    const v = buildSessionView(store, session.id);
    expect(v.transcript.map((l) => [l.speaker, l.text, l.atMs])).toEqual([
      ["H", "Zwölf Jahre", 70_000],
      ["", "Ende", 600_000],
    ]);
    expect(new Date(v.transcript[0]!.clockMs!).toISOString().slice(11, 19)).toBe("10:16:10");
  });

  it("ändert und löscht Zeilen und lehnt Bilder ab", () => {
    const { session, audio, photo } = seed();
    const l = addLine(store, audio.id, { atMs: 1_000, speaker: "B1", text: "Hallo" });
    expect(updateLine(store, l.id, { atMs: 2_000, text: "Hallo zusammen" })).toBe(session.id);
    expect(store.getTranscriptLine(l.id)).toMatchObject({ atMs: 2_000, text: "Hallo zusammen", speaker: "B1" });
    deleteLine(store, l.id);
    expect(store.listTranscript(session.id)).toEqual([]);
    expect(() => addLine(store, photo.id, { atMs: 0, speaker: "", text: "x" })).toThrow(/keine Ton/);
  });

  it("erkennt ein Sprecherkürzel am Zeilenanfang", () => {
    expect(splitSpeaker("B1: Wie lange schon?")).toEqual({ speaker: "B1", text: "Wie lange schon?" });
    expect(splitSpeaker("Händlerin: ja")).toEqual({ speaker: null, text: "Händlerin: ja" });
    expect(splitSpeaker("Um 10:15 ging es los")).toEqual({ speaker: null, text: "Um 10:15 ging es los" });
  });
});
