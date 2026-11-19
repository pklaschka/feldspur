/**
 * Dauern und Stellen ohne Doppelpunkt tippen: „320“ ist 3:20, „10320“ ist 1:03:20. Die Ziffern füllen von rechts
 * Sekunden, Minuten, Stunden, je zwei Stellen. Ein oder zwei Ziffern sind Sekunden („45“ = 0:45). Gilt für die
 * Stelle in einer Aufnahme und für die Uhrabweichung, nicht für Uhrzeiten (die füllen von links, siehe maskClock).
 */

/** Nur Ziffern: Millisekunden. Anderes: undefined (dann gilt die Schreibweise mit Doppelpunkt). Unmöglich: null. */
export function digitsDurationMs(text: string): number | null | undefined {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return undefined;
  if (t.length <= 2) return Number(t) * 1000;
  const s = Number(t.slice(-2));
  const m = Number(t.slice(-4, -2));
  const h = t.length > 4 ? Number(t.slice(0, -4)) : 0;
  if (s > 59 || (t.length > 4 && m > 59)) return null;
  return ((h * 60 + m) * 60 + s) * 1000;
}

/** Nur Ziffern als „m:ss“ bzw. „h:mm:ss“ schreiben („320“ → „3:20“); sonst unverändert. */
export function digitsDurationText(text: string): string {
  const t = text.trim();
  if (!/^\d{3,}$/.test(t) || digitsDurationMs(t) === null) return text;
  const s = t.slice(-2);
  const m = t.slice(-4, -2);
  return t.length > 4 ? `${Number(t.slice(0, -4))}:${m}:${s}` : `${Number(m)}:${s}`;
}
