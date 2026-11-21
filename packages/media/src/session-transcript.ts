/**
 * Einsatztranskript: alles eines Einsatzes in einer Reihenfolge, mit der Stelle im Montagevideo.
 * Daraus entstehen das .docx für MAXQDA und die Einblendungen im Video.
 */
import { createHash } from "node:crypto";
import {
  formatClock,
  formatDuration,
  planMontage,
  resolveTimeline,
  type Id,
  type MontageMode,
  type MontagePlan,
  type ProjectStore,
  type ResolveInput,
  type ResolveResult,
  type Source,
  diaryPageLabel,
} from "@feldspur/core";
import { sessionEpisodes } from "./analyze.ts";
import { contextBody, contextHeadDetails, contextPieces } from "./context.ts";

export type SessionTranscriptKind = "card" | "episode" | "start" | "photo" | "diary" | "line" | "sync" | "end";

/** Bildausschnitt für das Dokument: ganzes Foto oder Rahmen auf einer Scan-Seite. */
export interface ImageRef {
  sourceId: Id;
  region?: { page: number; x: number; y: number; w: number; h: number };
}

export interface SessionTranscriptEntry {
  /** Stelle im Montagevideo. */
  montageMs: number;
  kind: SessionTranscriptKind;
  /** „10:16:20“, „ca. 10:05 (notiert 10:12)“, „10:17:30–10:40:00“. */
  clock: string;
  /** Uhrzeit als Zahl (Beginn bei Spannen), für Einblendungen. */
  clockMs?: number;
  head: string;
  body: string;
  images: ImageRef[];
  /** Mitschrift: Sprecher*in, steht auch vorn im body („B1: …“). Für den Viewer, der sie hervorhebt. */
  speaker?: string;
  /** Tagebuch: Schlüssel der Kontextstücke, auf die der Eintrag verweist (stehen auch am Ende von body). */
  contextRefs?: string[];
}

export interface SessionTranscriptHeader {
  title: string;
  date: string;
  place: string;
  researchers: string[];
  reference: string | null;
  sources: string[];
  extra: Record<string, string>;
  /**
   * Kennung, die Montagevideo und Einsatztranskript einander zuordnet. Steht im Video eingeblendet
   * und in den Metadaten, im Dokument im Kopf. Gleicher Stand → gleiche Kennung.
   */
  montageId: string;
  /** „Episoden“ oder „Echtzeit“. */
  modeLabel: string;
  /** Anzahl der Kontextstücke; fehlt, wenn es keine gibt (dann bleibt alles wie vor Issue #108). */
  contextCount?: number;
}

/**
 * Kontextstück im Einsatztranskript: steht vor der ersten Zeitmarke, ohne Zeitmarke und ohne Stelle im Video.
 * Absichtlich kein SessionTranscriptEntry: Die tragen eine Stelle im Video und speisen die Einblendungen.
 */
export interface SessionTranscriptContext {
  key: string;
  position: number;
  /** Fett: „Kontext · Karte 2: Standplan“. Der Wortlaut „Kontext · “ am Anfang ist fest (zum Suchen in MAXQDA). */
  head: string;
  /** Grau dahinter: Fundstelle, Person, entstanden, notiert, erwähnt um. */
  details: string;
  /** Text darunter („Kurzform: …“); leer bei Fotos ohne Text. */
  body: string;
  images: ImageRef[];
}

export interface SessionTranscript {
  header: SessionTranscriptHeader;
  plan: MontagePlan;
  /** Episoden benannt (Zeilen „Episode n“, Zwischenzeiten)? Sonst nur Uhrzeit, Quellen und Leerlauf. */
  episodes: boolean;
  entries: SessionTranscriptEntry[];
  /** Kontextstücke in ihrer Reihenfolge, vor der Chronologie (leer, wenn es keine gibt). */
  context: SessionTranscriptContext[];
  /** Grundlage für die Montage (Lagen, Quellen). */
  input: ResolveInput;
  resolved: ResolveResult;
}

const ORDER: Record<SessionTranscriptKind, number> = {
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

export interface SessionTranscriptOptions {
  /** Alles in Echtzeit (Standard) oder Episoden mit kurzen Tafeln dazwischen. */
  mode?: MontageMode;
  /**
   * Episoden im Einsatztranskript und Video benennen. Nur auf Wunsch; bei mode "episodes" immer.
   * Ohne sie bleibt die Echtzeit-Montage gleich lang, nur ohne Episoden- und Zwischenzeit-Zeilen.
   */
  episodes?: boolean;
}

export function buildSessionTranscript(
  store: ProjectStore,
  sessionId: Id,
  opts: SessionTranscriptOptions = {},
): SessionTranscript {
  const input = store.loadResolveInput(sessionId);
  const res = resolveTimeline(input);
  const analyses = store.listAudioAnalyses(sessionId);
  const loud = new Map(analyses.map((a) => [a.sourceId, a.loudInIdle]));
  const ep = sessionEpisodes(store, sessionId, { input, resolved: res, analyses });
  const photos = new Set(input.sources.filter((s) => s.kind === "photo" && !s.partOf).map((s) => s.id));
  // In Zwischenzeiten stehen Fotos und Tagebucheinträge; Tagebuchseiten zeigen sich über ihre Einträge.
  const plan = planMontage(
    ep,
    (kind, id) =>
      kind === "source" ? (photos.has(id) ? res.placements.get(id)?.startMs : undefined) : res.diary.get(id)?.notedAtMs,
    { mode: opts.mode },
  );
  const named = plan.mode === "episodes" || opts.episodes === true;

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

  const entries: SessionTranscriptEntry[] = [];
  // Uhrzeit je Zeile, nur zum Sortieren an derselben Stelle im Video (Zwischentafel nach Episoden, Issue #153).
  const realMs = new Map<SessionTranscriptEntry, number>();
  const push = (e: Omit<SessionTranscriptEntry, "images"> & { images?: ImageRef[] }, atMs?: number) => {
    const entry = { images: [], ...e };
    entries.push(entry);
    if (atMs !== undefined) realMs.set(entry, atMs);
  };

  // Tafeln und Episoden.
  for (const seg of plan.segments) {
    if (seg.kind === "episode") {
      if (!named) continue;
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
    // Ohne Episoden zählt eine Zwischenzeit nur, wenn dort eine Aufnahme im Leerlauf weiterlief.
    if (!named && !idleSources.length) continue;
    const parts = [
      named && span > 0 ? `${formatDuration(span)} ohne Episode` : "",
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
      head: !named ? "Leerlauf" : plan.mode === "realtime" ? "Zwischenzeit" : "Zwischentafel",
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
      push(
        {
          montageMs: at,
          kind: "start",
          clock: formatClock(p.startMs),
          head: `${what} ${s.label} beginnt`,
          body: `${s.fileName}${who(s) ? `, ${who(s)}` : ""}${follows}. Zeit: ${basis(s)}`,
        },
        p.startMs,
      );
    } else if (s.kind === "photo") {
      const at = plan.toMontage(p.startMs, s.id);
      if (at === null) continue;
      push(
        {
          montageMs: at,
          kind: "photo",
          clock: formatClock(p.startMs),
          clockMs: p.startMs,
          head: `Foto ${s.label}`,
          body: `${s.fileName}${who(s) ? `, ${who(s)}` : ""}. Zeit: ${basis(s)}`,
          images: [{ sourceId: s.id }],
        },
        p.startMs,
      );
    }
  }

  // Kontext: vor der Chronologie, ohne Zeitmarke (Issue #108).
  const pieces = contextPieces(input, res, persons);
  const pieceByKey = new Map(pieces.map((p) => [p.item.key, p]));
  const context: SessionTranscriptContext[] = pieces.map((p) => ({
    key: p.item.key,
    position: p.item.position,
    head: `Kontext · ${p.name}`,
    details: contextHeadDetails(p),
    body: contextBody(p),
    images: p.images,
  }));

  // Tagebuch: am Beginn des Bezugszeitraums.
  const numbered = input.diaryEntries.toSorted((a, b) => {
    const pa = res.diary.get(a.id)?.notedAtMs ?? Infinity;
    const pb = res.diary.get(b.id)?.notedAtMs ?? Infinity;
    return pa - pb;
  });
  for (const e of numbered) {
    const dp = res.diary.get(e.id);
    if (!dp) continue;
    const at = plan.toMontage(dp.notedAtMs, e.id);
    if (at === null) continue;
    const first = e.regions[0] ? src.get(e.regions[0].sourceId) : undefined;
    const page = first?.partOf ? src.get(first.partOf) : first;
    const text = e.mode === "full" ? e.fullText : e.mode === "short" ? e.shortText : "";
    const modeLabel = e.mode === "full" ? "Volltext" : e.mode === "short" ? "Kurzform" : "nur Scan";
    // Verweise auf Kontextstücke im selben Absatz, damit keine zweite Zeitmarke nötig wird. Ruhende fehlen.
    const refKeys = [...new Set(e.contextRefs)].filter((k) => pieceByKey.has(k));
    const refs = refKeys.map((k) => pieceByKey.get(k)!.name);
    const refText = refs.length ? ` → Kontext: ${refs.join("; ")}` : "";
    push(
      {
        montageMs: at,
        kind: "diary",
        clock: `${hm(dp.notedAtMs)} (notiert, bezieht sich auf ca. ${hm(dp.fromMs)}–${hm(dp.toMs)})`,
        clockMs: dp.notedAtMs,
        head: `Tagebuch ${first && e.regions[0] ? diaryPageLabel(first, e.regions[0]) : (page?.label ?? "?")}${page && who(page) ? ` (${who(page)})` : ""}`,
        body: (text ? `${modeLabel}: ${text}` : modeLabel) + refText,
        images: e.regions.map((r) => ({ sourceId: r.sourceId, region: r })),
        ...(refKeys.length ? { contextRefs: refKeys } : {}),
      },
      dp.notedAtMs,
    );
  }

  // Bestätigte Klatscher als Sync-Signal.
  for (const a of input.anchors) {
    if (a.proposed || a.kind !== "clap") continue;
    const p = res.placements.get(a.a.sourceId);
    if (!p) continue;
    const t = p.startMs + a.a.atMediaMs;
    const at = plan.toMontage(t);
    if (at === null) continue;
    push(
      {
        montageMs: at,
        kind: "sync",
        clock: formatClock(t),
        head: "Sync-Signal",
        body: `Klatschen in ${label(a.a.sourceId)} und ${label(a.b.sourceId)}, Anker für den Abgleich`,
      },
      t,
    );
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
    push(
      {
        montageMs: at,
        kind: "line",
        clock: formatClock(t),
        head: transcribed.size > 1 ? label(l.sourceId) : "",
        body: `${speaker}${l.text}`,
        ...(l.speaker ? { speaker: l.speaker } : {}),
      },
      t,
    );
  }

  push({ montageMs: plan.durationMs, kind: "end", clock: "", head: "Ende", body: "Ende der Montage" });
  // An derselben Stelle: Tafel und Episodenkopf zuerst, dann nach Uhrzeit, bei gleicher Uhrzeit nach Art.
  const lead = (e: SessionTranscriptEntry) =>
    e.kind === "card" || e.kind === "episode" ? 0 : e.kind === "end" ? 2 : 1;
  entries.sort(
    (a, b) =>
      a.montageMs - b.montageMs ||
      lead(a) - lead(b) ||
      (realMs.get(a) ?? 0) - (realMs.get(b) ?? 0) ||
      ORDER[a.kind] - ORDER[b.kind],
  );

  // Quellen, die Kontext tragen: Kontext-Quellen selbst und Tagebuchseiten mit Kontext-Einträgen.
  const contextSources = new Set<Id>();
  for (const p of pieces) {
    if (p.source) contextSources.add(p.source.id);
    for (const r of p.entry?.regions ?? []) contextSources.add(src.get(r.sourceId)?.partOf ?? r.sourceId);
  }
  const isContextSource = (id: Id) => contextSources.has(id);

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
      sources: input.sources
        .filter((s) => !s.partOf && (res.placements.has(s.id) || isContextSource(s.id)))
        .map((s) => s.label),
      extra: input.session.extra,
      montageId: montageId(sessionId, plan, named, input.sources, res),
      modeLabel: plan.mode === "realtime" ? "Echtzeit" : "Episoden",
      ...(context.length ? { contextCount: context.length } : {}),
    },
    plan,
    episodes: named,
    entries,
    context,
    input,
    resolved: res,
  };
}

/** Eine Zeile des Einsatztranskripts als Text (ohne Bilder), wie sie im Dokument steht. */
export function entryText(e: SessionTranscriptEntry): string {
  const clock = e.clock ? `Uhrzeit ${e.clock} · ` : "";
  const head = e.head ? `${e.head}: ` : "";
  return `${timestamp(e.montageMs)} ${clock}${head}${e.body}`;
}

/** Kurze, gut lesbare Kennung aus Einsatz, Art der Montage und Lage der Quellen. */
function montageId(sessionId: Id, plan: MontagePlan, named: boolean, sources: Source[], res: ResolveResult): string {
  const h = createHash("sha1").update(
    JSON.stringify({
      sessionId,
      mode: plan.mode,
      // Echtzeit mit benannten Episoden wie bisher; ohne Episoden ist es eine andere Montage.
      ...(plan.mode === "realtime" && !named ? { episodes: false } : {}),
      durationMs: Math.round(plan.durationMs),
      sources: sources
        .filter((s) => res.placements.has(s.id))
        .map((s) => [s.sha256, Math.round(res.placements.get(s.id)!.startMs)])
        .sort(),
    }),
  );
  // Ohne leicht verwechselbare Zeichen (0/O, 1/I).
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = h.digest();
  let id = "";
  for (let i = 0; i < 8; i++) id += alphabet[bytes[i]! % alphabet.length];
  return `FS-${id.slice(0, 4)}-${id.slice(4)}`;
}
