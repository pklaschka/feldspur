/**
 * Anker vorschlagen: Für Aufnahmen, deren Uhr noch nicht abgeglichen ist, den
 * Moment finden, der in einer sicher eingeordneten Aufnahme genauso klingt.
 *
 * Zwei Wege, die sich ergänzen:
 * 1. Tonspur-Vergleich: überlappende Aufnahmen desselben Geschehens (deine
 *    Stimme in Audio und Video) per Kreuzkorrelation der Hüllkurven.
 * 2. Sync-Signale: scharfe Geräusche (Klatschen) in beiden Aufnahmen. Ein
 *    einzelnes Klatschen ist mehrdeutig; deshalb stimmen alle Clips eines Geräts
 *    gemeinsam ab, welche Uhrabweichung am besten zu allen passt.
 *
 * Ergebnis sind nur Vorschläge. Übernommen wird erst nach Bestätigung.
 */
import {
  effectiveLocal,
  type Device,
  type Id,
  type ResolveResult,
  type Source,
  type TimeEvidence,
} from "@feldspur/core";
import { detectTransients, estimateOffset, type Envelope, type Transient } from "./audio.ts";

export interface AnchorProposal {
  /** Sicher eingeordnete Aufnahme (Referenzseite). */
  refSourceId: Id;
  refAtMs: number;
  /** Aufnahme, die abgeglichen wird. */
  sourceId: Id;
  atMs: number;
  method: "clap" | "audio-correlation";
  /** Wie viele Klatscher bzw. wie eindeutig die Korrelation ist. */
  votes: number;
  score: number;
  confidence: "high" | "low";
  /** Daraus folgende Uhrabweichung des Geräts (falls es eine Geräteuhr hat). */
  impliedDeviceOffsetMs: number | null;
}

export interface ProposeInput {
  sources: Source[];
  devices: Device[];
  evidence: TimeEvidence[];
  session: { timeZone: string };
  resolved: ResolveResult;
  envelopes: Map<Id, Envelope>;
}

export interface ProposeOptions {
  /** Toleranz, innerhalb der zwei Klatscher als „gleiche Abweichung“ gelten. */
  toleranceMs?: number;
  /** So weit darf eine Geräteuhr höchstens danebenliegen. */
  maxOffsetMs?: number;
  /** Suchfenster der Korrelation um die erwartete Lage. */
  searchMs?: number;
}

const isAv = (s: Source) => s.kind === "audio" || s.kind === "video";

export function proposeAnchors(input: ProposeInput, opts: ProposeOptions = {}): AnchorProposal[] {
  const tol = opts.toleranceMs ?? 150;
  const maxOffset = opts.maxOffsetMs ?? 2 * 3600_000;
  const searchMs = opts.searchMs ?? 10 * 60_000;
  const { resolved } = input;

  const trustedIds = new Set<Id>();
  for (const s of input.sources) {
    const p = resolved.placements.get(s.id);
    if (!p || !isAv(s) || !input.envelopes.has(s.id)) continue;
    const clock = s.deviceId ? resolved.deviceClocks.get(s.deviceId) : undefined;
    if (p.basis.kind === "manual" || p.basis.kind === "anchor" || clock?.offsetMs != null) trustedIds.add(s.id);
  }
  const trusted = input.sources.filter((s) => trustedIds.has(s.id));
  const pending = input.sources.filter((s) => isAv(s) && !trustedIds.has(s.id) && input.envelopes.has(s.id));
  if (!trusted.length || !pending.length) return [];

  // Sync-Signale der Referenzseite in echter Zeit.
  const refEvents: { sourceId: Id; t: Transient; trueMs: number }[] = [];
  for (const s of trusted) {
    const start = resolved.placements.get(s.id)!.startMs;
    for (const t of detectTransients(input.envelopes.get(s.id)!))
      refEvents.push({ sourceId: s.id, t, trueMs: start + t.atMs });
  }

  // Gerätezeit, die der Clip-Anfang laut eigener Uhr hatte.
  const deviceStart = (s: Source): number | null => {
    const ev = input.evidence.find((e) => e.sourceId === s.id && e.enabled && e.clock === "device");
    const device = input.devices.find((d) => d.id === s.deviceId);
    return ev ? effectiveLocal(ev, device, input.session.timeZone) - ev.atMediaMs : null;
  };

  const out: AnchorProposal[] = [];
  const done = new Set<Id>();

  // 1. Tonspur-Vergleich je Clip gegen jede überlappende Referenzaufnahme.
  for (const s of pending) {
    const env = input.envelopes.get(s.id)!;
    const guess = resolved.placements.get(s.id)?.startMs;
    let best: AnchorProposal | null = null;
    for (const r of trusted) {
      const rp = resolved.placements.get(r.id)!;
      const est = estimateOffset(
        input.envelopes.get(r.id)!,
        env,
        guess !== undefined ? { expectedLagMs: guess - rp.startMs, searchMs } : {},
      );
      if (!est || est.score < 0.25 || est.distinctness < 1.5) continue;
      const clipStartTrue = rp.startMs + est.lagMs;
      const devStart = deviceStart(s);
      const cand: AnchorProposal = {
        refSourceId: r.id,
        refAtMs: Math.max(0, est.lagMs),
        sourceId: s.id,
        atMs: Math.max(0, -est.lagMs),
        method: "audio-correlation",
        votes: 1,
        score: est.score,
        confidence: est.distinctness >= 2 ? "high" : "low",
        impliedDeviceOffsetMs: devStart === null ? null : devStart - clipStartTrue,
      };
      if (!best || cand.score > best.score) best = cand;
    }
    if (best) {
      out.push(best);
      done.add(s.id);
    }
  }

  // 2. Klatscher: je Gerät (bzw. je Clip ohne Geräteuhr) über alle Paare abstimmen.
  type Pair = { s: Source; t: Transient; ref: (typeof refEvents)[number]; value: number };
  const groups = new Map<string, Pair[]>();
  for (const s of pending) {
    if (done.has(s.id)) continue;
    const devStart = deviceStart(s);
    const key = devStart !== null && s.deviceId ? `dev:${s.deviceId}` : `src:${s.id}`;
    const list = groups.get(key) ?? [];
    for (const t of detectTransients(input.envelopes.get(s.id)!)) {
      for (const ref of refEvents) {
        const clipStartTrue = ref.trueMs - t.atMs;
        // Mit Geräteuhr: abgestimmt wird über die Abweichung, sonst über die Lage des Clips.
        const value = devStart !== null ? devStart - clipStartTrue : clipStartTrue;
        if (devStart !== null && Math.abs(value) > maxOffset) continue;
        list.push({ s, t, ref, value });
      }
    }
    groups.set(key, list);
  }

  for (const [key, pairs] of groups) {
    if (!pairs.length) continue;
    const byDevice = key.startsWith("dev:");
    // Häufungen finden: für jedes Paar zählen, wie viele verschiedene Clip-Klatscher dazu passen.
    let bestCluster: Pair[] = [];
    let bestPrior = Infinity;
    for (const p of pairs) {
      const cluster = pairs.filter((q) => Math.abs(q.value - p.value) <= tol);
      const distinct = new Set(cluster.map((q) => `${q.s.id}@${q.t.atMs}`)).size;
      const bestDistinct = new Set(bestCluster.map((q) => `${q.s.id}@${q.t.atMs}`)).size;
      // Vorrang: mehr Stimmen, dann kleinere Abweichung (Uhren gehen selten weit falsch).
      const prior = byDevice
        ? Math.abs(p.value)
        : Math.abs(p.value - (resolved.placements.get(p.s.id)?.startMs ?? p.value));
      if (distinct > bestDistinct || (distinct === bestDistinct && prior < bestPrior)) {
        bestCluster = cluster;
        bestPrior = prior;
      }
    }
    const votes = new Set(bestCluster.map((q) => `${q.s.id}@${q.t.atMs}`)).size;
    const median = bestCluster.map((q) => q.value).sort((a, b) => a - b)[Math.floor(bestCluster.length / 2)]!;
    // Pro Clip den stärksten passenden Klatscher als Anker vorschlagen.
    const perClip = new Map<Id, Pair>();
    for (const q of bestCluster) {
      const prev = perClip.get(q.s.id);
      if (!prev || q.t.riseDb + q.ref.t.riseDb > prev.t.riseDb + prev.ref.t.riseDb) perClip.set(q.s.id, q);
    }
    for (const q of perClip.values()) {
      out.push({
        refSourceId: q.ref.sourceId,
        refAtMs: q.ref.t.atMs,
        sourceId: q.s.id,
        atMs: q.t.atMs,
        method: "clap",
        votes,
        score: Math.min(1, (q.t.riseDb + q.ref.t.riseDb) / 80),
        confidence: votes >= 2 ? "high" : "low",
        impliedDeviceOffsetMs: byDevice ? Math.round(median) : null,
      });
    }
  }
  return out;
}
