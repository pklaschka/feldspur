import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vite-plus/test";
import { scaffoldDocx } from "../src/docx.ts";
import type { Scaffold, ScaffoldEntry } from "../src/scaffold.ts";

/** Nur der Teil von Scaffold, den scaffoldDocx liest. */
function fake(entries: ScaffoldEntry[]): Scaffold {
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
    },
    entries,
  } as unknown as Scaffold;
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

describe("Zeitgerüst-.docx: Zeilenumbrüche", () => {
  it("setzt einen Umbruch im selben Absatz, nicht rohe Zeilenumbrüche", async () => {
    const e: ScaffoldEntry = {
      montageMs: 1000,
      kind: "diary",
      clock: "",
      head: "Tagebuch S. 1",
      body: "Volltext: a\nb\r\nc",
      images: [],
    };
    const xml = documentXml(await scaffoldDocx(fake([e]), { mediaFileName: "m.mp4", stills: new Map() }));
    expect(xml).toContain("<w:br/>");
    expect(xml.match(/<w:br\/>/g)).toHaveLength(2);
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*\n/);
    // Eine Zeitmarke je Eintrag: Absatz bleibt einer.
    expect(xml.match(/#00:00:01-0#/g)).toHaveLength(1);
    expect(xml).toContain("Volltext: a");
  });
});
