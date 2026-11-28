/**
 * Einsatztranskript: alles eines Einsatzes in einer Reihenfolge, mit der Stelle im Montagevideo.
 * Daraus entstehen das .docx für MAXQDA und die Einblendungen im Video.
 *
 * Einordnung: Drehscheibe des Schritts „Ausgeben“. `buildSessionTranscript` liest den Einsatz aus der Projektdatei,
 * lässt `packages/core/src/resolve.ts` die Lage aller Quellen aus den Zeitbelegen berechnen und `planMontage` (core)
 * die Montage planen, und stellt alles in eine Reihenfolge. Das Ergebnis (`SessionTranscript`) wird nie gespeichert,
 * sondern bei jedem Bedarf neu gebaut. Darauf bauen auf: `export.ts` (alle Dateien der Ausgabe), `docx.ts`,
 * `montage-video.ts` und `montage-preview.ts`, `fcpxml.ts`, `viewer/html.ts`, `readme.ts`, `methods-summary.ts`
 * (Übersicht) und `export-state.ts` (ist die letzte Ausgabe noch aktuell?), alle in `packages/media/src/`.
 *
 * Hier entsteht auch die Montage-ID (unten: `montageId`, `textBlock`).
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
import { datasetLines, sessionDataset } from "./dataset.ts";

/**
 * Art einer Zeile der Chronologie:
 * - card: Zwischenzeit zwischen Episoden (Tafel) oder Leerlauf
 * - episode: Kopf einer Episode
 * - start: eine Ton- oder Videoaufnahme beginnt
 * - photo: Foto
 * - diary: Tagebucheintrag
 * - line: Zeile einer Mitschrift (Transkript)
 * - sync: bestätigtes Klatschen (Anker)
 * - end: Ende der Montage
 */
export type SessionTranscriptKind = "card" | "episode" | "start" | "photo" | "diary" | "line" | "sync" | "end";

/** Bildausschnitt für das Dokument: ganzes Foto oder Rahmen auf einer Scan-Seite. */
export interface ImageRef {
  sourceId: Id;
  /** Rahmen in Anteilen der Seite (0 bis 1); fehlt beim ganzen Bild. */
  region?: { page: number; x: number; y: number; w: number; h: number };
}

/**
 * Woher eine Zeile stammt, damit die App von ihr zur Bearbeitung springen kann (Schritt „Ansehen“, Issue #131).
 * Geht in keine Ausgabe und nicht in die Montage-ID ein.
 */
export interface EntryOrigin {
  /** source: Beginn einer Aufnahme oder Foto · line: Mitschriftzeile · diary: Tagebucheintrag · sync: Klatscher. */
  kind: "source" | "line" | "diary" | "sync" | "episode";
  /** Quelle (source, line, sync), Tagebuchseite (diary) oder leer (episode). */
  id: Id;
  /** Stelle in der Aufnahme in ms (line, sync). */
  atMs?: number;
  /** Uhrzeit der Stelle (Ortszeit des Einsatzes in ms, `LocalMs`); bei Episoden ihr Beginn, `endMs` ihr Ende. */
  clockMs: number;
  endMs?: number;
}

/** Eine Zeile der Chronologie: im Dokument ein Absatz mit Zeitmarke. */
export interface SessionTranscriptEntry {
  /** Stelle im Montagevideo, in ms ab dessen Beginn; daraus wird die Zeitmarke. */
  montageMs: number;
  kind: SessionTranscriptKind;
  /** „10:16:20“, „ca. 10:05 (notiert 10:12)“, „10:17:30–10:40:00“. */
  clock: string;
  /** Uhrzeit als Zahl (Beginn bei Spannen), für Einblendungen. Ortszeit des Einsatzes in ms (`LocalMs`). */
  clockMs?: number;
  /** Fett vor dem Text, z. B. „Foto F-003“; leer bei Mitschrift aus nur einer Aufnahme. */
  head: string;
  body: string;
  /** Bilder unter der Zeile: das Foto selbst oder die Rahmen eines Tagebucheintrags. */
  images: ImageRef[];
  /** Mitschrift: Sprecher*in, steht auch vorn im body („B1: …“). Für den Viewer, der sie hervorhebt. */
  speaker?: string;
  /** Tagebuch: Schlüssel der Kontextstücke, auf die der Eintrag verweist (stehen auch am Ende von body). */
  contextRefs?: string[];
  /** Herkunft der Zeile; fehlt bei Tafeln und am Ende. */
  origin?: EntryOrigin;
}

/** Kopf des Einsatztranskripts: Angaben zum Einsatz (`FieldSession`) und die Kennung dieser Fassung. */
export interface SessionTranscriptHeader {
  title: string;
  /** Datum des Einsatzes, „2026-09-14“. */
  date: string;
  place: string;
  /** Namen der Personen, denen im Einsatz ein Gerät zugeordnet ist. */
  researchers: string[];
  /** Bezeichnung des Referenzgeräts (Referenzuhr); null, wenn keins festgelegt ist. */
  reference: string | null;
  /** Kurzzeichen der Quellen, die vorkommen: alle mit Lage auf der Zeitachse und alle, die Kontext tragen. */
  sources: string[];
  /** Freie Felder des Einsatzes für den Quellennachweis (DOI, Projektnummer, …). */
  extra: Record<string, string>;
  /**
   * Kennung der Ausgabe in drei Blöcken, z. B. „FS-7KQ2-M9XD-3F8A“. Die ersten beiden Blöcke beschreiben die
   * Montage (Einsatz, Art, Lage der Quellen), der dritte den Textstand des Einsatztranskripts. Steht im Kopf
   * des Dokuments, im Viewer und in den Dokumentvariablen. Gleicher Stand → gleiche Kennung.
   */
  montageId: string;
  /**
   * Die ersten beiden Blöcke von `montageId`, z. B. „FS-7KQ2-M9XD“. So steht die Kennung im Video eingeblendet:
   * Das Video enthält keinen Text und muss nicht neu gerechnet werden, wenn sich nur der Text ändert.
   */
  montageVideoId: string;
  /** „Episoden“ oder „Echtzeit“. */
  modeLabel: string;
  /**
   * Angaben zum Datensatz (Issue #206), soweit eingetragen: Projekt, darüber der Einsatz. Je Feld Beschriftung und
   * Wert in einer Zeile. Fehlt, wenn nichts eingetragen ist; dann bleiben Kopf und Montage-ID wie vorher.
   */
  dataset?: [string, string][];
  /** Anzahl der Kontextstücke; fehlt, wenn es keine gibt (dann bleibt alles wie vor Issue #108). */
  contextCount?: number;
}

/**
 * Kontextstück im Einsatztranskript: steht vor der ersten Zeitmarke, ohne Zeitmarke und ohne Stelle im Video.
 * Absichtlich kein SessionTranscriptEntry: Die tragen eine Stelle im Video und speisen die Einblendungen.
 */
export interface SessionTranscriptContext {
  /** Schlüssel des Kontextstücks; Tagebucheinträge verweisen darüber auf es (`contextRefs`). */
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

/** Das ganze Einsatztranskript samt allem, was die übrigen Ausgaben daraus brauchen. */
export interface SessionTranscript {
  header: SessionTranscriptHeader;
  /** Plan der Montage aus `packages/core`: Abschnitte und die Umrechnung von Uhrzeit in Stelle im Video. */
  plan: MontagePlan;
  /** Episoden benannt (Zeilen „Episode n“, Zwischenzeiten)? Sonst nur Uhrzeit, Quellen und Leerlauf. */
  episodes: boolean;
  entries: SessionTranscriptEntry[];
  /** Kontextstücke in ihrer Reihenfolge, vor der Chronologie (leer, wenn es keine gibt). */
  context: SessionTranscriptContext[];
  /** Grundlage für die Montage (Lagen, Quellen). */
  input: ResolveInput;
  /** Berechnete Zeitachse zu `input`: Lage jeder Quelle, Uhr jedes Geräts. */
  resolved: ResolveResult;
}

/** Reihenfolge der Arten, wenn zwei Zeilen an derselben Stelle und zur selben Uhrzeit stehen. */
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

/**
 * Baut das Einsatztranskript aus dem jetzigen Stand des Projekts. Liest nur aus der Projektdatei (und, für Notizen
 * im Kontext, deren Originaldateien); schreibt nichts. Gleicher Stand ergibt dieselbe Montage-ID.
 */
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
        origin: { kind: "episode", id: "", clockMs: seg.fromMs, endMs: seg.toMs },
      });
      continue;
    }
    const span = seg.toMs - seg.fromMs;
    // Aufnahmen, die in dieser Zwischenzeit liefen, ohne dass dort eine Episode ist.
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
          origin: { kind: "source", id: s.id, clockMs: p.startMs },
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
          origin: { kind: "source", id: s.id, clockMs: p.startMs },
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
    // Der erste Rahmen bestimmt, unter welcher Seite der Eintrag geführt wird; Teile einer Seite zählen zur Seite.
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
        ...(page ? { origin: { kind: "diary" as const, id: page.id, clockMs: dp.notedAtMs } } : {}),
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
        origin: { kind: "sync", id: a.a.sourceId, atMs: a.a.atMediaMs, clockMs: t },
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
        origin: { kind: "line", id: l.sourceId, atMs: l.atMs, clockMs: t },
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
  const dataset = datasetLines(sessionDataset(store, sessionId));
  const stated = {
    title: input.session.title,
    date: input.session.date,
    place: input.session.place,
    researchers,
    reference: ref ? ref.label : null,
    sources: input.sources
      .filter((s) => !s.partOf && (res.placements.has(s.id) || isContextSource(s.id)))
      .map((s) => s.label),
    extra: input.session.extra,
    ...(dataset.length ? { dataset } : {}),
  };
  // Erst die Kennung der Montage, dann der Block für den Text: Das Video trägt nur die erste (`montageVideoId`).
  const montageVideoId = montageId(sessionId, plan, named, input.sources, res);
  // Bilder über die Prüfsumme der Datei, nicht über die interne Kennung der Quelle.
  const image = (i: ImageRef) => [src.get(i.sourceId)?.sha256 ?? i.sourceId, i.region ?? null];
  const text = textBlock({
    ...stated,
    entries: entries.map((e) => [e.montageMs, e.kind, entryText(e), e.images.map(image)]),
    context: context.map((c) => [c.head, c.details, c.body, c.images.map(image)]),
  });
  return {
    header: {
      ...stated,
      montageId: `${montageVideoId}-${text}`,
      montageVideoId,
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

// Ohne leicht verwechselbare Zeichen (0/O, 1/I).
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Die ersten `length` Bytes eines SHA-1 als Zeichen aus `ID_ALPHABET`. */
function idChars(json: unknown, length: number): string {
  const bytes = createHash("sha1").update(JSON.stringify(json)).digest();
  let id = "";
  for (let i = 0; i < length; i++) id += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return id;
}

/**
 * Dritter Block der Montage-ID: alles, was im Einsatztranskript steht (Kopf, Zeilen mit Zeitmarke, Bilder, Kontext).
 * Ändert sich mit jedem Wort, aber auch, wenn Zeilen an einer anderen Stelle im Video stehen.
 */
function textBlock(content: unknown): string {
  return idChars(content, 4);
}

/**
 * Die ersten beiden Blöcke der Montage-ID: Einsatz, Art der Montage und Lage der Quellen. Quellen gehen mit ihrer
 * Prüfsumme ein, nicht mit ihrer internen Kennung: Dieselben Dateien an derselben Stelle ergeben im selben Einsatz
 * dieselbe Kennung.
 */
function montageId(sessionId: Id, plan: MontagePlan, named: boolean, sources: Source[], res: ResolveResult): string {
  const id = idChars(
    {
      sessionId,
      mode: plan.mode,
      // Echtzeit mit benannten Episoden wie bisher; ohne Episoden ist es eine andere Montage.
      ...(plan.mode === "realtime" && !named ? { episodes: false } : {}),
      durationMs: Math.round(plan.durationMs),
      sources: sources
        .filter((s) => res.placements.has(s.id))
        .map((s) => [s.sha256, Math.round(res.placements.get(s.id)!.startMs)])
        .sort(),
    },
    8,
  );
  return `FS-${id.slice(0, 4)}-${id.slice(4)}`;
}
