/**
 * Kleine Einstellungen der Oberfläche im localStorage (zuletzt gewählter Einsatz, Breiten, Schalter). Alles nur
 * Bequemlichkeit: Ohne Speicher (gesperrt, voll, beschädigt) gelten die Standardwerte, und eine Wahl gilt bis zum
 * Neustart. In die Projektdatei gehört davon nichts: Die Einstellungen gelten für diesen Rechner, nicht fürs Projekt.
 */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ohne Speicher gilt die Wahl bis zum Neustart
  }
}

/** Gespeichertes JSON-Objekt; alles andere (fehlt, kaputt, kein Objekt) ergibt ein leeres. */
export function readStoredObject(key: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(readStored(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
