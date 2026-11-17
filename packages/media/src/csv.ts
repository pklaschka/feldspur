/**
 * CSV für Excel und LibreOffice: Semikolon, Zeilenende CRLF, UTF-8 mit BOM, damit Umlaute richtig ankommen.
 * Gemeinsam für Begleitprotokoll und Änderungsprotokoll.
 */

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Zeilen als CSV-Text; die erste Zeile sind üblicherweise die Spaltenköpfe. */
export function excelCsv(rows: readonly (readonly unknown[])[]): string {
  return `﻿${rows.map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}
