// @vitest-environment happy-dom
/**
 * Dialog der Schnellsuche (`apps/desktop/src/renderer/SearchDialog.tsx`): Screenreader erfahren den gewählten Treffer
 * und die Trefferzahl.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { SearchDialog } from "../src/renderer/SearchDialog.tsx";
import type { SessionView } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

// Erfundenes Beispiel, keine Forschungsdaten.
const view = {
  rows: [
    { id: "a1", label: "A1", deviceLabel: "Rekorder", fileName: "x.wav", personName: null, basis: null, startMs: 0 },
  ],
  transcript: Array.from({ length: 70 }, (_, i) => ({
    sourceId: "a1",
    atMs: i * 1000,
    clockMs: i * 1000,
    speaker: null,
    text: `Zeile ${i}`,
  })),
  notes: [],
  diary: [],
  episodes: [],
} as unknown as SessionView;

describe("SearchDialog", () => {
  it("meldet den gewählten Treffer per aria-activedescendant und nennt die Trefferzahl", () => {
    // Angenommen: eine Aufnahme mit 70 Zeilen, die Suche ist offen
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<SearchDialog view={view} open onOpenChange={() => {}} onPick={() => {}} />));
    const input = document.querySelector<HTMLInputElement>("input[role=combobox]")!;
    const type = (v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    // Wenn: „zeile“ gesucht wird
    type("zeile");
    // Dann: zeigt die Liste die ersten 60 und der erste Treffer ist gewählt
    const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options()).toHaveLength(60);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(document.querySelector("[role=listbox]")!.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]!.id);
    // Wenn: Pfeil nach unten gedrückt wird, dann ist der zweite gewählt und die Zahl wird genannt
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1]!.id);
    expect(options()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[role=status]")!.textContent).toBe(
      "Erste 60 von 70 Treffern. Suche eingrenzen, z. B. mit einer Uhrzeit.",
    );
    // Wenn: die Suche eingegrenzt wird, dann bleibt ein Treffer
    type("zeile 30");
    expect(document.querySelector("[role=status]")!.textContent).toBe("1 Treffer.");
    // Wenn: nichts passt, dann ist nichts gewählt und die Liste zu
    type("gibtsnicht");
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
    act(() => root.unmount());
  });
});
