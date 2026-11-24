/**
 * Stand eines Einsatzes in Worten: offene Punkte, Reihenfolge der Prüfliste und Gründe für „prüfen“. Reine
 * Funktionen über der Ansicht des Einsatzes (`SessionView`), geprüft in `apps/desktop/test/inspector-status.test.ts`.
 * Genutzt von Detailleiste, Prüfliste (`apps/desktop/src/renderer/review/CheckList.tsx`), „Durchsehen“, „Ausgeben“
 * und `apps/desktop/src/renderer/app/SessionPane.tsx`.
 */
import type { SessionView, SourceRow } from "../../shared/api.ts";
import type { Step } from "../App.tsx";

/** Was als Nächstes zu tun ist, mit Sprungziel (Schritt und ggf. Quelle). */
export interface Todo {
  text: string;
  step: Step;
  sourceId?: string;
  action: string;
}

/** Offener oder neu zu prüfender Widerspruch. */
export const openConflict = (r: SourceRow) => r.conflict.state === "open" || r.conflict.state === "stale";

/** Rang in der Prüfliste: starke Widersprüche, deutliche, dann übrige unsichere Lagen. */
function rank(r: SourceRow): number {
  if (openConflict(r)) return r.conflict.severity === "strong" ? 0 : 1;
  return 2;
}

/** Eine Gruppe (ganze Kamera mit demselben Widerspruch) zählt als eine Stelle: nur ihre erste Datei bleibt. */
export function asPlaces<T extends { id: string }>(rows: T[], groups: { sourceIds: string[] }[]): T[] {
  const grouped = new Set(groups.flatMap((g) => g.sourceIds.slice(1)));
  return rows.filter((r) => !grouped.has(r.id));
}

/** Die Stelle, zu der eine Quelle gehört: bei einer Gruppe deren erste Datei. */
const placeOf = (id: string, groups: { sourceIds: string[] }[]) =>
  groups.find((g) => g.sourceIds.includes(id))?.sourceIds[0] ?? id;

/**
 * Nächste (`dir` 1) oder vorige (-1) zu prüfende Stelle ab der gewählten Quelle, ringsum. Ein Gruppenmitglied
 * zählt als seine Stelle; ist nichts davon gewählt, geht es bei der ersten (bzw. letzten) Stelle los.
 */
export function stepPlace<T extends { id: string }>(
  queue: T[],
  groups: { sourceIds: string[] }[],
  selected: string | null,
  dir: 1 | -1,
): T | undefined {
  const places = asPlaces(queue, groups);
  if (!places.length) return undefined;
  const at = selected === null ? -1 : places.findIndex((r) => r.id === placeOf(selected, groups));
  if (at < 0) return dir === 1 ? places[0] : places.at(-1);
  return places[(at + dir + places.length) % places.length];
}

/** Die übrigen Stellen nach der Stelle von `id`, ringsum: vorab bestimmt, wohin es nach „Lage passt“ geht. */
export function placesAfter(queue: { id: string }[], groups: { sourceIds: string[] }[], id: string): string[] {
  const own = placeOf(id, groups);
  const ids = asPlaces(queue, groups).map((r) => r.id);
  const at = ids.indexOf(own);
  return (at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at)]).filter((x) => x !== own);
}

/** Erste Stelle aus `order`, die (nach dem Speichern) noch zu prüfen ist. */
export function firstOpen<T extends { id: string }>(
  order: string[],
  queue: T[],
  groups: { sourceIds: string[] }[],
): T | undefined {
  const open = new Map(asPlaces(queue, groups).map((r) => [r.id, r]));
  for (const id of order) {
    const r = open.get(id);
    if (r) return r;
  }
  return undefined;
}

/** „Lage passt“ steht für diese Quelle zur Wahl (wie im Prüfkasten der Seitenleiste). */
export function canConfirm(r: SourceRow): boolean {
  if (r.evidence.some((e) => e.kind === "checked" && e.chosen)) return false;
  return r.status === "check" && r.startMs !== null && r.kind !== "diary" && !r.partOf && r.conflict.state === "none";
}

/**
 * Was zu prüfen ist, in der Reihenfolge der Prüfliste: stärkste Widersprüche zuerst (innerhalb eines Grades
 * die größte Abweichung), danach übrige unsichere Lagen nach Uhrzeit. „Nächste →“ folgt dieser Reihenfolge
 * (über die Stellen, siehe `stepPlace`).
 */
export function checkQueue(rows: SourceRow[]): SourceRow[] {
  return rows
    .filter((r) => r.status === "check" && !r.partOf && (r.startMs !== null || r.diaryWindow))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) < 2 ? Math.abs(b.conflict.worstMs) - Math.abs(a.conflict.worstMs) : 0) ||
        (a.startMs ?? a.diaryWindow?.toMs ?? 0) - (b.startMs ?? b.diaryWindow?.toMs ?? 0) ||
        a.label.localeCompare(b.label),
    );
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
  const queue = checkQueue(view.rows);
  const conflicted = queue.filter(openConflict);
  if (conflicted.length) {
    const places = asPlaces(conflicted, view.conflictGroups);
    const strong = places.filter((r) => r.conflict.severity === "strong").length;
    out.push({
      text: `Zeitbelege widersprechen sich an ${places.length} ${places.length === 1 ? "Stelle" : "Stellen"}${strong && strong < places.length ? `, davon ${strong} stark` : strong ? " (stark)" : ""}.`,
      step: "review",
      sourceId: conflicted[0]!.id,
      action: places.length === 1 ? "Ansehen" : "Ersten ansehen",
    });
  }
  const checks = queue.filter((r) => !openConflict(r));
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
  // Eine Seite, die ganz Kontext ist, braucht keine Randnotiz.
  const diaryOpen = view.rows.filter((r) => r.kind === "diary" && !r.diaryNote && !r.partOf && r.status !== "context");
  if (diaryOpen.length)
    out.push({
      text: `${diaryOpen.length} ${diaryOpen.length === 1 ? "Tagebuchseite" : "Tagebuchseiten"} ohne Randnotiz.`,
      step: "collect",
      sourceId: diaryOpen[0]!.id,
      action: "Erste ansehen",
    });
  return out;
}

/**
 * Hinweis aus der Zeitbestimmung in einen verständlichen Satz übersetzen. Die Hinweistexte (`notes`) erzeugt
 * `packages/core/src/resolve.ts`; ändert sich dort ein Wortlaut, muss er hier nachgezogen werden.
 */
export function checkReason(note: string, deviceLabel: string | undefined): string {
  if (note === "Uhr weicht ab?") return `Die Uhr von ${deviceLabel ?? "diesem Gerät"} ist noch nicht abgeglichen.`;
  if (note === "Keine Referenzuhr gewählt") return "Es ist noch keine Referenzuhr gewählt.";
  if (note === "nur Minute") return "Die Uhrzeit ist nur minutengenau bekannt.";
  if (note.startsWith("± ")) return `Die Uhrzeit ist nur ungefähr bekannt (${note}).`;
  if (note.startsWith("Widerspruch ")) return `Zeitbelege widersprechen sich (${note.slice(12)}).`;
  if (note === "Entscheidung neu prüfen") return "Seit der Entscheidung hat sich ein Zeitbeleg geändert.";
  return note;
}
