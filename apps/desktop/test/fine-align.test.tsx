// @vitest-environment happy-dom
/**
 * Dialog „Feinabgleich“ (`apps/desktop/src/renderer/FineAlign.tsx`): Die Anzeige „… gegenüber vorher“ zählt ab der
 * Startlage des gewählten Paars, auch nach dem Wechsel der Aufnahme im offenen Dialog (Issue #259). Die Brücke zum
 * Hauptprozess ist nachgestellt und antwortet nicht; Spitzen und Ton braucht der Test nicht.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SessionView } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(window as unknown as { feldspur: object }).feldspur = new Proxy(
  {},
  { get: (_, name: string) => (name.startsWith("on") ? () => () => {} : () => new Promise(() => {})) },
);
const { FineAlign } = await import("../src/renderer/FineAlign.tsx");

// Erfundenes Beispiel, keine Forschungsdaten: drei Aufnahmen von je zehn Minuten, die 10 s und 22,34 s nach der
// ersten beginnen. Nur die Felder, die der Dialog liest.
const row = (id: string, label: string, startMs: number) => ({
  id,
  label,
  fileName: `${label}.wav`,
  kind: "audio",
  startMs,
  durationMs: 600_000,
});
const view = {
  rows: [row("a", "Rekorder", 0), row("b", "Kamera", 10_000), row("c", "Handy", 22_340)],
} as unknown as SessionView;

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
});

const shift = () => document.querySelector("[data-testid=fine-shift]")?.textContent ?? "";
const result = () => document.querySelector("[data-testid=fine-result]")?.textContent ?? "";
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
/** In einem der beiden Auswahlfelder eine andere Aufnahme wählen, mit der Tastatur. */
function choose(field: string, label: string) {
  key(document.querySelector(`button[aria-label^="${field}"]`)!, "Enter");
  const option = [...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.startsWith(label))!;
  key(option, "Enter");
}

describe("Feinabgleich: „gegenüber vorher“", () => {
  it("steht nach dem Wechsel der zweiten Aufnahme auf ±0, solange nichts verschoben wurde", () => {
    // Angenommen: der Feinabgleich für Rekorder und Kamera ist offen, an ihrer bisherigen Lage
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    unmount = () => root.unmount();
    act(() =>
      root.render(
        <FineAlign
          view={view}
          start={{ aSourceId: "a", aAtMs: 60_000, bSourceId: "b", bAtMs: 50_000 }}
          guard={(fn) => fn()}
          onView={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(result()).toBe("Rekorder bei 1:00.000 = Kamera bei 0:50.000");
    expect(shift()).toBe("±0,000 s gegenüber vorher");
    // Wenn: als zweite Aufnahme das Handy gewählt wird, das 12,34 s später beginnt als die Kamera
    choose("Zweite Aufnahme", "Handy");
    // Dann: liegt das neue Paar an seiner eigenen Startlage, und verschoben wurde noch nichts
    expect(result()).toBe("Rekorder bei 1:00.000 = Handy bei 0:37.660");
    expect(shift()).toBe("±0,000 s gegenüber vorher");
  });
});
