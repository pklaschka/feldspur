import { describe, expect, it } from "vite-plus/test";
import { continuePages, diaryPageLabel, pageSide, regionPageNo, sideOrder, suggestPageNo } from "../src/pages.ts";

const scan = (over: Partial<{ fileName: string; firstPage: number | null; pageSpread: boolean }> = {}) => ({
  label: "T-01",
  fileName: "Tagebuch_S01.jpg",
  firstPage: null,
  pageSpread: false,
  ...over,
});

describe("Seitenzählung im Tagebuch", () => {
  it("bleibt ohne Angaben beim Kurzzeichen (PDF mit Seitenangabe)", () => {
    expect(diaryPageLabel(scan(), { x: 0, w: 1 })).toBe("T-01");
    expect(diaryPageLabel(scan({ fileName: "Scan.pdf" }), { page: 1, x: 0, w: 1 })).toBe("T-01 S. 2");
  });

  it("ordnet Rahmen auf einer Doppelseite der linken oder rechten Seite zu", () => {
    expect(pageSide({ x: 0.05, w: 0.4 })).toBe("left");
    expect(pageSide({ x: 0.1, w: 0.43 })).toBe("left"); // leicht über den Falz
    expect(pageSide({ x: 0.52, w: 0.4 })).toBe("right");
    expect(pageSide({ x: 0.2, w: 0.6 })).toBe("both");
    expect(diaryPageLabel(scan({ pageSpread: true }), { x: 0.6, w: 0.3 })).toBe("T-01 rechts");
  });

  it("zählt Doppelseiten ab der eingetragenen Seite", () => {
    const s = scan({ pageSpread: true, firstPage: 7 });
    expect(diaryPageLabel(s, { x: 0, w: 0.45 })).toBe("T-01 · S. 7");
    expect(diaryPageLabel(s, { x: 0.55, w: 0.45 })).toBe("T-01 · S. 8");
    expect(diaryPageLabel(s, { x: 0, w: 1 })).toBe("T-01 · S. 7–8");
    expect(diaryPageLabel(s)).toBe("T-01 · S. 7–8");
  });

  it("zählt in PDFs je Seite weiter", () => {
    const s = scan({ fileName: "Heft.pdf", pageSpread: true, firstPage: 1 });
    expect(diaryPageLabel(s, { page: 2, x: 0.6, w: 0.3 })).toBe("T-01 · S. 6");
    expect(diaryPageLabel(scan({ fileName: "Heft.pdf", firstPage: 10 }), { page: 2, x: 0, w: 1 })).toBe("T-01 · S. 12");
  });

  it("nimmt auf Doppelseiten erst die linke, dann die rechte Seite", () => {
    expect(sideOrder({ pageSpread: true }, { x: 0.6, w: 0.3 })).toBe(1);
    expect(sideOrder({ pageSpread: true }, { x: 0.1, w: 0.3 })).toBe(0);
    expect(sideOrder({ pageSpread: false }, { x: 0.6, w: 0.3 })).toBe(0);
  });

  it("setzt die Zählung über folgende Scans fort", () => {
    expect(
      continuePages({ firstPage: 1, pageSpread: true, pdfPages: 1 }, [
        { id: "b", pdfPages: 1 },
        { id: "c", pdfPages: 3 },
        { id: "d", pdfPages: 1 },
      ]),
    ).toEqual([
      { id: "b", firstPage: 3 },
      { id: "c", firstPage: 5 },
      { id: "d", firstPage: 11 },
    ]);
  });

  it("nimmt eine am Eintrag eingetragene Seitenzahl vor der Zählung des Scans", () => {
    const s = scan({ fileName: "Heft.pdf", pageSpread: true, firstPage: 1 });
    expect(diaryPageLabel(s, { page: 2, x: 0.6, w: 0.3, pageNo: 9 })).toBe("T-01 · S. 9");
    expect(regionPageNo(s, { page: 2, x: 0.6, w: 0.3 })).toBe(6);
    expect(regionPageNo(s, { page: 2, x: 0, w: 1 })).toBeNull(); // über beide Hälften
    expect(regionPageNo(scan(), { x: 0, w: 1 })).toBeNull();
  });

  it("schlägt die Seite vom vorigen Eintrag aus vor", () => {
    const a = { sourceId: "a", page: 0, x: 0, w: 0.4 };
    expect(suggestPageNo(null, { region: a, spread: false })).toBeNull();
    // gleicher Scan, gleiche Seite → gleiche Zahl
    expect(suggestPageNo({ region: a, pageNo: 4, spread: false }, { region: { ...a, x: 0.1 }, spread: false })).toBe(4);
    // Doppelseite: von links nach rechts → nächste
    expect(suggestPageNo({ region: a, pageNo: 4, spread: true }, { region: { ...a, x: 0.6 }, spread: true })).toBe(5);
    // nächste PDF-Seite oder nächster Scan → nächste
    expect(suggestPageNo({ region: a, pageNo: 4, spread: false }, { region: { ...a, page: 1 }, spread: false })).toBe(
      5,
    );
    expect(
      suggestPageNo({ region: a, pageNo: 4, spread: false }, { region: { ...a, sourceId: "b" }, spread: false }),
    ).toBe(5);
  });
});
