/** Stand eines Einsatzes in Worten: offene Punkte und Gründe für „prüfen“. */
import type { SessionView } from "../../shared/api.ts";
import type { Step } from "../App.tsx";

/** Was als Nächstes zu tun ist, mit Sprungziel (Schritt und ggf. Quelle). */
export interface Todo {
  text: string;
  step: Step;
  sourceId?: string;
  action: string;
}

/** Offene Punkte eines Einsatzes, in der Reihenfolge der Schritte. Auch Ausgeben zeigt sie vor dem Knopf. */
export function todos(view: SessionView): Todo[] {
  const hasRef = view.devices.some((d) => d.isReference);
  const open = view.devices.filter((d) => !d.isReference && d.offsetMs === null);
  const out: Todo[] = [];
  if (!view.rows.length) out.push({ text: "Dateien des Einsatzes einsammeln.", step: "collect", action: "Einsammeln" });
  if (view.devices.length && !hasRef)
    out.push({ text: "Eine Referenzuhr wählen.", step: "sync", action: "Uhren abgleichen" });
  if (hasRef && open.length)
    out.push({
      text: `Abweichung für ${open.map((d) => d.label).join(", ")} klären.`,
      step: "sync",
      action: "Uhren abgleichen",
    });
  if (view.proposals.length)
    out.push({
      text: `${view.proposals.length} ${view.proposals.length === 1 ? "Vorschlag" : "Vorschläge"} aus der Tonspur prüfen.`,
      step: "sync",
      action: "Vorschläge ansehen",
    });
  const checks = view.rows
    .filter((r) => r.status === "check" && !r.partOf)
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  if (checks.length)
    out.push({
      text: `${checks.length} ${checks.length === 1 ? "Lage" : "Lagen"} prüfen.`,
      step: "review",
      sourceId: checks[0]!.id,
      action: "Erste prüfen",
    });
  const unplaced = view.rows.filter((r) => r.status === "unplaced" && !r.partOf);
  if (unplaced.length)
    out.push({
      text: `${unplaced.length} ${unplaced.length === 1 ? "Quelle hat" : "Quellen haben"} noch keine Uhrzeit.`,
      step: "review",
      sourceId: unplaced[0]!.id,
      action: "Ansehen",
    });
  if (view.avCount && !view.analyzedCount)
    out.push({
      text: view.session.episodes
        ? "Tonspuren abgleichen, damit Episoden und Stille erkannt werden."
        : "Tonspuren abgleichen, damit Klatscher und Stille erkannt werden.",
      step: "sync",
      action: "Uhren abgleichen",
    });
  const diaryOpen = view.rows.filter((r) => r.kind === "diary" && !r.diaryNote && !r.partOf);
  if (diaryOpen.length)
    out.push({
      text: `${diaryOpen.length} ${diaryOpen.length === 1 ? "Tagebuchseite" : "Tagebuchseiten"} ohne Randnotiz.`,
      step: "collect",
      sourceId: diaryOpen[0]!.id,
      action: "Erste ansehen",
    });
  return out;
}

/** Hinweis aus der Zeitbestimmung in einen verständlichen Satz übersetzen. */
export function checkReason(note: string, deviceLabel: string | undefined): string {
  if (note === "Uhr weicht ab?") return `Die Uhr von ${deviceLabel ?? "diesem Gerät"} ist noch nicht abgeglichen.`;
  if (note === "Keine Referenzuhr gewählt") return "Es ist noch keine Referenzuhr gewählt.";
  if (note === "nur Minute") return "Die Uhrzeit ist nur minutengenau bekannt.";
  if (note.startsWith("± ")) return `Die Uhrzeit ist nur ungefähr bekannt (${note}).`;
  if (note.startsWith("Widerspruch ")) return `Zeitbelege widersprechen sich (${note.slice(12)}).`;
  return note;
}
