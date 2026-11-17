import { describe, expect, it } from "vite-plus/test";
import { fitBox, navPages, sKey } from "../src/renderer/diary/pages.ts";
import type { SourceRow } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten.
const diary = (o: Partial<SourceRow> & { id: string }) =>
  ({
    label: o.id.toUpperCase(),
    kind: "diary",
    partOf: null,
    isPdf: false,
    pageSpread: false,
    firstPage: null,
    ...o,
  }) as SourceRow;

describe("navPages", () => {
  it("Bild mit weiteren Bildern ist eine Seite, sortiert nach Kurzzeichen; andere Arten fehlen", () => {
    const rows = [
      diary({ id: "t-02" }),
      diary({ id: "t-01" }),
      diary({ id: "t-01b", partOf: "t-01" }),
      { ...diary({ id: "f" }), kind: "photo" } as SourceRow,
    ];
    const pages = navPages(rows, new Map());
    expect(pages.map((p) => [p.key, p.label, p.surfaces.map((s) => s.sourceId)])).toEqual([
      ["t-01#0", "T-01", ["t-01", "t-01b"]],
      ["t-02#0", "T-02", ["t-02"]],
    ]);
  });

  it("PDF je Seite, weitere Bilder an der letzten Seite", () => {
    const rows = [diary({ id: "scan", isPdf: true }), diary({ id: "rueck", partOf: "scan" })];
    const pages = navPages(rows, new Map([["scan", 3]]));
    expect(pages.map((p) => [p.key, p.label, p.surfaces.map(sKey)])).toEqual([
      ["scan#0", "SCAN S. 1", ["scan#0"]],
      ["scan#1", "SCAN S. 2", ["scan#1"]],
      ["scan#2", "SCAN S. 3", ["scan#2", "rueck#0"]],
    ]);
  });

  it("PDF mit unbekannter Seitenzahl zählt als eine Seite", () => {
    const pages = navPages([diary({ id: "scan", isPdf: true })], new Map());
    expect(pages.map((p) => p.label)).toEqual(["SCAN"]);
  });
});

describe("fitBox", () => {
  it("noch nicht gemessen: nichts", () => {
    expect(fitBox({ w: 0, h: 500 }, false)).toEqual({ w: 0, h: 0 });
  });
  it("Innenabstand ab, bei mehreren Bildern Platz für die Beschriftung, nie unter 200 px", () => {
    expect(fitBox({ w: 800, h: 600 }, false)).toEqual({ w: 768, h: 568 });
    expect(fitBox({ w: 800, h: 600 }, true)).toEqual({ w: 768, h: 544 });
    expect(fitBox({ w: 100, h: 100 }, true)).toEqual({ w: 200, h: 200 });
  });
});
