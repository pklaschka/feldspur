/**
 * Waveform als Canvas: Spiegelform um die Mittellinie, außen die Spitzen, innen der RMS-Pegel.
 * Logarithmisch (dB) zeigt leise Sprache deutlich; linear zeigt die echte Aussteuerung.
 * Wiederverwendbar: Mitschreiben zeigt einen mitlaufenden Ausschnitt, der Feinabgleich zwei Spuren.
 */
import { peakLevel, type Peaks, type WaveformScale } from "@feldspur/core/waveform";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prepareCanvas, useElementWidth } from "./canvas.ts";

const api = window.feldspur;

export type WaveTone = "accent" | "muted" | "warn" | "bad" | "good";

export interface WaveMarker {
  atMs: number;
  tone?: WaveTone;
}

export interface WaveBand {
  fromMs: number;
  toMs: number;
  tone?: WaveTone;
}

const TONE_VAR: Record<WaveTone, string> = {
  accent: "--accent",
  muted: "--muted",
  warn: "--warn",
  bad: "--bad",
  good: "--good",
};

export function Waveform({
  peaks,
  fromMs,
  toMs,
  scale = "log",
  height = 72,
  cursorMs,
  markers = [],
  bands = [],
  tone = "accent",
  ticks = false,
  onSeek,
  className,
  style,
  label = "Waveform",
}: {
  /** Ein oder mehrere Ausschnitte (Kacheln); Lücken bleiben leer. */
  peaks: Peaks[];
  /** Sichtbarer Bereich in ms ab Dateianfang. */
  fromMs: number;
  toMs: number;
  scale?: WaveformScale;
  height?: number;
  /** Wiedergabestelle. */
  cursorMs?: number;
  /** Senkrechte Striche, z. B. Zeilen der Mitschrift. */
  markers?: WaveMarker[];
  /** Hinterlegte Strecken, z. B. Notizen zu Abschnitten. */
  bands?: WaveBand[];
  tone?: WaveTone;
  /** Sekunden-Raster mit Beschriftung am unteren Rand. */
  ticks?: boolean;
  onSeek?: (ms: number) => void;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(canvas);

  useEffect(() => {
    const el = canvas.current;
    if (!el || width <= 0) return;
    const ctx = prepareCanvas(el, width, height);
    if (!ctx) return;
    draw(ctx, el, { peaks, fromMs, toMs, scale, width, height, cursorMs, markers, bands, tone, ticks });
  }, [peaks, fromMs, toMs, scale, width, height, cursorMs, markers, bands, tone, ticks]);

  return (
    <canvas
      ref={canvas}
      className={className}
      style={{ display: "block", width: "100%", height, cursor: onSeek ? "pointer" : undefined, ...style }}
      role="img"
      aria-label={label}
      onClick={(e) => {
        if (!onSeek) return;
        const b = e.currentTarget.getBoundingClientRect();
        onSeek(fromMs + ((e.clientX - b.left) / b.width) * (toMs - fromMs));
      }}
      data-testid="waveform"
    />
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  el: Element,
  o: {
    peaks: Peaks[];
    fromMs: number;
    toMs: number;
    scale: WaveformScale;
    width: number;
    height: number;
    cursorMs: number | undefined;
    markers: WaveMarker[];
    bands: WaveBand[];
    tone: WaveTone;
    ticks: boolean;
  },
): void {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim() || "#888";
  const { width: w, height: h, fromMs, toMs } = o;
  const span = Math.max(1, toMs - fromMs);
  const x = (ms: number) => ((ms - fromMs) / span) * w;
  const tickH = o.ticks ? 14 : 0;
  const waveH = h - tickH;
  const mid = waveH / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = v("--sunken");
  ctx.fillRect(0, 0, w, waveH);

  for (const b of o.bands) {
    const a = Math.max(0, x(b.fromMs));
    const e = Math.min(w, x(b.toMs));
    if (e <= a) continue;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = v(TONE_VAR[b.tone ?? "warn"]);
    ctx.fillRect(a, 0, e - a, waveH);
    ctx.globalAlpha = 1;
  }

  // Je Pixelspalte die stärksten Fächer der beteiligten Kacheln.
  const color = v(TONE_VAR[o.tone]);
  const tiles = o.peaks.filter((p) => p.toMs > fromMs && p.fromMs < toMs);
  const outer = new Float32Array(w);
  const inner = new Float32Array(w);
  for (const p of tiles) {
    const n = p.max.length;
    for (let i = 0; i < n; i++) {
      const t0 = p.fromMs + i * p.bucketMs;
      const t1 = t0 + p.bucketMs;
      if (t1 < fromMs || t0 > toMs) continue;
      const c0 = Math.max(0, Math.floor(x(t0)));
      const c1 = Math.min(w - 1, Math.max(c0, Math.ceil(x(t1)) - 1));
      const peak = peakLevel(Math.max(-p.min[i]!, p.max[i]!), o.scale);
      const rms = peakLevel(p.rms[i]!, o.scale);
      for (let c = c0; c <= c1; c++) {
        if (peak > outer[c]!) outer[c] = peak;
        if (rms > inner[c]!) inner[c] = rms;
      }
    }
  }
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.45;
  for (let c = 0; c < w; c++) {
    const a = outer[c]! * (mid - 1);
    if (a > 0) ctx.fillRect(c, mid - a, 1, Math.max(1, 2 * a));
  }
  ctx.globalAlpha = 1;
  for (let c = 0; c < w; c++) {
    const a = inner[c]! * (mid - 1);
    if (a > 0) ctx.fillRect(c, mid - a, 1, Math.max(1, 2 * a));
  }
  ctx.globalAlpha = 0.3;
  ctx.fillRect(0, Math.floor(mid), w, 1);
  ctx.globalAlpha = 1;

  for (const m of o.markers) {
    const mx = x(m.atMs);
    if (mx < 0 || mx > w) continue;
    ctx.fillStyle = v(TONE_VAR[m.tone ?? "muted"]);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(Math.round(mx), 0, 1, waveH);
    ctx.beginPath();
    ctx.moveTo(Math.round(mx) - 3, 0);
    ctx.lineTo(Math.round(mx) + 4, 0);
    ctx.lineTo(Math.round(mx) + 0.5, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (o.ticks) {
    const step = tickStep(span, w);
    ctx.fillStyle = v("--muted");
    ctx.font = `10px ${v("--font-mono") || "monospace"}`;
    ctx.textBaseline = "top";
    for (let t = Math.ceil(fromMs / step) * step; t <= toMs; t += step) {
      const tx = Math.round(x(t));
      ctx.fillRect(tx, waveH, 1, 3);
      ctx.fillText(tickText(t, step), tx + 2, waveH + 2);
    }
  }

  if (o.cursorMs !== undefined) {
    const cx = x(o.cursorMs);
    if (cx >= 0 && cx <= w) {
      ctx.fillStyle = v("--bad");
      ctx.fillRect(Math.round(cx) - 1, 0, 2, waveH);
    }
  }
}

const STEPS = [1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];

function tickStep(spanMs: number, widthPx: number): number {
  // Etwa alle 70 px eine Beschriftung.
  const want = (spanMs / widthPx) * 70;
  return STEPS.find((s) => s >= want) ?? STEPS.at(-1)!;
}

function tickText(ms: number, step: number): string {
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (step >= 60_000) return hh ? `${hh}:${p(mm)} h` : `${mm} min`;
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

// ── Kacheln laden ─────────────────────────────────────────────────────────

const cache = new Map<string, Peaks | Promise<Peaks | null>>();
const CACHE_MAX = 600;

function remember(key: string, value: Peaks | Promise<Peaks | null>): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/**
 * Spitzen für den Bereich [fromMs, toMs] in festen Kacheln laden und zwischenspeichern. So
 * kostet das Mitlaufen beim Abspielen nur ab und zu eine neue Kachel, nicht jede Bildwiederholung.
 * Die Kachel vor und nach dem Bereich wird vorab geholt.
 */
export function usePeakTiles(
  sourceId: string,
  fromMs: number,
  toMs: number,
  tileMs: number,
  bucketsPerTile: number,
  durationMs: number | null,
): Peaks[] {
  const [, bump] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const first = Math.max(0, Math.floor(fromMs / tileMs) - 1);
  const lastTile = durationMs ? Math.max(0, Math.ceil(durationMs / tileMs) - 1) : Infinity;
  const last = Math.min(lastTile, Math.floor(toMs / tileMs) + 1);
  const key = (i: number) => `${sourceId}:${tileMs}:${bucketsPerTile}:${i}`;

  useEffect(() => {
    for (let i = first; i <= last; i++) {
      const k = key(i);
      if (cache.has(k)) continue;
      const p = api
        .waveformPeaks(sourceId, i * tileMs, (i + 1) * tileMs, bucketsPerTile)
        .then((r) => {
          remember(k, r);
          if (mounted.current) bump((n) => n + 1);
          return r;
        })
        .catch(() => {
          cache.delete(k);
          return null;
        });
      remember(k, p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, first, last, tileMs, bucketsPerTile]);

  const out: Peaks[] = [];
  for (let i = first; i <= last; i++) {
    const v = cache.get(key(i));
    if (v && !(v instanceof Promise)) out.push(v);
  }
  return out;
}
