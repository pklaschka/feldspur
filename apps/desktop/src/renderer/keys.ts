import type { KeyboardEvent } from "react";

/**
 * Enter, mit dem jemand eine Eingabe abschließt. Wer mit einem Eingabesystem (IME, z. B. für Japanisch oder
 * Chinesisch) tippt, bestätigt mit Enter erst die Zeichen; dieses Enter zählt nicht.
 */
export function isEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing;
}
