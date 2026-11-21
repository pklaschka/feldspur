import { describe, expect, it } from "vite-plus/test";
import { leadingSpeaker, oneParagraph, splitLine, transcriberKey, waveWindow } from "../src/renderer/transcribe.ts";

describe("Mitschreiben: Hilfen", () => {
  it.each`
    stelleMs   | breiteMs  | ausschnitt                            | fall
    ${0}       | ${30_000} | ${{ fromMs: 0, toMs: 30_000 }}        | ${"am Anfang"}
    ${100_000} | ${40_000} | ${{ fromMs: 90_000, toMs: 130_000 }}  | ${"läuft mit, Stelle im ersten Viertel"}
    ${595_000} | ${30_000} | ${{ fromMs: 570_000, toMs: 600_000 }} | ${"am Ende der 10-Min.-Datei"}
  `("Waveform-Ausschnitt bei $stelleMs ms: $fall", ({ stelleMs, breiteMs, ausschnitt }) => {
    expect(waveWindow(stelleMs, breiteMs, 600_000)).toEqual(ausschnitt);
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
    // Angenommen: eine Zeile ab 10 s, die nächste bei 30 s, die Wiedergabe steht woanders
    const line = { atMs: 10_000, text: "a".repeat(100) };
    const r = splitLine(line, 50, { posMs: 0, nextAtMs: 30_000, durationMs: 60_000 })!;
    // Dann: liegt die geschätzte Marke zwischen beiden Zeilen
    expect(r.secondAtMs).toBeGreaterThan(10_000);
    expect(r.secondAtMs).toBeLessThan(30_000);
  });

  it.each`
    text        | marke | fall
    ${"Satz"}   | ${0}  | ${"Marke am Anfang"}
    ${"Satz  "} | ${4}  | ${"nach der Marke nur Leerraum"}
  `("teilt nicht, wenn ein Teil leer wäre: $fall", ({ text, marke }) => {
    expect(splitLine({ atMs: 0, text }, marke, { posMs: 0, nextAtMs: null, durationMs: null })).toBeNull();
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

    it.each`
      taste       | mit                   | ziel                 | aktion       | fall
      ${"Escape"} | ${{}}                 | ${body}              | ${"toggle"}  | ${"Esc ohne Fokus: Wiedergabe an/aus"}
      ${"F8"}     | ${{}}                 | ${on("button")}      | ${"back"}    | ${"F8 auf einem Knopf: zurück"}
      ${"F9"}     | ${{}}                 | ${on("textarea")}    | ${"forward"} | ${"F9 im Textfeld: vor"}
      ${"F7"}     | ${{}}                 | ${null}              | ${"slower"}  | ${"F7: langsamer"}
      ${"F7"}     | ${{ shiftKey: true }} | ${null}              | ${"faster"}  | ${"Umschalt+F7: schneller"}
      ${"Escape"} | ${{}}                 | ${on("listbox")}     | ${null}      | ${"Esc in offener Auswahlliste bleibt dort"}
      ${"F8"}     | ${{}}                 | ${on("menu")}        | ${null}      | ${"F8 im Menü bleibt dort"}
      ${"Escape"} | ${{}}                 | ${on("alertdialog")} | ${null}      | ${"Esc in einer Rückfrage bleibt dort"}
      ${"a"}      | ${{}}                 | ${body}              | ${"type"}    | ${"Tippen ohne Fokus springt in die neue Zeile"}
      ${"a"}      | ${{}}                 | ${on("button")}      | ${"type"}    | ${"Tippen auf einem Knopf ebenso"}
      ${" "}      | ${{}}                 | ${body}              | ${"type"}    | ${"Leertaste ohne Fokus ebenso"}
      ${" "}      | ${{}}                 | ${on("button")}      | ${null}      | ${"Leertaste auf einem Knopf drückt ihn"}
      ${"a"}      | ${{}}                 | ${on("textarea")}    | ${null}      | ${"Tippen im Textfeld bleibt dort"}
      ${"k"}      | ${{ ctrlKey: true }}  | ${body}              | ${null}      | ${"Strg+K bleibt Kürzel"}
      ${"Enter"}  | ${{ ctrlKey: true }}  | ${on("textarea")}    | ${null}      | ${"Strg+Enter im Textfeld bleibt dort"}
    `("$fall", ({ taste, mit, ziel, aktion }) => {
      expect(transcriberKey(key(taste, mit), ziel, field)).toBe(aktion);
    });

    it("ohne Zeilenfeld wird Tippen nicht umgeleitet", () => {
      expect(transcriberKey(key("a"), body, null)).toBeNull();
    });
  });

  it.each`
    anfang                 | kuerzel                                  | fall
    ${"B1: "}              | ${{ speaker: "B1", rest: "" }}           | ${"Kürzel mit Leerzeichen"}
    ${"H: Zwölf Jahre"}    | ${{ speaker: "H", rest: "Zwölf Jahre" }} | ${"Kürzel und Text"}
    ${"B1:"}               | ${null}                                  | ${"noch kein Leerzeichen"}
    ${"10: Uhr"}           | ${null}                                  | ${"Zahl, kein Kürzel"}
    ${"Interviewerin: ja"} | ${null}                                  | ${"zu lang für ein Kürzel"}
  `("Sprecherkürzel beim Tippen von „$anfang“: $fall", ({ anfang, kuerzel }) => {
    expect(leadingSpeaker(anfang)).toEqual(kuerzel);
  });
});
