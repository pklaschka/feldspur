/**
 * Episoden: Zeiträume, in denen mindestens eine Aufnahme läuft und tatsächlich
 * etwas zu hören oder zu sehen ist. Leerlauf (lange Stille, siehe Tonspur-Analyse)
 * zählt nicht. Dazwischen liegen Zwischenzeiten, die im Export als Tafeln mit
 * Uhrzeit und Tagebuchnotiz erscheinen.
 */
import type { Id, Interval, Source } from "./model.ts";
import type { ResolveResult } from "./resolve.ts";
import type { LocalMs } from "./time.ts";

export interface Episode {
  index: number;
  startMs: LocalMs;
  endMs: LocalMs;
  /** Aufnahmen, die in der Episode etwas beitragen. */
  sourceIds: Id[];
}

export interface Gap {
  startMs: LocalMs;
  endMs: LocalMs;
  /** Fotos und Tagebucheinträge, die in die Zwischenzeit fallen. */
  sourceIds: Id[];
  diaryEntryIds: Id[];
}

export interface EpisodeOptions {
  /** Aktivität mit kürzerem Abstand gehört zur selben Episode. Konzept: 5 Minuten. */
  mergeGapMs?: number;
  /** Puffer vor und nach jeder Aktivität. */
  padMs?: number;
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
    for (const part of subtract({ startMs: p.startMs, endMs: p.endMs }, holes)) {
      // Puffer nur nach innen in die Aufnahme hinein, nie über ihre Grenzen.
      spans.push({
        sourceId: s.id,
        startMs: Math.max(p.startMs, part.startMs - pad),
        endMs: Math.min(p.endMs, part.endMs + pad),
      });
    }
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
