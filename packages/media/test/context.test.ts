import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, type ExportSettings } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { documentVariables, protocolCsv } from "../src/export.ts";
import { exportFingerprint } from "../src/export-state.ts";
import { buildSessionTranscript, entryText } from "../src/session-transcript.ts";

const SETTINGS: ExportSettings = {
  video: false,
  resolve: false,
  mixAudio: true,
  realtime: true,
  deviceTracks: false,
  viewer: false,
};
const T = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 14, h, m, s);

describe("Kontext im Einsatztranskript (Issue #108)", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  let ids: { audio: string; foto: string; seite: string; notiz: string; d1: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-kontext-"));
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14" }).id;
    const person = store.addPerson({ name: "Testperson A" });
    const rec = store.addDevice({ sessionId, label: "Rekorder", isReference: true, offsetBasis: "reference" });
    const handy = store.addDevice({ sessionId, label: "Handy", personId: person.id });
    const buch = store.addDevice({ sessionId, label: "Tagebuch", personId: person.id });
    const sha = (n: number) => String(n).repeat(64).slice(0, 64);
    const add = (
      kind: "audio" | "photo" | "diary" | "note",
      deviceId: string,
      fileName: string,
      n: number,
      durationMs: number | null = null,
    ) =>
      store.addSource({
        sessionId,
        deviceId,
        kind,
        originalPath: join(dir, fileName),
        fileName,
        sizeBytes: 1,
        sha256: sha(n),
        durationMs,
      }).id;
    const audio = add("audio", rec.id, "ZOOM0001.m4a", 1, 30 * 60_000);
    const foto = add("photo", handy.id, "IMG_0007.jpg", 2);
    const seite = add("diary", buch.id, "Tagebuch_S03.jpg", 3);
    writeFileSync(join(dir, "zusammenfassung.txt"), "Zwischenstand\r\nerste Runde");
    const notiz = add("note", buch.id, "zusammenfassung.txt", 4);
    store.addEvidence({
      sourceId: audio,
      kind: "metadata",
      clock: "device",
      localMs: T(10, 15),
      uncertaintyMs: 1000,
      detail: "Metadaten",
    });
    store.addEvidence({
      sourceId: foto,
      kind: "metadata",
      clock: "device",
      localMs: T(9, 41, 12),
      uncertaintyMs: 1000,
      detail: "EXIF",
    });
    store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: seite, page: 0, x: 0, y: 0, w: 1, h: 0.4 }],
      notedAtMs: null,
      mode: "short",
      shortText: "Standplan",
      role: "context",
      title: "Karte 2: Standplan",
      contextMade: "am Vorabend",
      contextOrder: 1,
    });
    const d1 = store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: seite, page: 0, x: 0, y: 0.5, w: 1, h: 0.5 }],
      notedAtMs: T(10, 24),
      mode: "short",
      shortText: "Streit am Käsestand",
    }).id;
    ids = { audio, foto, seite, notiz, d1 };
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const karteKey = () => `entry:${store.listDiaryEntries(sessionId).find((e) => e.role === "context")!.id}`;

  it("Kontext steht vorn, ohne Stelle im Video; Verweise hängen am datierten Eintrag", () => {
    store.updateDiaryEntry(ids.d1, { contextRefs: [karteKey()] });
    const t = buildSessionTranscript(store, sessionId);
    expect(t.context).toHaveLength(1);
    expect(t.context[0]).toMatchObject({
      head: "Kontext · Karte 2: Standplan",
      details: " · Tagebuch T-01 (Testperson A) · entstanden: am Vorabend · erwähnt um 10:24",
      body: "Kurzform: Standplan",
    });
    expect(t.entries.some((e) => entryText(e).includes("Karte 2"))).toBe(true);
    const diary = t.entries.find((e) => e.kind === "diary")!;
    expect(diary.body).toBe("Kurzform: Streit am Käsestand → Kontext: Karte 2: Standplan");
    expect(t.header.contextCount).toBe(1);
  });

  it("Foto und Textdatei als Kontext: Foto mit Bild, Textdatei mit Inhalt; Quellen im Kopf", () => {
    store.updateSource(ids.foto, { role: "context", contextOrder: 2 });
    store.updateSource(ids.notiz, { role: "context", contextOrder: 3, title: "Zwischenstand" });
    const t = buildSessionTranscript(store, sessionId);
    expect(t.context.map((c) => c.head)).toEqual([
      "Kontext · Karte 2: Standplan",
      "Kontext · Foto F-001, IMG_0007.jpg",
      "Kontext · Zwischenstand",
    ]);
    expect(t.context[1]!.images).toEqual([{ sourceId: ids.foto }]);
    expect(t.context[2]!.body).toBe("Volltext: Zwischenstand\nerste Runde");
    expect(t.entries.some((e) => e.kind === "photo")).toBe(false);
    expect(t.header.sources).toContain("F-001");
    expect(t.header.sources).toContain("N-01");
  });

  it("Begleitprotokoll und Variablen: neue Spalten nur mit Kontext", () => {
    store.updateSource(ids.foto, { role: "context" });
    const t = buildSessionTranscript(store, sessionId);
    const rows = protocolCsv(store, t)
      .replace(/^﻿/, "")
      .trim()
      .split(/\r?\n/)
      .map((r) => r.split(";"));
    const head = rows[0]!;
    const col = (row: string[], name: string) => row[head.indexOf(name)]?.replace(/^"|"$/g, "");
    const foto = rows.find((r) => r[0] === "F-001")!;
    const seite = rows.find((r) => r[0] === "T-01")!;
    expect(col(foto, "Rolle")).toBe("Kontext");
    expect(col(foto, "Zeit stammt aus")).toBe("Kontext, bewusst ohne Uhrzeit (Lage 09:41:12 ruht)");
    expect(col(seite, "Rolle")).toBe("Chronologie und Kontext");
    expect(col(seite, "Kontext")).toBe("1: Karte 2: Standplan");
    expect(col(seite, "Kontext entstanden")).toBe("am Vorabend");
    const vars = documentVariables(t, "x");
    expect(vars[1]![vars[0]!.indexOf("Kontextstücke")]).toBe(2);
  });

  it("ohne Kontext: keine neuen Spalten, kein neuer Abdruck", () => {
    for (const e of store.listDiaryEntries(sessionId)) store.updateDiaryEntry(e.id, { role: "timeline" });
    const t = buildSessionTranscript(store, sessionId);
    expect(t.context).toEqual([]);
    expect(t.header).not.toHaveProperty("contextCount");
    expect(protocolCsv(store, t)).not.toContain("Rolle");
    expect(documentVariables(t, "x")[0]).not.toContain("Kontextstücke");
    // Abdruck hängt nicht an den gespeicherten Kontext-Feldern, solange nichts Kontext ist.
    const before = exportFingerprint(store, sessionId, SETTINGS).content;
    store.updateSource(ids.foto, { contextMade: "egal", contextOrder: 4 });
    expect(exportFingerprint(store, sessionId, SETTINGS).content).toBe(before);
  });

  it("Abdruck: Titel oder Reihenfolge des Kontexts ändern macht die Ausgabe veraltet", () => {
    store.updateSource(ids.foto, { role: "context", contextOrder: 2 });
    const a = exportFingerprint(store, sessionId, SETTINGS).content;
    store.updateSource(ids.foto, { title: "Lageplan" });
    const b = exportFingerprint(store, sessionId, SETTINGS).content;
    store.updateSource(ids.foto, { contextOrder: 0 });
    const c = exportFingerprint(store, sessionId, SETTINGS).content;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("Montage-ID bleibt, wenn ein Eintrag ohne Lage Kontext wird", () => {
    const e = store.addDiaryEntry({ sessionId, regions: [{ sourceId: ids.seite }], notedAtMs: null });
    const before = buildSessionTranscript(store, sessionId).header.montageId;
    store.updateDiaryEntry(e.id, { role: "context" });
    expect(buildSessionTranscript(store, sessionId).header.montageId).toBe(before);
  });
});
