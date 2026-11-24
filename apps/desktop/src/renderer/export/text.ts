/**
 * Texte und Pfade für den Schritt „Ausgeben“: reine Hilfen ohne Oberfläche, genutzt von den Bausteinen in
 * `apps/desktop/src/renderer/export/`.
 */
import type { ExportProgress } from "../../shared/api.ts";

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** Übergeordneter Ordner eines Pfads (Windows oder sonst). */
export const parentDir = (p: string) => p.replace(/[\\/][^\\/]*[\\/]?$/, "") || p;
/**
 * Wozu eine Datei im Ausgabeordner da ist, erkannt am Namen. Der erste Treffer gilt, deshalb stehen die genauen
 * Namen (LIESMICH, Änderungsprotokoll) vor den allgemeinen Endungen (.html, .csv).
 */
export const FILE_ROLE: [RegExp, string][] = [
  [/\.mp4$/, "Montagevideo zum Zuordnen: Uhrzeit, Videos und Ton mit Herkunft, Montage-ID"],
  [/^LIESMICH\.html$/, "LIESMICH: was im Ordner liegt, wie zitiert wird, Tabelle für den Methodenteil"],
  [/^manifest-sha256\.txt$/, "Prüfsummenliste: SHA-256 jeder Datei im Ordner"],
  [/_Aenderungsprotokoll\.csv$/, "Änderungsprotokoll dieses Einsatzes: jede Änderung mit vorher und nachher"],
  [/\.html$/, "Viewer: Einsatztranskript synchron zum Video, im Browser öffnen"],
  [/\.docx$/, "Einsatztranskript für MAXQDA, mit Zeitmarken zum Video, Mitschrift und Bildern"],
  [/\.xlsx$/, "Dokumentvariablen für MAXQDA (Variablen › Dokumentvariablen importieren)"],
  [/\.csv$/, "Begleitprotokoll: Herkunft und Zeitnachweis jeder Datei"],
  [/\.fcpxml$/, "Schnittliste für DaVinci Resolve (Datei › Importieren › Timeline)"],
];

/** Pfad einer Datei im Ausgabeordner, mit dem Trenner, den der Ordner schon hat (Windows oder sonst). */
export const inDir = (dir: string, name: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;
const GB = 1024 ** 3;
/** „12,4 von 80,0 GB geprüft“; unter einem GB in MB. */
export function checkedText(p: ExportProgress): string {
  const big = p.total >= GB;
  const unit = big ? GB : 1024 ** 2;
  const n = (x: number) => (x / unit).toFixed(big ? 1 : 0).replace(".", ",");
  return `${n(p.done)} von ${n(p.total)} ${big ? "GB" : "MB"} geprüft`;
}
export const files = (n: number) => `${n} ${n === 1 ? "Datei" : "Dateien"}`;
/** „2026-09-14“ → „14.09.2026“. */
export const germanDate = (iso: string) => iso.split("-").reverse().join(".");
export const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
