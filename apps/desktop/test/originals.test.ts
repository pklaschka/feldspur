import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  checkOriginals,
  exportBlocker,
  relinkDuplicates,
  relinkFile,
  searchOriginals,
  unreachableForAnalysis,
} from "../src/main/originals.ts";
import { buildSessionView } from "../src/main/view.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-orig-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Erfundener Einsatz: eine Tonaufnahme und ein Foto, beide als echte (kleine) Dateien. */
function seed() {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  mkdirSync(join(dir, "alt"));
  const add = (fileName: string, content: string, kind: "audio" | "photo") => {
    const originalPath = join(dir, "alt", fileName);
    writeFileSync(originalPath, content);
    return store.addSource({
      sessionId: session.id,
      deviceId: null,
      kind,
      fileName,
      originalPath,
      sizeBytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      durationMs: kind === "audio" ? 1000 : null,
      metadata: {},
    });
  };
  return { session, audio: add("ZOOM0001.WAV", "ton", "audio"), photo: add("IMG_1.jpg", "bild", "photo") };
}

describe("Originale neu verknüpfen", () => {
  it("erkennt einen verschobenen Ordner und verknüpft ihn ohne neues Einsammeln", async () => {
    const { session, audio, photo } = seed();
    renameSync(join(dir, "alt"), join(dir, "neu"));

    const view = buildSessionView(store, session.id);
    expect(view.rows.map((r) => r.file)).toEqual(["missing", "missing"]);
    expect(exportBlocker(store, session.id, false)).toMatch(/Eine Originaldatei fehlt \(F-/);
    expect(exportBlocker(store, session.id, true)).toMatch(/2 Originaldateien fehlen/);
    expect(unreachableForAnalysis(store, session.id).has(audio.id)).toBe(true);

    const r = await searchOriginals(store, session.id, join(dir, "neu"));
    expect(r.relinked).toHaveLength(2);
    expect(store.getSource(audio.id).originalPath).toBe(join(dir, "neu", "ZOOM0001.WAV"));
    expect(store.getSource(photo.id).originalPath).toBe(join(dir, "neu", "IMG_1.jpg"));
    // Die Suche hat die Prüfsummen schon gerechnet: Die Ansicht zeigt „unverändert“.
    expect(buildSessionView(store, session.id).rows.map((r) => r.file)).toEqual(["ok", "ok"]);
    expect(exportBlocker(store, session.id, true)).toBeNull();

    // Ein Schritt, rückgängig zu machen, und im Änderungsprotokoll mit altem und neuem Pfad.
    const step = store.history.changeLog({ limit: 1 })[0]!;
    expect(step.label).toBe("2 Originaldateien neu verknüpft");
    expect(step.changes[0]!.before?.original_path).toMatch(/alt/);
    expect(step.changes[0]!.after?.original_path).toMatch(/neu/);
    store.history.undo();
    expect(store.getSource(audio.id).originalPath).toBe(join(dir, "alt", "ZOOM0001.WAV"));
  });

  it("nimmt eine gleichnamige Datei mit anderer Prüfsumme nicht an", async () => {
    const { session, audio } = seed();
    rmSync(join(dir, "alt", "ZOOM0001.WAV"));
    mkdirSync(join(dir, "fremd"));
    writeFileSync(join(dir, "fremd", "ZOOM0001.WAV"), "TON"); // gleiche Größe, anderer Inhalt

    await expect(relinkFile(store, audio.id, join(dir, "fremd", "ZOOM0001.WAV"))).rejects.toThrow(/nicht das Original/);
    const r = await searchOriginals(store, session.id, join(dir, "fremd"));
    expect(r.relinked).toEqual([]);
    expect(r.rejected).toEqual([
      { label: audio.label, path: join(dir, "fremd", "ZOOM0001.WAV"), reason: "Prüfsumme passt nicht" },
    ]);
    expect(r.stillOpen).toEqual([audio.label]);
    expect(store.getSource(audio.id).originalPath).toBe(join(dir, "alt", "ZOOM0001.WAV"));
  });

  it("verknüpft eine einzeln gewählte Datei mit passender Prüfsumme", async () => {
    const { audio } = seed();
    mkdirSync(join(dir, "usb"));
    renameSync(join(dir, "alt", "ZOOM0001.WAV"), join(dir, "usb", "umbenannt.wav"));
    await relinkFile(store, audio.id, join(dir, "usb", "umbenannt.wav"));
    expect(store.getSource(audio.id).originalPath).toBe(join(dir, "usb", "umbenannt.wav"));
    // Der Dateiname im Quellennachweis bleibt der vom Einsammeln.
    expect(store.getSource(audio.id).fileName).toBe("ZOOM0001.WAV");
    expect(store.history.state().undo).toBe("Originaldatei neu verknüpft");
  });

  it("erneutes Einsammeln verknüpft fehlende Originale, lässt vorhandene in Ruhe", () => {
    const { audio, photo } = seed();
    rmSync(join(dir, "alt", "ZOOM0001.WAV"));
    const n = relinkDuplicates(store, [
      { path: join(dir, "kopie", "ZOOM0001.WAV"), existing: store.getSource(audio.id) },
      { path: join(dir, "kopie", "IMG_1.jpg"), existing: store.getSource(photo.id) },
    ]);
    expect(n).toBe(1);
    expect(store.getSource(audio.id).originalPath).toBe(join(dir, "kopie", "ZOOM0001.WAV"));
    expect(store.getSource(photo.id).originalPath).toBe(join(dir, "alt", "IMG_1.jpg"));
  });
});

describe("Prüfung vor der Ausgabe", () => {
  it("erkennt eine veränderte Datei an der Prüfsumme und sperrt die Ausgabe nicht", async () => {
    const { session, audio, photo } = seed();
    writeFileSync(join(dir, "alt", "IMG_1.jpg"), "BILD"); // gleiche Größe: nur die Prüfsumme verrät es
    expect(buildSessionView(store, session.id).rows.find((r) => r.id === photo.id)?.file).toBe("unchecked");
    const r = await checkOriginals(store, session.id, { video: true });
    expect(r.checks.find((c) => c.sourceId === photo.id)?.state).toBe("changed");
    expect(r.checks.find((c) => c.sourceId === audio.id)?.state).toBe("ok");
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toEqual([photo.id]);
    expect(buildSessionView(store, session.id).rows.find((x) => x.id === photo.id)?.file).toBe("changed");
  });
});
