/**
 * LIESMICH.html und Prüfsummenliste im Ausgabeordner (`packages/media/src/readme.ts`, geschrieben von
 * `packages/media/src/export.ts`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { exportSession } from "../src/export.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { exportReadmeHtml, MANIFEST_NAME, README_NAME } from "../src/readme.ts";
import { sha256File } from "../src/hash.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { hasFfmpeg, makePhoto } from "./fixtures.ts";

describe.skipIf(!hasFfmpeg())("LIESMICH im Ausgabeordner", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const transcript = () => buildSessionTranscript(store, sessionId);
  const html = (video = false, software?: string) =>
    exportReadmeHtml(transcript(), { files: ["Feldtag.docx", "Feldtag_Begleitprotokoll.csv"], video, software });

  // Angenommen: ein Einsatz „Markt <Ost> & West“ mit zwei Fotos, deren Uhrzeit im Dateinamen steht
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-liesmich-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makePhoto(join(raw, "IMG_20260914_102000.jpg"), "0x2f6b3a");
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Markt <Ost> & West", date: "2026-09-14", place: "Marktplatz" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("nennt Einsatz, Datum und die ganze Montage-ID", () => {
    const text = html();
    expect(text).toContain("<h1>Markt &lt;Ost&gt; &amp; West · 14.09.2026</h1>");
    expect(text).toContain(transcript().header.montageId);
    expect(text).not.toContain("<Ost>");
  });

  it("erklärt jede Datei des Ordners, sich selbst eingeschlossen", () => {
    const text = html();
    expect(text).toContain("<dt>Feldtag.docx</dt><dd>Einsatztranskript:");
    expect(text).toContain("<dt>Feldtag_Begleitprotokoll.csv</dt><dd>Begleitprotokoll:");
    expect(text).toContain("<dt>LIESMICH.html</dt><dd>LIESMICH: diese Datei</dd>");
  });

  it("enthält die Tabellen für den Methodenteil mit Eingang und Ausgabe dieses Einsatzes", () => {
    const text = html();
    expect(text).toContain('<p class="cap" id="eingang">Eingang: Aufzeichnungen aus einem Einsatz (14.09.2026)</p>');
    expect(text).toContain('<td class="nw">Fotos</td>');
    expect(text).toContain('<td class="nw">Dateiname</td>');
    expect(text).toContain('<p class="cap" id="ausgabe">Ausgabe: Einsatztranskript und Montagevideo je Einsatz</p>');
    expect(text).toContain(`<td class="nw">${transcript().header.montageId}</td>`);
    expect(text).toContain("https://purl.archive.org/feldspur#sec-methodenteil");
  });

  it.each`
    video    | zeile            | satz
    ${true}  | ${"vorhanden"}   | ${"Die Zeitmarke zeigt auf die Stelle im Montagevideo"}
    ${false} | ${"weggelassen"} | ${"Diese Ausgabe enthält kein Montagevideo"}
  `("mit Montagevideo $video ist dessen Zeile in der Tabelle $zeile", ({ video, satz }) => {
    const text = html(video);
    expect(text.includes('<td class="nw">Montagevideo</td>')).toBe(video);
    expect(text).toContain(satz);
  });

  it("nennt hinter dem Montagevideo Auflösung und Bildrate", () => {
    const text = (format?: { height: number; fps: number }) =>
      exportReadmeHtml(transcript(), { files: ["Feldtag.mp4", "Feldtag.docx"], video: true, format });
    expect(text()).toMatch(/<dt>Feldtag\.mp4<\/dt><dd>Montagevideo:[^<]*\(1280 × 720, 25 Bilder\/s\)<\/dd>/);
    expect(text({ height: 360, fps: 10 })).toContain("(640 × 360, 10 Bilder/s)</dd>");
  });

  it("nennt die Software nur, wenn die App sie mitgibt", () => {
    expect(html(false, "Zusammengeführt mit Feldspur, Version 0.4.0")).toContain(
      "<p>Zusammengeführt mit Feldspur, Version 0.4.0</p>",
    );
    expect(html()).not.toContain("Zusammengeführt mit Feldspur");
  });

  it("kommt ohne Skript und ohne Verweise auf fremde Dateien aus", () => {
    const text = html();
    expect(text).not.toMatch(/<script|<link|<img|src=/);
    expect(text).toContain("default-src 'none'");
  });

  it("wird auf Wunsch als letzte Datei der Ausgabe geschrieben und nennt alle anderen", async () => {
    // Wenn: mit LIESMICH ausgegeben wird (ohne Video, damit es schnell geht)
    const out = join(dir, "aus");
    const r = await exportSession(store, sessionId, out, { video: false, readme: true });
    // Dann: liegt sie im Ordner, steht zuletzt in der Liste und erklärt jede andere Datei
    expect(r.files.at(-1)).toBe(README_NAME);
    const text = readFileSync(join(out, README_NAME), "utf8");
    // Im Dateinamen steht das „&“ des Titels; in HTML ist es maskiert.
    for (const f of r.files) expect(text).toContain(`<dt>${f.replace(/&/g, "&amp;")}</dt>`);
    // Wenn: ohne LIESMICH in einen anderen Ordner ausgegeben wird, dann fehlt sie dort
    const plain = await exportSession(store, sessionId, join(dir, "ohne"), { video: false });
    expect(plain.files).not.toContain(README_NAME);
    expect(existsSync(join(dir, "ohne", README_NAME))).toBe(false);
  });

  it("schreibt Änderungsprotokoll und Prüfsummenliste; die Liste prüft jede andere Datei", async () => {
    // Wenn: mit Änderungsprotokoll, LIESMICH und Prüfsummenliste ausgegeben wird
    const out = join(dir, "voll");
    const r = await exportSession(store, sessionId, out, {
      video: false,
      readme: true,
      changeLog: "\uFEFFZeit (UTC);Schritt\r\n",
      manifest: true,
    });
    // Dann: stehen die drei neuen Dateien in dieser Reihenfolge am Ende
    const protocol = r.files.find((f) => f.endsWith("_Aenderungsprotokoll.csv"));
    expect(r.files.slice(-3)).toEqual([protocol, README_NAME, MANIFEST_NAME]);
    expect(readFileSync(join(out, protocol!), "utf8")).toContain("Zeit (UTC);Schritt");
    // Und: die LIESMICH nennt beide und erklärt, wie man prüft
    const text = readFileSync(join(out, README_NAME), "utf8");
    expect(text).toContain(`<dt>${MANIFEST_NAME}</dt><dd>Prüfsummenliste:`);
    expect(text).toContain("<dd>Änderungsprotokoll:");
    expect(text).toContain(`sha256sum -c ${MANIFEST_NAME}`);
    // Und: die Prüfsummenliste führt jede andere Datei im Format von sha256sum, sich selbst nicht
    const lines = readFileSync(join(out, MANIFEST_NAME), "utf8").trimEnd().split("\n");
    expect(lines.map((l) => l.slice(66))).toEqual(r.files.slice(0, -1));
    for (const l of lines) expect(l.slice(0, 64)).toBe(await sha256File(join(out, l.slice(66))));
  });

  it("lässt die neuen Dateien weg, wenn sie nicht gewählt sind", async () => {
    const r = await exportSession(store, sessionId, join(dir, "schlicht"), { video: false });
    expect(r.files.some((f) => f.endsWith("_Aenderungsprotokoll.csv") || f === MANIFEST_NAME)).toBe(false);
  });
});
