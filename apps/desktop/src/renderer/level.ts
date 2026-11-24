/**
 * Lautstärke-Angleichung beim Abhören: Jedes Medien-Element läuft über einen kleinen Web-Audio-Graph
 * (Verstärkung → Kompressor → Begrenzer → Panorama) mit denselben Werten wie im
 * Montagevideo (FFmpeg, siehe `levelFilter` in `packages/media/src/audio.ts`; die gemeinsamen Werte stehen in
 * `packages/core/src/level.ts`). Die Datei selbst bleibt unverändert. Die Einstellung je Quelle (`LevelRow`) wählt
 * man in der Detailleiste (`inspector/LevelPanel.tsx`).
 *
 * Wichtig: Ein Element lässt sich nur einmal an Web Audio hängen, und es muss mit
 * crossOrigin="anonymous" geladen sein, sonst bleibt es stumm. Deshalb tragen alle Player
 * `{...LEVEL_MEDIA_PROPS}`.
 */
import { COMPRESSOR, dbToGain, LIMIT_DB } from "@feldspur/core/level";
import { useEffect, useEffectEvent, type RefObject } from "react";
import type { LevelRow } from "../shared/api.ts";

/** Auf jedes <audio>/<video>, das über applyLevel laufen soll. */
export const LEVEL_MEDIA_PROPS = { crossOrigin: "anonymous" } as const;

interface Graph {
  gain: GainNode;
  comp: DynamicsCompressorNode;
  pan: StereoPannerNode;
}

// Ein Audio-Kontext für die ganze Oberfläche, erst beim ersten Bedarf angelegt.
let ctx: AudioContext | null = null;
const graphs = new WeakMap<HTMLMediaElement, Graph>();

function graphFor(el: HTMLMediaElement): Graph | null {
  const known = graphs.get(el);
  if (known) return known;
  try {
    ctx ??= new AudioContext();
    const c = ctx;
    const src = c.createMediaElementSource(el);
    const gain = c.createGain();
    const comp = c.createDynamicsCompressor();
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = LIMIT_DB;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    const pan = c.createStereoPanner();
    src.connect(gain).connect(comp).connect(limit).connect(pan).connect(c.destination);
    // Ein Audio-Kontext startet erst nach einer Nutzeraktion; Abspielen ist eine.
    el.addEventListener("play", () => void c.resume());
    const g = { gain, comp, pan };
    graphs.set(el, g);
    return g;
  } catch {
    // Ohne Web Audio (oder schon anderweitig verbunden) spielt das Element unverändert.
    return null;
  }
}

/** Links (−1) bis rechts (1), z. B. zwei Aufnahmen getrennt hören. Hängt das Element an Web Audio. */
export function setPan(el: HTMLMediaElement | null, pan: number): void {
  const g = el && graphFor(el);
  if (g) g.pan.pan.value = pan;
}

/** Audio-Kontext wecken (nach einer Nutzeraktion), bevor mehrere Elemente gleichzeitig starten. */
export function resumeAudio(): Promise<void> {
  return ctx ? ctx.resume() : Promise.resolve();
}

/** Einstellung einer Quelle auf ein Medien-Element anwenden. null = unverändert durchreichen. */
export function applyLevel(el: HTMLMediaElement | null, level: LevelRow | null | undefined, force = false): void {
  if (!el) return;
  const active = !!level && level.mode !== "off";
  // Unverändert und noch nie verbunden: gar nicht erst an Web Audio hängen.
  if (!active && !force && !graphs.has(el)) return;
  const g = graphFor(el);
  if (!g) return;
  const compress = active && level.compress;
  g.gain.gain.value = active ? dbToGain(level.gainDb) : 1;
  // Kompressor „aus“: Schwelle ganz oben, Verhältnis 1, keine Aufholverstärkung.
  g.comp.threshold.value = compress ? COMPRESSOR.thresholdDb : 0;
  g.comp.ratio.value = compress ? COMPRESSOR.ratio : 1;
  g.comp.knee.value = compress ? COMPRESSOR.kneeDb : 0;
  g.comp.attack.value = COMPRESSOR.attackMs / 1000;
  g.comp.release.value = COMPRESSOR.releaseMs / 1000;
  // Die Aufholverstärkung (COMPRESSOR.makeupDb) wendet Web Audio selbst an; ohne Kompressor ist sie 0 dB.
}

/** Für Player mit eigenem Element: wendet die Einstellung an, sobald es da ist und wenn sie sich ändert. */
export function useLevel(ref: RefObject<HTMLMediaElement | null>, level: LevelRow | null | undefined): void {
  // Nur bei geänderter Einstellung anwenden, nicht bei jedem neuen (inhaltsgleichen) Objekt aus der Ansicht.
  const key = level ? `${level.mode}|${level.gainDb}|${level.compress}` : "";
  const apply = useEffectEvent(() => applyLevel(ref.current, level));
  useEffect(() => apply(), [key]);
}
