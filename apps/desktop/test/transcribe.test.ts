import { describe, expect, it } from "vite-plus/test";
import { leadingSpeaker, oneParagraph, splitLine, transcriberKey, waveWindow } from "../src/renderer/transcribe.ts";

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

  describe("Tastenkürzel unabhängig vom Fokus", () => {
    const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
      key: k,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      ...mods,
    });
    /** Ziel, das auf die genannten Selektoren passt (Teilzeichenkette genügt). */
    const on = (...matches: string[]) => ({
      closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null),
    });
    const body = on();
    const field = {};

    it("Esc, F7, F8, F9 gelten auch ohne Fokus im Textfeld", () => {
      expect(transcriberKey(key("Escape"), body, field)).toBe("toggle");
      expect(transcriberKey(key("F8"), on("button"), field)).toBe("back");
      expect(transcriberKey(key("F9"), on("textarea"), field)).toBe("forward");
      expect(transcriberKey(key("F7"), null, field)).toBe("slower");
      expect(transcriberKey(key("F7", { shiftKey: true }), null, field)).toBe("faster");
    });

    it("lässt offene Auswahllisten, Menüs und weitere Dialoge in Ruhe", () => {
      expect(transcriberKey(key("Escape"), on("listbox"), field)).toBeNull();
      expect(transcriberKey(key("F8"), on("menu"), field)).toBeNull();
      expect(transcriberKey(key("Escape"), on("alertdialog"), field)).toBeNull();
    });

    it("Tippen ohne Textfeld springt in die neue Zeile, Kürzel und Textfelder bleiben, wie sie sind", () => {
      expect(transcriberKey(key("a"), body, field)).toBe("type");
      expect(transcriberKey(key("a"), on("button"), field)).toBe("type");
      expect(transcriberKey(key(" "), body, field)).toBe("type");
      expect(transcriberKey(key(" "), on("button"), field)).toBeNull();
      expect(transcriberKey(key("a"), on("textarea"), field)).toBeNull();
      expect(transcriberKey(key("k", { ctrlKey: true }), body, field)).toBeNull();
      expect(transcriberKey(key("Enter", { ctrlKey: true }), on("textarea"), field)).toBeNull();
      expect(transcriberKey(key("a"), body, null)).toBeNull();
    });
  });

  it("erkennt ein Sprecherkürzel am Zeilenanfang schon beim Tippen", () => {
    expect(leadingSpeaker("B1: ")).toEqual({ speaker: "B1", rest: "" });
    expect(leadingSpeaker("H: Zwölf Jahre")).toEqual({ speaker: "H", rest: "Zwölf Jahre" });
    expect(leadingSpeaker("B1:")).toBeNull(); // noch kein Leerzeichen
    expect(leadingSpeaker("10: Uhr")).toBeNull(); // Zahl, kein Kürzel
    expect(leadingSpeaker("Interviewerin: ja")).toBeNull(); // zu lang für ein Kürzel
  });
});
