/**
 * LIESMICH und Metadaten des Projektordners (`packages/media/src/project-folder.ts`, `ro-crate.ts`, Issue #209), aus
 * erfundenen Einsätzen ohne Dateizugriff.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  projectReadmeHtml,
  projectSpan,
  type ProjectFolder,
  type ProjectFolderSession,
} from "../src/project-folder.ts";
import { projectRoCrateJson } from "../src/ro-crate.ts";

/** Erfundener Einsatz im Projektordner; `n` unterscheidet Tag, Titel und Montage-ID. */
const einsatz = (n: number, patch: Partial<ProjectFolderSession> = {}): ProjectFolderSession => ({
  folder: `Feldtag_2026-09-1${3 + n}_Markt ${n}`,
  numbers: {
    title: `Markt ${n}`,
    date: `2026-09-1${3 + n}`,
    material: [
      { kind: "video", device: "Kamera", files: n, durationMs: 60_000, basis: { metadata: n }, correctionsMs: [] },
    ],
    output: {
      base: `Feldtag_2026-09-1${3 + n}_Markt_${n}`,
      lines: 10 * n,
      context: 0,
      durationMs: 60_000,
      mode: "Echtzeit",
      montageId: `FS-AAA${n}-BBB${n}-CCC${n}`,
      montageVideoId: `FS-AAA${n}-BBB${n}`,
      video: true,
      farFromDate: 0,
    },
  },
  place: "Südstadt",
  marks: [
    {
      kind: "video",
      fromMs: Date.parse(`2026-09-1${3 + n}T10:00:00Z`),
      toMs: Date.parse(`2026-09-1${3 + n}T10:01:00Z`),
    },
  ],
  exportedAt: "2026-09-20T08:00:00.000Z",
  files: [`Feldtag_${n}.docx`, `Feldtag_${n}.mp4`, "LIESMICH.html", "manifest-sha256.txt"],
  ...patch,
});

const ordner = (patch: Partial<ProjectFolder> = {}): ProjectFolder => ({
  name: "Marktstudie",
  dataset: {},
  researchers: ["Mara Beispiel"],
  sessions: [einsatz(2), einsatz(1)],
  roCrate: false,
  others: [],
  ...patch,
});

describe("LIESMICH des Projektordners", () => {
  it("nennt die Einsätze in zeitlicher Folge mit Ordner, Montage-ID und Verweis auf ihre LIESMICH", () => {
    const html = projectReadmeHtml(ordner());
    expect(html).toContain("<h1>Marktstudie</h1>");
    expect(html).toContain("Ausgabe eines Projekts mit 2 Einsätzen, 14.09.2026 bis 15.09.2026");
    expect(html.indexOf("FS-AAA1-BBB1-CCC1")).toBeLessThan(html.indexOf("FS-AAA2-BBB2-CCC2"));
    // Leerzeichen im Ordnernamen sind im Verweis kodiert, im Text nicht.
    expect(html).toContain('<a href="Feldtag_2026-09-14_Markt%201/LIESMICH.html">Feldtag_2026-09-14_Markt 1/</a>');
  });

  it("fasst die Tabellen für den Methodenteil über alle Einsätze zusammen und zeigt den Feldkalender", () => {
    const html = projectReadmeHtml(ordner({ software: "Feldspur, Version 0.5.0" }));
    expect(html).toContain("Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)");
    expect(html).toContain("Ausgabe: Einsatztranskript und Montagevideo je Einsatz");
    expect(html).toContain("<svg ");
    expect(html).toContain("Feldkalender: 2 Einsätze auf einer Uhrzeit-Achse");
    expect(html).toContain("Feldspur, Version 0.5.0");
  });

  it("kommt ohne Skript und ohne Verweise auf Dateien außerhalb aus", () => {
    const html = projectReadmeHtml(ordner());
    expect(html).not.toContain("<script");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/(?:src|href)="(?:\/|file:|[A-Za-z]:\\)/);
  });

  it("zeigt nur eingetragene Angaben zum Datensatz und setzt den Titel des Datensatzes nach oben", () => {
    expect(projectReadmeHtml(ordner())).not.toContain("Angaben zum Datensatz");
    const html = projectReadmeHtml(ordner({ dataset: { title: "Marktgespräche", license: "CC BY 4.0" } }));
    expect(html).toContain("<h1>Marktgespräche</h1>");
    expect(html).toContain("<dt>Lizenz</dt><dd>CC BY 4.0</dd>");
    expect(html).not.toContain("<dt>Zugang</dt>");
  });

  it("entschärft Zeichen aus Titeln und Ordnernamen", () => {
    const html = projectReadmeHtml(
      ordner({ name: "<b>Studie</b>", sessions: [einsatz(1, { folder: 'Feldtag_"x"&<y>' })] }),
    );
    expect(html).toContain("&lt;b&gt;Studie&lt;/b&gt;");
    expect(html).not.toContain("<y>");
  });

  it.each`
    tage      | spanne
    ${[]}     | ${""}
    ${[1]}    | ${"14.09.2026"}
    ${[3, 1]} | ${"14.09.2026 bis 16.09.2026"}
  `("Zeitraum für die Tage $tage: „$spanne“", ({ tage, spanne }) => {
    expect(projectSpan((tage as number[]).map((n) => einsatz(n)))).toBe(spanne);
  });
});

describe("Metadaten des Projektordners", () => {
  const graph = (p: ProjectFolder) =>
    (
      JSON.parse(projectRoCrateJson(p, { exportedAt: "2026-09-20T08:00:00Z" })) as {
        "@graph": (Record<string, unknown> & { "@id": string })[];
      }
    )["@graph"];
  const node = (p: ProjectFolder, id: string) => graph(p).find((x) => x["@id"] === id)!;

  it("beschreibt den Ordner als Datensatz mit Zeitraum, Ort und den Einsatzordnern als Teilen", () => {
    const p = ordner({ dataset: { title: "Marktgespräche", creators: "Mara Beispiel, 0000-0002-1825-0097" } });
    const root = node(p, "./");
    expect(root).toMatchObject({
      name: "Marktgespräche",
      temporalCoverage: "2026-09-14/2026-09-15",
      author: [{ "@id": "https://orcid.org/0000-0002-1825-0097" }],
      contentLocation: [{ "@id": "#ort-sudstadt" }],
    });
    expect(root.hasPart).toEqual([
      { "@id": "LIESMICH.html" },
      { "@id": "Feldtag_2026-09-15_Markt%202/" },
      { "@id": "Feldtag_2026-09-14_Markt%201/" },
    ]);
  });

  it("führt je Einsatzordner Montage-ID, Tag der Ausgabe und seine Dateien", () => {
    const folder = node(ordner(), "Feldtag_2026-09-14_Markt%201/");
    expect(folder).toMatchObject({
      "@type": "Dataset",
      identifier: "FS-AAA1-BBB1-CCC1",
      datePublished: "2026-09-20T08:00:00.000Z",
      temporalCoverage: "2026-09-14",
    });
    expect(folder.hasPart).toContainEqual({ "@id": "Feldtag_2026-09-14_Markt%201/Feldtag_1.mp4" });
    expect(folder.conformsTo).toBeUndefined();
  });

  it("kennzeichnet einen Einsatzordner mit eigenen Metadaten als eigenes RO-Crate", () => {
    const p = ordner({ sessions: [einsatz(1, { files: ["Feldtag_1.docx", "ro-crate-metadata.json"] })] });
    expect(node(p, "Feldtag_2026-09-14_Markt%201/")).toMatchObject({
      conformsTo: { "@id": "https://w3id.org/ro/crate" },
      subjectOf: { "@id": "Feldtag_2026-09-14_Markt%201/ro-crate-metadata.json" },
    });
  });

  it("nimmt die Forschenden an den Geräten als Urheber*innen, solange keine eingetragen sind", () => {
    expect(node(ordner(), "./").author).toEqual([{ "@id": "#person-mara-beispiel" }]);
  });
});
