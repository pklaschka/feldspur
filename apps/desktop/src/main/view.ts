import {
  computeEpisodes,
  formatDuration,
  formatClock,
  resolveTimeline,
  type Id,
  type Interval,
  type ProjectStore,
} from "@feldspur/core";
import type {
  AnchorRow,
  DeviceRow,
  DiaryEntryRow,
  EpisodeRow,
  GapRow,
  ProposalRow,
  SessionView,
  SourceRow,
} from "../shared/api.ts";

const mmss = (ms: number) => formatDuration(ms);

/** Einsatz laden, Zeitbestimmung rechnen und als Tabellenzeilen aufbereiten. */
export function buildSessionView(store: ProjectStore, sessionId: string): SessionView {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));

  const analyses = store.listAudioAnalyses(sessionId);
  const analysisBySource = new Map(analyses.map((a) => [a.sourceId, a]));
  const evidenceBySource = new Map<Id, typeof input.evidence>();
  for (const e of [...input.evidence, ...res.derivedEvidence]) {
    evidenceBySource.set(e.sourceId, [...(evidenceBySource.get(e.sourceId) ?? []), e]);
  }

  const pageOf = (id: string) => sourceById.get(id)?.partOf ?? id;
  const pageLabel = (id: string, page: number) => {
    const s = sourceById.get(id);
    return `${s?.label ?? "?"}${s && /\.pdf$/i.test(s.fileName) ? ` S. ${page + 1}` : ""}`;
  };
  const rows: SourceRow[] = input.sources.map((s) => {
    const p = res.placements.get(s.id);
    const page = pageOf(s.id);
    const entry = input.diaryEntries.find(
      (e) => e.regions.some((r) => pageOf(r.sourceId) === page) && e.notedAtMs !== null,
    );
    const dp = entry ? res.diary.get(entry.id) : undefined;
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    const an = analysisBySource.get(s.id);
    const evs = (evidenceBySource.get(s.id) ?? [])
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        detail: e.detail,
        raw: e.raw,
        chosen: p?.basis.evidenceId === e.id,
        enabled: e.enabled,
        own: e.kind === "manual" || e.kind === "spoken",
        derived: e.id.startsWith("anchor:"),
        uncertaintyMs: e.uncertaintyMs,
      }))
      .sort((a, b) => Number(b.chosen) - Number(a.chosen));
    return {
      diaryWindow: dp ? { fromMs: dp.fromMs, toMs: dp.toMs } : null,
      durationMs: s.durationMs,
      sizeBytes: s.sizeBytes,
      sha256: s.sha256,
      originalPath: s.originalPath,
      uncertaintyMs: p?.uncertaintyMs ?? null,
      evidence: evs,
      idle: p && an ? an.idle.map((i) => ({ startMs: p.startMs + i.startMs, endMs: p.startMs + i.endMs })) : [],
      loudAtMs: p && an ? an.loudInIdle.map((l) => p.startMs + l.atMs) : [],
      previewable: (s.kind === "photo" || s.kind === "diary") && /\.(jpe?g|png|webp|gif)$/i.test(s.fileName),
      isPdf: /\.pdf$/i.test(s.fileName),
      id: s.id,
      label: s.label,
      kind: s.kind,
      partOf: s.partOf,
      parts: input.sources.filter((x) => x.partOf === s.id).map((x) => x.id),
      follows: s.follows,
      followedBy: input.sources.find((x) => x.follows === s.id)?.id ?? null,
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

  const toRow = (d: (typeof input.devices)[number]): DeviceRow => {
    const c = res.deviceClocks.get(d.id);
    const kinds = input.sources.filter((s) => s.deviceId === d.id).map((s) => s.kind);
    const kind =
      (["video", "audio", "photo", "diary", "gps", "note", "other"] as const).find((k) => kinds.includes(k)) ?? "other";
    return {
      id: d.id,
      label: d.label,
      kind,
      personName: d.personId ? (persons.get(d.personId) ?? "") : "",
      isReference: d.isReference,
      offsetMs: c?.offsetMs ?? null,
      offsetBasis: c?.basis ?? "unknown",
      sourceCount: kinds.length,
    };
  };
  const allDevices = input.devices.map(toRow);
  // Geräte ohne eigene Uhr (nur Tagebuchscans, Notizen) brauchen keinen Abgleich.
  const deviceRows = allDevices.filter((d) => d.kind !== "diary" && d.kind !== "note");

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
        impliedOffsetMs: implied,
        deviceId: dev?.id ?? null,
        deviceLabel: dev?.label ?? "",
      };
    });

  // Episoden, sobald analysiert.
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

  const conflictBy = new Map(res.anchorConflicts.map((c) => [c.anchorId, c.differenceMs]));
  const anchors: AnchorRow[] = input.anchors
    .filter((a) => !a.proposed)
    .map((a) => {
      const la = sourceById.get(a.a.sourceId)?.label ?? "?";
      const lb = sourceById.get(a.b.sourceId)?.label ?? "?";
      return {
        id: a.id,
        kind: a.kind,
        description: `${la} bei ${mmss(a.a.atMediaMs)} = ${lb} bei ${mmss(a.b.atMediaMs)}`,
        note: a.note,
        conflictMs: conflictBy.get(a.id) ?? null,
      };
    });

  const diary: DiaryEntryRow[] = input.diaryEntries
    .map((e) => {
      // Nummerierung nach Seite (Hauptquelle, dann weitere Bilder, PDF-Seite) und Lage auf der Seite.
      const first = e.regions[0];
      const src = sourceById.get(first?.sourceId ?? "");
      const main = src?.partOf ? sourceById.get(src.partOf) : src;
      const page = String(first?.page ?? 0).padStart(4, "0");
      return {
        e,
        key: `${main?.label ?? "~"}:${src?.partOf ? src.label : ""}:${page}:${(first?.y ?? 0).toFixed(4)}:${(first?.x ?? 0).toFixed(4)}`,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ e }, i) => {
      const dp = res.diary.get(e.id);
      return {
        id: e.id,
        number: i + 1,
        notedAt: e.notedAtMs === null ? null : formatClock(e.notedAtMs).slice(0, 5),
        window: dp ? { fromMs: dp.fromMs, toMs: dp.toMs } : null,
        lookbackMin: e.lookbackMs === null ? null : e.lookbackMs / 60_000,
        mode: e.mode,
        shortText: e.shortText,
        fullText: e.fullText,
        regions: e.regions.map((r) => ({
          ...r,
          pageLabel: pageLabel(r.sourceId, r.page),
        })),
      };
    });

  return {
    session: input.session,
    rows,
    anchors,
    diary,
    diaryLookbackMin: input.session.diaryLookbackMs / 60_000,
    allDevices,
    devices: deviceRows,
    proposals,
    episodes,
    gaps,
    analyzedCount: analyses.length,
    avCount,
  };
}
