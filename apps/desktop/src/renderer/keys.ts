import type { KeyboardEvent } from "react";

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
  isComposing: boolean;
  defaultPrevented: boolean;
}

export interface TargetLike {
  closest(selector: string): unknown;
}

/** Textfelder: dort gehören Buchstaben und Enter dem Feld. */
export const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
export const PRESSABLE =
  "button, a[href], summary, [role='button'], [role='radio'], [role='switch'], [role='checkbox'], [role='tab']";
/** Aufgeklappte Auswahl oder Menü: dort gelten deren eigene Tasten (Esc schließt sie). */
export const POPUP = "[role='listbox'], [role='menu']";
/** Ein Dialog oder eine Rückfrage. */
export const DIALOG = "[role='dialog'], [role='alertdialog']";

export type ReviewKey = "next" | "prev" | "confirm" | null;

/**
 * Tastenkürzel in Durchsehen: N nächste, Umschalt+N vorige zu prüfende Stelle, Strg/⌘+Enter „Lage passt“.
 * Nicht in Textfeldern, aufgeklappten Menüs oder bei offenem Dialog (`dialogOpen`).
 */
export function reviewKey(e: KeyLike, target: TargetLike | null, dialogOpen: boolean): ReviewKey {
  if (e.defaultPrevented || e.isComposing || dialogOpen) return null;
  if (target?.closest(EDITABLE) || target?.closest(POPUP) || target?.closest(DIALOG)) return null;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return "confirm";
  if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) return e.shiftKey ? "prev" : "next";
  return null;
}
