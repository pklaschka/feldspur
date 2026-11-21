import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { addNote, deleteNote, updateNote } from "../src/main/notes.ts";
import { addLine, deleteLine, importLines, updateLine } from "../src/main/transcript.ts";
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
  it("übernimmt ein automatisches Transkript: ergänzen, ersetzen, Überhang verwerfen", () => {
    const { session, audio, photo } = seed();
    // Angenommen: eine Aufnahme mit einer Zeile von Hand und ein Transkript mit drei Zeilen, eine hinter dem Ende
    addLine(store, audio.id, { atMs: 5_000, speaker: "B1", text: "von Hand" });
    const lines = [
      { atMs: 1_000, speaker: "S1", text: "Eins" },
      { atMs: 61_000, speaker: "S2", text: "Zwei" },
      { atMs: 900_000, speaker: "S1", text: "hinter dem Ende" },
    ];
    // Wenn: es ergänzt wird, dann kommen zwei dazu, die dritte wird verworfen
    expect(importLines(store, audio.id, lines, "append")).toMatchObject({ count: 2, dropped: 1 });
    expect(buildSessionView(store, session.id).transcript.map((l) => l.text)).toEqual(["Eins", "von Hand", "Zwei"]);
    // Wenn: es ersetzt wird, dann bleibt nur das Transkript, mit Uhrzeit
    importLines(store, audio.id, lines.slice(0, 1), "replace");
    const v = buildSessionView(store, session.id);
    expect(v.transcript.map((l) => [l.text, l.clockMs])).toEqual([["Eins", Date.UTC(2026, 8, 14, 10, 15, 1)]]);
    // Wenn: es an ein Foto soll, dann lehnt die App ab
    expect(() => importLines(store, photo.id, lines, "append")).toThrow(/keine Ton/);
  });

  it("macht Ersetzen rückgängig und lässt den Verlauf davor bestehen", () => {
    const { session, audio } = seed();
    // Angenommen: eine Zeile von Hand, dann die Mitschrift ersetzt
    store.history.record("Zeile angelegt", () => addLine(store, audio.id, { atMs: 5_000, speaker: "", text: "alt" }));
    const lines = [{ atMs: 1_000, speaker: "S1", text: "neu" }];
    store.history.record("Mitschrift ersetzt", () => importLines(store, audio.id, lines, "replace"));
    const texts = () => buildSessionView(store, session.id).transcript.map((l) => l.text);
    expect(texts()).toEqual(["neu"]);
    // Wenn: rückgängig, dann ist die alte Zeile wieder da
    expect(store.history.undo()).toBe("Mitschrift ersetzt");
    expect(texts()).toEqual(["alt"]);
    // Wenn: noch einmal rückgängig, dann ist sie weg
    expect(store.history.undo()).toBe("Zeile angelegt");
    expect(texts()).toEqual([]);
  });

  it("legt Zeilen an, rechnet die Uhrzeit aus dem Abgleich und begrenzt die Stelle", () => {
    const { session, audio } = seed();
    // Wenn: eine Zeile mit Leerraum und eine hinter dem Ende angelegt werden
    addLine(store, audio.id, { atMs: 70_000, speaker: " H ", text: " Zwölf Jahre " });
    addLine(store, audio.id, { atMs: 9_999_999, speaker: "", text: "Ende" });
    // Dann: ist der Leerraum weg, die Stelle begrenzt und die Uhrzeit aus dem Abgleich gerechnet
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
    // Wenn: die Zeile geändert wird, dann bleibt das Sprecherkürzel
    expect(updateLine(store, l.id, { atMs: 2_000, text: "Hallo zusammen" })).toBe(session.id);
    expect(store.getTranscriptLine(l.id)).toMatchObject({ atMs: 2_000, text: "Hallo zusammen", speaker: "B1" });
    // Wenn: sie gelöscht wird, dann ist die Mitschrift leer
    deleteLine(store, l.id);
    expect(store.listTranscript(session.id)).toEqual([]);
    // Wenn: eine Zeile an ein Foto soll, dann lehnt die App ab
    expect(() => addLine(store, photo.id, { atMs: 0, speaker: "", text: "x" })).toThrow(/keine Ton/);
  });

  it.each`
    zeile                      | geteilt                                                  | fall
    ${"B1: Wie lange schon?"}  | ${{ speaker: "B1", text: "Wie lange schon?" }}           | ${"Kürzel am Anfang"}
    ${"Händlerin: ja"}         | ${{ speaker: null, text: "Händlerin: ja" }}              | ${"ein Wort ist kein Kürzel"}
    ${"Um 10:15 ging es los"}  | ${{ speaker: null, text: "Um 10:15 ging es los" }}       | ${"Doppelpunkt in einer Uhrzeit"}
  `("Sprecherkürzel in „$zeile“: $fall", ({ zeile, geteilt }) => {
    expect(splitSpeaker(zeile)).toEqual(geteilt);
  });
});

describe("Notizen zu Dateien", () => {
  it("legt Notizen mit und ohne Strecke an, ordnet und begrenzt die Strecke", () => {
    const { session, audio, photo } = seed();
    // Wenn: Notizen ohne Strecke, mit verdrehter Strecke über das Ende hinaus und an einem Foto angelegt werden
    addNote(store, audio.id, { text: "  ganze Aufnahme: viel Wind  " });
    addNote(store, audio.id, { text: "noch abtippen", fromMs: 900_000, toMs: 120_000 });
    addNote(store, photo.id, { text: "unscharf" });
    // Dann: ist der Leerraum weg und die Strecke geordnet und begrenzt
    const v = buildSessionView(store, session.id);
    const own = v.notes.filter((n) => n.sourceId === audio.id);
    expect(own.map((n) => [n.text, n.fromMs, n.toMs, n.done])).toEqual([
      ["ganze Aufnahme: viel Wind", null, null, false],
      ["noch abtippen", 120_000, 600_000, false],
    ]);
    expect(v.notes.filter((n) => n.sourceId === photo.id)).toHaveLength(1);
    // Wenn: eine Notiz leer ist, dann lehnt die App sie ab
    expect(() => addNote(store, audio.id, { text: "   " })).toThrow(/leer/);
  });

  it("ändert, hakt ab und löscht", () => {
    const { session, audio } = seed();
    addNote(store, audio.id, { text: "Abschnitt", fromMs: 10_000 });
    const id = buildSessionView(store, session.id).notes[0]!.id;
    // Wenn: das Ende vor den Anfang gesetzt und abgehakt wird, dann wird die Strecke geordnet
    updateNote(store, id, { toMs: 5_000, done: true });
    expect(buildSessionView(store, session.id).notes[0]).toMatchObject({ fromMs: 5_000, toMs: 10_000, done: true });
    // Wenn: der Anfang entfernt wird, dann gilt die Notiz der ganzen Datei
    updateNote(store, id, { fromMs: null });
    expect(buildSessionView(store, session.id).notes[0]).toMatchObject({ fromMs: null, toMs: null });
    // Wenn: sie gelöscht wird, dann ist sie weg
    deleteNote(store, id);
    expect(buildSessionView(store, session.id).notes).toEqual([]);
  });

  it("verschwindet mit der Datei", () => {
    const { session, audio } = seed();
    addNote(store, audio.id, { text: "weg" });
    // Wenn: die Datei gelöscht wird, dann auch ihre Notiz
    store.deleteSource(audio.id);
    expect(buildSessionView(store, session.id).notes).toEqual([]);
  });
});
