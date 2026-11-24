/**
 * Originale prüfen, verschobene wiederfinden und die Prüfung vor der Ausgabe (`packages/media/src/integrity.ts`),
 * mit kleinen Textdateien anstelle von Aufnahmen.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Source } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkSources, exportVerdict, findOriginals, HashCache, quickCheck, verifyOriginal } from "../src/integrity.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-integrity-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Erfundene Datei anlegen und als Quelle beschreiben, wie es das Einsammeln täte. */
function source(name: string, content: string, kind: Source["kind"] = "audio", sub = "aufnahmen"): Source {
  mkdirSync(join(dir, sub), { recursive: true });
  const path = join(dir, sub, name);
  writeFileSync(path, content);
  return {
    id: `id-${name}`,
    sessionId: "s",
    deviceId: null,
    label: name.slice(0, 4),
    kind,
    title: "",
    originalPath: path,
    fileName: name,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
    durationMs: null,
    metadata: {},
    importedAt: new Date().toISOString(),
    partOf: null,
    follows: null,
    levelMode: "auto",
    levelGainDb: 0,
    levelCompress: true,
    firstPage: null,
    pageSpread: false,
    role: "timeline",
    contextOrder: null,
    contextMade: "",
  };
}

describe("Originale prüfen", () => {
  it("unterscheidet unverändert, verändert, fehlt und nicht prüfbar", async () => {
    // Angenommen: fünf Originale: unverändert, gleich groß mit anderem Inhalt, länger, gelöscht, durch einen Ordner ersetzt
    const ok = source("ok.wav", "aaaa");
    const sameSize = source("gleich.wav", "bbbb");
    writeFileSync(sameSize.originalPath, "cccc"); // gleiche Größe, anderer Inhalt
    const grown = source("laenger.wav", "dddd");
    writeFileSync(grown.originalPath, "dddddd");
    const gone = source("weg.wav", "eeee");
    rmSync(gone.originalPath);
    const folder = source("ordner.wav", "ffff");
    rmSync(folder.originalPath);
    mkdirSync(folder.originalPath);

    // Wenn: schnell (nur Größe) geprüft wird, dann fällt nur die Größenänderung und das Fehlen auf
    expect(quickCheck(ok).state).toBe("unchecked");
    expect(quickCheck(sameSize).state).toBe("unchecked"); // ohne Prüfsumme nicht zu erkennen
    expect(quickCheck(grown).state).toBe("changed");
    expect(quickCheck(gone).state).toBe("missing");

    // Wenn: mit Prüfsumme geprüft wird, dann wird jeder Fall erkannt
    const cache = new HashCache();
    const r = await checkSources([ok, sameSize, grown, gone, folder], { cache });
    expect(r.map((c) => c.state)).toEqual(["ok", "changed", "changed", "missing", "unreadable"]);
    expect(r[1]!.detail).toMatch(/Prüfsumme/);
    // Dann: kennt die schnelle Prüfung danach das Ergebnis, ohne neu zu lesen
    expect(quickCheck(ok, cache).state).toBe("ok");
    expect(quickCheck(sameSize, cache).state).toBe("changed");
  });

  it("nimmt eine Datei nur mit passender Prüfsumme an", async () => {
    // Angenommen: ein Original, eine fremde Datei und eine echte Kopie
    const src = source("A.wav", "original");
    writeFileSync(join(dir, "fremd.wav"), "anderer");
    writeFileSync(join(dir, "kopie.wav"), "original");
    // Dann: nur die Kopie wird angenommen, eine fehlende Datei nicht
    expect(await verifyOriginal(src, join(dir, "fremd.wav"))).toMatchObject({ ok: false });
    expect(await verifyOriginal(src, join(dir, "kopie.wav"))).toMatchObject({ ok: true });
    expect(await verifyOriginal(src, join(dir, "gibtsnicht.wav"))).toMatchObject({ ok: false });
  });
});

describe("Verschobene Originale wiederfinden", () => {
  it("findet verschobene und umbenannte Dateien, lehnt gleichnamige andere ab", async () => {
    // Angenommen: ein Original verschoben, eines umbenannt in einem Unterordner, eines durch eine gleichnamige andere Datei ersetzt
    const moved = source("ZOOM0004.WAV", "ton-vom-markt");
    const renamed = source("C0012.MP4", "video-vom-markt");
    const wrong = source("IMG_0231.jpg", "foto-original", "photo");
    mkdirSync(join(dir, "neu", "tief"), { recursive: true });
    renameSync(moved.originalPath, join(dir, "neu", "zoom0004.wav"));
    renameSync(renamed.originalPath, join(dir, "neu", "tief", "Markt_Video.mp4"));
    rmSync(wrong.originalPath);
    writeFileSync(join(dir, "neu", "IMG_0231.jpg"), "foto-bearbeit"); // gleicher Name, gleiche Größe, anderer Inhalt
    writeFileSync(join(dir, "neu", ".versteckt"), "ton-vom-markt");

    // Wenn: der neue Ordner durchsucht wird
    const r = await findOriginals([moved, renamed, wrong], join(dir, "neu"));
    // Dann: die ersten beiden werden gefunden, die gleichnamige wird abgelehnt
    expect(r.found).toEqual([
      { sourceId: moved.id, path: join(dir, "neu", "zoom0004.wav") },
      { sourceId: renamed.id, path: join(dir, "neu", "tief", "Markt_Video.mp4") },
    ]);
    expect(r.rejected).toEqual([
      { sourceId: wrong.id, path: join(dir, "neu", "IMG_0231.jpg"), reason: "Prüfsumme passt nicht" },
    ]);
    expect(r.truncated).toBe(false);
  });

  it("ordnet zwei gleiche Dateien nicht beiden Quellen zu und hört bei maxFiles auf", async () => {
    // Angenommen: zwei Quellen mit gleichem Inhalt, nur eine Datei liegt im neuen Ordner
    const a = source("a.wav", "gleich", "audio", "x");
    const b = source("b.wav", "gleich", "audio", "y");
    rmSync(a.originalPath);
    rmSync(b.originalPath);
    mkdirSync(join(dir, "neu"));
    writeFileSync(join(dir, "neu", "a.wav"), "gleich");
    // Wenn: gesucht wird, dann gehört die Datei nur einer Quelle
    const r = await findOriginals([a, b], join(dir, "neu"));
    expect(r.found).toEqual([{ sourceId: a.id, path: join(dir, "neu", "a.wav") }]);

    // Wenn: mehr Dateien als maxFiles im Ordner liegen, dann wird die Suche als abgeschnitten gemeldet
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, "neu", `f${i}.txt`), "x");
    expect((await findOriginals([a], join(dir, "neu"), { maxFiles: 3 })).truncated).toBe(true);
  });
});

describe("Prüfung vor der Ausgabe", () => {
  it("sperrt nur, wenn eine gebrauchte Datei fehlt; Veränderungen warnen", () => {
    // Angenommen: Ton fehlt, Foto in Ordnung, GPS fehlt, ein Ton ist verändert
    const audio = source("a.wav", "1");
    const photo = source("f.jpg", "2", "photo");
    const gps = source("g.gpx", "3", "gps");
    const changed = source("c.wav", "4");
    const checks = [
      { sourceId: audio.id, state: "missing" as const, detail: "" },
      { sourceId: photo.id, state: "ok" as const, detail: "" },
      { sourceId: gps.id, state: "missing" as const, detail: "" },
      { sourceId: changed.id, state: "changed" as const, detail: "" },
    ];
    const all = [audio, photo, gps, changed];
    // Wenn: mit Montagevideo, dann sperrt der fehlende Ton; GPS und Veränderung warnen nur
    const withVideo = exportVerdict(all, checks, { video: true });
    expect(withVideo.blocking.map((c) => c.sourceId)).toEqual([audio.id]);
    expect(withVideo.warnings.map((c) => c.sourceId)).toEqual([gps.id, changed.id]);
    // Wenn: ohne Montagevideo, dann sperrt der Ton nicht, ein fehlendes Foto aber schon
    expect(exportVerdict(all, checks, { video: false }).blocking).toEqual([]);
    const missingPhoto = [{ sourceId: photo.id, state: "missing" as const, detail: "" }];
    expect(exportVerdict(all, missingPhoto, { video: false }).blocking).toHaveLength(1);
  });
});
