import {
  diaryPageLabel,
  regionPageNo,
  effectiveLocal,
  sideOrder,
  formatDuration,
  formatClock,
  resolveTimeline,
  type EvidenceComparison,
  type Id,
  type Placement,
  type ProjectStore,
  type Source,
  effectiveGainDb,
} from "@feldspur/core";
import { contextPieces, sessionEpisodes, speechLevels } from "@feldspur/media";
import { quickStates } from "./originals.ts";
import type {
  AnchorRow,
  ConflictGroupRow,
  ContextRow,
  DeviceRow,
  DiaryEntryRow,
  EpisodeRow,
  GapRow,
  LevelRow,
  ProposalRow,
  SessionView,
  SourceNoteRow,
  SourceRow,
  TranscriptRow,
} from "../shared/api.ts";

const mmss = (ms: number) => formatDuration(ms);

function levelRow(s: Source, levels: Map<Id, number | null>): LevelRow {
  const measured = levels.has(s.id);
  const measuredDb = levels.get(s.id) ?? null;
  return {
    mode: s.levelMode,
    manualGainDb: s.levelGainDb,
    compress: s.levelCompress,
    measured,
    measuredDb,
    gainDb: effectiveGainDb(s, measuredDb),
  };
}

/**
 * Gleichartige offene Widersprüche eines Geräts zusammenfassen: dieselben Belegarten und dieselbe Abweichung
 * (auf die erlaubte Abweichung genau) oder dieselbe vermutete Ursache. Ab drei Dateien, bei Geräten mit nur
 * zwei Dateien auch schon bei zwei.
 */
export function groupConflicts(
  sources: Source[],
  placements: Map<Id, Placement>,
  devices: Map<Id, { label: string }>,
): ConflictGroupRow[] {
  type Case = { sourceId: Id; deviceId: Id; used: string; other: EvidenceComparison };
  const cases: Case[] = [];
  for (const s of sources) {
    const p = placements.get(s.id);
    if (!s.deviceId || !p || (p.conflict.state !== "open" && p.conflict.state !== "stale")) continue;
    const other = p.comparison
      .filter((c) => c.enabled && c.verdict === "conflict")
      .sort((a, b) => Math.abs(b.differenceMs) - Math.abs(a.differenceMs))[0];
    if (other) cases.push({ sourceId: s.id, deviceId: s.deviceId, used: p.basis.kind, other });
  }
  const groups: { cases: Case[] }[] = [];
  for (const c of cases) {
    const g = groups.find(({ cases: [f] }) => {
      if (f!.deviceId !== c.deviceId || f!.used !== c.used || f!.other.kind !== c.other.kind) return false;
      if (f!.other.cause && f!.other.cause === c.other.cause) return true;
      return Math.abs(f!.other.differenceMs - c.other.differenceMs) <= Math.max(f!.other.allowedMs, c.other.allowedMs);
    });
    if (g) g.cases.push(c);
    else groups.push({ cases: [c] });
  }
  const filesOf = (deviceId: Id) => sources.filter((s) => s.deviceId === deviceId && !s.partOf).length;
  return groups
    .filter((g) => g.cases.length >= Math.min(3, Math.max(2, filesOf(g.cases[0]!.deviceId))))
    .map(({ cases: cs }) => {
      const f = cs[0]!;
      return {
        key: `${f.deviceId}:${f.used}:${f.other.kind}:${f.sourceId}`,
        deviceId: f.deviceId,
        deviceLabel: devices.get(f.deviceId)?.label ?? "",
        usedKind: f.used,
        otherKind: f.other.kind,
        sourceIds: cs.map((c) => c.sourceId),
        differenceMs: f.other.differenceMs,
        severity: cs.some((c) => c.other.severity === "strong") ? "strong" : "clear",
        cause: cs.every((c) => c.other.cause === f.other.cause) ? (f.other.cause ?? null) : null,
      };
    });
}

/** Einsatz laden, Zeitbestimmung rechnen und als Tabellenzeilen aufbereiten. */
export function buildSessionView(store: ProjectStore, sessionId: string): SessionView {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));

  const analyses = store.listAudioAnalyses(sessionId);
  const analysisBySource = new Map(analyses.map((a) => [a.sourceId, a]));
  const levels = speechLevels(store, sessionId, analyses);
  const evidenceBySource = new Map<Id, typeof input.evidence>();
  for (const e of [...input.evidence, ...res.derivedEvidence]) {
    evidenceBySource.set(e.sourceId, [...(evidenceBySource.get(e.sourceId) ?? []), e]);
  }

  const pageOf = (id: string) => sourceById.get(id)?.partOf ?? id;
  const pageLabel = (id: string, region: { page: number; x: number; w: number }) => {
    const s = sourceById.get(id);
    return s ? diaryPageLabel(s, region) : "?";
  };
  const files = quickStates(input.sources);
  // Kontext (Issue #108): Einträge je Seite, um Seiten mit nur Kontext als „Kontext“ zu zeigen.
  const entriesOfPage = new Map<Id, typeof input.diaryEntries>();
  for (const e of input.diaryEntries)
    for (const pid of new Set(e.regions.map((r) => pageOf(r.sourceId))))
      entriesOfPage.set(pid, [...(entriesOfPage.get(pid) ?? []), e]);
  const roleOf = (s: Source) => (s.partOf ? (sourceById.get(s.partOf)?.role ?? s.role) : s.role);
  const rows: SourceRow[] = input.sources.map((s) => {
    const p = res.placements.get(s.id);
    const file = files.get(s.id)!;
    const page = pageOf(s.id);
    const onPage = entriesOfPage.get(page) ?? [];
    const entry = onPage.find((e) => e.notedAtMs !== null && e.role !== "context");
    const contextEntries = onPage.filter((e) => e.role === "context").length;
    const isContext =
      s.kind === "diary" ? contextEntries > 0 && contextEntries === onPage.length : roleOf(s) === "context";
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
        own: e.kind === "manual" || e.kind === "spoken" || e.kind === "checked",
        derived: e.id.startsWith("anchor:"),
        uncertaintyMs: e.uncertaintyMs,
        compare: p?.comparison.find((c) => c.evidenceId === e.id) ?? null,
      }))
      .sort((a, b) => Number(b.chosen) - Number(a.chosen));
    const checkedEv = p?.basis.kind === "checked" ? input.evidence.find((e) => e.id === p.basis.evidenceId) : undefined;
    return {
      diaryWindow: dp ? { fromMs: dp.fromMs, toMs: dp.toMs } : null,
      durationMs: s.durationMs,
      sizeBytes: s.sizeBytes,
      sha256: s.sha256,
      originalPath: s.originalPath,
      file: file.state,
      fileDetail: file.detail,
      uncertaintyMs: p?.uncertaintyMs ?? null,
      evidence: evs,
      hasDeviceClock: (evidenceBySource.get(s.id) ?? []).some((e) => e.enabled && e.clock === "device"),
      idle: p && an ? an.idle.map((i) => ({ startMs: p.startMs + i.startMs, endMs: p.startMs + i.endMs })) : [],
      loudAtMs: p && an ? an.loudInIdle.map((l) => p.startMs + l.atMs) : [],
      previewable: (s.kind === "photo" || s.kind === "diary") && /\.(jpe?g|png|webp|gif)$/i.test(s.fileName),
      isPdf: /\.pdf$/i.test(s.fileName),
      firstPage: s.firstPage,
      pageSpread: s.pageSpread,
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
      status: isContext ? "context" : (p?.status ?? "unplaced"),
      role: s.kind === "diary" ? "timeline" : roleOf(s),
      contextEntries,
      entryCount: onPage.length,
      notes: p?.notes ?? [],
      conflict: p?.conflict ?? { state: "none", severity: null, worstMs: 0, count: 0, staleBecause: [] },
      basisReason: p?.basis.reason ?? "",
      decision: checkedEv
        ? {
            evidenceId: checkedEv.id,
            at: checkedEv.decision?.at ?? null,
            reason: checkedEv.decision?.reason ?? "",
            basisKind: checkedEv.decision?.basisKind ?? "",
            basisId: checkedEv.decision?.basisId ?? null,
            detail: checkedEv.detail,
          }
        : null,
      level: s.kind === "audio" || s.kind === "video" ? levelRow(s, levels) : null,
    };
  });
  rows.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.label.localeCompare(b.label));

  const toRow = (d: (typeof input.devices)[number]): DeviceRow => {
    const c = res.deviceClocks.get(d.id);
    const mine = input.sources.filter((s) => s.deviceId === d.id);
    const own = new Set(mine.map((s) => s.id));
    const kinds = mine.map((s) => s.kind);
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
      hasUtcStamps: input.evidence.some((e) => e.utcMs !== null && own.has(e.sourceId)),
      checkedCount: new Set(
        input.evidence.filter((e) => e.kind === "checked" && own.has(e.sourceId)).map((e) => e.sourceId),
      ).size,
      timestampsAreUtc: d.timestampsAreUtc,
      timeZone: d.timeZone,
    };
  };
  const allDevices = input.devices.map(toRow);
  // Geräte ohne eigene Uhr (nur Tagebuchscans, Notizen) brauchen keinen Abgleich.
  // Ebenso Geräte, deren Dateien alle Kontext sind: Kontext hat keine Uhrzeit, also nichts abzugleichen.
  const onlyContext = (id: Id) => {
    const own = input.sources.filter((x) => x.deviceId === id && !x.partOf);
    return own.length > 0 && own.every((x) => x.role === "context");
  };
  const deviceRows = allDevices.filter((d) => d.kind !== "diary" && d.kind !== "note" && !onlyContext(d.id));

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
          ? effectiveLocal(devEv, dev, input.session.timeZone) -
            devEv.atMediaMs +
            a.b.atMediaMs -
            (refStart + a.a.atMediaMs)
          : null;
      const what = a.kind === "clap" ? "Klatschen" : "Gleicher Ton";
      return {
        anchorId: a.id,
        a: { sourceId: a.a.sourceId, atMs: a.a.atMediaMs },
        b: { sourceId: a.b.sourceId, atMs: a.b.atMediaMs },
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

  // Episoden nur auf Wunsch, sobald analysiert.
  const avCount = input.sources.filter((s) => s.kind === "audio" || s.kind === "video").length;
  let episodes: EpisodeRow[] | null = null;
  let gaps: GapRow[] = [];
  if (input.session.episodes && analyses.length) {
    const ep = sessionEpisodes(store, sessionId, { input, resolved: res, analyses });
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

  const conflictGroups = groupConflicts(input.sources, res.placements, devices);

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
        a: { sourceId: a.a.sourceId, atMs: a.a.atMediaMs },
        b: { sourceId: a.b.sourceId, atMs: a.b.atMediaMs },
      };
    });

  const diary: DiaryEntryRow[] = input.diaryEntries
    .map((e) => {
      // Nummerierung nach Seite (Hauptquelle, dann weitere Bilder, PDF-Seite) und Lage auf der Seite;
      // auf Doppelseiten erst die linke, dann die rechte Seite.
      const first = e.regions[0];
      const src = sourceById.get(first?.sourceId ?? "");
      const main = src?.partOf ? sourceById.get(src.partOf) : src;
      const page = String(first?.page ?? 0).padStart(4, "0");
      const side = src && first ? sideOrder(src, first) : 0;
      return {
        e,
        key: `${main?.label ?? "~"}:${src?.partOf ? src.label : ""}:${page}:${side}:${(first?.y ?? 0).toFixed(4)}:${(first?.x ?? 0).toFixed(4)}`,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ e }, i) => {
      const dp = res.diary.get(e.id);
      return {
        role: e.role,
        title: e.title,
        contextMade: e.contextMade,
        refs: e.contextRefs,
        contextPosition: res.context.find((c) => c.entryId === e.id)?.position ?? null,
        id: e.id,
        number: i + 1,
        notedAt: e.notedAtMs === null ? null : formatClock(e.notedAtMs).slice(0, 5),
        window: dp ? { fromMs: dp.fromMs, toMs: dp.toMs } : null,
        lookbackMin: e.lookbackMs === null ? null : e.lookbackMs / 60_000,
        mode: e.mode,
        shortText: e.shortText,
        fullText: e.fullText,
        regions: e.regions.map((r) => {
          const s = sourceById.get(r.sourceId);
          return {
            ...r,
            pageLabel: pageLabel(r.sourceId, r),
            pageNo: s ? regionPageNo(s, r) : (r.pageNo ?? null),
            pageNoOwn: r.pageNo != null,
          };
        }),
      };
    });

  const numberOf = new Map(diary.map((d) => [d.id, d.number]));
  const context: ContextRow[] = contextPieces(input, res, persons).map((p) => {
    const first = p.entry?.regions[0];
    const thumbSrc = p.source ?? (first ? sourceById.get(first.sourceId) : undefined);
    const wouldBasis = p.source
      ? (input.evidence.find((e) => e.sourceId === p.source!.id && e.enabled)?.detail ?? "")
      : p.entry?.notedAtMs != null
        ? "Notierzeit"
        : "";
    return {
      key: p.item.key,
      position: p.item.position,
      entryId: p.entry?.id ?? null,
      sourceId: p.source?.id ?? null,
      kind: p.kind,
      title: p.title,
      name: p.name,
      find: p.find,
      personName: p.person,
      mode: p.mode,
      text: p.text,
      textEditable: !!p.entry,
      made: p.made,
      notedAt: p.notedAt,
      wouldStartMs: p.item.wouldStartMs,
      wouldStartBasis: wouldBasis,
      canReturn: !p.entry || p.entry.regions.length > 0,
      mentionedBy: p.item.mentionedBy.map((m) => {
        const e = input.diaryEntries.find((x) => x.id === m.entryId);
        const r = e?.regions[0];
        return {
          entryId: m.entryId,
          number: numberOf.get(m.entryId) ?? 0,
          notedAt: formatClock(m.notedAtMs).slice(0, 5),
          pageId: r ? pageOf(r.sourceId) : null,
        };
      }),
      thumb:
        thumbSrc && (thumbSrc.kind === "photo" || thumbSrc.kind === "diary")
          ? {
              sourceId: thumbSrc.id,
              region: first ? { page: first.page, x: first.x, y: first.y, w: first.w, h: first.h } : null,
              previewable: /\.(jpe?g|png|webp|gif)$/i.test(thumbSrc.fileName),
              isPdf: /\.pdf$/i.test(thumbSrc.fileName),
            }
          : null,
    };
  });

  const transcript: TranscriptRow[] = store.listTranscript(sessionId).map((l) => {
    const p = res.placements.get(l.sourceId);
    return {
      id: l.id,
      sourceId: l.sourceId,
      atMs: l.atMs,
      clockMs: p ? p.startMs + l.atMs : null,
      speaker: l.speaker,
      text: l.text,
    };
  });

  const notes: SourceNoteRow[] = store.listSourceNotes(sessionId).map((n) => ({
    id: n.id,
    sourceId: n.sourceId,
    fromMs: n.fromMs,
    toMs: n.toMs,
    text: n.text,
    done: n.done,
  }));

  return {
    session: input.session,
    transcript,
    notes,
    rows,
    anchors,
    diary,
    context,
    diaryLookbackMin: input.session.diaryLookbackMs / 60_000,
    allDevices,
    devices: deviceRows,
    proposals,
    conflictGroups,
    episodes,
    gaps,
    episodeEdits: input.session.episodes ? store.listEpisodeEdits(sessionId).length : 0,
    analyzedCount: analyses.length,
    avCount,
  };
}
