/**
 * Zeitgerüst: alles eines Einsatzes in einer Reihenfolge, mit der Stelle im Montagevideo.
 * Daraus entstehen das .docx für MAXQDA und die Einblendungen im Video.
 */
import {
  computeEpisodes,
  formatClock,
  formatDuration,
  planMontage,
  resolveTimeline,
  type Id,
  type Interval,
  type MontagePlan,
  type ProjectStore,
  type ResolveInput,
  type ResolveResult,
  type Source,
} from "@feldspur/core";

export type ScaffoldKind = "card" | "episode" | "start" | "photo" | "diary" | "line" | "sync" | "end";

/** Bildausschnitt für das Dokument: ganzes Foto oder Rahmen auf einer Scan-Seite. */
export interface ImageRef {
  sourceId: Id;
  region?: { page: number; x: number; y: number; w: number; h: number };
}

export interface ScaffoldEntry {
  /** Stelle im Montagevideo. */
  montageMs: number;
  kind: ScaffoldKind;
  /** „10:16:20“, „ca. 10:05 (notiert 10:12)“, „10:17:30–10:40:00“. */
  clock: string;
  /** Uhrzeit als Zahl (Beginn bei Spannen), für Einblendungen. */
  clockMs?: number;
  head: string;
  body: string;
  images: ImageRef[];
}

export interface ScaffoldHeader {
  title: string;
  date: string;
  place: string;
  researchers: string[];
  reference: string | null;
  sources: string[];
  extra: Record<string, string>;
}

export interface Scaffold {
  header: ScaffoldHeader;
  plan: MontagePlan;
  entries: ScaffoldEntry[];
  /** Grundlage für die Montage (Lagen, Quellen). */
  input: ResolveInput;
  resolved: ResolveResult;
}

const ORDER: Record<ScaffoldKind, number> = {
  card: 0,
  episode: 1,
  start: 2,
  sync: 3,
  photo: 4,
  diary: 5,
  line: 6,
  end: 7,
};

const hm = (ms: number) => formatClock(ms).slice(0, 5);

/** MAXQDA-/f4-Zeitmarke: #hh:mm:ss-z# mit Zehntelsekunden. */
export function timestamp(ms: number): string {
  const t = Math.max(0, Math.round(ms / 100));
  const tenths = t % 10;
  const s = Math.floor(t / 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `#${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}-${tenths}#`;
}

export function buildScaffold(store: ProjectStore, sessionId: Id): Scaffold {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const analyses = store.listAudioAnalyses(sessionId);
  const idle = new Map<Id, Interval[]>(analyses.map((a) => [a.sourceId, a.idle]));
  const loud = new Map(analyses.map((a) => [a.sourceId, a.loudInIdle]));
  const ep = computeEpisodes(input.sources, res, idle);
  const photos = new Set(input.sources.filter((s) => s.kind === "photo" && !s.partOf).map((s) => s.id));
  // In Tafeln erscheinen Fotos und Tagebucheinträge; Tagebuchseiten zeigen sich über ihre Einträge.
  const plan = planMontage(ep, (kind, id) =>
    kind === "source" ? (photos.has(id) ? res.placements.get(id)?.startMs : undefined) : res.diary.get(id)?.fromMs,
  );

  const src = new Map(input.sources.map((s) => [s.id, s]));
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const who = (s: Source) => {
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    const person = d?.personId ? persons.get(d.personId) : undefined;
    return [d?.label, person].filter(Boolean).join(", ");
  };
  const basis = (s: Source) => res.placements.get(s.id)?.basis.detail ?? "";
  const label = (id: Id) => src.get(id)?.label ?? "?";

  const entries: ScaffoldEntry[] = [];
  const push = (e: Omit<ScaffoldEntry, "images"> & { images?: ImageRef[] }) => entries.push({ images: [], ...e });

  // Tafeln und Episoden.
  for (const seg of plan.segments) {
    if (seg.kind === "episode") {
      const names = seg.episode.sourceIds.map(label).sort();
      push({
        montageMs: seg.montageStartMs,
        kind: "episode",
        clock: formatClock(seg.fromMs),
        head: `Episode ${seg.episode.index}`,
        body: `${formatClock(seg.fromMs)}–${formatClock(seg.toMs)}, Quellen: ${names.join(", ")}`,
      });
      continue;
    }
    const span = seg.toMs - seg.fromMs;
    const idleSources = input.sources.filter((s) => {
      const p = res.placements.get(s.id);
      return p && (s.kind === "audio" || s.kind === "video") && p.startMs < seg.toMs && p.endMs > seg.fromMs;
    });
    const loudHere = idleSources.flatMap((s) => {
      const start = res.placements.get(s.id)!.startMs;
      return (loud.get(s.id) ?? []).map((l) => start + l.atMs).filter((t) => t >= seg.fromMs && t <= seg.toMs);
    });
    const parts = [
      span > 0 ? `${formatDuration(span)} ohne Episode` : "",
      idleSources.length ? `${idleSources.map((s) => s.label).join(", ")} lief weiter (Leerlauf)` : "",
      loudHere.length
        ? `Prüfhinweis: laut um ${loudHere
            .sort((a, b) => a - b)
            .map(formatClock)
            .join(", ")}`
        : "",
    ].filter(Boolean);
    push({
      montageMs: seg.montageStartMs,
      kind: "card",
      clock: span > 0 ? `${formatClock(seg.fromMs)}–${formatClock(seg.toMs)}` : formatClock(seg.fromMs),
      head: "Zwischentafel",
      body: parts.join(". "),
    });
  }

  // Quellen: Beginn von Audio/Video, Fotos.
  for (const s of input.sources) {
    const p = res.placements.get(s.id);
    if (!p || s.partOf) continue;
    if (s.kind === "audio" || s.kind === "video") {
      const at = plan.toMontage(p.startMs);
      if (at === null) continue;
      const what = s.kind === "video" ? "Video" : "Audio";
      const follows = s.follows ? `, setzt ${label(s.follows)} fort` : "";
      push({
        montageMs: at,
        kind: "start",
        clock: formatClock(p.startMs),
        head: `${what} ${s.label} beginnt`,
        body: `${s.fileName}${who(s) ? `, ${who(s)}` : ""}${follows}. Zeit: ${basis(s)}`,
      });
    } else if (s.kind === "photo") {
      const at = plan.toMontage(p.startMs, s.id);
      if (at === null) continue;
      push({
        montageMs: at,
        kind: "photo",
        clock: formatClock(p.startMs),
        clockMs: p.startMs,
        head: `Foto ${s.label}`,
        body: `${s.fileName}${who(s) ? `, ${who(s)}` : ""}. Zeit: ${basis(s)}`,
        images: [{ sourceId: s.id }],
      });
    }
  }

  // Tagebuch: am Beginn des Bezugszeitraums.
  const numbered = [...input.diaryEntries].sort((a, b) => {
    const pa = res.diary.get(a.id)?.fromMs ?? Infinity;
    const pb = res.diary.get(b.id)?.fromMs ?? Infinity;
    return pa - pb;
  });
  for (const e of numbered) {
    const dp = res.diary.get(e.id);
    if (!dp) continue;
    const at = plan.toMontage(dp.fromMs, e.id);
    if (at === null) continue;
    const first = e.regions[0] ? src.get(e.regions[0].sourceId) : undefined;
    const page = first?.partOf ? src.get(first.partOf) : first;
    const text = e.mode === "full" ? e.fullText : e.mode === "short" ? e.shortText : "";
    const modeLabel = e.mode === "full" ? "Volltext" : e.mode === "short" ? "Kurzform" : "nur Scan";
    push({
      montageMs: at,
      kind: "diary",
      clock: `ca. ${hm(dp.fromMs)} (notiert ${hm(dp.notedAtMs)})`,
      clockMs: dp.fromMs,
      head: `Tagebuch ${page?.label ?? "?"}${page && who(page) ? ` (${who(page)})` : ""}`,
      body: text ? `${modeLabel}: ${text}` : modeLabel,
      images: e.regions.map((r) => ({ sourceId: r.sourceId, region: r })),
    });
  }

  // Bestätigte Klatscher als Sync-Signal.
  for (const a of input.anchors) {
    if (a.proposed || a.kind !== "clap") continue;
    const p = res.placements.get(a.a.sourceId);
    if (!p) continue;
    const t = p.startMs + a.a.atMediaMs;
    const at = plan.toMontage(t);
    if (at === null) continue;
    push({
      montageMs: at,
      kind: "sync",
      clock: formatClock(t),
      head: "Sync-Signal",
      body: `Klatschen in ${label(a.a.sourceId)} und ${label(a.b.sourceId)}, Anker für den Abgleich`,
    });
  }

  // Mitschrift.
  const transcript = store.listTranscript(sessionId);
  const transcribed = new Set(transcript.map((l) => l.sourceId));
  for (const l of transcript) {
    const p = res.placements.get(l.sourceId);
    if (!p) continue;
    const t = p.startMs + l.atMs;
    const at = plan.toMontage(t);
    if (at === null) continue;
    const speaker = l.speaker ? `${l.speaker}: ` : "";
    push({
      montageMs: at,
      kind: "line",
      clock: formatClock(t),
      head: transcribed.size > 1 ? label(l.sourceId) : "",
      body: `${speaker}${l.text}`,
    });
  }

  push({ montageMs: plan.durationMs, kind: "end", clock: "", head: "Ende", body: "Ende der Montage" });
  entries.sort((a, b) => a.montageMs - b.montageMs || ORDER[a.kind] - ORDER[b.kind]);

  const researchers = [
    ...new Set(input.devices.flatMap((d) => (d.personId && persons.get(d.personId) ? [persons.get(d.personId)!] : []))),
  ];
  const ref = input.devices.find((d) => d.isReference);
  return {
    header: {
      title: input.session.title,
      date: input.session.date,
      place: input.session.place,
      researchers,
      reference: ref ? ref.label : null,
      sources: input.sources.filter((s) => res.placements.has(s.id) && !s.partOf).map((s) => s.label),
      extra: input.session.extra,
    },
    plan,
    entries,
    input,
    resolved: res,
  };
}

/** Eine Zeile des Zeitgerüsts als Text (ohne Bilder), wie sie im Dokument steht. */
export function entryText(e: ScaffoldEntry): string {
  const clock = e.clock ? `Uhrzeit ${e.clock} · ` : "";
  const head = e.head ? `${e.head}: ` : "";
  return `${timestamp(e.montageMs)} ${clock}${head}${e.body}`;
}
