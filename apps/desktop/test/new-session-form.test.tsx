// @vitest-environment happy-dom
/**
 * Formular „Neuer Einsatz“ auf der Startseite eines leeren Projekts und die Vorschau daneben
 * (`apps/desktop/src/renderer/app/start.tsx`).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { FirstSession, NewSessionForm } from "../src/renderer/app/start.tsx";

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

describe("FirstSession (Vorschau der Kopfzeile)", () => {
  const preview = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-testid=session-preview]")!;

  it("zeigt leere Felder als Platzhalter und die vier Schritte", () => {
    const host = render(<FirstSession onCreate={() => {}} />);
    const [, date, place] = [...host.querySelectorAll("input")];
    type(date!, "");
    type(place!, "");
    const head = preview(host).querySelector("[aria-hidden]")!;
    expect(head.textContent).toBe("TT.MM.TitelOrt");
    const steps = [...preview(host).querySelectorAll("li")].map((li) => li.textContent);
    expect(steps.map((t) => t?.split(" · ")[0]?.slice(1))).toEqual([
      "Einsammeln",
      "Abgleichen",
      "Durchsehen",
      "Ausgeben",
    ]);
  });

  it("schreibt Titel, Datum und Ort beim Tippen mit", () => {
    const host = render(<FirstSession onCreate={() => {}} />);
    const [title, date, place] = [...host.querySelectorAll("input")];
    // Wenn: die Felder ausgefüllt werden
    type(title!, "  Wochenmarkt Süd ");
    type(date!, "2026-09-14");
    type(place!, "Marktplatz");
    // Dann: steht der Einsatz so in der Vorschau, wie ihn die Kopfzeile gleich zeigt
    const head = preview(host).querySelector("[aria-hidden]")!;
    expect([...head.children].map((c) => c.textContent)).toEqual(["14.09.", "Wochenmarkt Süd", "Marktplatz"]);
  });
});
