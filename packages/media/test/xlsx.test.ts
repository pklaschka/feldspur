import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { documentVariables } from "../src/export.ts";
import type { SessionTranscript } from "../src/session-transcript.ts";
import { columnName, xlsx } from "../src/xlsx.ts";

/** ZIP lesen (nur, was xlsx() schreibt): Name → Text. */
export function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const start = at + 30 + nameLen + extra;
    out[name] = inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    at = start + size;
  }
  return out;
}

describe("Excel-Datei", () => {
  it.each`
    nummer | spalte
    ${0}   | ${"A"}
    ${1}   | ${"B"}
    ${25}  | ${"Z"}
    ${26}  | ${"AA"}
    ${27}  | ${"AB"}
    ${701} | ${"ZZ"}
    ${702} | ${"AAA"}
  `("Spalte $nummer heißt $spalte wie in Excel", ({ nummer, spalte }) => {
    expect(columnName(nummer)).toBe(spalte);
  });

  it("schreibt Text und Zahlen in ein gültiges Archiv", () => {
    // Wenn: eine Tabelle mit Sonderzeichen, Zahl und leerer Zeile geschrieben wird
    const buf = xlsx([
      ["Name", "Zahl"],
      ["Ä & <b>", 1.5],
      [null, ""],
    ]);
    // Dann: ein gültiges Archiv mit maskiertem Text, Zahl und leerer Zeile
    const files = unzip(buf);
    expect(Object.keys(files)).toContain("[Content_Types].xml");
    const sheet = files["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Ä &amp; &lt;b&gt;</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>1.5</v></c>');
    expect(sheet).toContain('<row r="3"></row>');
  });

  it("gleicher Inhalt ergibt Byte für Byte dieselbe Datei", () => {
    expect(xlsx([["Name"]]).equals(xlsx([["Name"]]))).toBe(true);
  });
});

describe("Dokumentvariablen für MAXQDA", () => {
  const transcript = {
    header: {
      title: "Testmarkt",
      date: "2026-09-14",
      place: "Marktplatz",
      researchers: ["A. Muster"],
      reference: "ZOOM",
      sources: ["A-01", "V-01"],
      extra: { DOI: "10.1234/abc", Ort: "doppelt", " ": "leer" },
      montageId: "FS-ABCD-EFGH",
      modeLabel: "Echtzeit",
    },
    plan: {
      durationMs: 90_000,
      segments: [{ fromMs: 10 * 3_600_000, toMs: 10 * 3_600_000 + 90_000 }],
    },
    input: {
      session: { timeZone: "Europe/Berlin" },
      sources: [{ id: "s1", deviceId: "d1" }],
      devices: [
        { id: "d1", label: "ZOOM" },
        { id: "d2", label: "ungenutzt" },
      ],
    },
    resolved: { placements: new Map([["s1", {}]]) },
  } as unknown as SessionTranscript;

  it("beginnt mit Dokumentgruppe und Dokumentname, danach eine Spalte je Variable", () => {
    // Wenn: die Variablen für das Dokument „Feldtag_2026-09-14_Testmarkt“ gebildet werden
    const [head, row] = documentVariables(transcript, "Feldtag_2026-09-14_Testmarkt");
    // Dann: erst Gruppe und Name, danach die Angaben; ein doppelter Name bekommt „(Einsatz)“, ein leerer fällt weg
    expect(head!.slice(0, 2)).toEqual(["Dokumentgruppe", "Dokumentname"]);
    expect(row!.slice(0, 2)).toEqual(["", "Feldtag_2026-09-14_Testmarkt"]);
    const v = Object.fromEntries(head!.map((k, i) => [k, row![i]]));
    expect(v).toMatchObject({
      Einsatz: "Testmarkt",
      Datum: "2026-09-14",
      Ort: "Marktplatz",
      Geräte: "ZOOM",
      Quellen: 2,
      Beginn: "10:00:00",
      Ende: "10:01:30",
      "Videolänge (Min.)": 1.5,
      DOI: "10.1234/abc",
      "Ort (Einsatz)": "doppelt",
    });
    expect(head).not.toContain(" ");
  });
});
