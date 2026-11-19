/**
 * Feinabgleich zweier Tonspuren an einer markanten Stelle (eine Stimme, ein Klatscher, eine Tür).
 * Beide Waveforms liegen übereinander; die zweite lässt sich mit der Maus ziehen, bis die Spitzen
 * deckungsgleich sind. „Einrasten“ sucht die genaue Lage im Umkreis, „Anhören“ spielt beide
 * gleichzeitig, die erste links, die zweite rechts: Passt es, klingt es wie eine Aufnahme.
 * Gespeichert wird ein Anker mit Genauigkeit von wenigen Millisekunden.
 */
import { formatDuration } from "@feldspur/core/time";
import { peakLevel, type Peaks, type WaveformScale } from "@feldspur/core/waveform";
import { Dialog } from "radix-ui";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { mediaUrl, type AlignResult, type SessionView, type SourceRow } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { prepareCanvas, useElementWidth } from "./canvas.ts";
import { Button, Choice, CloseButton, cx, ErrorBanner, Picker } from "./ui.tsx";
import { usePeakTiles } from "./Waveform.tsx";
import { applyLevel, LEVEL_MEDIA_PROPS, resumeAudio, setPan } from "./level.ts";

const api = window.feldspur;

/** Sichtbare Breite je Zoomstufe. */
const ZOOMS = [30_000, 12_000, 5_000, 2_000, 800, 300];
/** Genauigkeit eines fein abgeglichenen Ankers. */
const FINE_UNCERTAINTY_MS = 20;
const LANE_H = 180;

export interface FineAlignStart {
  aSourceId: string;
  aAtMs: number;
  bSourceId: string;
  bAtMs: number;
  /** Diesen Anker (oder Vorschlag) beim Speichern ersetzen. */
  replaceAnchorId?: string;
  note?: string;
}

/** Stelle mit Millisekunden: „1:23.456“. */
export function msText(ms: number): string {
  const sign = ms < 0 ? "−" : "";
  const a = Math.abs(Math.round(ms));
  return `${sign}${formatDuration(a - (a % 1000))}.${String(a % 1000).padStart(3, "0")}`;
}

/** Verschiebung „+0,347 s“. */
export function shiftText(ms: number): string {
  const s = (Math.abs(ms) / 1000).toFixed(3).replace(".", ",");
  return `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${s} s`;
}

/** Grobe Startlage für B: aus der bisherigen Einordnung, sonst die gleiche Stelle. */
export function guessB(a: SourceRow | undefined, b: SourceRow | undefined, aAtMs: number): number {
  if (a?.startMs != null && b?.startMs != null) {
    const at = aAtMs + a.startMs - b.startMs;
    return Math.max(0, Math.min(b.durationMs ?? at, at));
  }
  return aAtMs;
}

export function FineAlign({
  view,
  start,
  guard,
  onView,
  onClose,
}: {
  view: SessionView;
  start: FineAlignStart | null;
  guard: Guard;
  onView: (v: SessionView) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={!!start} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          className="fixed inset-x-6 top-10 z-50 mx-auto max-w-5xl rounded-xl border border-line bg-panel p-5 shadow-2xl"
          aria-describedby={undefined}
          data-testid="fine-align"
        >
          <ErrorBanner dialog className="mb-3" />
          {start && (
            <Editor
              key={`${start.aSourceId}:${start.bSourceId}:${start.replaceAnchorId ?? ""}`}
              view={view}
              start={start}
              guard={guard}
              onSaved={(v) => {
                onView(v);
                onClose();
              }}
              onClose={onClose}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Editor({
  view,
  start,
  guard,
  onSaved,
  onClose,
}: {
  view: SessionView;
  start: FineAlignStart;
  guard: Guard;
  onSaved: (v: SessionView) => void;
  onClose: () => void;
}) {
  const av = view.rows.filter((r) => r.kind === "audio" || r.kind === "video");
  const options = av.map((r) => ({ value: r.id, label: `${r.label} · ${r.fileName}` }));
  const [aId, setAId] = useState(start.aSourceId);
  const [bId, setBId] = useState(start.bSourceId);
  const a = av.find((r) => r.id === aId);
  const b = av.find((r) => r.id === bId);
  const [aAt, setAAt] = useState(start.aAtMs);
  // B relativ zu A: Stelle in B = Stelle in A + delta.
  const [delta, setDelta] = useState(start.bAtMs - start.aAtMs);
  const [startDelta, setStartDelta] = useState(start.bAtMs - start.aAtMs);
  const [zoom, setZoom] = useState(2);
  const [scale, setScale] = useState<WaveformScale>("log");
  const [listen, setListen] = useState<"both" | "a" | "b">("both");
  const [note, setNote] = useState(start.note ?? "");
  const [snap, setSnap] = useState<AlignResult | null | "none">(null);
  const [busy, setBusy] = useState(false);
  const span = ZOOMS[zoom]!;
  const bAt = aAt + delta;

  const pick = (side: "a" | "b", id: string) => {
    if (side === "a") {
      setAId(id);
      setDelta(
        guessB(
          av.find((r) => r.id === id),
          b,
          aAt,
        ) - aAt,
      );
    } else {
      setBId(id);
      setDelta(
        guessB(
          a,
          av.find((r) => r.id === id),
          aAt,
        ) - aAt,
      );
    }
    setStartDelta(delta);
    setSnap(null);
  };

  const refine = async () => {
    setBusy(true);
    const r = await guard(() =>
      api.alignRefine({ aSourceId: aId, aAtMs: aAt, bSourceId: bId, bAtMs: bAt, searchMs: Math.max(250, span / 2) }),
    );
    setBusy(false);
    if (r === undefined) return;
    setSnap(r ?? "none");
    if (r) setDelta(r.bAtMs - aAt);
  };

  const save = async () => {
    const input = {
      aSourceId: aId,
      aAt: (Math.max(0, aAt) / 1000).toFixed(3),
      bSourceId: bId,
      bAt: (Math.max(0, bAt) / 1000).toFixed(3),
      precision: "exact" as const,
      uncertaintyMs: FINE_UNCERTAINTY_MS,
      note: note.trim() || "Feinabgleich",
    };
    const v = await guard(() =>
      start.replaceAnchorId ? api.replaceAnchor(start.replaceAnchorId, input) : api.addAnchor(input),
    );
    if (v) onSaved(v);
  };

  const outOfB = !!b && (bAt < 0 || (b.durationMs !== null && bAt > b.durationMs));

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Dialog.Title className="font-semibold">Feinabgleich</Dialog.Title>
        <span className="text-[0.86rem] text-muted">
          Ziehe die zweite Spur, bis die Spitzen übereinanderliegen. Feiner mit Zoom oder den Pfeiltasten.
        </span>
        <span className="flex-1" />
        <CloseButton onClick={onClose} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Side
          tone="a"
          title="Erste Aufnahme (liegt schon richtig)"
          value={aId}
          options={options}
          onPick={(id) => pick("a", id)}
          at={aAt}
        />
        <Side
          tone="b"
          title="Zweite Aufnahme (wird verschoben)"
          value={bId}
          options={options}
          onPick={(id) => pick("b", id)}
          at={bAt}
        />
      </div>

      {a && b && aId !== bId ? (
        <>
          <Overlay
            a={a}
            b={b}
            aAt={aAt}
            delta={delta}
            span={span}
            scale={scale}
            onDelta={(d) => {
              setDelta(d);
              setSnap(null);
            }}
            onPan={setAAt}
            listen={listen}
          />
          <div className="flex flex-wrap items-center gap-2 text-[0.86rem]">
            <span className="text-muted">Zoom</span>
            <Button size="sm" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)} aria-label="weiter weg">
              −
            </Button>
            <span className="w-14 text-center font-mono">{span >= 1000 ? `${span / 1000} s` : `${span} ms`}</span>
            <Button
              size="sm"
              disabled={zoom === ZOOMS.length - 1}
              onClick={() => setZoom(zoom + 1)}
              aria-label="näher heran"
            >
              +
            </Button>
            <Choice
              label="Skala"
              value={scale}
              onChange={setScale}
              options={[
                { value: "log", label: "dB", title: "Leise Stellen deutlich" },
                { value: "linear", label: "linear" },
              ]}
            />
            <span className="mx-1 h-4 w-px bg-line" />
            <Button size="sm" disabled={busy} onClick={() => void refine()} data-testid="fine-snap">
              {busy ? "Sucht…" : "Einrasten"}
            </Button>
            {snap === "none" && <span className="text-warn">nichts Eindeutiges gefunden</span>}
            {snap && snap !== "none" && (
              <span className={snap.distinctness >= 1.5 ? "text-good" : "text-warn"}>
                {snap.distinctness >= 1.5 ? "passt eindeutig" : "unsicher, bitte anhören"}
              </span>
            )}
            <span className="flex-1" />
            <Choice
              label="Anhören"
              value={listen}
              onChange={setListen}
              options={[
                { value: "both", label: "beide", title: "Erste links, zweite rechts" },
                { value: "a", label: "nur erste" },
                { value: "b", label: "nur zweite" },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <span className="font-mono text-[0.9rem]" data-testid="fine-result">
              {a.label} bei {msText(aAt)} = {b.label} bei {msText(bAt)}
            </span>
            <span className="text-[0.85rem] text-muted">{shiftText(delta - startDelta)} gegenüber vorher</span>
            {outOfB && <span className="text-[0.85rem] text-warn">liegt außerhalb der zweiten Aufnahme</span>}
            <input
              className="min-w-40 flex-1"
              placeholder="Notiz, z. B. „Satz: ‚Dann fangen wir an‘“"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Notiz zum Anker"
            />
            <Button variant="primary" disabled={outOfB || aAt < 0} onClick={() => void save()}>
              {start.replaceAnchorId ? "Anker ersetzen" : "Anker setzen"}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[0.9rem] text-muted">Wähle zwei verschiedene Aufnahmen mit Ton.</p>
      )}
    </div>
  );
}

function Side({
  tone,
  title,
  value,
  options,
  onPick,
  at,
}: {
  tone: "a" | "b";
  title: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (id: string) => void;
  at: number;
}) {
  return (
    <div className="grid gap-1 rounded-lg border border-line bg-panel-2 p-2.5">
      <span className="flex items-center gap-2 text-[0.85rem] font-medium text-ink-2">
        <span className={cx("inline-block h-2.5 w-5 rounded-sm", tone === "a" ? "bg-ink-2/60" : "bg-accent/70")} />
        {title}
      </span>
      <Picker label={title} placeholder="Aufnahme wählen…" value={value} onChange={onPick} options={options} />
      <span className="font-mono text-[0.85rem] text-muted">Stelle {msText(at)}</span>
    </div>
  );
}

/** Spitzen je Pixelspalte (0 … 1) für den Bereich [from, to] einer Spur. */
function columns(tiles: Peaks[], from: number, to: number, w: number, scale: WaveformScale): Float32Array {
  const out = new Float32Array(w);
  const span = Math.max(1, to - from);
  for (const p of tiles) {
    if (p.toMs < from || p.fromMs > to) continue;
    for (let i = 0; i < p.max.length; i++) {
      const t0 = p.fromMs + i * p.bucketMs;
      const t1 = t0 + p.bucketMs;
      if (t1 < from || t0 > to) continue;
      const c0 = Math.max(0, Math.floor(((t0 - from) / span) * w));
      const c1 = Math.min(w - 1, Math.max(c0, Math.ceil(((t1 - from) / span) * w) - 1));
      const v = peakLevel(Math.max(-p.min[i]!, p.max[i]!), scale);
      for (let c = c0; c <= c1; c++) if (v > out[c]!) out[c] = v;
    }
  }
  // Jede Spur auf volle Höhe: Unterschiedlich laute Geräte sollen gleich gut vergleichbar sein.
  let top = 0;
  for (const v of out) if (v > top) top = v;
  if (top > 0) for (let c = 0; c < w; c++) out[c] = out[c]! / top;
  return out;
}

/** Anzahl Fächer je Kachel: etwa zwei je Pixel bei der sichtbaren Breite. */
const BUCKETS = 2400;

function Overlay({
  a,
  b,
  aAt,
  delta,
  span,
  scale,
  onDelta,
  onPan,
  listen,
}: {
  a: SourceRow;
  b: SourceRow;
  aAt: number;
  delta: number;
  span: number;
  scale: WaveformScale;
  onDelta: (d: number) => void;
  onPan: (aAt: number) => void;
  listen: "both" | "a" | "b";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(canvas);
  const from = aAt - span / 2;
  const to = aAt + span / 2;
  const aTiles = usePeakTiles(a.id, from, to, span, BUCKETS, a.durationMs);
  const bTiles = usePeakTiles(b.id, from + delta, to + delta, span, BUCKETS, b.durationMs);
  const player = useDuet(a, b, listen);
  const cursor = player.atMs;

  useEffect(() => {
    const el = canvas.current;
    if (!el || width <= 0) return;
    const ctx = prepareCanvas(el, width, LANE_H);
    if (!ctx) return;
    const cs = getComputedStyle(el);
    const v = (n: string) => cs.getPropertyValue(n).trim() || "#888";
    const w = width;
    const mid = LANE_H / 2;
    ctx.clearRect(0, 0, w, LANE_H);
    ctx.fillStyle = v("--sunken");
    ctx.fillRect(0, 0, w, LANE_H);
    // Außerhalb der Dateien grau hinterlegen.
    const shade = (startMs: number, endMs: number | null) => {
      ctx.fillStyle = v("--line");
      const x0 = ((startMs - from) / span) * w;
      if (x0 > 0) ctx.fillRect(0, 0, Math.min(w, x0), LANE_H);
      if (endMs !== null) {
        const x1 = ((endMs - from) / span) * w;
        if (x1 < w) ctx.fillRect(Math.max(0, x1), 0, w - Math.max(0, x1), LANE_H);
      }
    };
    shade(0, a.durationMs);
    shade(-delta, b.durationMs === null ? null : b.durationMs - delta);

    const ca = columns(aTiles, from, to, w, scale);
    const cb = columns(bTiles, from + delta, to + delta, w, scale);
    // A als Fläche oben, B als Fläche unten, dazu B gespiegelt als Linie über A: So sieht man,
    // ob die Spitzen auf gleicher Höhe beginnen.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = v("--ink-2");
    for (let c = 0; c < w; c++) {
      const h = ca[c]! * (mid - 4);
      if (h > 0) ctx.fillRect(c, mid - h, 1, h);
    }
    ctx.fillStyle = v("--accent");
    for (let c = 0; c < w; c++) {
      const h = cb[c]! * (mid - 4);
      if (h > 0) ctx.fillRect(c, mid, 1, h);
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = v("--accent");
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let c = 0; c < w; c++) {
      const y = mid - cb[c]! * (mid - 4);
      if (c === 0) ctx.moveTo(c, y);
      else ctx.lineTo(c, y);
    }
    ctx.stroke();
    ctx.strokeStyle = v("--ink-2");
    ctx.beginPath();
    for (let c = 0; c < w; c++) {
      const y = mid + ca[c]! * (mid - 4);
      if (c === 0) ctx.moveTo(c, y);
      else ctx.lineTo(c, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = v("--line-2");
    ctx.fillRect(0, Math.floor(mid), w, 1);

    // Ankerstelle in der Mitte, Wiedergabe als roter Strich.
    ctx.fillStyle = v("--ink");
    ctx.fillRect(Math.round(w / 2), 0, 1, LANE_H);
    if (cursor !== null) {
      const x = ((cursor - from) / span) * w;
      if (x >= 0 && x <= w) {
        ctx.fillStyle = v("--bad");
        ctx.fillRect(Math.round(x) - 1, 0, 2, LANE_H);
      }
    }
    // Zeitraster in A.
    ctx.fillStyle = v("--muted");
    ctx.font = `10px ${v("--font-mono") || "monospace"}`;
    ctx.textBaseline = "top";
    const step = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => (s / span) * w >= 70) ?? 5000;
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const x = Math.round(((t - from) / span) * w);
      ctx.fillRect(x, LANE_H - 4, 1, 4);
      if (t >= 0) ctx.fillText(msText(t), x + 2, LANE_H - 14);
    }
  }, [aTiles, bTiles, from, to, span, delta, width, scale, cursor, a.durationMs, b.durationMs]);

  // Ziehen: unten (B) oder ohne Umschalttaste verschiebt B; mit Umschalttaste wandert die Ansicht.
  const drag = useRef<{ x: number; delta: number; aAt: number; pan: boolean } | null>(null);
  const msPerPx = width > 0 ? span / width : 1;
  const step = Math.max(1, Math.round(msPerPx));

  return (
    <div className="grid gap-1.5">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="slider"
        aria-label="Zweite Spur verschieben"
        aria-valuetext={shiftText(delta)}
        aria-valuenow={Math.round(delta)}
        className="block w-full cursor-ew-resize touch-none rounded-lg outline-offset-2"
        style={{ height: LANE_H }}
        data-testid="fine-overlay"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, delta, aAt, pan: e.shiftKey };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = (e.clientX - d.x) * msPerPx;
          if (d.pan) onPan(Math.round(d.aAt - dx));
          // Nach rechts ziehen = B erscheint später = frühere Stelle in B unter dem Mittelstrich.
          else onDelta(Math.round(d.delta - dx));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => {
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          onPan(Math.round(aAt + d * msPerPx));
        }}
        onKeyDown={(e) => {
          const k = e.shiftKey ? 10 : 1;
          if (e.key === "ArrowLeft") onDelta(delta + step * k);
          else if (e.key === "ArrowRight") onDelta(delta - step * k);
          else if (e.key === " ") {
            e.preventDefault();
            player.toggle(aAt, delta);
            return;
          } else return;
          e.preventDefault();
        }}
      />
      <div className="flex items-center gap-2 text-[0.82rem] text-muted">
        <Button size="sm" onClick={() => player.toggle(aAt, delta)} data-testid="fine-play">
          {player.playing ? "■ Anhalten" : "▶ Anhören"}
        </Button>
        <span>
          Leertaste spielt ab 1,5 s vor der Stelle. Ziehen verschiebt die zweite Spur, mit ⇧ die Ansicht; ←/→ um {step}{" "}
          ms (mit ⇧ ×10).
        </span>
      </div>
      {player.element}
    </div>
  );
}

/**
 * Beide Aufnahmen gleichzeitig abspielen, die erste links, die zweite rechts, mit der
 * Lautstärke-Angleichung der Quellen. Liegen sie richtig, verschmelzen sie zu einem Klang;
 * liegen sie daneben, hört man ein Echo oder Doppelschläge.
 */
function useDuet(a: SourceRow, b: SourceRow, listen: "both" | "a" | "b") {
  const aEl = useRef<HTMLAudioElement>(null);
  const bEl = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [atMs, setAtMs] = useState<number | null>(null);
  const stopAt = useRef(0);

  useEffect(() => {
    applyLevel(aEl.current, a.level, true);
    applyLevel(bEl.current, b.level, true);
    setPan(aEl.current, listen === "both" ? -0.8 : 0);
    setPan(bEl.current, listen === "both" ? 0.8 : 0);
    if (aEl.current) aEl.current.muted = listen === "b";
    if (bEl.current) bEl.current.muted = listen === "a";
  }, [a.level, b.level, listen]);

  const stop = () => {
    aEl.current?.pause();
    bEl.current?.pause();
    setPlaying(false);
    setAtMs(null);
  };
  const stopNow = useEffectEvent(stop);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = aEl.current;
      if (!el) return;
      const t = el.currentTime * 1000;
      setAtMs(t);
      if (t >= stopAt.current || el.paused) {
        stopNow();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = (aAt: number, delta: number) => {
    const ae = aEl.current;
    const be = bEl.current;
    if (!ae || !be) return;
    if (playing) return stop();
    const from = Math.max(0, aAt - 1500);
    ae.currentTime = from / 1000;
    be.currentTime = Math.max(0, from + delta) / 1000;
    stopAt.current = aAt + 1500;
    void resumeAudio();
    // Beide erst starten, wenn beide gespult haben, damit sie nicht gegeneinander versetzt anlaufen.
    void Promise.all([ready(ae), ready(be)]).then(() => {
      void ae.play();
      void be.play();
      setPlaying(true);
    });
  };

  const element = useMemo(
    () => (
      <>
        <audio ref={aEl} src={mediaUrl(a.id)} preload="auto" {...LEVEL_MEDIA_PROPS} />
        <audio ref={bEl} src={mediaUrl(b.id)} preload="auto" {...LEVEL_MEDIA_PROPS} />
      </>
    ),
    [a.id, b.id],
  );
  return { playing, atMs, toggle, element };
}

function ready(el: HTMLMediaElement): Promise<void> {
  if (!el.seeking && el.readyState >= 3) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener("canplay", done);
      el.removeEventListener("seeked", done);
      resolve();
    };
    el.addEventListener("canplay", done);
    el.addEventListener("seeked", done);
    setTimeout(done, 1500);
  });
}
