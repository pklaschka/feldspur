// @vitest-environment happy-dom
/** Formular „Neuer Einsatz“ auf der Startseite eines leeren Projekts (`apps/desktop/src/renderer/app/start.tsx`). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { NewSessionForm } from "../src/renderer/app/start.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(el));
  return host;
}

function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("NewSessionForm (Hero)", () => {
  it("ist gleich offen, beschriftet und ohne Abbrechen", () => {
    const host = render(<NewSessionForm hero onCreate={() => {}} />);
    const labels = [...host.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).toEqual(["Titel", "Datum", "Ort"]);
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Einsatz anlegen"]);
  });

  it("legt mit Titel, Datum und Ort an", () => {
    const onCreate = vi.fn();
    const host = render(<NewSessionForm hero onCreate={onCreate} />);
    const [title, date, place] = [...host.querySelectorAll("input")];
    // Wenn: Titel (mit Leerraum), Datum und Ort eingetragen und abgeschickt werden
    type(title!, "  Wochenmarkt Südstadt ");
    type(date!, "2026-09-14");
    type(place!, "Marktplatz");
    act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    // Dann: wird der Einsatz mit bereinigtem Titel angelegt
    expect(onCreate).toHaveBeenCalledWith({ title: "Wochenmarkt Südstadt", date: "2026-09-14", place: "Marktplatz" });
  });

  it("legt ohne Titel nichts an", () => {
    const onCreate = vi.fn();
    const host = render(<NewSessionForm hero onCreate={onCreate} />);
    act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
