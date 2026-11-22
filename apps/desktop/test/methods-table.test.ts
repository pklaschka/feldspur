import type { MethodsMaterialRow, MethodsSessionSummary } from "@feldspur/media";
import { describe, expect, it } from "vite-plus/test";
import {
  basisText,
  combineMaterial,
  hms,
  materialTable,
  methodsHtml,
  methodsMarkdown,
  methodsPlain,
  outputTable,
  softwareLine,
} from "../src/shared/methods-table.ts";

const row = (r: Partial<MethodsMaterialRow>): MethodsMaterialRow => ({
  kind: "video",
  device: "Kamera",
  files: 1,
  durationMs: 0,
  basis: {},
  correctionsMs: [],
  ...r,
});

/** Erfundener Einsatz; `n` unterscheidet Tag, Titel und Montage-ID. */
const einsatz = (n: number, patch: Partial<MethodsSessionSummary> = {}): MethodsSessionSummary => ({
  sessionId: `s${n}`,
  title: `Testmarkt ${n}`,
  date: `2026-09-1${3 + n}`,
  sources: 19,
  unsynced: 0,
  material: [
    row({ files: 10, durationMs: 3_600_000, basis: { metadata: 10 }, correctionsMs: [42_000] }),
    row({ kind: "audio", device: "Rekorder", files: 2, durationMs: 5_400_000, basis: { spoken: 1, follows: 1 } }),
    row({ kind: "photo", device: "Handy", files: 5, basis: { metadata: 4, none: 1 } }),
    row({ kind: "diary", device: "", files: 2, entries: 7, basis: { diary: 2 } }),
  ],
  output: {
    base: `Feldtag_2026-09-1${3 + n}_Testmarkt_${n}`,
    lines: 100 * n,
    context: 0,
    durationMs: 5_400_000,
    mode: "Echtzeit",
    montageId: `FS-AAA${n}-BBB${n}-CCC${n}`,
    montageVideoId: `FS-AAA${n}-BBB${n}`,
    video: true,
  },
  exported: "current",
  exportedAt: "2026-09-20T08:00:00.000Z",
  ...patch,
});

describe("Dauer", () => {
  it.each`
    ms            | text
    ${0}          | ${"0:00:00"}
    ${250_000}    | ${"0:04:10"}
    ${6_480_000}  | ${"1:48:00"}
    ${90_061_000} | ${"25:01:01"}
  `("$ms ms steht als $text (immer h:mm:ss)", ({ ms, text }) => {
    expect(hms(ms)).toBe(text);
  });
});

describe("Zelle „Zeitbeleg“", () => {
  it.each`
    fall                            | zeile                                                            | text
    ${"ein Beleg"}                  | ${{ basis: { metadata: 98 } }}                                   | ${"Metadaten"}
    ${"mehrere Belege"}             | ${{ basis: { filename: 14, metadata: 98 } }}                     | ${"Metadaten (98), Dateiname (14)"}
    ${"eine Uhrkorrektur"}          | ${{ basis: { metadata: 3 }, correctionsMs: [42_000] }}           | ${"Metadaten; Uhr um +0:42 korrigiert"}
    ${"mehrere Uhrkorrekturen"}     | ${{ basis: { metadata: 3 }, correctionsMs: [70_000, -167_000] }} | ${"Metadaten; Uhr korrigiert (−2:47 bis +1:10)"}
    ${"Quellen ohne Uhrzeit"}       | ${{ basis: { metadata: 4, none: 1 } }}                           | ${"Metadaten (4), ohne Uhrzeit (1)"}
    ${"Kontext"}                    | ${{ basis: { context: 2 } }}                                     | ${"Kontext, ohne Uhrzeit"}
    ${"Tagebuch nur mit Einträgen"} | ${{ kind: "diary", files: 0, entries: 3 }}                       | ${"notierte Uhrzeit"}
  `("$fall: $text", ({ zeile, text }) => {
    expect(basisText(row(zeile))).toBe(text);
  });
});

describe("Eingang über mehrere Einsätze", () => {
  it("fasst gleiche Art und gleiches Gerät zu einer Zeile zusammen", () => {
    const sum = combineMaterial([einsatz(1), einsatz(2)]);
    expect(sum.map((r) => [r.kind, r.device, r.files])).toEqual([
      ["video", "Kamera", 20],
      ["audio", "Rekorder", 4],
      ["photo", "Handy", 10],
      ["diary", "", 4],
    ]);
    expect(sum[0]).toMatchObject({ durationMs: 7_200_000, basis: { metadata: 20 }, correctionsMs: [42_000] });
    expect(sum[3]!.entries).toBe(14);
  });

  it("hält verschiedene Geräte derselben Art auseinander", () => {
    const zweite = einsatz(2, { material: [row({ device: "Handy", files: 3, basis: { filename: 3 } })] });
    expect(combineMaterial([einsatz(1), zweite]).map((r) => `${r.kind} ${r.device}`)).toEqual([
      "video Handy",
      "video Kamera",
      "audio Rekorder",
      "photo Handy",
      "diary ",
    ]);
  });

  it("ergibt die Tabelle mit Anzahl, Dauer und Zeitbeleg", () => {
    expect(materialTable([einsatz(1), einsatz(2)])).toEqual({
      caption: "Eingang: Aufzeichnungen aus 2 Einsätzen (14.09.2026 bis 15.09.2026)",
      head: ["Eingang", "Gerät", "Anzahl", "Dauer (h:mm:ss)", "Zeitbeleg"],
      rows: [
        ["Video", "Kamera", "20", "2:00:00", "Metadaten; Uhr um +0:42 korrigiert"],
        ["Audio", "Rekorder", "4", "3:00:00", "angesagte Uhrzeit (2), Folgeaufnahme (2)"],
        ["Fotos", "Handy", "10", "–", "Metadaten (8), ohne Uhrzeit (2)"],
        ["Tagebuch", "–", "14 Einträge, 4 Dateien", "–", "notierte Uhrzeit"],
      ],
    });
  });

  it("nennt bei einem einzelnen Einsatz nur dessen Tag", () => {
    expect(materialTable([einsatz(1)]).caption).toBe("Eingang: Aufzeichnungen aus einem Einsatz (14.09.2026)");
  });
});

describe("Ausgabe je Einsatz", () => {
  it("führt Einsatztranskript und Montagevideo, die ganze Montage-ID steht beim Einsatztranskript", () => {
    expect(outputTable([einsatz(2), einsatz(1)]).rows).toEqual([
      ["14.09.2026 Testmarkt 1", "Einsatztranskript", ".docx", "100 Zeilen", "FS-AAA1-BBB1-CCC1"],
      ["", "Montagevideo", ".mp4", "1:30:00, Echtzeit", ""],
      ["15.09.2026 Testmarkt 2", "Einsatztranskript", ".docx", "200 Zeilen", "FS-AAA2-BBB2-CCC2"],
      ["", "Montagevideo", ".mp4", "1:30:00, Echtzeit", ""],
    ]);
  });

  it("lässt das Montagevideo weg, wenn ohne Video ausgegeben wird, und nennt Kontextstücke", () => {
    const e = einsatz(1);
    const ohne = { ...e, output: { ...e.output, video: false, context: 3, lines: 1 } };
    expect(outputTable([ohne]).rows).toEqual([
      ["14.09.2026 Testmarkt 1", "Einsatztranskript", ".docx", "1 Zeile, 3 Kontextstücke", "FS-AAA1-BBB1-CCC1"],
    ]);
  });

  it("überspringt Einsätze, aus denen sich nichts ausgeben lässt", () => {
    const e = einsatz(1);
    expect(outputTable([{ ...e, output: { ...e.output, durationMs: 0 } }]).rows).toEqual([]);
  });
});

describe("Zum Kopieren", () => {
  const tabellen = [
    { caption: "Eingang", head: ["Eingang", "Gerät"], rows: [["Video", "Kamera A|B"]] },
    { caption: "Ausgabe", head: ["Einsatz"], rows: [["Markt <Ost> & West"]] },
  ];
  const software = softwareLine({ version: "0.4.0", released: "2026-12-01", doi: "10.5281/zenodo.24289969" });

  it("nennt unter den Tabellen Feldspur mit Version und DOI", () => {
    expect(software).toContain("Zusammengeführt und ausgegeben mit Feldspur, Version 0.4.0: Klaschka, Z. N. (2026).");
    expect(software).toContain("https://doi.org/10.5281/zenodo.24289969");
  });

  it("Markdown: Überschrift, Tabelle mit Kopfzeile, senkrechte Striche maskiert", () => {
    expect(methodsMarkdown(tabellen, software)).toBe(
      [
        "**Eingang**",
        "",
        "| Eingang | Gerät |",
        "| --- | --- |",
        "| Video | Kamera A\\|B |",
        "",
        "**Ausgabe**",
        "",
        "| Einsatz |",
        "| --- |",
        "| Markt <Ost> & West |",
        "",
        software,
        "",
      ].join("\n"),
    );
  });

  it("HTML für Word: echte Tabellen, Sonderzeichen maskiert", () => {
    const html = methodsHtml(tabellen, software);
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain("<p><b>Eingang</b></p>");
    expect(html).toContain(">Markt &lt;Ost&gt; &amp; West</td>");
    expect(html).not.toContain("<Ost>");
  });

  it("Text: Spalten durch Tabulatoren getrennt", () => {
    expect(methodsPlain(tabellen, software)).toBe(
      `Eingang\nEingang\tGerät\nVideo\tKamera A|B\n\nAusgabe\nEinsatz\nMarkt <Ost> & West\n\n${software}\n`,
    );
  });
});
