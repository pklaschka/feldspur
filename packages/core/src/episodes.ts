/**
 * Episoden: Zeiträume, in denen mindestens eine Aufnahme läuft und tatsächlich
 * etwas zu hören oder zu sehen ist. Leerlauf (lange Stille, siehe Tonspur-Analyse)
 * zählt nicht. Dazwischen liegen Zwischenzeiten, die im Export als Tafeln mit
 * Uhrzeit und Tagebuchnotiz erscheinen.
 *
 * Ob Oberfläche und Ausgabe Episoden zeigen, entscheidet der Einsatz (`FieldSession.episodes`, eingeschaltet unter
 * „Durchsehen“); diese Datei rechnet nur, und zwar aus Lagen (`packages/core/src/resolve.ts`), Leerlauf aus der
 * Tonspur-Analyse (`AudioAnalysis.idle`) und Anpassungen von Hand (`EpisodeEdit`). Gespeichert wird nichts. Aufgerufen
 * von `sessionEpisodes` in `packages/media/src/analyze.ts`, das die Daten aus der Projektdatei holt. Weiter geht es
 * in `packages/core/src/montage.ts`.
 */
import type { EpisodeEdit, Id, Interval, Source } from "./model.ts";
import type { ResolveResult } from "./resolve.ts";
import type { LocalMs } from "./time.ts";

/** Eine Episode auf der Zeitachse (Uhrzeiten des Einsatzes). */
export interface Episode {
  /** Laufende Nummer ab 1, in zeitlicher Reihenfolge. */
  index: number;
  startMs: LocalMs;
  endMs: LocalMs;
  /** Aufnahmen, die in der Episode etwas beitragen. */
  sourceIds: Id[];
}

/**
 * Eine Zwischenzeit: die Zeit vor, zwischen oder nach Episoden. Vor der ersten und nach der letzten Episode gibt es
 * sie nur, wenn dort etwas liegt; sie beginnt bzw. endet dann beim äußersten Stück.
 */
export interface Gap {
  startMs: LocalMs;
  endMs: LocalMs;
  /** Fotos und Tagebucheinträge, die in die Zwischenzeit fallen (Einträge nach ihrer Notierzeit). */
  sourceIds: Id[];
  diaryEntryIds: Id[];
}

/** Stellschrauben der Episodenbildung; die Standardwerte stehen in `computeEpisodes`. */
export interface EpisodeOptions {
  /** Aktivität mit kürzerem Abstand gehört zur selben Episode. Konzept: 5 Minuten. */
  mergeGapMs?: number;
  /** Puffer vor und nach jeder Aktivität. */
  padMs?: number;
  /** Anpassungen von Hand, in der Reihenfolge, in der sie gemacht wurden. Sie gelten nach dem Puffer. */
  edits?: Pick<EpisodeEdit, "sourceId" | "fromMs" | "toMs" | "mode">[];
}

export interface EpisodeResult {
  episodes: Episode[];
  gaps: Gap[];
}

interface Span extends Interval {
  sourceId: Id;
}

/** Intervall minus Leerlauf-Strecken (alle in derselben Zeitachse). */
function subtract(iv: Interval, holes: Interval[]): Interval[] {
  let parts: Interval[] = [iv];
  for (const h of holes) {
    parts = parts.flatMap((p) => {
      if (h.endMs <= p.startMs || h.startMs >= p.endMs) return [p];
      const out: Interval[] = [];
      if (h.startMs > p.startMs) out.push({ startMs: p.startMs, endMs: h.startMs });
      if (h.endMs < p.endMs) out.push({ startMs: h.endMs, endMs: p.endMs });
      return out;
    });
  }
  return parts;
}

/** Intervalle sortieren und Überlappungen zusammenfassen. */
function normalize(list: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of [...list].filter((i) => i.endMs > i.startMs).sort((a, b) => a.startMs - b.startMs)) {
    const last = out.at(-1);
    if (last && iv.startMs <= last.endMs) last.endMs = Math.max(last.endMs, iv.endMs);
    else out.push({ ...iv });
  }
  return out;
}

/**
 * Episoden und Zwischenzeiten eines Einsatzes berechnen: je Aufnahme den Leerlauf abziehen, Puffer anlegen,
 * Anpassungen von Hand anwenden, dann alles, was näher als `mergeGapMs` beieinanderliegt, zu einer Episode
 * verbinden. Aufnahmen ohne Lage zählen nicht.
 */
export function computeEpisodes(
  sources: Source[],
  resolved: ResolveResult,
  /** Leerlauf je Quelle, in ms ab Dateianfang. */
  idleBySource: Map<Id, Interval[]>,
  opts: EpisodeOptions = {},
): EpisodeResult {
  const mergeGap = opts.mergeGapMs ?? 5 * 60_000;
  const pad = opts.padMs ?? 10_000;

  const spans: Span[] = [];
  for (const s of sources) {
    if (s.kind !== "audio" && s.kind !== "video") continue;
    const p = resolved.placements.get(s.id);
    if (!p || p.endMs <= p.startMs) continue;
    const holes = (idleBySource.get(s.id) ?? []).map((h) => ({
      startMs: p.startMs + h.startMs,
      endMs: p.startMs + h.endMs,
    }));
    // Puffer nur nach innen in die Aufnahme hinein, nie über ihre Grenzen.
    let parts = subtract({ startMs: p.startMs, endMs: p.endMs }, holes).map((part) => ({
      startMs: Math.max(p.startMs, part.startMs - pad),
      endMs: Math.min(p.endMs, part.endMs + pad),
    }));
    for (const e of opts.edits ?? []) {
      if (e.sourceId !== s.id) continue;
      // Die Anpassung nennt Stellen in der Aufnahme; hier wird sie auf die Uhrzeit umgerechnet und auf die Aufnahme
      // begrenzt.
      const iv = { startMs: Math.max(p.startMs, p.startMs + e.fromMs), endMs: Math.min(p.endMs, p.startMs + e.toMs) };
      if (iv.endMs <= iv.startMs) continue;
      parts = e.mode === "include" ? normalize([...parts, iv]) : normalize(parts).flatMap((x) => subtract(x, [iv]));
    }
    for (const part of normalize(parts)) spans.push({ sourceId: s.id, ...part });
  }
  spans.sort((a, b) => a.startMs - b.startMs);

  const episodes: Episode[] = [];
  for (const sp of spans) {
    const last = episodes.at(-1);
    if (last && sp.startMs - last.endMs < mergeGap) {
      last.endMs = Math.max(last.endMs, sp.endMs);
      if (!last.sourceIds.includes(sp.sourceId)) last.sourceIds.push(sp.sourceId);
    } else {
      episodes.push({ index: episodes.length + 1, startMs: sp.startMs, endMs: sp.endMs, sourceIds: [sp.sourceId] });
    }
  }

  // Zwischenzeiten: vor der ersten, zwischen und nach der letzten Episode, soweit dort etwas liegt.
  const points = [
    ...sources
      .filter((s) => s.kind !== "audio" && s.kind !== "video")
      .map((s) => ({ id: s.id, diary: false, t: resolved.placements.get(s.id)?.startMs })),
    ...[...resolved.diary.values()].map((d) => ({ id: d.entryId, diary: true, t: d.notedAtMs })),
  ].filter((x): x is { id: Id; diary: boolean; t: number } => x.t !== undefined);
  const inEpisode = (t: number) => episodes.some((e) => t >= e.startMs && t <= e.endMs);
  const outside = points.filter((p) => !inEpisode(p.t)).sort((a, b) => a.t - b.t);

  // Paarweise gelesen: (−∞, Beginn 1), (Ende 1, Beginn 2), …, (Ende n, +∞) sind die Lücken zwischen den Episoden.
  const bounds = [-Infinity, ...episodes.flatMap((e) => [e.startMs, e.endMs]), Infinity];
  const gaps: Gap[] = [];
  for (let i = 0; i < bounds.length; i += 2) {
    const from = bounds[i]!;
    const to = bounds[i + 1]!;
    const inside = outside.filter((p) => p.t >= from && p.t <= to);
    const hasBoth = Number.isFinite(from) && Number.isFinite(to);
    if (!inside.length && !hasBoth) continue;
    gaps.push({
      startMs: Number.isFinite(from) ? from : inside[0]!.t,
      endMs: Number.isFinite(to) ? to : inside.at(-1)!.t,
      sourceIds: inside.filter((p) => !p.diary).map((p) => p.id),
      diaryEntryIds: inside.filter((p) => p.diary).map((p) => p.id),
    });
  }
  return { episodes, gaps };
}
