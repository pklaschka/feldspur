/**
 * Wiedergabe der Montage aus den Originalen für den Schritt „Ansehen“ (Issue #131): spielt die Aufnahmen an den
 * Stellen ab, an denen sie im Montagevideo stünden, mit denselben Einblendungen. Gerechnet wird nichts.
 *
 * Nach außen sieht die Wiedergabe aus wie ein `<video>`: Der Viewer (`viewerMain` in
 * `packages/media/src/viewer/runtime.ts`) steuert sie über `currentTime`, `play()`, `playbackRate`, `volume` und
 * hört auf dieselben Ereignisse (`ViewerHost.video`). Innen gibt eine eigene Uhr den Takt (ms ab Beginn der Montage),
 * und die Medien-Elemente der Originale werden ihr nachgeführt, statt selbst die Zeit vorzugeben.
 *
 * Läuft im Rahmen des Schritts (`frame.ts`), ohne React. Den Ablauf (`MontagePreview`: Stücke mit ihren Videos und
 * Tonquellen) liefert der Hauptprozess (`watchPreview`, `apps/desktop/src/main/export.ts`); Maße und Felder der Bühne
 * kommen aus `packages/media/src/layout.ts`, die Einblendungen zeichnet `overlay.ts`, beides wie beim gerechneten
 * Video.
 */
import { MAX_TILES, montageLayout, videoTiles } from "@feldspur/media/layout";
import type { ViewerHost } from "@feldspur/media/viewer-runtime";
import { mediaUrl, type LevelRow, type MontagePreview } from "../../shared/api.ts";
import { applyLevel, LEVEL_MEDIA_PROPS } from "../level.ts";
import { pieceAt, previewFrame } from "../montage.ts";
import { drawOverlay } from "../overlay.ts";

/** Höchstens so viele Tonquellen außer den Videos gleichzeitig. */
const MAX_SOUNDS = 4;
/** Ab so viel Abweichung zwischen Uhr und Wiedergabe wird nachgestellt (in Sekunden, bei Tempo 1). */
const DRIFT_S = 0.3;
/** So oft werden die Medien-Elemente beim Abspielen der Uhr nachgeführt. */
const FOLLOW_MS = 100;

/** Was `createPlayer` außer dem Ablauf braucht. */
export interface PlayerOptions {
  /** Lautstärke-Angleichung je Quelle, wie im Montagevideo. */
  levels: Map<string, LevelRow | null>;
  /** Tonspur je Quelle (`WatchPreview.tracks`), für Solo und Stumm an den Gerätespuren. */
  tracks: Record<string, number>;
}

/** Die Wiedergabe, wie der Viewer sie braucht, dazu `pause` für den Rahmen (Schritt verlassen, Bearbeiten). */
export interface MontagePlayer extends ViewerHost {
  pause(): void;
}

/**
 * Baut die Bühne in `stage` (Videofelder, Tonquellen, Leinwand für die Einblendungen) und gibt die Wiedergabe
 * zurück. `stage` ist so groß wie das Bild; Felder und Leinwand liegen darin in Anteilen der Bildgröße.
 */
export function createPlayer(stage: HTMLElement, plan: MontagePreview, opts: PlayerOptions): MontagePlayer {
  const { pieces, header } = plan;
  const durationMs = Math.max(1, plan.durationMs);
  const layout = montageLayout(plan.format);
  const doc = stage.ownerDocument;
  const media = <K extends "video" | "audio">(tag: K): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.preload = "auto";
    el.crossOrigin = LEVEL_MEDIA_PROPS.crossOrigin;
    stage.append(el);
    return el;
  };
  // Feste Zahl von Elementen, die wiederverwendet werden: Welche Quelle wo läuft, setzt `follow`.
  const videoEls = Array.from({ length: MAX_TILES }, () => {
    const v = media("video");
    v.playsInline = true;
    return v;
  });
  const audioEls = Array.from({ length: MAX_SOUNDS }, () => media("audio"));
  const canvas = doc.createElement("canvas");
  canvas.width = layout.w;
  canvas.height = layout.h;
  stage.append(canvas);

  /** Die Uhr: Stelle in der Montage in ms. */
  let t = 0;
  let playing = false;
  let rate = 1;
  let volume = 1;
  let muted = false;
  /** Tonspuren, die zu hören sein sollen; null = alle Quellen. */
  let wanted: Set<number> | null = null;
  let raf = 0;
  /** Stück und Sekunde der zuletzt gezeichneten Einblendung. */
  let drawn = "";

  const events = new EventTarget();
  const emit = (name: string) => events.dispatchEvent(new Event(name));
  const audible = (sourceId: string) => {
    if (!wanted) return true;
    const track = opts.tracks[sourceId];
    return track !== undefined && wanted.has(track);
  };

  /** Bild, Ton und Einblendung an die Uhr anlegen. */
  function follow(): void {
    const piece = pieces[pieceAt(pieces, t)];
    if (!piece) return;
    const at = (m: { fromMs: number }) => (m.fromMs + (t - piece.fromMs)) / 1000;
    const place = (el: HTMLMediaElement, m: { sourceId: string; fromMs: number } | null) => {
      if (!m) {
        el.pause();
        return;
      }
      const src = mediaUrl(m.sourceId);
      if (el.getAttribute("src") !== src) el.setAttribute("src", src);
      applyLevel(el, opts.levels.get(m.sourceId));
      el.muted = muted || !audible(m.sourceId);
      el.volume = volume;
      el.playbackRate = rate;
      if (Math.abs(el.currentTime - at(m)) > DRIFT_S * Math.max(1, rate)) el.currentTime = at(m);
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    };
    const tiles = videoTiles(piece.videos.length, layout);
    videoEls.forEach((el, k) => {
      const v = piece.videos[k] ?? null;
      const b = tiles[k] ?? layout.main;
      el.style.visibility = v ? "visible" : "hidden";
      el.style.left = `${(b.x / layout.w) * 100}%`;
      el.style.top = `${(b.y / layout.h) * 100}%`;
      el.style.width = `${(b.w / layout.w) * 100}%`;
      el.style.height = `${(b.h / layout.h) * 100}%`;
      place(el, v);
    });
    // Ton: Quellen, die schon als Video laufen, klingen aus dem Videofeld; die übrigen aus eigenen Elementen.
    const shown = new Set(piece.videos.map((v) => v.sourceId));
    const extra = piece.audios.filter((a) => !shown.has(a.sourceId));
    audioEls.forEach((el, k) => place(el, extra[k] ?? null));
    // Einblendungen: einmal je Sekunde neu, wie im Video.
    const second = Math.floor((t - piece.fromMs) / 1000);
    const key = `${piece.fromMs}|${second}`;
    if (key !== drawn) {
      drawn = key;
      const ctx = canvas.getContext("2d");
      if (ctx) drawOverlay(ctx, header, previewFrame(piece, piece.fromMs + second * 1000), layout);
    }
  }

  function stop(): void {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    follow();
    emit("pause");
  }

  function start(): void {
    if (playing) return;
    playing = true;
    let last = performance.now();
    let lastFollow = 0;
    const tick = (now: number) => {
      t = Math.min(durationMs, t + (now - last) * rate);
      last = now;
      if (t >= durationMs) {
        t = durationMs - 1;
        stop();
        emit("ended");
        return;
      }
      if (now - lastFollow > FOLLOW_MS) {
        lastFollow = now;
        follow();
      }
      raf = requestAnimationFrame(tick);
    };
    follow();
    emit("play");
    emit("playing");
    raf = requestAnimationFrame(tick);
  }

  const video = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    /** Der Viewer fragt nach `<source>`-Kindern; hier gibt es keine. */
    querySelector: () => null,
    readyState: 4,
    duration: durationMs / 1000,
    get currentTime() {
      return t / 1000;
    },
    set currentTime(s: number) {
      t = Math.max(0, Math.min(durationMs - 1, s * 1000));
      emit("seeking");
      follow();
      emit("seeked");
      emit("timeupdate");
    },
    get paused() {
      return !playing;
    },
    get playbackRate() {
      return rate;
    },
    set playbackRate(r: number) {
      rate = r;
      follow();
      emit("ratechange");
    },
    get volume() {
      return volume;
    },
    set volume(v: number) {
      volume = v;
      follow();
    },
    get muted() {
      return muted;
    },
    set muted(m: boolean) {
      muted = m;
      follow();
    },
    play() {
      start();
      return Promise.resolve();
    },
    pause: stop,
  };

  // Auch ohne Abspielen zeigt die Bühne die erste Stelle; die Schrift der Einblendungen kann später fertig laden.
  follow();
  void doc.fonts?.ready.then(() => {
    drawn = "";
    follow();
  });

  return {
    // Nur die Teile eines `<video>`, die der Viewer nutzt (siehe oben); mehr verlangt er von der App nicht.
    video: video as unknown as HTMLVideoElement,
    mix(tracks) {
      wanted = tracks ? new Set(tracks) : null;
      follow();
    },
    pause: stop,
  };
}
