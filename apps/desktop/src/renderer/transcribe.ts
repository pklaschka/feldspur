/** Reine Hilfen fürs Mitschreiben (ohne React), damit sie sich testen lassen. */

/** Ausschnitt der mitlaufenden Waveform: die Wiedergabestelle steht bei einem Viertel. */
export function waveWindow(posMs: number, spanMs: number, durationMs: number | null): { fromMs: number; toMs: number } {
  let from = Math.max(0, posMs - spanMs / 4);
  if (durationMs && from + spanMs > durationMs) from = Math.max(0, durationMs - spanMs);
  return { fromMs: Math.round(from), toMs: Math.round(from + spanMs) };
}

/** Typische Sprechgeschwindigkeit fürs Schätzen: etwa 15 Zeichen je Sekunde. */
const MS_PER_CHAR = 65;

/**
 * Zeile an der Schreibmarke teilen. Die Zeitmarke des zweiten Teils ist die aktuelle Stelle,
 * wenn sie zwischen dieser und der nächsten Zeile liegt (man hat gerade dort hingehört);
 * sonst wird sie nach Textanteil geschätzt.
 */
export function splitLine(
  line: { atMs: number; text: string },
  cursor: number,
  opts: { posMs: number; nextAtMs: number | null; durationMs: number | null },
): { first: string; second: string; secondAtMs: number } | null {
  const first = line.text.slice(0, cursor).trim();
  const second = line.text.slice(cursor).trim();
  if (!first || !second) return null;
  const end = opts.nextAtMs ?? opts.durationMs ?? line.atMs + line.text.length * MS_PER_CHAR;
  if (opts.posMs > line.atMs && opts.posMs < end) return { first, second, secondAtMs: Math.round(opts.posMs) };
  const share = cursor / line.text.length;
  const guess = line.atMs + Math.min(end - line.atMs, line.text.length * MS_PER_CHAR) * share;
  return { first, second, secondAtMs: Math.max(line.atMs + 1, Math.round(guess)) };
}

/** Zeilenumbrüche (z. B. beim Einfügen) zu Leerzeichen; eine Zeile bleibt ein Absatz. */
export function oneParagraph(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

export type TranscriberKey = "toggle" | "back" | "forward" | "slower" | "faster" | "type" | null;

/** Was beim Mitschreiben aus einem Tastendruck folgt; nur die Felder, die dafür zählen. */
export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

interface TargetLike {
  closest(selector: string): unknown;
}

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const PRESSABLE =
  "button, a[href], summary, [role='button'], [role='radio'], [role='switch'], [role='checkbox'], [role='tab']";
/** Aufgeklappte Auswahl oder Menü: dort gelten deren eigene Tasten (Esc schließt sie). */
const POPUP = "[role='listbox'], [role='menu']";
/** Ein weiterer Dialog über dem Mitschreiben (z. B. eine Rückfrage). */
const OTHER_DIALOG = "[role='dialog']:not([data-testid='transcriber']), [role='alertdialog']";

/**
 * Tastenkürzel des Mitschreibens, unabhängig davon, wo der Fokus gerade ist.
 * Esc, F7, F8 und F9 gelten überall im Dialog; ein Buchstabe ohne Fokus in einem Textfeld
 * springt in die neue Zeile. Strg/⌘+Enter bleibt beim Textfeld (Zeile teilen).
 */
export function transcriberKey(e: KeyLike, target: TargetLike | null, newLine: unknown): TranscriberKey {
  if (e.defaultPrevented || e.isComposing) return null;
  if (target?.closest(POPUP) || target?.closest(OTHER_DIALOG)) return null;
  switch (e.key) {
    case "Escape":
      return "toggle";
    case "F8":
      return "back";
    case "F9":
      return "forward";
    case "F7":
      return e.shiftKey ? "faster" : "slower";
  }
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || !newLine) return null;
  if (target?.closest(EDITABLE)) return null;
  // Leertaste auf einem Knopf drückt den Knopf.
  if (e.key === " " && target?.closest(PRESSABLE)) return null;
  return "type";
}

/**
 * Sprecherkürzel am Zeilenanfang („B1: …“), schon während des Tippens: sobald nach dem Doppelpunkt
 * ein Leerzeichen steht, wandert das Kürzel ins Sprecherfeld. Das Kürzel beginnt mit einem Buchstaben,
 * damit Uhrzeiten wie „10: …“ Text bleiben.
 */
export function leadingSpeaker(text: string): { speaker: string; rest: string } | null {
  const m = /^\s*(\p{L}[\p{L}\d]{0,5}):\s+(.*)$/su.exec(text);
  return m ? { speaker: m[1]!, rest: m[2]! } : null;
}
