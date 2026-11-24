/**
 * Tastatur: was ein Tastendruck in der Oberfläche bedeutet. Die Entscheidung steht hier als reine Funktion ohne
 * React und DOM, damit sie sich testen lässt (`apps/desktop/test/keys.test.ts`); die Ansichten hängen nur den
 * Listener an. Die Kürzel des Mitschreibens stehen in `transcribe.ts` und nutzen die Selektoren von hier.
 */
import type { KeyboardEvent } from "react";

/** Läuft die App unter macOS? Nur für die Beschriftung von Kürzeln („⌘Z“ statt „Strg+Z“). */
export const isMac = (globalThis.navigator?.platform ?? "").toLowerCase().includes("mac");

/**
 * Enter, mit dem jemand eine Eingabe abschließt. Wer mit einem Eingabesystem (IME, z. B. für Japanisch oder
 * Chinesisch) tippt, bestätigt mit Enter erst die Zeichen; dieses Enter zählt nicht.
 */
export function isEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing;
}

/** Was aus einem Tastendruck folgt; nur die Felder, die dafür zählen (ohne React, damit es sich testen lässt). */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Taste wird gehalten (automatische Wiederholung). */
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/** Wo der Tastendruck ankam: vom Element zählt nur `closest`, so kommt der Test ohne DOM aus. */
export interface TargetLike {
  closest(selector: string): unknown;
}

/** Textfelder: dort gehören Buchstaben und Enter dem Feld. */
export const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
/** Knöpfe und Ähnliches: dort drückt die Leertaste das Element und ist kein getippter Buchstabe. */
export const PRESSABLE =
  "button, a[href], summary, [role='button'], [role='radio'], [role='switch'], [role='checkbox'], [role='tab']";
/** Aufgeklappte Auswahl oder Menü: dort gelten deren eigene Tasten (Esc schließt sie). */
export const POPUP = "[role='listbox'], [role='menu']";
/** Ein Dialog oder eine Rückfrage. */
export const DIALOG = "[role='dialog'], [role='alertdialog']";

export type ReviewKey = "next" | "prev" | "confirm" | null;

/**
 * Tastenkürzel in Durchsehen: N nächste, Umschalt+N vorige zu prüfende Stelle, Strg/⌘+Enter „Lage passt“.
 * Nicht in Textfeldern, aufgeklappten Menüs oder bei offenem Dialog (`dialogOpen`). Gehaltenes Strg/⌘+Enter
 * bestätigt nur einmal: danach springt die Auswahl weiter, jede Wiederholung bestätigte sonst ungesehen die
 * nächste Stelle. N darf wiederholen.
 */
export function reviewKey(e: KeyLike, target: TargetLike | null, dialogOpen: boolean): ReviewKey {
  if (e.defaultPrevented || e.isComposing || dialogOpen) return null;
  if (target?.closest(EDITABLE) || target?.closest(POPUP) || target?.closest(DIALOG)) return null;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return e.repeat ? null : "confirm";
  if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) return e.shiftKey ? "prev" : "next";
  return null;
}
