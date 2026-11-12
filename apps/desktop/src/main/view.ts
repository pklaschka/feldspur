import {
  computeEpisodes,
  formatDuration,
  formatClock,
  resolveTimeline,
  type Id,
  type Interval,
  type ProjectStore,
} from "@feldspur/core";
import type { DeviceRow, EpisodeRow, GapRow, ProposalRow, SessionView, SourceRow } from "../shared/api.ts";

const mmss = (ms: number) => formatDuration(ms);

/** Einsatz laden, Zeitbestimmung rechnen und als Tabellenzeilen aufbereiten. */
export function buildSessionView(store: ProjectStore, sessionId: string): SessionView {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));

  const rows: SourceRow[] = input.sources.map((s) => {
    const p = res.placements.get(s.id);
    const entry = input.diaryEntries.find((e) => e.regions.some((r) => r.sourceId === s.id) && e.notedAtMs !== null);
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    return {
      id: s.id,
      label: s.label,
      kind: s.kind,
      fileName: s.fileName,
      deviceId: s.deviceId,
      deviceLabel: d?.label ?? "",
      personName: d?.personId ? (persons.get(d.personId) ?? "") : "",
      basis: p?.basis.detail ?? "nichts gefunden",
      startMs: p?.startMs ?? null,
      endMs: p?.endMs ?? null,
      correctionMs: p?.deviceCorrectionMs ?? 0,
      diaryNote: s.kind === "diary" && entry?.notedAtMs != null ? formatClock(entry.notedAtMs).slice(0, 5) : null,
      status: p?.status ?? "unplaced",
      notes: p?.notes ?? [],
    };
  });
  rows.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.label.localeCompare(b.label));

  // Geräte ohne eigene Uhr (nur Tagebuchscans, Notizen) brauchen keinen Abgleich.
  const clocked = input.devices.filter((d) =>
    input.sources.some((s) => s.deviceId === d.id && s.kind !== "diary" && s.kind !== "note"),
  );
  const deviceRows: DeviceRow[] = clocked.map((d) => {
    const c = res.deviceClocks.get(d.id);
    return {
      id: d.id,
      label: d.label,
      isReference: d.isReference,
      offsetMs: c?.offsetMs ?? null,
      offsetBasis: c?.basis ?? "unknown",
      sourceCount: input.sources.filter((s) => s.deviceId === d.id).length,
    };
  });

  // Vorschläge aus der Tonspur-Analyse.
  const proposals: ProposalRow[] = input.anchors
    .filter((a) => a.proposed)
    .map((a) => {
      const ref = sourceById.get(a.a.sourceId);
      const clip = sourceById.get(a.b.sourceId);
      const dev = clip?.deviceId ? devices.get(clip.deviceId) : undefined;
      // Abweichung, die aus diesem Anker folgen würde: Geräteuhr am Ankerpunkt minus echte Zeit.
      const refStart = ref ? res.placements.get(ref.id)?.startMs : undefined;
      const devEv = input.evidence.find((e) => e.sourceId === clip?.id && e.enabled && e.clock === "device");
      const implied =
        refStart !== undefined && devEv
          ? devEv.localMs - devEv.atMediaMs + a.b.atMediaMs - (refStart + a.a.atMediaMs)
          : null;
      const what = a.kind === "clap" ? "Klatschen" : "Gleicher Ton";
      return {
        anchorId: a.id,
        sourceLabel: clip?.label ?? "?",
        fileName: clip?.fileName ?? "",
        refLabel: ref?.label ?? "?",
        description: `${what} bei ${mmss(a.b.atMediaMs)} ↔ ${ref?.label ?? "?"} bei ${mmss(a.a.atMediaMs)}`,
        note: a.note,
        confidence: a.confidence,
        impliedOffset: implied === null ? null : formatDuration(implied, { sign: true }),
        deviceLabel: dev?.label ?? "",
      };
    });

  // Episoden, sobald analysiert.
  const analyses = store.listAudioAnalyses(sessionId);
  const avCount = input.sources.filter((s) => s.kind === "audio" || s.kind === "video").length;
  let episodes: EpisodeRow[] | null = null;
  let gaps: GapRow[] = [];
  if (analyses.length) {
    const idle = new Map<Id, Interval[]>(analyses.map((a) => [a.sourceId, a.idle]));
    const ep = computeEpisodes(input.sources, res, idle);
    const label = (id: Id) => sourceById.get(id)?.label ?? "?";
    episodes = ep.episodes.map((e) => ({
      index: e.index,
      startMs: e.startMs,
      endMs: e.endMs,
      sourceLabels: e.sourceIds.map(label).sort(),
    }));
    const loud = analyses.flatMap((a) => {
      const start = res.placements.get(a.sourceId)?.startMs;
      return start === undefined ? [] : a.loudInIdle.map((l) => start + l.atMs);
    });
    const diaryLabel = (entryId: Id) => {
      const e = input.diaryEntries.find((x) => x.id === entryId);
      return e?.regions[0] ? `${label(e.regions[0].sourceId)} (Tagebuch)` : "Tagebuch";
    };
    gaps = ep.gaps.map((g) => ({
      startMs: g.startMs,
      endMs: g.endMs,
      itemLabels: [...g.sourceIds.map(label), ...g.diaryEntryIds.map(diaryLabel)],
      loudAtMs: loud.filter((t) => t >= g.startMs && t <= g.endMs).sort((a, b) => a - b),
    }));
  }

  return {
    session: input.session,
    rows,
    devices: deviceRows,
    proposals,
    episodes,
    gaps,
    analyzedCount: analyses.length,
    avCount,
  };
}
