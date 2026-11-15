import { describe, expect, it } from "vite-plus/test";
import { oneParagraph, splitLine, waveWindow } from "../src/renderer/transcribe.ts";

describe("Mitschreiben: Hilfen", () => {
  it("Waveform-Ausschnitt läuft mit und bleibt in der Datei", () => {
    expect(waveWindow(0, 30_000, 600_000)).toEqual({ fromMs: 0, toMs: 30_000 });
    expect(waveWindow(100_000, 40_000, 600_000)).toEqual({ fromMs: 90_000, toMs: 130_000 });
    expect(waveWindow(595_000, 30_000, 600_000)).toEqual({ fromMs: 570_000, toMs: 600_000 });
  });

  it("teilt eine Zeile an der Schreibmarke und nimmt die aktuelle Stelle, wenn sie passt", () => {
    const line = { atMs: 10_000, text: "Erster Satz. Zweiter Satz." };
    expect(splitLine(line, 12, { posMs: 14_000, nextAtMs: 20_000, durationMs: 60_000 })).toEqual({
      first: "Erster Satz.",
      second: "Zweiter Satz.",
      secondAtMs: 14_000,
    });
  });

  it("schätzt die Zeitmarke, wenn die Stelle außerhalb liegt", () => {
    const line = { atMs: 10_000, text: "a".repeat(100) };
    const r = splitLine(line, 50, { posMs: 0, nextAtMs: 30_000, durationMs: 60_000 })!;
    expect(r.secondAtMs).toBeGreaterThan(10_000);
    expect(r.secondAtMs).toBeLessThan(30_000);
  });

  it("teilt nicht, wenn ein Teil leer wäre", () => {
    expect(splitLine({ atMs: 0, text: "Satz" }, 0, { posMs: 0, nextAtMs: null, durationMs: null })).toBeNull();
    expect(splitLine({ atMs: 0, text: "Satz  " }, 4, { posMs: 0, nextAtMs: null, durationMs: null })).toBeNull();
  });

  it("macht aus eingefügten Zeilenumbrüchen Leerzeichen", () => {
    expect(oneParagraph("eins\n zwei\r\n\ndrei")).toBe("eins zwei drei");
  });
});
