/**
 * Montage in der App ansehen, ohne sie zu rechnen: spielt die Originale an den Stellen ab,
 * an denen sie im Montagevideo stünden, mit denselben Einblendungen.
 */
import { formatClock, formatDuration } from "@feldspur/core/time";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type MontagePreview, type PreviewPiece } from "../shared/api.ts";

import { pieceAt, previewFrame } from "./montage.ts";
import { drawOverlay } from "./overlay.ts";
import { Button, CloseButton, cx } from "./ui.tsx";

const api = window.feldspur;
const W = 1280;
const H = 720;
const MAIN = { x: 0, y: 52, w: 944, h: 531 };
const SIDE = { x: 944, y: 52, w: W - 944, h: 531 };
/** Ab so viel Abweichung zwischen Uhr und Wiedergabe wird nachgestellt. */
const DRIFT_S = 0.3;

export function MontageView({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [plan, setPlan] = useState<MontagePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPlan(null);
    setError(null);
    api.montagePreview(sessionId).then(
      (p) => live && setPlan(p),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [open, sessionId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          data-testid="montage"
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Dialog.Title className="font-semibold">Montage ansehen</Dialog.Title>
            <span className="text-[0.82rem] text-muted">
              Vorschau aus den Originalen, so wie das Montagevideo aufgebaut ist. Nichts wird gerechnet.
            </span>
            <span className="ml-auto" />
            <CloseButton onClick={() => onOpenChange(false)} />
          </div>
          {error && <p className="p-6 text-bad">{error}</p>}
          {!error && !plan && <p className="p-6 text-muted">Lade…</p>}
          {plan && plan.durationMs <= 0 && <p className="p-6 text-muted">Noch keine Quelle mit Uhrzeit.</p>}
          {plan && plan.durationMs > 0 && <Player plan={plan} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Player({ plan }: { plan: MontagePreview }) {
  const { pieces, durationMs, timeline } = plan;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  const videoEl = useRef<HTMLVideoElement>(null);
  const audioEl = useRef<HTMLAudioElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const idx = pieceAt(pieces, t);
  const piece = pieces[idx]!;
  const shared = !!piece.video && piece.audio?.sourceId === piece.video.sourceId;

  const seekTo = (ms: number) => {
    const v = Math.max(0, Math.min(durationMs - 1, ms));
    tRef.current = v;
    setT(v);
  };

  // Bühne auf die verfügbare Fläche skalieren.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / W, el.clientHeight / H)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Uhr der Montage: läuft beim Abspielen in Echtzeit; Bild und Ton folgen ihr.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      tRef.current = Math.min(durationMs, tRef.current + (now - last));
      last = now;
      if (tRef.current >= durationMs) {
        setPlaying(false);
        setT(durationMs - 1);
        return;
      }
      if (now - lastUi > 100) {
        lastUi = now;
        setT(tRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs]);

  // Bild und Ton an die Uhr anlegen (beim Stückwechsel, Springen und gelegentlich zum Nachstellen).
  useEffect(() => {
    const at = (m: { fromMs: number }) => (m.fromMs + (t - piece.fromMs)) / 1000;
    const follow = (el: HTMLMediaElement | null, m: { sourceId: string; fromMs: number } | null, muted: boolean) => {
      if (!el) return;
      if (!m) {
        el.pause();
        return;
      }
      const src = mediaUrl(m.sourceId);
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
      el.muted = muted;
      if (Math.abs(el.currentTime - at(m)) > DRIFT_S) el.currentTime = at(m);
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    };
    follow(videoEl.current, piece.video, !shared);
    follow(audioEl.current, shared ? null : piece.audio, false);
  }, [t, piece, playing, shared]);

  // Einblendungen: einmal je Sekunde neu, wie im Video.
  const second = Math.floor((t - piece.fromMs) / 1000);
  useEffect(() => {
    const ctx = overlay.current?.getContext("2d");
    if (ctx) drawOverlay(ctx, timeline, previewFrame(piece, piece.fromMs + second * 1000));
  }, [piece, second, timeline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") seekTo(tRef.current + 10_000);
      else if (e.key === "ArrowLeft") seekTo(tRef.current - 10_000);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stillBox = piece.kind === "item" ? MAIN : SIDE;
  const clock = previewFrame(piece, t).clockMs;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <div
          className="absolute top-1/2 left-1/2 origin-center bg-[#10171b]"
          style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          <video
            ref={videoEl}
            className={cx("absolute bg-black object-contain", !piece.video && "invisible")}
            style={{ left: MAIN.x, top: MAIN.y, width: MAIN.w, height: MAIN.h }}
            playsInline
            preload="auto"
          />
          <audio ref={audioEl} preload="auto" />
          {piece.still && (
            <StillImage
              key={`${piece.still.image.sourceId}:${JSON.stringify(piece.still.image.region ?? null)}`}
              still={piece.still}
              box={{ x: stillBox.x + 8, y: stillBox.y + 8, w: stillBox.w - 16, h: stillBox.h - 40 }}
            />
          )}
          <canvas ref={overlay} width={W} height={H} className="pointer-events-none absolute inset-0" />
        </div>
      </div>
      <Controls
        pieces={pieces}
        durationMs={durationMs}
        t={t}
        clock={clock}
        playing={playing}
        onPlay={() => setPlaying((p) => !p)}
        onSeek={seekTo}
        current={idx}
      />
    </div>
  );
}

/** Foto oder Tagebuchausschnitt, eingepasst wie im Video (oben ausgerichtet, mittig). */
function StillImage({
  still,
  box,
}: {
  still: NonNullable<PreviewPiece["still"]>;
  box: { x: number; y: number; w: number; h: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const r = still.image.region ?? { x: 0, y: 0, w: 1, h: 1 };
      const sw = img.naturalWidth * r.w;
      const sh = img.naturalHeight * r.h;
      const k = Math.min(box.w / sw, box.h / sh, 1000 / sw);
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      ctx.drawImage(img, img.naturalWidth * r.x, img.naturalHeight * r.y, sw, sh, 0, 0, c.width, c.height);
    };
    img.src = mediaUrl(still.image.sourceId);
  }, [still, box.w, box.h]);
  return (
    <div
      className="absolute flex items-start justify-center"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <canvas ref={ref} aria-label={still.caption} />
    </div>
  );
}

function Controls({
  pieces,
  durationMs,
  t,
  clock,
  playing,
  onPlay,
  onSeek,
  current,
}: {
  pieces: PreviewPiece[];
  durationMs: number;
  t: number;
  clock: number;
  playing: boolean;
  onPlay: () => void;
  onSeek: (ms: number) => void;
  current: number;
}) {
  const pct = (ms: number) => `${(ms / durationMs) * 100}%`;
  const jump = (d: -1 | 1) => {
    // Zurück: an den Anfang des Stücks, wenn man schon ein paar Sekunden drin ist.
    const p = pieces[current]!;
    if (d < 0 && t - p.fromMs > 2000) return onSeek(p.fromMs);
    const n = pieces[Math.max(0, Math.min(pieces.length - 1, current + d))]!;
    onSeek(n.fromMs);
  };
  return (
    <div className="border-t border-line px-4 pt-2 pb-3">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-2.5 h-2 overflow-hidden rounded-full bg-sunken">
          {pieces.map((p, i) => (
            <span
              key={i}
              className={cx("absolute inset-y-0", p.kind === "episode" ? "bg-accent/45" : "bg-muted/25")}
              style={{ left: pct(p.fromMs), width: pct(p.toMs - p.fromMs) }}
            />
          ))}
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: pct(t) }} />
        </div>
        <input
          type="range"
          aria-label="Stelle in der Montage"
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          min={0}
          max={durationMs}
          step={1000}
          value={Math.floor(t)}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
      </div>
      <div className="flex items-center gap-2" data-testid="montage-bar">
        <Button size="sm" onClick={() => jump(-1)} title="Voriges Stück" aria-label="Voriges Stück">
          ⏮
        </Button>
        <Button size="sm" variant="primary" onClick={onPlay} className="min-w-24">
          {playing ? "Pause" : "Abspielen"}
        </Button>
        <Button size="sm" onClick={() => jump(1)} title="Nächstes Stück" aria-label="Nächstes Stück">
          ⏭
        </Button>
        <span className="ml-2 font-mono text-[0.85rem] tabular-nums" data-testid="montage-time">
          {formatDuration(t)} / {formatDuration(durationMs)}
        </span>
        <span className="font-mono text-[0.85rem] text-muted tabular-nums">· Uhr {formatClock(clock)}</span>
        <span className="truncate text-[0.85rem] text-muted">· {pieces[current]!.title}</span>
        <span className="ml-auto text-[0.78rem] text-muted">Leertaste: Abspielen · ←/→: 10 s</span>
      </div>
    </div>
  );
}
