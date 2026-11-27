/**
 * Originale in den Ausgabeordner kopieren und den Ordner später prüfen (Issue #208,
 * `packages/media/src/originals-copy.ts`, eingebunden in `packages/media/src/export.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore, type Device, type Source } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  CopyMismatchError,
  copyOriginals,
  ensureSpace,
  NoManifestError,
  NotEnoughSpaceError,
  parseManifest,
  planOriginals,
  verifyFolder,
} from "../src/originals-copy.ts";
import { MANIFEST_NAME, README_NAME, RO_CRATE_NAME } from "../src/dataset.ts";
import { exportSession } from "../src/export.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { hasFfmpeg, makePhoto } from "./fixtures.ts";

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-originale-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** Eine ausgedachte Quelle mit echter Datei auf der Platte. */
function source(label: string, fileName: string, deviceId: string | null, content = `${label}:${fileName}`): Source {
  const raw = join(dir, "roh", label);
  mkdirSync(raw, { recursive: true });
  const originalPath = join(raw, fileName);
  writeFileSync(originalPath, content);
  return {
    label,
    fileName,
    deviceId,
    originalPath,
    sizeBytes: Buffer.byteLength(content),
    sha256: sha(content),
  } as Source;
}
const device = (id: string, label: string) => ({ id, label }) as Device;

describe("Kopierplan", () => {
  it("legt je Gerät einen Ordner an und stellt das Kurzzeichen vor den Dateinamen", () => {
    // Angenommen: zwei Karten mit gleichem Dateinamen, ein Gerät mit Sonderzeichen und eine Quelle ohne Gerät
    const plan = planOriginals(
      [
        source("A1", "C0001.MP4", "k1"),
        source("B1", "C0001.MP4", "k2"),
        source("C1", "notiz.jpg", "t"),
        source("D1", "zettel.jpg", null),
      ],
      [device("k1", "Kamera"), device("k2", "kamera"), device("t", "Ton: Zoom/H5")],
    );
    // Dann: stoßen die beiden C0001.MP4 nicht zusammen, und kein Pfad enthält „:“ oder einen zweiten Trenner
    expect(plan.map((c) => c.path)).toEqual([
      "Originale/Kamera/A1_C0001.MP4",
      "Originale/kamera_2/B1_C0001.MP4",
      "Originale/Ton_Zoom_H5/C1_notiz.jpg",
      "Originale/Ohne_Gerät/D1_zettel.jpg",
    ]);
  });
});

describe("Kopieren", () => {
  it("kopiert, liest jede Kopie nach und meldet Fortschritt bis zum Doppelten der Größe", async () => {
    const s = source("V1", "clip.mp4", "k", "x".repeat(3000));
    const out = join(dir, "kopie");
    const seen: [number, number][] = [];
    const r = await copyOriginals(out, planOriginals([s], [device("k", "Kamera")]), {
      onProgress: (d, t) => seen.push([d, t]),
    });
    expect(r).toEqual({ files: ["Originale/Kamera/V1_clip.mp4"], kept: [], missing: [] });
    expect(readFileSync(join(out, "Originale", "Kamera", "V1_clip.mp4"), "utf8")).toBe("x".repeat(3000));
    expect(seen.at(-1)).toEqual([6000, 6000]);
  });

  it("lässt bei erneuter Ausgabe Kopien gleicher Größe liegen, die zur letzten Ausgabe gehörten", async () => {
    const s = source("V2", "clip.mp4", "k");
    const plan = planOriginals([s], [device("k", "Kamera")]);
    const out = join(dir, "erneut");
    await copyOriginals(out, plan);
    const dest = join(out, "Originale", "Kamera", "V2_clip.mp4");
    const before = statSync(dest).mtimeMs;
    // Wenn: noch einmal ausgegeben wird, mit der Kopie in der letzten Ausgabe
    const r = await copyOriginals(out, plan, { previousFiles: [plan[0]!.path] });
    // Dann: bleibt sie liegen
    expect(r.kept).toEqual([plan[0]!.path]);
    expect(statSync(dest).mtimeMs).toBe(before);
    // Wenn: die Datei nicht zur letzten Ausgabe gehörte, dann wird sie neu geschrieben
    expect((await copyOriginals(out, plan)).kept).toEqual([]);
  });

  it("bricht ab und entfernt die Kopie, wenn sie nicht zur Prüfsumme vom Einsammeln passt", async () => {
    // Angenommen: das Original hat sich seit dem Einsammeln verändert
    const s = source("V3", "clip.mp4", null);
    writeFileSync(s.originalPath, "verändert");
    const out = join(dir, "falsch");
    await expect(copyOriginals(out, planOriginals([s], []))).rejects.toBeInstanceOf(CopyMismatchError);
    expect(existsSync(join(out, "Originale", "Ohne_Gerät", "V3_clip.mp4"))).toBe(false);
  });

  it("überspringt ein fehlendes Original und nennt es", async () => {
    const s = source("V4", "weg.mp4", null);
    rmSync(s.originalPath);
    const r = await copyOriginals(join(dir, "fehlt"), planOriginals([s], []));
    expect(r.files).toEqual([]);
    expect(r.missing.map((m) => m.label)).toEqual(["V4"]);
  });
});

describe("Platzprüfung", () => {
  it("lässt kleine Originale durch und meldet zu große verständlich", async () => {
    await expect(ensureSpace(join(dir, "gibt-es-noch-nicht", "tief"), 1000)).resolves.toBeUndefined();
    await expect(ensureSpace(dir, 1024 ** 5)).rejects.toThrow(NotEnoughSpaceError);
    await expect(ensureSpace(dir, 1024 ** 5)).rejects.toThrow(/Für die Originale fehlt Platz: Sie brauchen/);
  });
});

describe("Ordner prüfen", () => {
  /** Ein Ordner mit Prüfsummenliste über zwei Dateien, eine davon in einem Unterordner. */
  function folder(name: string): string {
    const d = join(dir, name);
    mkdirSync(join(d, "Originale", "Kamera"), { recursive: true });
    writeFileSync(join(d, "a.docx"), "eins");
    writeFileSync(join(d, "Originale", "Kamera", "A1_c.mp4"), "zwei");
    writeFileSync(join(d, MANIFEST_NAME), `${sha("eins")}  a.docx\n${sha("zwei")}  Originale/Kamera/A1_c.mp4\n`);
    return d;
  }

  it("meldet einen unveränderten Ordner und übergeht Systemdateien", async () => {
    const d = folder("heil");
    writeFileSync(join(d, ".DS_Store"), "");
    expect(await verifyFolder(d)).toEqual({ dir: d, listed: 2, ok: 2, missing: [], changed: [], extra: [] });
  });

  it("zählt fehlende, veränderte und dazugekommene Dateien getrennt", async () => {
    const d = folder("beschaedigt");
    rmSync(join(d, "a.docx"));
    writeFileSync(join(d, "Originale", "Kamera", "A1_c.mp4"), "zwei!");
    writeFileSync(join(d, "notiz.txt"), "später");
    const r = await verifyFolder(d);
    expect(r).toMatchObject({ listed: 2, ok: 0, missing: ["a.docx"], changed: ["Originale/Kamera/A1_c.mp4"] });
    expect(r.extra).toEqual(["notiz.txt"]);
  });

  it("sagt, wenn die Prüfsummenliste fehlt", async () => {
    mkdirSync(join(dir, "ohne-liste"));
    await expect(verifyFolder(join(dir, "ohne-liste"))).rejects.toBeInstanceOf(NoManifestError);
  });

  it("liest die Liste auch im Binärformat von sha256sum", () => {
    expect(parseManifest(`${"A".repeat(64)} *x y.mp4\r\nKommentar\n`)).toEqual([
      { sha: "a".repeat(64), path: "x y.mp4" },
    ]);
  });
});

describe.skipIf(!hasFfmpeg())("Ausgabe mit Originalen", () => {
  let store: ProjectStore;
  let sessionId: string;

  // Angenommen: ein Einsatz mit zwei Fotos
  beforeAll(async () => {
    const raw = join(dir, "fotos");
    mkdirSync(raw);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makePhoto(join(raw, "IMG_20260914_102000.jpg"), "0x2f6b3a");
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "Marktplatz" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterAll(() => store?.close());

  it("legt die Kopien in den Ordner, nennt sie in LIESMICH, Metadaten und Prüfsummenliste", async () => {
    // Wenn: mit Originalen, LIESMICH, Metadaten und Prüfsummenliste ausgegeben wird
    const out = join(dir, "ausgabe");
    const r = await exportSession(store, sessionId, out, {
      video: false,
      originals: true,
      readme: true,
      roCrate: true,
      manifest: true,
    });
    // Dann: stehen die Kopien vorn in der Dateiliste und liegen im Ordner
    const copies = r.files.filter((f) => f.startsWith("Originale/"));
    expect(copies).toHaveLength(2);
    expect(r.files.slice(0, 2)).toEqual(copies);
    for (const s of store.listSources(sessionId))
      expect(copies.some((c) => c.endsWith(`/${s.label}_${s.fileName}`))).toBe(true);
    // Und: die LIESMICH fasst sie zu einem Eintrag zusammen
    const readme = readFileSync(join(out, README_NAME), "utf8");
    expect(readme).toContain("<dt>Originale/</dt>");
    expect(readme).not.toContain(`<dt>${copies[0]}</dt>`);
    // Und: die Metadaten führen jede Kopie als Datei im Datensatz
    const crate = JSON.parse(readFileSync(join(out, RO_CRATE_NAME), "utf8")) as { "@graph": { "@id": string }[] };
    const ids = crate["@graph"].map((e) => e["@id"]);
    expect(ids).toContain("Originale/");
    for (const c of copies) expect(ids).toContain(c);
    // Und: die Prüfsummenliste deckt sie ab, „Ordner prüfen“ findet alles unverändert
    const check = await verifyFolder(out);
    expect(check).toMatchObject({ listed: r.files.length - 1, missing: [], changed: [], extra: [] });
  });

  it("entfernt die Kopien, wenn erneut ohne Originale ausgegeben wird", async () => {
    const out = join(dir, "umschalten");
    const first = await exportSession(store, sessionId, out, { video: false, originals: true });
    const second = await exportSession(store, sessionId, out, { video: false, previousFiles: first.files });
    expect(second.files.some((f) => f.startsWith("Originale/"))).toBe(false);
    expect(existsSync(join(out, "Originale"))).toBe(false);
  });
});
