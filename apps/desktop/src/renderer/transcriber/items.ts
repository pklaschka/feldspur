/** Was in der Mitschrift neben den eigenen Zeilen steht, und wo die Wiedergabe gerade ist. Ohne React, damit es sich direkt testen lässt. */
import type { SessionView, SourceNoteRow, SourceRow, TranscriptRow } from "../../shared/api.ts";
import { KIND_LABEL } from "../format.ts";
import type { WaveBand } from "../Waveform.tsx";

export interface Event {
  key: string;
  atMs: number;
  text: string;
  /** Zeile aus der Mitschrift einer anderen, gleichzeitig laufenden Spur (nur lesen). */
  other?: OtherLine;
}

export interface OtherLine {
  sourceId: string;
  /** Stelle in der anderen Aufnahme. */
  atMs: number;
  label: string;
  speaker: string;
  text: string;
}
export type Item = { kind: "line"; atMs: number; line: TranscriptRow } | { kind: "event"; atMs: number; event: Event };

/** Tonquellen: erst die Dateien desselben Geräts (dieselbe Spur), dann mit Trennlinie die übrigen. */
export function sourceOptions(row: SourceRow, avRows: SourceRow[]) {
  const byLabel = (a: SourceRow, b: SourceRow) => a.label.localeCompare(b.label, "de", { numeric: true });
  const same = avRows.filter((r) => r.deviceId === row.deviceId).sort(byLabel);
  const other = avRows.filter((r) => r.deviceId !== row.deviceId).sort(byLabel);
  return [...same, ...other].map((r, i) => ({
    value: r.id,
    label: `${r.label} · ${r.fileName}`,
    groupStart: i === same.length && same.length > 0 ? "Andere Geräte" : undefined,
  }));
}

/** Bei gleicher Stelle: erst „… beginnt“ und Tagebuch, dann Zeilen anderer Spuren, dann die eigenen. */
export const itemRank = (it: Item) => (it.kind === "line" ? 2 : it.event.other ? 1 : 0);

/** Letzte Zeile an oder vor der Stelle (Zeilen sind nach Stelle sortiert). */
export function lastAtOrBefore(lines: TranscriptRow[], pos: number): TranscriptRow | undefined {
  let lo = 0;
  let hi = lines.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (lines[m]!.atMs <= pos) {
      hit = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return hit >= 0 ? lines[hit] : undefined;
}

export function noteBands(notes: SourceNoteRow[]): WaveBand[] {
  return notes
    .filter((n) => n.fromMs !== null && n.toMs !== null)
    .map((n) => ({ fromMs: n.fromMs!, toMs: n.toMs!, tone: n.done ? ("good" as const) : ("warn" as const) }));
}

/** Was in anderen Quellen passiert, während diese Aufnahme läuft (als Stelle in dieser Aufnahme). */
export function eventsIn(view: SessionView, row: SourceRow): Event[] {
  if (row.startMs === null) return [];
  const start = row.startMs;
  const end = row.endMs ?? start + (row.durationMs ?? 0);
  const inside = (ms: number | null) => ms !== null && ms >= start && ms <= end;
  const out: Event[] = [];
  for (const r of view.rows) {
    if (r.id === row.id || r.partOf || r.kind === "diary" || !inside(r.startMs)) continue;
    const what =
      r.kind === "video"
        ? `${r.label} (Video) beginnt`
        : r.kind === "audio"
          ? `${r.label} (Audio) beginnt`
          : `${KIND_LABEL[r.kind]} ${r.label}`;
    out.push({ key: `r:${r.id}`, atMs: r.startMs! - start, text: `${what} · ${r.fileName}` });
  }
  const byId = new Map(view.rows.map((r) => [r.id, r]));
  for (const l of view.transcript) {
    if (l.sourceId === row.id || l.clockMs === null || !inside(l.clockMs)) continue;
    const r = byId.get(l.sourceId);
    if (!r) continue;
    out.push({
      key: `t:${l.id}`,
      atMs: l.clockMs - start,
      text: `${r.label}: ${l.speaker ? `${l.speaker}: ` : ""}${l.text}`,
      other: { sourceId: r.id, atMs: l.atMs, label: r.label, speaker: l.speaker, text: l.text },
    });
  }
  for (const d of view.diary) {
    if (!d.window || !inside(d.window.toMs)) continue;
    const short = d.shortText || d.fullText;
    out.push({
      key: `d:${d.id}`,
      atMs: d.window.toMs - start,
      text: `Tagebuch ${d.regions[0]?.pageLabel ?? ""}, Eintrag ${d.number}${d.notedAt ? ` (notiert ${d.notedAt})` : ""}${short ? `: ${short}` : ""}`,
    });
  }
  return out;
}
