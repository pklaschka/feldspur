/**
 * Schnellsuche in einem Einsatz: Mitschrift, Notizen, Tagebuch, Quellen, Episoden.
 * Alles liegt schon in der Ansicht; gesucht wird ohne Rücksicht auf Groß-/Kleinschreibung
 * und Akzente, mehrere Wörter müssen alle vorkommen.
 */
import { formatClock } from "@feldspur/core/time";
import type { SessionView } from "../shared/api.ts";

export type HitKind = "line" | "note" | "diary" | "source" | "episode";

export interface Hit {
  kind: HitKind;
  /** Was angesprungen wird: Quelle (Zeile, Quelle), Tagebuchseite oder Episodennummer. */
  target: string;
  /** Stelle in der Aufnahme (Mitschrift, Notiz an einer Stelle). */
  atMs?: number;
  /** Ende des Bereichs (nur Episoden): Uhrzeit. */
  endMs?: number;
  /** Uhrzeit zum Sortieren und Anzeigen. */
  clockMs: number | null;
  title: string;
  text: string;
}

export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss");

/** Alle durchsuchbaren Einträge eines Einsatzes, in Uhrzeit-Reihenfolge. */
export function searchItems(view: SessionView): Hit[] {
  const label = new Map(view.rows.map((r) => [r.id, r.label]));
  const items: Hit[] = [];
  for (const l of view.transcript) {
    items.push({
      kind: "line",
      target: l.sourceId,
      atMs: l.atMs,
      clockMs: l.clockMs,
      title: `${label.get(l.sourceId) ?? "?"}${l.speaker ? ` · ${l.speaker}` : ""}`,
      text: l.text,
    });
  }
  const start = new Map(view.rows.map((r) => [r.id, r.startMs]));
  for (const n of view.notes) {
    const s0 = start.get(n.sourceId);
    items.push({
      kind: "note",
      target: n.sourceId,
      atMs: n.fromMs ?? undefined,
      clockMs: s0 == null ? null : s0 + (n.fromMs ?? 0),
      title: `${label.get(n.sourceId) ?? "?"}${n.done ? " · erledigt" : ""}`,
      text: n.text,
    });
  }
  for (const d of view.diary) {
    const text = [d.shortText, d.fullText].filter(Boolean).join(" · ");
    items.push({
      kind: "diary",
      target: d.regions[0]?.sourceId ?? "",
      clockMs: d.window?.toMs ?? null,
      title: `Tagebuch ${d.number}${d.regions[0] ? ` · ${d.regions[0].pageLabel}` : ""}${d.notedAt ? ` · notiert ${d.notedAt}` : ""}`,
      text: text || "(noch nicht abgetippt)",
    });
  }
  for (const r of view.rows) {
    items.push({
      kind: "source",
      target: r.id,
      clockMs: r.startMs,
      title: `${r.label} · ${r.deviceLabel}`,
      text: [r.fileName, r.personName, r.basis].filter(Boolean).join(" · "),
    });
  }
  for (const e of view.episodes ?? []) {
    items.push({
      kind: "episode",
      target: String(e.index),
      clockMs: e.startMs,
      endMs: e.endMs,
      title: `Episode ${e.index}`,
      text: `${formatClock(e.startMs)}–${formatClock(e.endMs)} · ${e.sourceLabels.join(", ")}`,
    });
  }
  return items.sort((a, b) => (a.clockMs ?? Infinity) - (b.clockMs ?? Infinity));
}

/** Höchstzahl der angezeigten Treffer. */
export const SEARCH_LIMIT = 60;

/** Treffer für eine Anfrage; Uhrzeiten wie „10:15“ finden auch alles, was um diese Zeit liegt. */
export function search(items: Hit[], query: string, limit = SEARCH_LIMIT): { hits: Hit[]; total: number } {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { hits: [], total: 0 };
  const hits: Hit[] = [];
  let total = 0;
  for (const it of items) {
    const hay = fold(`${it.title} ${it.text} ${it.clockMs === null ? "" : formatClock(it.clockMs)}`);
    if (!terms.every((t) => hay.includes(t))) continue;
    total++;
    if (hits.length < limit) hits.push(it);
  }
  return { hits, total };
}

/** Text in Stücke teilen, Treffer markiert (für die Anzeige). */
export function highlight(text: string, query: string): { text: string; hit: boolean }[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [{ text, hit: false }];
  const folded = fold(text);
  // fold kann die Länge ändern (ß → ss); dann ohne Markierung.
  if (folded.length !== text.length) return [{ text, hit: false }];
  const mark = Array.from({ length: text.length }, () => false);
  for (const t of terms) {
    for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + 1)) mark.fill(true, i, i + t.length);
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === mark[i]) last.text += text[i];
    else parts.push({ text: text[i]!, hit: mark[i]! });
  }
  return parts;
}
