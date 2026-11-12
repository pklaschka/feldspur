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
} from "@feldspur/core";
import { computeEnvelope, detectIdle, packEnvelope, unpackEnvelope, type Envelope, type IdleOptions } from "./audio.ts";
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
      envelopes.set(s.id, unpackEnvelope(cached.envelope, cached.envelopeRate));
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
  return computeEpisodes(input.sources, resolved, idle);
}
