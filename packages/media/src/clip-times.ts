/**
 * Zeitbelege eines Geräts gemeinsam betrachten (rein, ohne I/O).
 *
 * Manches lässt sich an einer einzelnen Datei nicht entscheiden, wohl aber an allen Clips eines Geräts:
 *
 * 1. Beginn oder Ende? MP4 sagt nicht, ob `creation_time` den Aufnahmebeginn meint oder den Moment, in dem die Datei
 *    abgeschlossen wurde. Viele Android-Handys (etwa Google Pixel) schreiben das Ende. Erkennbar ist das, wenn der
 *    Dateiname den Beginn trägt (Name + Länge ≈ creation_time), und daran, dass sich Clips eines Geräts sonst
 *    überlappen würden, was physisch nicht geht.
 * 2. Kamera-Timecode: Läuft der Timecode einer Kamera frei mit (Free Run), ist sein Abstand zur Kamerauhr für alle
 *    Clips gleich. Die Uhr ist nur sekundengenau, der Timecode bildgenau. Aus mehreren Clips folgt der Abstand auf
 *    Bruchteile einer Sekunde genau und damit die Lage jedes Clips.
 */
import type { MediaProbe } from "./probe.ts";
import type { EvidenceDraft } from "./evidence.ts";
import type { ImportCandidate } from "./import.ts";

const QUARTER_HOUR = 15 * 60_000;
const DAY = 86_400_000;
/** So weit darf creation_time vom Ende laut Dateiname abweichen: Handys schreiben das Datum erst nach dem Speichern. */
const END_TOLERANCE_MS = 10_000;
/** Kürzere Clips lassen keine Unterscheidung zu: Beginn und Ende liegen zu dicht beieinander. */
const MIN_DECIDING_MS = 2 * END_TOLERANCE_MS;
/** Überlappung, die als echt gilt (Sekundenrundung zweier Stempel nicht mitgezählt). */
const OVERLAP_MS = 2_000;
/** creation_time als Ende: sekundengenau, dazu bis zu ein paar Sekunden, bis die Datei abgeschlossen war. */
export const END_STAMP_UNCERTAINTY_MS = 3_000;

const isCreationTime = (e: EvidenceDraft) =>
  e.kind === "metadata" && e.raw.startsWith("creation_time=") && e.atMediaMs === 0;

/** Abstand zum nächsten Vielfachen einer Viertelstunde (Zeitzonen), höchstens 14 Stunden; sonst Infinity. */
function gridResidual(x: number, grid: boolean): number {
  if (!grid) return Math.abs(x);
  if (Math.abs(x) > 14 * 3_600_000 + END_TOLERANCE_MS) return Infinity;
  const r = ((x % QUARTER_HOUR) + QUARTER_HOUR) % QUARTER_HOUR;
  return Math.min(r, QUARTER_HOUR - r);
}

/**
 * Passt creation_time zum Beginn oder zum Ende laut Dateiname? Trägt nur einer von beiden UTC, kann eine Zeitzone
 * dazwischenliegen: dann zählt der Abstand bis auf ganze Viertelstunden.
 */
export function creationTimeMeans(c: Pick<ImportCandidate, "evidence" | "durationMs">): "start" | "end" | null {
  const ct = c.evidence.find(isCreationTime);
  const name = c.evidence.find((e) => e.kind === "filename");
  const dur = c.durationMs;
  if (!ct || !name || !dur || dur < MIN_DECIDING_MS || name.uncertaintyMs > 1_000) return null;
  const bothUtc = ct.utcMs != null && name.utcMs != null;
  const d = bothUtc ? ct.utcMs! - name.utcMs! : ct.localMs - name.localMs;
  const startFit = gridResidual(d, !bothUtc) <= END_TOLERANCE_MS;
  const endFit = gridResidual(d - dur, !bothUtc) <= END_TOLERANCE_MS;
  if (endFit && !startFit) return "end";
  if (startFit && !endFit) return "start";
  return null;
}

/** Würden sich die Clips überlappen, wenn ihre Stempel bei `atStart` (Beginn) bzw. am Ende gälten? */
function overlaps(clips: { at: number; dur: number }[], atStart: boolean): number {
  const spans = clips
    .map((c) => (atStart ? { from: c.at, to: c.at + c.dur } : { from: c.at - c.dur, to: c.at }))
    .toSorted((a, b) => a.from - b.from);
  let n = 0;
  for (let i = 1; i < spans.length; i++) if (spans[i]!.from < spans[i - 1]!.to - OVERLAP_MS) n++;
  return n;
}

/** Liest ein Gerät creation_time als Ende? Dateinamen entscheiden per Mehrheit, sonst die Überlappungsprobe. */
export function deviceWritesEnd(cands: Pick<ImportCandidate, "evidence" | "durationMs">[]): boolean {
  let end = 0;
  let start = 0;
  for (const c of cands) {
    const v = creationTimeMeans(c);
    if (v === "end") end++;
    else if (v === "start") start++;
  }
  if (end !== start) return end > start;
  const clips = cands.flatMap((c) => {
    const ct = c.evidence.find(isCreationTime);
    return ct && c.durationMs ? [{ at: ct.localMs, dur: c.durationMs }] : [];
  });
  return clips.length >= 2 && overlaps(clips, true) > 0 && overlaps(clips, false) === 0;
}

function asEnd(e: EvidenceDraft, durationMs: number): EvidenceDraft {
  return {
    ...e,
    atMediaMs: durationMs,
    uncertaintyMs: END_STAMP_UNCERTAINTY_MS,
    detail: "Metadaten (Aufnahmeende: das Gerät schreibt das Datum beim Abschließen der Datei)",
  };
}

/** "10:34:39:08" (oder mit ";" bei Drop-Frame) → Bilder seit Mitternacht. Drop-Frame wird nicht unterstützt. */
export function timecodeFrames(tc: string, nominalFps: number): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})[:.](\d{2})$/.exec(tc.trim());
  if (!m) return null;
  const [h, mi, s, f] = m.slice(1).map(Number) as [number, number, number, number];
  if (h > 23 || mi > 59 || s > 59 || f >= nominalFps) return null;
  return ((h * 60 + mi) * 60 + s) * nominalFps + f;
}

interface TimedClip {
  index: number;
  base: EvidenceDraft;
  tc: string;
  tcMs: number;
  frameMs: number;
  fps: string;
}

function timedClip(c: ImportCandidate, index: number): TimedClip | null {
  const probe = c.metadata.media as MediaProbe | undefined;
  const tc = probe?.tags["timecode"];
  const rate = probe?.frameRate;
  // Der genaueste Uhrbeleg am Dateianfang: Apple, Kamera-XML oder creation_time.
  const base = c.evidence.find((e) => e.kind === "metadata" && e.atMediaMs === 0);
  if (!tc || !rate || !base) return null;
  const nominal = Math.round(rate.num / rate.den);
  const frames = timecodeFrames(tc, nominal);
  if (frames === null) return null;
  // Bei 29,97 und 23,976 zählt der Timecode Bilder, nicht Sekunden: echte Zeit = Bilder / echte Bildrate.
  const tcMs = (frames * rate.den * 1000) / rate.num;
  return { index, base, tc, tcMs, frameMs: (rate.den * 1000) / rate.num, fps: `${rate.num}/${rate.den}` };
}

/**
 * Abstand Kamerauhr − Timecode aus mehreren Clips. Die Uhr schneidet vermutlich auf ganze Sekunden ab: Jeder Clip
 * sagt dann „Abstand liegt in [r, r + 1 s)“. Die Schnittmenge aller Clips wird mit jedem Clip enger. Passen die Clips
 * nicht zusammen (Timecode läuft nur während der Aufnahme oder wurde neu gesetzt), gibt es kein Ergebnis.
 */
export function timecodeOffset(
  clips: { clockMs: number; tcMs: number; frameMs: number }[],
): { offsetMs: number; uncertaintyMs: number } | null {
  if (clips.length < 2) return null;
  const first = clips[0]!.clockMs - clips[0]!.tcMs;
  // Timecode springt um Mitternacht auf 00:00:00:00 zurück.
  const rs = clips.map((c) => {
    let r = c.clockMs - c.tcMs;
    while (r - first > DAY / 2) r -= DAY;
    while (first - r > DAY / 2) r += DAY;
    return r;
  });
  const frameMs = Math.max(...clips.map((c) => c.frameMs));
  let lo = Math.max(...rs);
  let hi = Math.min(...rs) + 1000;
  if (hi < lo - 2 * frameMs) return null;
  if (hi < lo) [lo, hi] = [(lo + hi) / 2, (lo + hi) / 2];
  return { offsetMs: (lo + hi) / 2, uncertaintyMs: Math.max(Math.round((hi - lo) / 2), Math.round(frameMs / 2)) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const formatOffset = (ms: number) => {
  const sign = ms < 0 ? "−" : "+";
  const s = Math.round(Math.abs(ms) / 100) / 10;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${sign}${h}:${pad(m)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** Belege aus dem Kamera-Timecode für alle Clips eines Geräts, deren Timecode frei mitläuft. */
function timecodeEvidence(cands: ImportCandidate[]): Map<number, EvidenceDraft> {
  const clips = cands.flatMap((c, i) => timedClip(c, i) ?? []);
  const off = timecodeOffset(clips.map((c) => ({ clockMs: c.base.localMs, tcMs: c.tcMs, frameMs: c.frameMs })));
  const out = new Map<number, EvidenceDraft>();
  if (!off) return out;
  for (const c of clips) {
    const localMs = Math.round(c.tcMs + off.offsetMs);
    out.set(c.index, {
      kind: "metadata",
      clock: "device",
      atMediaMs: 0,
      localMs,
      utcMs: c.base.utcMs != null ? localMs + (c.base.utcMs - c.base.localMs) : null,
      uncertaintyMs: off.uncertaintyMs,
      detail: `Kamera-Timecode ${c.tc} (bildgenau; Abstand zur Kamerauhr aus ${clips.length} Clips)`,
      raw: `timecode=${c.tc} fps=${c.fps} uhr−timecode=${formatOffset(off.offsetMs)}`,
    });
  }
  return out;
}

/**
 * Zeitbelege aller Clips je Gerät nachschärfen: creation_time als Aufnahmeende lesen, wo das Gerät es so schreibt,
 * und bildgenaue Belege aus dem Kamera-Timecode ergänzen. Andere Dateien bleiben unverändert.
 */
export function refineClipTimes(cands: ImportCandidate[]): ImportCandidate[] {
  const byDevice = new Map<string, number[]>();
  cands.forEach((c, i) => {
    if (c.kind !== "video" && c.kind !== "audio") return;
    byDevice.set(c.deviceKey, [...(byDevice.get(c.deviceKey) ?? []), i]);
  });
  const out = [...cands];
  for (const idx of byDevice.values()) {
    const group = idx.map((i) => cands[i]!);
    if (deviceWritesEnd(group)) {
      for (const i of idx) {
        const c = out[i]!;
        const dur = c.durationMs;
        if (!dur) continue;
        out[i] = { ...c, evidence: c.evidence.map((e) => (isCreationTime(e) ? asEnd(e, dur) : e)) };
      }
    }
    const tc = timecodeEvidence(idx.map((i) => out[i]!));
    tc.forEach((ev, j) => {
      const i = idx[j]!;
      out[i] = { ...out[i]!, evidence: [ev, ...out[i]!.evidence] };
    });
  }
  return out;
}
