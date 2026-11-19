import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { sessionTranscriptDocx } from "../src/docx.ts";
import type { SessionTranscript, SessionTranscriptContext, SessionTranscriptEntry } from "../src/session-transcript.ts";

/** Nur der Teil von SessionTranscript, den sessionTranscriptDocx liest. */
function fake(entries: SessionTranscriptEntry[], context: SessionTranscriptContext[] = []): SessionTranscript {
  return {
    header: {
      title: "Test",
      date: "2026-09-14",
      place: "",
      researchers: [],
      reference: null,
      sources: [],
      extra: {},
      montageId: "M1",
      modeLabel: "Echtzeit",
      ...(context.length ? { contextCount: context.length } : {}),
    },
    entries,
    context,
  } as unknown as SessionTranscript;
}

/** word/document.xml aus dem ZIP lesen (Größen stehen ggf. erst im Datenbeschreiber, daher Zentralverzeichnis). */
function documentXml(buf: Buffer): string {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  while (buf.readUInt32LE(at) === 0x02014b50) {
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (name === "word/document.xml") {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      return inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("document.xml fehlt");
}

describe("Einsatztranskript-.docx: Zeilenumbrüche", () => {
  it("setzt einen Umbruch im selben Absatz, nicht rohe Zeilenumbrüche", async () => {
    const e: SessionTranscriptEntry = {
      montageMs: 1000,
      kind: "diary",
      clock: "",
      head: "Tagebuch S. 1",
      body: "Volltext: a\nb\r\nc",
      images: [],
    };
    const xml = documentXml(await sessionTranscriptDocx(fake([e]), { mediaFileName: "m.mp4", stills: new Map() }));
    expect(xml).toContain("<w:br/>");
    expect(xml.match(/<w:br\/>/g)).toHaveLength(2);
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n/);
    // Eine Zeitmarke je Eintrag: Absatz bleibt einer.
    expect(xml.match(/#00:00:01-0#/g)).toHaveLength(1);
    expect(xml).toContain("Volltext: a");
  });
});

describe("Einsatztranskript-.docx: Kontext (Issue #108)", () => {
  const line: SessionTranscriptEntry = {
    montageMs: 9 * 60_000,
    kind: "diary",
    clock: "10:24",
    head: "Tagebuch T-01 · S. 3",
    body: "Kurzform: Streit am Käsestand → Kontext: Karte 2: Standplan",
    images: [],
  };
  const karte: SessionTranscriptContext = {
    key: "entry:karte",
    position: 1,
    head: "Kontext · Karte 2: Standplan",
    details: " · Tagebuch T-01 · S. 3 (Testperson A) · erwähnt um 10:24",
    body: "Kurzform: Standplan\nBrunnen",
    images: [],
  };
  const text = (xml: string) => xml.replace(/<[^>]+>/g, "");

  it("steht vor der ersten Zeitmarke, ohne Zeitmarke, mit Überschriften", async () => {
    const xml = documentXml(
      await sessionTranscriptDocx(fake([line], [karte]), { mediaFileName: "m.mp4", stills: new Map() }),
    );
    const t = text(xml);
    const firstStamp = t.indexOf("#00:");
    expect(t.indexOf("Kontext · Karte 2: Standplan")).toBeGreaterThan(-1);
    expect(t.indexOf("Kontext · Karte 2: Standplan")).toBeLessThan(firstStamp);
    expect(t.indexOf("Chronologie")).toBeLessThan(firstStamp);
    expect(t).toContain("Kontext: 1 Stück ohne Zeitmarke, vor der Chronologie.");
    // Der Kontextabschnitt trägt kein „#“.
    expect(t.slice(t.indexOf("Diese Stücke"), firstStamp)).not.toContain("#");
    expect(t.match(/#\d\d:\d\d:\d\d-\d#/g)).toHaveLength(1);
    // Verweis im selben Absatz wie die Zeitmarke.
    expect(t).toContain("Kurzform: Streit am Käsestand → Kontext: Karte 2: Standplan");
    expect(xml.match(/<w:br\/>/g)).toHaveLength(1);
  });

  it("ohne Kontext: keine Überschrift „Kontext“ oder „Chronologie“", async () => {
    const t = text(
      documentXml(await sessionTranscriptDocx(fake([line]), { mediaFileName: "m.mp4", stills: new Map() })),
    );
    expect(t).not.toContain("Chronologie");
    expect(t).not.toContain("Diese Stücke");
  });
});
