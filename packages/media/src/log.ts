/**
 * Arbeitsprotokoll auf der Konsole (Issue #168): was Feldspur bei Prozessen mit Dateien im Einzelnen tut, etwa beim
 * Einsammeln, Prüfen und Ausgeben. Gedacht für die Entwicklung und für Fehlersuche, nicht für Forschende; die
 * Oberfläche zeigt weiter nur den Fortschritt.
 *
 * Eingeschaltet mit der Umgebungsvariable `FELDSPUR_LOG=1`; die App schaltet es beim Entwickeln (`vp dev`, nicht
 * gepackt) selbst ein, `FELDSPUR_LOG=0` schaltet es dort ab. Ausgabe auf stderr, eine Zeile je Schritt:
 *
 *   12:04:31.207 ausgabe   schreibt Einsatztranskript …/2026-09-14_Testmarkt.docx (48 kB)
 */

export type LogArea = "einsammeln" | "prüfen" | "ausgabe" | "montage" | "ffmpeg" | "sicherung" | "originale";

export type LogSink = (line: string) => void;

const fromEnv = (v: string | undefined) =>
  v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : null;

let enabled = fromEnv(process.env.FELDSPUR_LOG) ?? false;
let sink: LogSink = (line) => process.stderr.write(`${line}\n`);

/** Schaltet das Protokoll ein oder aus; eine gesetzte Umgebungsvariable `FELDSPUR_LOG` geht immer vor. */
export function setLogEnabled(on: boolean): void {
  enabled = fromEnv(process.env.FELDSPUR_LOG) ?? on;
}

export function logEnabled(): boolean {
  return enabled;
}

/** Leitet die Zeilen um (für Tests); gibt die vorige Senke zurück. */
export function setLogSink(next: LogSink): LogSink {
  const prev = sink;
  sink = next;
  return prev;
}

/** Breite der Bereichsspalte: längster Bereich („einsammeln“) und ein Leerzeichen. */
const AREA_WIDTH = 11;

/** Eine Zeile ins Protokoll: Uhrzeit, Bereich, Text. */
export function log(area: LogArea, message: string): void {
  if (!enabled) return;
  const now = new Date();
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  sink(`${t}.${String(now.getMilliseconds()).padStart(3, "0")} ${area.padEnd(AREA_WIDTH)}${message}`);
}

/** Dateigröße kurz und lesbar, wie sie im Protokoll steht. */
export function logSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Dauer seit `startMs` (aus `performance.now()`), z. B. „1,4 s“ oder „320 ms“. */
export function logSince(startMs: number): string {
  const ms = performance.now() - startMs;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Befehlszeile zum Nachstellen: Argumente mit Leerzeichen oder Sonderzeichen in Anführungszeichen. */
export function logCommand(tool: string, args: readonly string[]): string {
  const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const MAX = 400;
  return [tool, ...args.map((a) => (a.length > MAX ? `${quote(a.slice(0, MAX))}…` : quote(a)))].join(" ");
}
