/**
 * Tonspuren eines Einsatzes analysieren und Anker vorschlagen. Ergebnisse
 * werden in der Projektdatei zwischengespeichert; bereits analysierte Quellen
 * werden übersprungen, solange sich das Verfahren nicht geändert hat.
 */
import {
  computeEpisodes,
  resolveTimeline,
  type AudioAnalysis,
  type EpisodeResult,
  type Id,
  type Interval,
  type ProjectStore,
  speechLevelDb,
} from "@feldspur/core";
import {
  audioLevelOf,
  computeEnvelope,
  detectIdle,
  packEnvelope,
  unpackEnvelope,
  type AudioLevel,
  type Envelope,
  type IdleOptions,
} from "./audio.ts";
import { proposeAnchors, type AnchorProposal } from "./sync.ts";

/** Erhöhen, wenn sich Hüllkurve oder Leerlauf-Erkennung ändern. */
export const ANALYSIS_VERSION = 1;

export interface AnalyzeOptions extends IdleOptions {
  onProgress?: (done: number, total: number, fileName: string) => void;
}

export interface AnalyzeResult {
  analyzed: number;
  failed: { sourceId: Id; fileName: string; message: string }[];
  proposals: AnchorProposal[];
}

export async function analyzeSession(
  store: ProjectStore,
  sessionId: Id,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const sources = store.listSources(sessionId).filter((s) => s.kind === "audio" || s.kind === "video");
  const existing = new Map(store.listAudioAnalyses(sessionId).map((a) => [a.sourceId, a]));
  const envelopes = new Map<Id, Envelope>();
  const failed: AnalyzeResult["failed"] = [];
  let analyzed = 0;

  for (const [i, s] of sources.entries()) {
    opts.onProgress?.(i, sources.length, s.fileName);
    const cached = existing.get(s.id);
    if (cached && cached.version === ANALYSIS_VERSION) {
      const env = unpackEnvelope(cached.envelope, cached.envelopeRate);
      envelopes.set(s.id, env);
      if (cached.speechLevelDb === null) store.saveAudioAnalysis({ ...cached, speechLevelDb: speechLevelDb(env.db) });
      continue;
    }
    try {
      const env = await computeEnvelope(s.originalPath);
      const idle = detectIdle(env, opts);
      store.saveAudioAnalysis({
        sourceId: s.id,
        envelope: packEnvelope(env),
        envelopeRate: env.rate,
        noiseFloorDb: idle.noiseFloorDb,
        idle: idle.idle,
        loudInIdle: idle.loudInIdle,
        speechLevelDb: speechLevelDb(env.db),
        version: ANALYSIS_VERSION,
        analyzedAt: new Date().toISOString(),
      });
      envelopes.set(s.id, env);
      analyzed++;
    } catch (e) {
      failed.push({ sourceId: s.id, fileName: s.fileName, message: (e as Error).message });
    }
  }
  opts.onProgress?.(sources.length, sources.length, "");

  const input = store.loadResolveInput(sessionId);
  const resolved = resolveTimeline(input);
  const proposals = proposeAnchors({ ...input, resolved, envelopes });
  store.replaceProposedAnchors(
    sessionId,
    proposals.map((p) => ({
      sessionId,
      kind: p.method,
      a: { sourceId: p.refSourceId, atMediaMs: p.refAtMs },
      b: { sourceId: p.sourceId, atMediaMs: p.atMs },
      uncertaintyMs: p.method === "clap" ? 20 : 50,
      confidence: Math.round(Math.min(1, p.confidence === "high" ? 0.5 + p.score / 2 : p.score / 2) * 100) / 100,
      note:
        p.method === "clap"
          ? `${p.votes} ${p.votes === 1 ? "Klatscher" : "Klatscher passen"} zusammen`
          : "Tonspuren stimmen überein",
    })),
  );
  return { analyzed, failed, proposals };
}

/** Episoden eines Einsatzes aus gespeicherter Analyse und aktueller Zeitbestimmung. */
export function sessionEpisodes(
  store: ProjectStore,
  sessionId: Id,
  analyses: AudioAnalysis[] = store.listAudioAnalyses(sessionId),
): EpisodeResult {
  const input = store.loadResolveInput(sessionId);
  const resolved = resolveTimeline(input);
  const idle = new Map<Id, Interval[]>(analyses.map((a) => [a.sourceId, a.idle]));
  return computeEpisodes(input.sources, resolved, idle, { edits: store.listEpisodeEdits(sessionId) });
}

/**
 * Sprachpegel je Quelle (für die Lautstärke-Angleichung). Ältere Analysen ohne Pegel werden aus
 * der gespeicherten Hüllkurve nachgerechnet und gespeichert. Nicht analysierte Quellen fehlen.
 */
export function speechLevels(
  store: ProjectStore,
  sessionId: Id,
  analyses: AudioAnalysis[] = store.listAudioAnalyses(sessionId),
): Map<Id, number | null> {
  const out = new Map<Id, number | null>();
  for (const a of analyses) {
    let level = a.speechLevelDb;
    if (level === null) {
      level = speechLevelDb(unpackEnvelope(a.envelope, a.envelopeRate).db);
      if (level !== null) store.saveAudioAnalysis({ ...a, speechLevelDb: level });
    }
    out.set(a.sourceId, level);
  }
  return out;
}

/** Nur den Pegel einer Quelle messen (ohne Anker-Vorschläge), etwa vor dem Ausgeben. */
export async function measureSource(store: ProjectStore, sourceId: Id): Promise<number | null> {
  const s = store.getSource(sourceId);
  const env = await computeEnvelope(s.originalPath);
  const idle = detectIdle(env);
  const level = speechLevelDb(env.db);
  store.saveAudioAnalysis({
    sourceId: s.id,
    envelope: packEnvelope(env),
    envelopeRate: env.rate,
    noiseFloorDb: idle.noiseFloorDb,
    idle: idle.idle,
    loudInIdle: idle.loudInIdle,
    speechLevelDb: level,
    version: ANALYSIS_VERSION,
    analyzedAt: new Date().toISOString(),
  });
  return level;
}

/**
 * Lautstärke-Angleichung aller Ton- und Videoquellen eines Einsatzes, so wie sie im Montagevideo
 * gilt. Mit measureMissing werden Quellen auf „automatisch“, die noch keinen Pegel haben, zuerst
 * gemessen (dekodiert die ganze Datei).
 */
export async function sessionLevels(
  store: ProjectStore,
  sessionId: Id,
  opts: { measureMissing?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<Id, AudioLevel | null>> {
  const sources = store.listSources(sessionId).filter((s) => s.kind === "audio" || s.kind === "video");
  const measured = speechLevels(store, sessionId);
  if (opts.measureMissing) {
    const missing = sources.filter((s) => s.levelMode === "auto" && !measured.has(s.id));
    for (const [i, s] of missing.entries()) {
      opts.onProgress?.(i, missing.length);
      // Nicht lesbare Dateien bleiben unverändert; das Montagevideo scheitert daran nicht.
      measured.set(s.id, await measureSource(store, s.id).catch(() => null));
    }
    if (missing.length) opts.onProgress?.(missing.length, missing.length);
  }
  return new Map(sources.map((s) => [s.id, audioLevelOf(s, measured.get(s.id) ?? null)]));
}

/** „+12,0 dB, Kompressor“ für Begleitprotokoll und Oberfläche. */
export function levelText(level: AudioLevel | null | undefined): string {
  if (!level) return "unverändert";
  const db = `${level.gainDb >= 0 ? "+" : "−"}${Math.abs(level.gainDb).toFixed(1).replace(".", ",")} dB`;
  return level.compress ? `${db}, Kompressor` : db;
}
