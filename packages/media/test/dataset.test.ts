/**
 * Angaben zum Datensatz und Metadaten als RO-Crate (Issue #206): `packages/media/src/dataset.ts` (Angaben lesen,
 * zusammenführen, beschreiben) und `packages/media/src/ro-crate.ts` (die Datei), geschrieben von `export.ts`.
 * Alle Namen und Werte sind erfunden.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  cleanDataset,
  describeExport,
  keywordList,
  licenseUrl,
  MANIFEST_NAME,
  mergeDataset,
  parsePeople,
  projectDataset,
  README_NAME,
  RO_CRATE_NAME,
  sessionDataset,
  setProjectDataset,
} from "../src/dataset.ts";
import { exportSession } from "../src/export.ts";
import { exportFingerprint } from "../src/export-state.ts";
import { applyImport, scanPaths } from "../src/import.ts";
import { exportReadmeHtml } from "../src/readme.ts";
import { PROFILE_URL } from "../src/ro-crate.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { sessionTranscriptHtml } from "../src/viewer/html.ts";
import { unzip } from "./xlsx.test.ts";
import { hasFfmpeg, makePhoto } from "./fixtures.ts";

describe("Angaben zum Datensatz", () => {
  it.each`
    zeile                                                      | name               | orcid
    ${"Mara Beispiel"}                                         | ${"Mara Beispiel"} | ${undefined}
    ${"Mara Beispiel, 0000-0002-1825-0097"}                    | ${"Mara Beispiel"} | ${"0000-0002-1825-0097"}
    ${"Mara Beispiel (https://orcid.org/0000-0002-1825-009x)"} | ${"Mara Beispiel"} | ${"0000-0002-1825-009X"}
    ${"  "}                                                    | ${null}            | ${undefined}
  `("„$zeile“ ergibt $name mit ORCID $orcid", ({ zeile, name, orcid }) => {
    const people = parsePeople(zeile);
    if (name === null) expect(people).toEqual([]);
    else expect(people).toEqual([orcid ? { name, orcid } : { name }]);
  });

  it("liest je Zeile eine Person", () => {
    expect(parsePeople("Mara Beispiel\r\nJo Muster\n\n").map((p) => p.name)).toEqual(["Mara Beispiel", "Jo Muster"]);
  });

  it("trennt Schlagworte an Komma und Semikolon und nimmt Doppelte heraus", () => {
    expect(keywordList("Markt, Handel; Markt ,Stadt")).toEqual(["Markt", "Handel", "Stadt"]);
  });

  it.each`
    lizenz                          | adresse
    ${"CC BY 4.0"}                  | ${"https://creativecommons.org/licenses/by/4.0/"}
    ${"cc-by-nc-sa-4.0"}            | ${"https://creativecommons.org/licenses/by-nc-sa/4.0/"}
    ${"CC0"}                        | ${"https://creativecommons.org/publicdomain/zero/1.0/"}
    ${"https://example.org/lizenz"} | ${"https://example.org/lizenz"}
    ${"Alle Rechte vorbehalten"}    | ${null}
  `("Lizenz „$lizenz“ hat die Adresse $adresse", ({ lizenz, adresse }) => {
    expect(licenseUrl(lizenz)).toBe(adresse);
  });

  it("nimmt ein Feld des Einsatzes statt des Felds im Projekt, leere Felder zählen nicht", () => {
    const project = { title: "Marktstudie", license: "CC BY 4.0", access: " " };
    const session = { title: "  ", license: "Alle Rechte vorbehalten" };
    expect(mergeDataset(project, session)).toEqual({ title: "Marktstudie", license: "Alle Rechte vorbehalten" });
    expect(cleanDataset({ description: "  Text  " })).toEqual({ description: "Text" });
  });

  it("merkt sich die Angaben des Projekts in der Projektdatei, rückgängig wie jede Änderung", () => {
    const store = ProjectStore.open(":memory:");
    try {
      const id = store.addSession({ title: "Markt", date: "2026-09-14" }).id;
      expect(projectDataset(store)).toEqual({});
      // Wenn: die Angaben fürs Projekt gespeichert werden, dann gelten sie auch im Einsatz
      store.history.record("Angaben", () => setProjectDataset(store, { title: "Marktstudie", keywords: "" }));
      expect(projectDataset(store)).toEqual({ title: "Marktstudie" });
      expect(sessionDataset(store, id)).toEqual({ title: "Marktstudie" });
      // Wenn: rückgängig, dann sind sie wieder leer; wiederholt, dann wieder da
      store.history.undo();
      expect(projectDataset(store)).toEqual({});
      store.history.redo();
      // Wenn: der Einsatz den Titel überschreibt, dann gilt dort seiner
      store.updateSession(id, { dataset: { title: "Markt am Montag" } });
      expect(sessionDataset(store, id)).toEqual({ title: "Markt am Montag" });
    } finally {
      store.close();
    }
  });
});

describe.skipIf(!hasFfmpeg())("Angaben in LIESMICH und Metadaten", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  const transcript = () => buildSessionTranscript(store, sessionId);

  // Angenommen: ein Einsatz mit zwei Fotos von einer Kamera, die Mara Beispiel gehört
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-datensatz-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makePhoto(join(raw, "IMG_20260914_101630.jpg"), "0x8a4fbf");
    makePhoto(join(raw, "IMG_20260914_102000.jpg"), "0x2f6b3a");
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Markt", date: "2026-09-14", place: "Marktplatz" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    const person = store.addPerson({ name: "Mara Beispiel" });
    for (const d of store.listDevices(sessionId)) store.updateDevice(d.id, { personId: person.id });
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("belegt ohne Angaben nur Titel und Urheber*innen vor, aus Einsatz und Forschenden", () => {
    const d = describeExport(transcript(), { files: [], persons: store.listPersons() });
    expect(d.title).toBe("Markt · 14.09.2026");
    expect(d.titleEntered).toBe(false);
    expect(d.creators).toEqual([{ name: "Mara Beispiel" }]);
    expect(d.creatorsEntered).toBe(false);
    expect([d.license, d.access, d.description]).toEqual([null, null, null]);
    expect(d.entered).toEqual([]);
  });

  it("nennt Quellen mit Gerät, Person und Uhrzeit in UTC, ohne Pfad des Rechners", () => {
    const d = describeExport(transcript(), { files: [], persons: store.listPersons() });
    expect(d.sources.map((s) => [s.fileName, s.person, s.start])).toEqual([
      ["IMG_20260914_101630.jpg", "Mara Beispiel", "2026-09-14T08:16:30.500Z"],
      ["IMG_20260914_102000.jpg", "Mara Beispiel", "2026-09-14T08:20:00.500Z"],
    ]);
    expect(JSON.stringify(d)).not.toContain(dir);
  });

  it("zeigt in der LIESMICH nur eingetragene Angaben, mit Zeilenumbrüchen", () => {
    const html = (dataset = {}) =>
      exportReadmeHtml(transcript(), {
        files: ["Feldtag.docx"],
        video: false,
        description: describeExport(transcript(), { dataset, files: ["Feldtag.docx", README_NAME] }),
      });
    expect(html()).not.toContain("Angaben zum Datensatz");
    const text = html({ title: "Marktstudie", creators: "Mara <Beispiel>\nJo Muster" });
    expect(text).toContain("<h2>Angaben zum Datensatz</h2>");
    expect(text).toContain("<dt>Titel</dt><dd>Marktstudie</dd>");
    expect(text).toContain("<dt>Urheber*innen</dt><dd>Mara &lt;Beispiel&gt;<br>Jo Muster</dd>");
    expect(text).not.toContain("<dt>Lizenz</dt>");
  });

  it("schreibt die Metadaten auf Wunsch nach der LIESMICH und vor der Prüfsummenliste", async () => {
    // Wenn: mit LIESMICH, Metadaten und Prüfsummenliste ausgegeben wird
    const out = join(dir, "voll");
    const r = await exportSession(store, sessionId, out, {
      video: false,
      readme: true,
      roCrate: true,
      manifest: true,
      dataset: { title: "Marktstudie", creators: "Mara Beispiel, 0000-0002-1825-0097", license: "CC BY 4.0" },
      exportedAt: "2026-11-27T20:00:00.000Z",
      softwareRef: { version: "0.5.0", url: "https://doi.org/10.5281/zenodo.24289969" },
    });
    // Dann: stehen die drei Dateien in dieser Reihenfolge am Ende
    expect(r.files.slice(-3)).toEqual([README_NAME, RO_CRATE_NAME, MANIFEST_NAME]);
    // Und: die LIESMICH nennt die Metadaten, die Prüfsummenliste prüft sie mit
    expect(readFileSync(join(out, README_NAME), "utf8")).toContain(
      `<dt>${RO_CRATE_NAME}</dt><dd>Metadaten (RO-Crate):`,
    );
    expect(readFileSync(join(out, MANIFEST_NAME), "utf8")).toContain(`  ${RO_CRATE_NAME}\n`);
    // Und: die Metadaten folgen RO-Crate 1.2 und dem Profil von Feldspur
    const crate = JSON.parse(readFileSync(join(out, RO_CRATE_NAME), "utf8")) as {
      "@context": unknown[];
      "@graph": Record<string, unknown>[];
    };
    expect(crate["@context"][0]).toBe("https://w3id.org/ro/crate/1.2/context");
    const node = (id: string) => crate["@graph"].find((n) => n["@id"] === id)!;
    expect(node(RO_CRATE_NAME)).toMatchObject({ conformsTo: { "@id": "https://w3id.org/ro/crate/1.2" } });
    const root = node("./");
    expect(root).toMatchObject({
      "@type": "Dataset",
      name: "Marktstudie",
      datePublished: "2026-11-27T20:00:00.000Z",
      conformsTo: { "@id": PROFILE_URL },
      identifier: transcript().header.montageId,
      author: [{ "@id": "https://orcid.org/0000-0002-1825-0097" }],
      license: { "@id": "https://creativecommons.org/licenses/by/4.0/" },
      temporalCoverage: "2026-09-14T08:16:30.500Z/2026-09-14T08:20:00.500Z",
    });
    expect(root).not.toHaveProperty("conditionsOfAccess");
    // Und: jede Datei im Ordner außer den Metadaten selbst steht darin, mit Größe, solange sie schon geschrieben war
    const parts = (root.hasPart as { "@id": string }[]).map((p) => p["@id"]);
    for (const f of r.files.filter((f) => f !== RO_CRATE_NAME)) expect(parts).toContain(encodeURI(f));
    expect(node(README_NAME)).toHaveProperty("contentSize");
    expect(node(MANIFEST_NAME)).not.toHaveProperty("contentSize");
    // Und: die Quellen tragen Prüfsumme und Gerät, aber keinen Pfad des Rechners
    const source = crate["@graph"].find((n) => n.name === "IMG_20260914_101630.jpg")!;
    expect(String(source["@id"])).toMatch(/^#quelle-/);
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(out, RO_CRATE_NAME), "utf8")).not.toContain(dir);
    const recording = crate["@graph"].find((n) => n["@type"] === "CreateAction" && n["@id"] !== "#ausgabe")!;
    expect(recording.result).toContainEqual({ "@id": source["@id"] });
    expect(recording.agent).toEqual({ "@id": "#person-mara-beispiel" });
  });

  it("lässt die Metadaten ohne Wunsch weg", async () => {
    const r = await exportSession(store, sessionId, join(dir, "schlicht"), { video: false, readme: true });
    expect(r.files).not.toContain(RO_CRATE_NAME);
  });

  it("macht eine Ausgabe veraltet, sobald sich die Angaben ändern; ohne Angaben bleibt der Abdruck wie vorher", () => {
    const settings = {
      video: false,
      resolve: false,
      mixAudio: true,
      realtime: true,
      deviceTracks: false,
      viewer: false,
      readme: true,
      changeLog: false,
      manifest: false,
      roCrate: false,
      videoHeight: 720,
      videoFps: 25,
    };
    const before = exportFingerprint(store, sessionId, settings).content;
    // Wenn: leere Angaben gespeichert werden, dann bleibt der Abdruck
    setProjectDataset(store, { title: "  " });
    expect(exportFingerprint(store, sessionId, settings).content).toBe(before);
    // Wenn: ein Titel dazukommt, dann ändert er sich
    setProjectDataset(store, { title: "Marktstudie" });
    expect(exportFingerprint(store, sessionId, settings).content).not.toBe(before);
    setProjectDataset(store, {});
  });

  it("steht im Kopf von Einsatztranskript und Viewer und geht in den dritten Block der Montage-ID ein", async () => {
    // Angenommen: ohne Angaben
    const id = transcript().header.montageId;
    expect(transcript().header.dataset).toBeUndefined();
    // Wenn: Titel, zwei Urheber*innen (eine mit ORCID) und eine Beschreibung über zwei Zeilen eingetragen werden
    setProjectDataset(store, {
      title: "Marktstudie",
      creators: "Mara Beispiel 0000-0002-1825-0097\nTom Muster",
      description: "Erste Zeile.\nZweite Zeile.",
    });
    const t = transcript();
    // Dann: stehen sie je Feld in einer Zeile, und nur der Textblock der ID ändert sich
    expect(t.header.dataset).toEqual([
      ["Titel des Datensatzes", "Marktstudie"],
      ["Urheber*innen", "Mara Beispiel (ORCID 0000-0002-1825-0097); Tom Muster"],
      ["Beschreibung", "Erste Zeile. Zweite Zeile."],
    ]);
    expect(t.header.montageId).not.toBe(id);
    expect(t.header.montageVideoId).toBe(id.slice(0, 12));
    const out = join(dir, "kopf");
    const r = await exportSession(store, sessionId, out, { video: false });
    const docx = r.files.find((f) => f.endsWith(".docx"))!;
    const xml = unzip(readFileSync(join(out, docx)))["word/document.xml"]!;
    expect(xml).toContain("Titel des Datensatzes: Marktstudie");
    expect(sessionTranscriptHtml(t, { mediaFileName: "Feldtag.mp4", stills: new Map() } as never)).toContain(
      "Titel des Datensatzes: Marktstudie",
    );
    // Wenn: die Angaben wieder gelöscht werden, dann ist die ID wie vorher
    setProjectDataset(store, {});
    expect(transcript().header.montageId).toBe(id);
  });
});
