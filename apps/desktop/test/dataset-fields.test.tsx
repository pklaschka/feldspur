// @vitest-environment happy-dom
/**
 * Felder der Angaben zum Datensatz (`apps/desktop/src/renderer/dataset/`): Personenliste, Schlagworte als Marken und
 * die Vorschläge für Lizenz und Zugang. Geprüft wird, welcher Text beim Aufrufer ankommt, denn gespeichert wird
 * weiter Text (eine Person je Zeile, Schlagworte mit Komma). Alle Namen sind erfunden.
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { DatasetInfo } from "@feldspur/core/model";
import { parsePeople } from "@feldspur/media/dataset";
import { DatasetFields } from "../src/renderer/dataset/DatasetFields.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount = () => {};
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
});

/** Felder zeigen; `current()` liefert, was zuletzt beim Aufrufer ankam, `reset` setzt die Angaben von außen. */
function open(
  initial: DatasetInfo = {},
  props: { placeholder?: Partial<Record<keyof DatasetInfo, string>>; researchers?: string[] } = {},
) {
  let latest = initial;
  let reset = (_d: DatasetInfo) => {};
  function Host() {
    const [value, setValue] = useState(initial);
    latest = value;
    reset = setValue;
    return <DatasetFields value={value} onChange={setValue} {...props} />;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<Host />));
  unmount = () => root.unmount();
  return { current: () => latest, reset: (d: DatasetInfo) => act(() => reset(d)) };
}

const group = (key: "creators" | "contributors") => document.querySelector<HTMLElement>(`[data-field=${key}]`)!;
const input = (within: Element, label: string) =>
  within.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const button = (within: Element, label: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;
/** Tippen wie im Browser: Wert setzen und das Ereignis auslösen, auf das React hört. */
function type(el: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const leave = (el: Element) => act(() => void el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
const click = (el: HTMLElement) => act(() => el.click());

describe("Personenliste", () => {
  it("zeigt gespeicherte Personen als Zeilen mit Name und ORCID iD", () => {
    open({ creators: "Mara Beispiel, 0000-0002-1825-0097\nJo Muster" });
    const g = group("creators");
    expect(input(g, "Person 1: Name").value).toBe("Mara Beispiel");
    expect(input(g, "Person 1: ORCID iD").value).toBe("0000-0002-1825-0097");
    expect(input(g, "Person 2: Name").value).toBe("Jo Muster");
    expect(input(g, "Person 2: ORCID iD").value).toBe("");
    // Die Gruppe trägt die Beschriftung des Felds, damit der Rundgang sie unter „Urheber*innen“ findet.
    expect(document.getElementById(g.getAttribute("aria-labelledby")!)!.textContent).toBe("Urheber*innen");
  });

  it("speichert eine Person je Zeile und lässt leere Zeilen weg", () => {
    // Angenommen: noch niemand eingetragen, eine leere Zeile steht zum Lostippen da
    const { current } = open();
    const g = group("creators");
    // Wenn: zwei Personen eingetragen werden und dazwischen eine Zeile leer bleibt
    type(input(g, "Person 1: Name"), "Mara Beispiel");
    type(input(g, "Person 1: ORCID iD"), "0000-0002-1825-0097");
    click(button(g, "Person hinzufügen"));
    click(button(g, "Person hinzufügen"));
    expect(g.querySelectorAll("[data-person]")).toHaveLength(2);
    key(input(g, "Person 2: Name"), "Enter");
    expect(g.querySelectorAll("[data-person]")).toHaveLength(2);
    type(input(g, "Person 2: Name"), "Platzhalter");
    key(input(g, "Person 2: Name"), "Enter");
    type(input(g, "Person 3: Name"), "Jo Muster");
    type(input(g, "Person 2: Name"), "");
    // Dann: kommt der Text in der Form an, die parsePeople liest
    expect(current().creators).toBe("Mara Beispiel, 0000-0002-1825-0097\nJo Muster");
    expect(parsePeople(current().creators)).toEqual([
      { name: "Mara Beispiel", orcid: "0000-0002-1825-0097" },
      { name: "Jo Muster" },
    ]);
    // Wenn: die erste Person entfernt wird, dann bleibt die andere
    click(button(g, "Mara Beispiel entfernen"));
    expect(current().creators).toBe("Jo Muster");
  });

  it("meldet eine unvollständige ORCID iD beim Verlassen der Zeile und übernimmt sie nicht", () => {
    const { current } = open({ creators: "Mara Beispiel" });
    const g = group("creators");
    const orcid = input(g, "Person 1: ORCID iD");
    // Wenn: eine zu kurze iD getippt und die Zeile verlassen wird
    act(() => orcid.focus());
    type(orcid, "0000-0002-1825");
    expect(g.textContent).not.toContain("16 Zeichen");
    leave(orcid);
    // Dann: steht die Meldung am Feld, und im Text bleibt nur der Name
    expect(orcid.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(orcid.getAttribute("aria-describedby")!)!.textContent).toContain("16 Zeichen");
    expect(current().creators).toBe("Mara Beispiel");
    // Wenn: die iD als Adresse ohne Bindestriche vervollständigt wird, dann steht sie in der üblichen Schreibweise da
    act(() => orcid.focus());
    type(orcid, "https://orcid.org/000000021825009 7");
    leave(orcid);
    expect(orcid.value).toBe("0000-0002-1825-0097");
    expect(orcid.getAttribute("aria-invalid")).toBeNull();
    expect(current().creators).toBe("Mara Beispiel, 0000-0002-1825-0097");
  });

  it("weist auf eine falsche Prüfziffer hin, übernimmt die iD aber", () => {
    const { current } = open({ creators: "Mara Beispiel" });
    const orcid = input(group("creators"), "Person 1: ORCID iD");
    type(orcid, "0000-0002-1852-0097");
    leave(orcid);
    expect(group("creators").textContent).toContain("Prüfziffer");
    expect(orcid.getAttribute("aria-invalid")).toBeNull();
    expect(current().creators).toBe("Mara Beispiel, 0000-0002-1852-0097");
  });

  it("zieht eine ORCID iD aus dem Namensfeld ins eigene Feld", () => {
    const { current } = open();
    const g = group("contributors");
    type(input(g, "Person 1: Name"), "Jo Muster, 0000-0002-1825-0097");
    leave(input(g, "Person 1: Name"));
    expect(input(g, "Person 1: Name").value).toBe("Jo Muster");
    expect(input(g, "Person 1: ORCID iD").value).toBe("0000-0002-1825-0097");
    expect(current().contributors).toBe("Jo Muster, 0000-0002-1825-0097");
  });

  it("bietet die Forschenden an den Geräten zum Übernehmen an", () => {
    const { current } = open({}, { researchers: ["Mara Beispiel", "Jo Muster"] });
    const g = group("creators");
    expect(g.textContent).toContain("Ohne Eintrag gelten die Forschenden an den Geräten des Einsatzes.");
    // Wenn: beide übernommen werden, dann stehen sie als Zeilen da und die Vorschläge sind verbraucht
    click(button(g, "Mara Beispiel"));
    click(button(g, "Jo Muster"));
    expect(current().creators).toBe("Mara Beispiel\nJo Muster");
    expect(g.querySelectorAll("[data-person]")).toHaveLength(2);
    expect(button(g, "Jo Muster")).toBeUndefined();
    expect(g.textContent).not.toContain("Ohne Eintrag");
    // Bei den Mitwirkenden gibt es diese Vorschläge nicht.
    expect(button(group("contributors"), "Mara Beispiel")).toBeUndefined();
  });

  it("zeigt in den Einsatzdaten die Personen des Projekts statt leerer Zeilen", () => {
    const { current } = open({}, { placeholder: { creators: "Mara Beispiel, 0000-0002-1825-0097\nJo Muster" } });
    const g = group("creators");
    expect(g.querySelector("[data-inherited]")!.textContent).toBe("Wie im Projekt: Mara Beispiel, Jo Muster");
    expect(g.querySelectorAll("[data-person]")).toHaveLength(0);
    // Wenn: für den Einsatz jemand eingetragen wird, dann gilt nur noch dieser Eintrag
    click(button(g, "Person hinzufügen"));
    type(input(g, "Person 1: Name"), "Kim Beispiel");
    expect(current().creators).toBe("Kim Beispiel");
    expect(g.querySelector("[data-inherited]")).toBeNull();
    // Wenn: die Zeile wieder entfernt wird, dann gilt wieder das Projekt
    click(button(g, "Kim Beispiel entfernen"));
    expect(current().creators).toBe("");
    expect(g.querySelector("[data-inherited]")).not.toBeNull();
  });

  it("beginnt neu, wenn die Angaben von außen ersetzt werden (Verwerfen)", () => {
    const { reset } = open({ creators: "Mara Beispiel" });
    type(input(group("creators"), "Person 1: Name"), "Jemand anderes");
    reset({ creators: "Mara Beispiel" });
    expect(input(group("creators"), "Person 1: Name").value).toBe("Mara Beispiel");
  });
});

describe("Schlagworte", () => {
  const field = () => document.querySelector<HTMLInputElement>("[data-field=keywords]")!;
  const marks = () => [...document.querySelectorAll("[data-keyword]")].map((m) => m.getAttribute("data-keyword"));

  it("macht aus Enter und Komma Marken und speichert Text mit Kommas", () => {
    const { current } = open({ keywords: "Markt" });
    expect(marks()).toEqual(["Markt"]);
    // Wenn: ein Wort mit Enter, eines mit Komma abgeschlossen und eines nur getippt wird
    type(field(), "Stadtteil");
    key(field(), "Enter");
    type(field(), "Alltag,");
    type(field(), "Hand");
    // Dann: sind die abgeschlossenen Marken, und auch das Getippte zählt schon mit
    expect(marks()).toEqual(["Markt", "Stadtteil", "Alltag"]);
    expect(field().value).toBe("Hand");
    expect(current().keywords).toBe("Markt, Stadtteil, Alltag, Hand");
    // Wenn: das Feld verlassen wird, dann wird auch das Getippte zur Marke
    leave(field());
    expect(marks()).toEqual(["Markt", "Stadtteil", "Alltag", "Hand"]);
    expect(field().value).toBe("");
  });

  it("nimmt Doppelte nicht zweimal und teilt Eingefügtes an Komma und Semikolon", () => {
    const { current } = open({ keywords: "Markt" });
    type(field(), "Handel; Markt, Stadt");
    expect(marks()).toEqual(["Markt", "Handel"]);
    expect(field().value).toBe("Stadt");
    expect(current().keywords).toBe("Markt, Handel, Stadt");
  });

  it("entfernt mit der Rücktaste das letzte und mit dem Kreuz ein bestimmtes Schlagwort", () => {
    const { current } = open({ keywords: "Markt, Stadtteil, Alltag" });
    key(field(), "Backspace");
    expect(current().keywords).toBe("Markt, Stadtteil");
    click(button(document.body, "Schlagwort Markt entfernen"));
    expect(current().keywords).toBe("Stadtteil");
    expect(marks()).toEqual(["Stadtteil"]);
  });

  it("zeigt in den Einsatzdaten die Schlagworte des Projekts als Vorgabe", () => {
    open({}, { placeholder: { keywords: "Markt, Alltag" } });
    expect(field().placeholder).toBe("Markt, Alltag");
  });
});

describe("Vorschläge für Lizenz und Zugang", () => {
  const field = (k: string) => document.querySelector<HTMLInputElement>(`[data-field=${k}]`)!;

  it("trägt einen Vorschlag mit einem Klick ein und nimmt ihn mit dem zweiten wieder heraus", () => {
    const { current } = open();
    const chip = () => button(document.body, "CC BY-NC 4.0");
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    click(chip());
    expect(current().license).toBe("CC BY-NC 4.0");
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    click(chip());
    expect(current().license).toBe("");
    // Freie Eingabe bleibt möglich.
    type(field("license"), "https://example.org/lizenz");
    expect(current().license).toBe("https://example.org/lizenz");
  });

  it("wählt beim Zugang nichts vor und lässt „Gesperrt bis …“ weiterschreiben", () => {
    const { current } = open();
    expect(field("access").value).toBe("");
    const access = document.querySelector('[aria-label="Vorschläge für Zugang"]')!;
    expect(access.querySelector("[aria-pressed=true]")).toBeNull();
    click(button(access, "Gesperrt bis …"));
    expect(current().access).toBe("Gesperrt bis ");
    expect(document.activeElement).toBe(field("access"));
  });
});
