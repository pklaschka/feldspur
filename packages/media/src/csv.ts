/**
 * CSV für Excel und LibreOffice: Semikolon, Zeilenende CRLF, UTF-8 mit BOM, damit Umlaute richtig ankommen.
 * Gemeinsam für Begleitprotokoll (`packages/media/src/export.ts`) und Änderungsprotokoll
 * (`apps/desktop/src/main/changelog.ts`, eingebunden als `@feldspur/media/csv`).
 */

/**
 * Text, der mit = + - @ Tab oder Wagenrücklauf beginnt, hielten Excel und LibreOffice für eine Formel: aus „- lacht“
 * würde #NAME?, aus „=HYPERLINK(…)“ ein Link. Ein vorangestelltes Apostroph lässt ihn Text bleiben (Empfehlung von
 * OWASP zur CSV-Einschleusung). Gilt für jede Textzelle, auch für „+0:03“; Zahlen bleiben Zahlen.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (v: unknown): string => {
  const raw = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  const s = typeof v === "string" && FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Zeilen als CSV-Text; die erste Zeile sind üblicherweise die Spaltenköpfe. */
export function excelCsv(rows: readonly (readonly unknown[])[]): string {
  return `﻿${rows.map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}
