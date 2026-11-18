/**
 * Texte rund um Widersprüche zwischen Zeitbelegen, für Hauptprozess (Protokoll) und Oberfläche gleich.
 * Ein Zustand, ein Wort: „Widerspruch“, „deutlich“, „stark“, „Rundung“, „entschieden“.
 */
import { formatDuration } from "@feldspur/core/time";
import type { ConflictSeverity, EvidenceComparison } from "@feldspur/core/resolve";

/** Art eines Belegs als Subjekt im Satz, mit passendem Verb („Metadaten gelten“, „Dateiname gilt“). */
const KIND_SUBJECT: Record<string, [string, string]> = {
  metadata: ["Metadaten", "gelten"],
  filename: ["Dateiname", "gilt"],
  spoken: ["Angesagte Uhrzeit", "gilt"],
  anchor: ["Anker", "gilt"],
  manual: ["Handeingabe", "gilt"],
  checked: ["Bisherige Entscheidung", "gilt"],
};
export const kindName = (kind: string) => KIND_SUBJECT[kind]?.[0] ?? kind;
/** Verb passend zur Art: „Metadaten widersprechen“, „Dateiname widerspricht“. */
export const kindVerb = (kind: string, singular: string, plural: string) =>
  KIND_SUBJECT[kind]?.[1] === "gelten" ? plural : singular;
export const kindHolds = (kind: string) => (KIND_SUBJECT[kind] ? KIND_SUBJECT[kind].join(" ") : `${kind} gilt`);

export const SEVERITY_TEXT: Record<ConflictSeverity, string> = { clear: "deutlich", strong: "stark" };

/** Abstand mit Vorzeichen für Abzeichen („+13:23“, „−1 Tag 2:00:00“). */
export const signed = (ms: number) => formatDuration(ms, { sign: true });
/** Abstand ohne Vorzeichen für Sätze („liegen 13:23 auseinander“). */
export const plain = (ms: number) => formatDuration(Math.abs(ms));

/** Kurzes Urteil für das Abzeichen eines Belegs. */
export function verdictBadge(c: EvidenceComparison, decided = false): string {
  if (!c.enabled) return "abgeschaltet";
  switch (c.verdict) {
    case "chosen":
      return "verwendet";
    case "agrees":
      return c.convertedFromUtc ? "passt · aus UTC umgerechnet" : "passt";
    case "rounding":
      return `Rundung (${signed(c.differenceMs)})`;
    case "unsynced":
      return "Uhr nicht abgeglichen";
    case "conflict":
      return `widerspricht ${signed(c.differenceMs)}${decided ? " · entschieden" : ""}`;
  }
}

/** Erklärung zum Abzeichen (Tooltip): warum etwas kein Widerspruch ist. */
export function verdictHelp(c: EvidenceComparison): string {
  switch (c.verdict) {
    case "agrees":
      return "Liegt im Rahmen der Genauigkeit beider Angaben.";
    case "rounding":
      return "Knapp über der Genauigkeit, typisch für Rundung (z. B. ein Dateiname, der nur die Minute nennt). Kein Widerspruch.";
    case "unsynced":
      return "Die Geräteuhr ist noch nicht abgeglichen. Ein Abstand zur echten Zeit ist dann zu erwarten, kein Widerspruch.";
    case "conflict":
      return `Weiter entfernt, als die Genauigkeit beider Angaben erklärt (erlaubt ± ${plain(c.allowedMs)}).`;
    default:
      return "";
  }
}

/** „1 Stunde“, „2 Stunden“, „5:30 Stunden“ für glatte Versätze. */
export function hoursText(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000 / 15) * 15;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return h === 1 ? "1 Stunde" : `${h} Stunden`;
  return `${h}:${String(m).padStart(2, "0")} Stunden`;
}
