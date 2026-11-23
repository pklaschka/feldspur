/** Alle IANA-Zeitzonen, die der Browser kennt, für die Auswahl beim Einsatz und an der Geräteuhr. */
export const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();
