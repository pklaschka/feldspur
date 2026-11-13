/**
 * Montage: aus Episoden und Zwischenzeiten eine durchgehende Videozeit machen.
 * Episoden laufen in voller Länge. Jede Zwischenzeit wird zu einer Tafel: Fotos und
 * Tagebucheinträge darin bekommen je ein paar Sekunden Standbild, reiner Leerlauf eine
 * kurze Tafel mit Uhrzeit. Überlappende Quellen verlängern nichts, alles folgt der Uhrzeit.
 */
import type { Episode, EpisodeResult, Gap } from "./episodes.ts";
import type { Id } from "./model.ts";
import type { LocalMs } from "./time.ts";

export interface MontageOptions {
  /** Länge einer Tafel ohne Inhalt. */
  cardMs?: number;
  /** Standzeit je Foto oder Tagebucheintrag in einer Zwischenzeit. */
  itemMs?: number;
}

/** Ein Ding, das in einer Tafel gezeigt wird, in Uhrzeit-Reihenfolge. */
export interface CardItem {
  kind: "source" | "diary";
  id: Id;
  atMs: LocalMs;
}

export type MontageSegment =
  | {
      kind: "episode";
      episode: Episode;
      fromMs: LocalMs;
      toMs: LocalMs;
      montageStartMs: number;
      montageMs: number;
    }
  | {
      kind: "card";
      gap: Gap;
      fromMs: LocalMs;
      toMs: LocalMs;
      items: CardItem[];
      montageStartMs: number;
      montageMs: number;
    };

export interface MontagePlan {
  segments: MontageSegment[];
  durationMs: number;
  /**
   * Stelle im Montagevideo zu einer Uhrzeit. In einer Episode genau, in einer Tafel der Beginn
   * der Tafel. itemId legt ein Foto oder einen Tagebucheintrag auf sein eigenes Standbild.
   */
  toMontage(clockMs: LocalMs, itemId?: Id): number | null;
}

export function planMontage(
  ep: EpisodeResult,
  /**
   * Uhrzeit je Foto (Quelle) bzw. Beginn des Bezugszeitraums je Tagebucheintrag;
   * undefined = in Tafeln nicht eigens zeigen.
   */
  timeOf: (kind: "source" | "diary", id: Id) => LocalMs | undefined,
  opts: MontageOptions = {},
): MontagePlan {
  const cardMs = opts.cardMs ?? 6_000;
  const itemMs = opts.itemMs ?? 3_000;
  type Seg = MontageSegment extends infer S
    ? S extends MontageSegment
      ? Omit<S, "montageStartMs" | "montageMs">
      : never
    : never;
  const parts: { at: number; len: number; seg: Seg }[] = [
    ...ep.episodes.map((e) => ({
      at: e.startMs,
      len: e.endMs - e.startMs,
      seg: { kind: "episode" as const, episode: e, fromMs: e.startMs, toMs: e.endMs },
    })),
    ...ep.gaps.map((g) => {
      const items: CardItem[] = [
        ...g.sourceIds.map((id) => ({ kind: "source" as const, id, atMs: timeOf("source", id) })),
        ...g.diaryEntryIds.map((id) => ({ kind: "diary" as const, id, atMs: timeOf("diary", id) })),
      ]
        // Ohne Zeit (z. B. Tagebuchseiten, die über ihre Einträge erscheinen) kein eigenes Standbild.
        .filter((x): x is CardItem => x.atMs !== undefined)
        .sort((x, y) => x.atMs - y.atMs || x.id.localeCompare(y.id));
      return {
        at: g.startMs,
        len: Math.max(cardMs, items.length * itemMs),
        seg: { kind: "card" as const, gap: g, fromMs: g.startMs, toMs: g.endMs, items },
      };
    }),
  ].sort((x, y) => x.at - y.at || (x.seg.kind === "card" ? -1 : 1));

  let t = 0;
  const segments: MontageSegment[] = parts.map(({ seg, len }) => {
    const out = { ...seg, montageStartMs: t, montageMs: len } as MontageSegment;
    t += len;
    return out;
  });

  const toMontage = (clockMs: LocalMs, itemId?: Id): number | null => {
    if (itemId) {
      for (const s of segments) {
        if (s.kind !== "card") continue;
        const i = s.items.findIndex((x) => x.id === itemId);
        if (i >= 0) return s.montageStartMs + i * itemMs;
      }
    }
    // Episoden zuerst: An den Grenzen gehört die Uhrzeit zur laufenden Aufnahme, nicht zur Tafel.
    for (const s of segments) {
      if (s.kind === "episode" && clockMs >= s.fromMs && clockMs <= s.toMs)
        return s.montageStartMs + (clockMs - s.fromMs);
    }
    for (const s of segments) {
      if (s.kind === "card" && clockMs >= s.fromMs && clockMs <= s.toMs) return s.montageStartMs;
    }
    return null;
  };
  return { segments, durationMs: t, toMontage };
}
