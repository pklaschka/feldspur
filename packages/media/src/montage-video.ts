/**
 * Montagevideo: nur, was zum Zuordnen nötig ist. Episoden in voller Länge mit kurzen Tafeln
 * für übersprungene Zwischenzeiten, oder alles in Echtzeit.
 *
 * Aufbau (Standard 1280×720, 25 fps; wählbar, `MontageFormat`): oben Uhrzeit, Einsatz und Montage-ID; in der Mitte die laufenden
 * Videos (gleichzeitige nebeneinander) mit Kurzzeichen, Datei und Stelle im Original; unten die
 * laufenden Tonquellen. Fotos und Tagebuch stehen im Einsatztranskript, nicht im Video.
 * Text zeichnet ein OverlayRenderer (in der App: die Oberfläche per Canvas), weil die
 * LGPL-Fassung von ffmpeg nicht überall Schrift setzen kann. Ohne Renderer entsteht das Video
 * trotzdem, nur ohne Einblendungen.
 *
 * Wo kein Video läuft, steht je Sekunde ein Bild (die Uhrzeit ändert sich nicht öfter), sonst so viele, wie das Format vorgibt:
 * Die Bildrate im fertigen Video wechselt also, die Zeiten bleiben auf das Bild genau (Issue #249).
 *
 * Das Video entsteht stückweise mit festen Parametern und wird ohne Neukodierung verbunden.
 * Der Ton wird als PCM je Stück erzeugt und am Ende je Spur einmal kodiert (in Teilen gleichzeitig, `aac-parts.ts`), damit er auf die
 * Probe genau zur Bildzeit passt.
 *
 * Tonspuren: Spur 1 ist immer die Mischung (oder nur die Hauptquelle) und als Standard markiert; das hören
 * MAXQDA und jeder Player. Auf Wunsch folgt je Gerät eine eigene Spur, so lang wie das Video und stumm, wo
 * das Gerät nicht läuft (Issue #122). Schnittprogramme, VLC und der Viewer können sie einzeln abspielen.
 *
 * Einordnung: Schritt „Ausgeben“. `exportSession` (`packages/media/src/export.ts`) ruft `renderMontage` mit dem
 * fertigen Einsatztranskript (`SessionTranscript`) auf. Der Weg im Inneren: `planPieces` teilt die Montage in Stücke
 * (`Piece`), `chunks` teilt lange Stücke in Abschnitte von höchstens einer Minute, jeder Abschnitt wird einzeln
 * gerechnet und im Zwischenspeicher abgelegt, am Ende fügt ein ffmpeg-Lauf Bild, Ton und Kapitel zusammen.
 * Den `OverlayRenderer` stellt der Hauptprozess (`overlayVia` in `apps/desktop/src/main/export.ts`); gezeichnet wird
 * in `apps/desktop/src/renderer/overlay.ts`. `planPieces` ist zugleich die Grundlage für die Vorschau
 * (`montage-preview.ts`), die Resolve-Schnittliste (`fcpxml.ts`) und den Viewer (`viewer/html.ts`).
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { formatClock, type Id, type Placement, type Source } from "@feldspur/core";
import type { SessionTranscript } from "./session-transcript.ts";
import {
  DEFAULT_FORMAT,
  isDefaultFormat,
  MAX_TILES,
  montageLayout,
  videoTiles,
  widthOf,
  type MontageFormat,
} from "./layout.ts";
import { encodeAacParts, limiter } from "./aac-parts.ts";
import { levelFilter, type AudioLevel } from "./audio.ts";
import { log, logSince } from "./log.ts";
import { probeMedia } from "./probe.ts";
import { PROBE_TIMEOUT_MS, runTool, STALL_MS, ToolError } from "./process.ts";

/** Dauer eines Bilds in ms bei `fps` Bildern je Sekunde. */
const frameMs = (fps: number) => 1000 / fps;
/** Abtastrate des Tons im Montagevideo, in Hz. */
const RATE = 48_000;

/** Was für die ganze Montage gleich bleibt (Kopfzeile). */
export interface OverlayHeader {
  title: string;
  date: string;
  /** Ordnet Video und Einsatztranskript einander zu: die ersten beiden Blöcke der Montage-ID, z. B. „FS-7KQ2-M9XD“. */
  montageId: string;
  modeLabel: string;
}

/** Herkunft einer laufenden Datei an einer Stelle: zum Wiederfinden im Original. */
export interface OverlayMedia {
  /** Kurzzeichen und Gerät, z. B. „V-01 Kamera Stativ“. */
  label: string;
  fileName: string;
  /** Stelle in der Originaldatei. */
  atMs: number;
}

/** Was in einer Sekunde Montage zu sehen ist. */
export interface OverlayFrame {
  /** Stelle im Montagevideo, in ms ab dessen Beginn. */
  montageMs: number;
  /** Uhrzeit an dieser Stelle (Ortszeit des Einsatzes in ms, `LocalMs`); in Tafeln der Beginn der Zwischenzeit. */
  clockMs: number;
  /** episode: Episode; gap: Zwischenzeit in Echtzeit; card: kurze Tafel für eine Zwischenzeit. */
  kind: "episode" | "gap" | "card";
  title: string;
  /** Text einer Tafel. */
  body: string;
  /** Laufende Videos, in der Reihenfolge der Felder. */
  tiles: OverlayMedia[];
  /** Laufende Tonquellen ohne eigenes Bild. */
  sounds: OverlayMedia[];
}

/**
 * Zeichnet die Einblendungen: je Eintrag in `frames` (einer je Sekunde) ein PNG in Bildgröße, das ffmpeg über das
 * Bild legt. Kommt von außen, weil hier keine Schrift gesetzt werden kann (siehe Kopf der Datei).
 */
export type OverlayRenderer = (
  header: OverlayHeader,
  frames: OverlayFrame[],
  /** Format des Montagevideos: Größe der PNGs und Aufbau des Bilds (`montageLayout`). */
  format: MontageFormat,
) => Promise<Buffer[]>;

/** Eine Aufnahme, die in einem Stück läuft, mit der Stelle, an der das Stück in ihr beginnt. */
export interface MediaRef {
  source: Source;
  /** Stelle in der Datei am Beginn des Stücks. */
  fromMs: number;
  /** Kurzzeichen und Gerät, z. B. „V-01 Kamera Stativ“. */
  label: string;
}

/**
 * Stück der Montage: ein Zeitraum, in dem durchgehend dieselben Aufnahmen laufen, oder eine Tafel. Innerhalb eines
 * Stücks ändert sich der Bildaufbau nicht (welche Videos in welchem Feld, welche Tonquellen).
 */
export interface Piece {
  /** Grenzen in Bildern ab Montagebeginn (`f1` ausschließlich). */
  f0: number;
  f1: number;
  kind: OverlayFrame["kind"];
  /** Uhrzeit am Beginn des Stücks, Ortszeit des Einsatzes in ms (außer in Tafeln läuft sie mit). */
  clock0: number;
  title: string;
  body: string;
  /** Gleichzeitig laufende Videos (höchstens MAX_TILES), nebeneinander im Hauptfeld. */
  videos: MediaRef[];
  /** Laufende Tonquellen, die Hauptquelle zuerst (Referenzgerät, sonst die längste). */
  audios: MediaRef[];
}

/**
 * Hardware-Dekodierung der Videos (`-hwaccel auto`), solange sie geht. Eigentlich weicht ffmpeg von selbst auf
 * Software aus; dem statischen ffmpeg unter Linux fehlen aber ohne Grafiktreiber-Bibliotheken (libva, CUDA) die
 * Geräte, und es stürzt ab. Scheitert ein Abschnitt mit Hardware-Dekodierung und gelingt ohne, rechnet Feldspur bis
 * zum Neustart ohne. Bewusst kein Muster in der Fehlerausgabe: Die Meldungen unterscheiden sich je System und Treiber
 * (VAAPI, VideoToolbox, D3D11), ein Absturz hinterlässt oft gar keine.
 */
let hwaccel = true;

const withoutHwaccel = (args: string[]) => args.filter((a, k) => a !== "-hwaccel" && args[k - 1] !== "-hwaccel");

/** ffmpeg mit Fortschritt: meldet die schon geschriebene Ausgabezeit in ms. */
async function ffProgress(args: string[], onTimeMs: (ms: number) => void, signal?: AbortSignal): Promise<void> {
  let buf = "";
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", ...args], {
    signal,
    // ffmpeg meldet Fortschritt etwa jede halbe Sekunde; bleibt er aus, hängt der Prozess.
    idleTimeoutMs: STALL_MS,
    onStdout: (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m) onTimeMs(Number(m[1]) / 1000);
      }
    },
  });
}

/** ffmpeg ohne Fortschritt, für die kurzen Läufe (Ton je Stück, Zusammenfügen). */
async function ff(args: string[], signal?: AbortSignal): Promise<void> {
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { signal });
}

/**
 * Bild mit laufendem Video, kbit/s, für die Größenschätzung: ein mittlerer Wert. Die Encoder rechnen auf Qualität,
 * nicht auf eine Bitrate (siehe `encoders`); ruhiges Bild liegt darunter, unruhiges darüber. Den Rest gleicht der
 * gelernte Faktor in der App aus.
 */
const VIDEO_KBPS = 3000;
/** Tonspur 1 (Mischung oder Hauptquelle) und jede Spur je Gerät, kbit/s. */
const MIX_KBPS = 160;
const DEVICE_TRACK_KBPS = 128;

/**
 * Bild ohne laufendes Video (Tafel, Uhrzeit auf leerem Grund), kbit/s. Hardware-Encoder sparen dort weniger als
 * libx264; der Wert liegt dazwischen, den Rest gleicht der gelernte Faktor in der App aus.
 */
const STILL_KBPS = 600;

/**
 * Wie viel Bild ein Format gegenüber 1280 × 720 bei 25 Bildern/s braucht (Issue #250), für die Größenschätzung und
 * die Obergrenze der Bitrate: linear mit der Zahl der Pixel, mit der Wurzel der Bildrate. Weniger Bilder je Sekunde
 * sparen weniger als ihr Anteil, weil sich zwischen zwei Bildern mehr ändert. Ohne Video (`still`) steht ohnehin nur
 * ein Bild je Sekunde, dort zählen nur die Pixel.
 */
function pictureScale(f: MontageFormat, still = false): number {
  const pixels = (widthOf(f.height) * f.height) / (widthOf(DEFAULT_FORMAT.height) * DEFAULT_FORMAT.height);
  return still ? pixels : pixels * Math.sqrt(f.fps / DEFAULT_FORMAT.fps);
}

/**
 * Ungefähre Größe des Montagevideos in Bytes, Stück für Stück: volle Bildbitrate nur, wo ein Video läuft, sonst
 * kaum etwas; Ton nur, wo eine Tonquelle läuft (Stille kostet in AAC fast nichts). `video` ist das Video mit
 * Tonspur 1, `deviceTracks` kommt mit einer Spur je Gerät dazu (erst ab zwei Geräten mit Ton). Eine Schätzung; je
 * nach Encoder und Bild weicht die echte Datei ab.
 */
export function estimateMontageBytes(
  transcript: SessionTranscript,
  format: MontageFormat = DEFAULT_FORMAT,
  pieces: Piece[] = planPieces(transcript, format.fps),
): { video: number; deviceTracks: number } {
  const bytes = (kbps: number, frames: number) => ((kbps * 1000) / 8) * (frames / format.fps);
  const videoKbps = VIDEO_KBPS * pictureScale(format);
  const stillKbps = STILL_KBPS * pictureScale(format, true);
  let video = 0;
  const perDevice = new Map<Id, number>();
  for (const p of pieces) {
    const frames = p.f1 - p.f0;
    video += bytes(p.videos.length ? videoKbps : stillKbps, frames);
    if (p.audios.length) video += bytes(MIX_KBPS, frames);
    for (const id of new Set(p.audios.map((a) => a.source.deviceId).filter((d): d is Id => !!d)))
      perDevice.set(id, (perDevice.get(id) ?? 0) + bytes(DEVICE_TRACK_KBPS, frames));
  }
  const tracks = [...perDevice.values()];
  return {
    video: Math.round(video),
    deviceTracks: tracks.length >= 2 ? Math.round(tracks.reduce((a, b) => a + b, 0)) : 0,
  };
}

/**
 * Obergrenze der Bildbitrate (kbit/s) bei 1280 × 720 und 25 Bildern/s, wo ein Encoder eine braucht. Sie greift nur
 * bei sehr unruhigem Bild (bewegtes Wasser, Laub im Wind); mit 3000 kbit/s zerfiel solches Bild in Blöcke (Issue
 * #252). In anderen Formaten wächst oder schrumpft sie wie das Bild (`maxVideoKbps`).
 */
const MAX_VIDEO_KBPS = 8000;

/** Obergrenze der Bildbitrate im Format `f`, auf 100 kbit/s gerundet; im Standardformat `MAX_VIDEO_KBPS`. */
function maxVideoKbps(f: MontageFormat): number {
  return Math.round((MAX_VIDEO_KBPS * pictureScale(f)) / 100) * 100;
}

/**
 * H.264-Encoder in der Reihenfolge, in der Feldspur sie versucht; es gilt der erste, den dieses ffmpeg kennt und mit
 * dem ein Probebild gelingt. Alle rechnen auf gleichbleibende Qualität: Ruhiges Bild wird klein, unruhiges bekommt,
 * was es braucht. Eine feste Bitrate kann das nicht, sie ist nur der Rückfall, wo der Encoder nichts anderes kann.
 *
 * - libx264 (Entwicklung): CRF.
 * - VideoToolbox (macOS): `-q:v` gibt es nur auf Apple Silicon mit dem Hardware-Encoder; auf Intel-Macs lehnt ffmpeg
 *   es ab, dort gilt die Bitrate.
 * - Media Foundation (Windows): Qualitätsmodus, wenn der Encoder des Rechners ihn kann, sonst die Bitrate.
 * - OpenH264 (Linux): kennt keine feste Qualität; `-qmin` hält es bei ruhigem Bild davon ab, die Bitrate
 *   auszuschöpfen, die Bitrate deckelt unruhiges Bild.
 *
 * Die Stufen sind an libx264 mit CRF 23 ausgerichtet (gemessen an ruhigem, mittlerem und sehr unruhigem Bild, siehe
 * Issue #252): ähnliche Qualität bei ähnlicher Größe. Die Rechenzeit der Encoder ändert sich dadurch nicht.
 */
function encoders(f: MontageFormat): (readonly [codec: string, ...args: string[]])[] {
  const max = `${maxVideoKbps(f)}k`;
  return [
    ["libx264", "-preset", "veryfast", "-crf", "23"],
    ["h264_videotoolbox", "-q:v", "55"],
    ["h264_videotoolbox", "-b:v", max],
    ["h264_mf", "-rate_control", "quality", "-quality", "40"],
    ["h264_mf", "-b:v", max],
    ["libopenh264", "-b:v", max, "-qmin", "26"],
    ["mpeg4", "-q:v", "4"],
  ];
}

/** Ein paar Bilder in Größe der Montage rechnen und verwerfen: Nimmt der Encoder diese Einstellungen an? */
async function encoderWorks(enc: string[], f: MontageFormat): Promise<boolean> {
  try {
    const frames = [
      "-f",
      "lavfi",
      "-i",
      `color=s=${widthOf(f.height)}x${f.height}:r=${f.fps}:d=0.2`,
      "-pix_fmt",
      "yuv420p",
    ];
    await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", ...frames, ...enc, "-f", "null", "-"], {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch (e) {
    log("montage", `Encoder ${enc.slice(1).join(" ")} geht hier nicht: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/**
 * Der erste Eintrag aus `encoders(format)`, den dieses ffmpeg kennt (`listing` ist die Ausgabe von `ffmpeg -encoders`)
 * und mit dem ein Probebild in diesem Format gelingt.
 */
export async function pickEncoder(
  listing: string,
  works: (enc: string[], format: MontageFormat) => Promise<boolean> = encoderWorks,
  format: MontageFormat = DEFAULT_FORMAT,
): Promise<string[]> {
  const has = (n: string) => new RegExp(`^\\s*V\\S*\\s+${n}\\s`, "m").test(listing);
  const known = encoders(format)
    .filter(([codec]) => has(codec))
    .map(([codec, ...args]) => ["-c:v", codec, ...args]);
  for (const enc of known) if (await works(enc, format)) return enc;
  // Nichts gelingt (etwa ein ffmpeg, das gar nicht läuft): bei H.264 mit Bitrate bleiben, die jeder der Encoder
  // annimmt, statt auf MPEG-4 auszuweichen. Der Abschnitt meldet dann den eigentlichen Fehler.
  return known.find((enc) => enc.includes("-b:v")) ?? known.at(-1) ?? ["-c:v", "mpeg4", "-q:v", "4"];
}

const encoderCache = new Map<string, Promise<string[]>>();
/**
 * Encoder-Argumente für das Bild im Format `format`, einmal je Programmlauf und Format bestimmt: Ein Hardware-Encoder
 * kann eine Größe ablehnen, die er in einer anderen annimmt, und die Obergrenze der Bitrate hängt am Format.
 */
export function videoEncoder(format: MontageFormat = DEFAULT_FORMAT): Promise<string[]> {
  const key = `${format.height}p${format.fps}`;
  let got = encoderCache.get(key);
  if (!got) {
    got = runTool("ffmpeg", ["-hide_banner", "-encoders"], { timeoutMs: PROBE_TIMEOUT_MS })
      .then((listing) => pickEncoder(listing, encoderWorks, format))
      .catch((e: unknown) => {
        // Ließ sich ffmpeg nicht fragen, beim nächsten Mal neu versuchen statt den Fehler zu behalten.
        encoderCache.delete(key);
        throw e;
      });
    encoderCache.set(key, got);
  }
  return got;
}

/** Stücke der Montage: Grenzen dort, wo eine Aufnahme beginnt oder endet, in Bildern bei `fps` Bildern je Sekunde. */
export function planPieces(transcript: SessionTranscript, fps: number = DEFAULT_FORMAT.fps): Piece[] {
  const { input, resolved, plan } = transcript;
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const place = (id: Id) => resolved.placements.get(id);
  const av = input.sources.filter((s) => (s.kind === "audio" || s.kind === "video") && place(s.id));
  const refDevice = input.devices.find((d) => d.isReference)?.id;
  const frame = (ms: number) => Math.round(ms / frameMs(fps));
  const covering = (s: Source, t: number) => {
    const p = place(s.id)!;
    return t >= p.startMs && t < p.endMs;
  };
  const describe = (s: Source) => {
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    return `${s.label} ${d?.label ?? ""}`.trim();
  };

  const pieces: Piece[] = [];
  for (const seg of plan.segments) {
    // Kurze Tafel für eine übersprungene Zwischenzeit.
    if (seg.kind === "card" && plan.mode !== "realtime") {
      const card = transcript.entries.find((e) => e.kind === "card" && e.montageMs === seg.montageStartMs);
      pieces.push({
        f0: frame(seg.montageStartMs),
        f1: frame(seg.montageStartMs + seg.montageMs),
        kind: "card",
        clock0: seg.fromMs,
        title: "Zwischenzeit übersprungen",
        body: card ? `${card.clock}\n${card.body}` : "",
        videos: [],
        audios: [],
      });
      continue;
    }

    // Episode (oder Zwischenzeit in Echtzeit): Schnittpunkte an Beginn und Ende jeder Aufnahme.
    const from = seg.fromMs;
    const to = seg.toMs;
    const toM = (t: number) => seg.montageStartMs + (t - from);
    const cuts = new Set<number>([from, to]);
    for (const s of av) {
      const p = place(s.id)!;
      if (p.startMs > from && p.startMs < to) cuts.add(p.startMs);
      if (p.endMs > from && p.endMs < to) cuts.add(p.endMs);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const f0 = frame(toM(a));
      const f1 = frame(toM(b));
      if (f1 <= f0) continue;
      // Zwischen zwei Schnittpunkten läuft überall dasselbe; die Mitte umgeht Randfälle genau auf der Grenze.
      const mid = (a + b) / 2;
      const running = av.filter((s) => covering(s, mid));
      const videos = running
        .filter((s) => s.kind === "video")
        .sort((x, y) => place(x.id)!.startMs - place(y.id)!.startMs)
        .slice(0, MAX_TILES);
      const audioOnly = running.filter((s) => s.kind === "audio");
      // Hauptquelle: die Tonaufnahme des Referenzgeräts, sonst die längste Tonaufnahme, sonst das erste Video.
      const mainAudio =
        audioOnly.find((s) => s.deviceId === refDevice) ??
        audioOnly.toSorted((x, y) => span(place(y.id)!) - span(place(x.id)!))[0] ??
        videos[0];
      const sounding = running.filter((s) => s.kind === "audio" || s.kind === "video");
      const audios = mainAudio ? [mainAudio, ...sounding.filter((s) => s !== mainAudio)] : sounding;
      const ref = (s: Source): MediaRef => ({ source: s, fromMs: a - place(s.id)!.startMs, label: describe(s) });
      pieces.push({
        f0,
        f1,
        kind: seg.kind === "episode" ? "episode" : "gap",
        clock0: a,
        title: !transcript.episodes ? "" : seg.kind === "episode" ? `Episode ${seg.episode.index}` : "Zwischenzeit",
        body: "",
        videos: videos.map(ref),
        audios: audios.map(ref),
      });
    }
  }
  // Lückenlos machen (Rundung): jedes Stück endet, wo das nächste beginnt.
  pieces.sort((a, b) => a.f0 - b.f0);
  for (let i = 0; i + 1 < pieces.length; i++) pieces[i]!.f1 = pieces[i + 1]!.f0;
  return pieces.filter((p) => p.f1 > p.f0);
}

const span = (p: Placement) => p.endMs - p.startMs;

/** Eine eigene Tonspur je Gerät im Montagevideo. */
export interface DeviceTrack {
  deviceId: Id;
  /** Name der Spur, wie Player ihn zeigen: das Gerät, z. B. „Audiorekorder ZOOM“. */
  title: string;
  /** Kurzzeichen der Aufnahmen dieses Geräts in der Montage, z. B. ["A-01", "A-02"]. */
  labels: string[];
}

/**
 * Geräte mit Ton in der Montage, in der Reihenfolge der Spuren: das Referenzgerät zuerst, dann wie im Einsatz.
 * Ob eine Videodatei wirklich Ton hat, weiß erst ffprobe; hier zählt jede Ton- und Videoquelle.
 */
export function deviceTracksOf(transcript: SessionTranscript, pieces: Piece[] = planPieces(transcript)): DeviceTrack[] {
  const sounding = new Map<Id, Set<string>>();
  for (const p of pieces)
    for (const a of p.audios) {
      const id = a.source.deviceId;
      if (!id) continue;
      if (!sounding.has(id)) sounding.set(id, new Set());
      sounding.get(id)!.add(a.source.label);
    }
  return transcript.input.devices
    .filter((d) => sounding.has(d.id))
    .toSorted((a, b) => Number(b.isReference) - Number(a.isReference))
    .map((d) => ({ deviceId: d.id, title: d.label, labels: [...sounding.get(d.id)!].sort() }));
}

/** Name der ersten Tonspur, je nach Mischung. */
export function mixTrackTitle(audioMix: "all" | "main" = "all"): string {
  return audioMix === "main" ? "Hauptquelle" : "Mischung aller Geräte";
}

/** Kopfzeile der Einblendungen; die Montage-ID in der Kurzform, wie sie im Video steht (`montageVideoId`). */
export function overlayHeader(transcript: SessionTranscript): OverlayHeader {
  const h = transcript.header;
  return { title: h.title, date: h.date, montageId: h.montageVideoId, modeLabel: h.modeLabel };
}

/** Einblendung an einer Stelle eines Stücks (ms ab Stückbeginn); `fps` wie beim Planen der Stücke. */
function frameAt(p: Piece, offsetMs: number, fps: number): OverlayFrame {
  const media = (m: MediaRef): OverlayMedia => ({
    label: m.label,
    fileName: m.source.fileName,
    atMs: m.fromMs + offsetMs,
  });
  const shown = new Set(p.videos.map((v) => v.source.id));
  return {
    montageMs: p.f0 * frameMs(fps) + offsetMs,
    clockMs: p.kind === "card" ? p.clock0 : p.clock0 + offsetMs,
    kind: p.kind,
    title: p.title,
    body: p.body,
    tiles: p.videos.map(media),
    sounds: p.audios.filter((a) => !shown.has(a.source.id)).map(media),
  };
}

/** Eine Einblendung je angefangener Sekunde des Stücks: Feiner als sekundenweise zeigt das Video die Uhrzeit nicht. */
function framesFor(p: Piece, fps: number): OverlayFrame[] {
  // In ganzen Bildern gerechnet: (f1 − f0) · 1000 / fps ergäbe bei 30 Bildern/s für 30 Bilder 1000,0000000000002 ms.
  const n = Math.ceil((p.f1 - p.f0) / fps);
  return Array.from({ length: n }, (_, k) => frameAt(p, k * 1000, fps));
}

export interface MontageVideoOptions {
  /** Arbeitsordner der Ausgabe; darin legt renderMontage den Unterordner `montage` für Zwischendateien an. */
  workDir: string;
  /** Zeichnet die Einblendungen; ohne ihn entsteht das Video ohne Text. */
  overlay?: OverlayRenderer;
  /** Fortschritt in Sekunden Montage. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Ordner für fertige Abschnitte. Was sich seit der letzten Ausgabe nicht geändert hat, wird
   * übernommen statt neu gerechnet. Nicht mehr gebrauchte Abschnitte werden danach gelöscht.
   */
  cacheDir?: string;
  /** Ton: alle laufenden Geräte übereinander (Standard) oder nur die Hauptquelle. */
  audioMix?: "all" | "main";
  /**
   * Zusätzlich je Gerät eine eigene Tonspur nach der Mischung (siehe deviceTracks). Nur, wenn mindestens zwei
   * Geräte Ton haben; sonst wäre die Gerätespur dasselbe wie Spur 1.
   */
  deviceTracks?: boolean;
  /** Wie viele Abschnitte gleichzeitig; Standard: ein Kern bleibt frei, höchstens 4. */
  parallel?: number;
  /** Auflösung und Bildrate (Issue #250); Standard 1280 × 720 bei 25 Bildern/s. */
  format?: MontageFormat;
  /** Lautstärke-Angleichung je Quelle (audioLevelOf); fehlt eine Quelle, bleibt ihr Ton unverändert. */
  levels?: Map<string, AudioLevel | null>;
  /**
   * Abbrechen: laufende ffmpeg-Prozesse werden beendet, renderMontage wirft einen AbortError.
   * Schon fertige Abschnitte bleiben im Zwischenspeicher (cacheDir) und werden beim nächsten Mal übernommen.
   */
  signal?: AbortSignal;
}

/** Längere Stücke werden in Abschnitte dieser Länge (in Sekunden) geteilt: parallel rechenbar, feiner Fortschritt. */
const CHUNK_S = 60;
/** Erhöhen, wenn sich das Aussehen oder der Aufbau der Abschnitte ändert, damit alte nicht wiederverwendet werden. */
const LOOK_VERSION = 6;

/** Teilt Stücke in Abschnitte von höchstens `CHUNK_S` Sekunden; Uhrzeit und Stellen in den Dateien rücken mit. */
function chunks(pieces: Piece[], fps: number): Piece[] {
  const most = CHUNK_S * fps;
  return pieces.flatMap((p) => {
    const out: Piece[] = [];
    for (let f0 = p.f0; f0 < p.f1; f0 += most) {
      const shift = (f0 - p.f0) * frameMs(fps);
      out.push({
        ...p,
        f0,
        f1: Math.min(p.f1, f0 + most),
        clock0: p.kind === "card" ? p.clock0 : p.clock0 + shift,
        videos: p.videos.map((v) => ({ ...v, fromMs: v.fromMs + shift })),
        audios: p.audios.map((v) => ({ ...v, fromMs: v.fromMs + shift })),
      });
    }
    return out;
  });
}

/**
 * Einfache Warteschlange: höchstens n Aufgaben gleichzeitig. Scheitert eine oder wird abgebrochen,
 * beginnt keine neue mehr, und onError erfährt es sofort (renderMontage bricht damit die laufenden ab).
 * Laufende werden noch abgewartet, dann kommt der erste Fehler.
 */
async function pool<T>(
  items: T[],
  n: number,
  work: (item: T, i: number) => Promise<void>,
  signal?: AbortSignal,
  onError?: (e: unknown) => void,
): Promise<void> {
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length && !failed) {
      signal?.throwIfAborted();
      const i = next++;
      await work(items[i]!, i).catch((e: unknown) => {
        failed = true;
        onError?.(e);
        throw e;
      });
    }
  });
  const settled = await Promise.allSettled(workers);
  const err = settled.find((r) => r.status === "rejected");
  if (err) throw err.reason;
}

/**
 * Stellt die Standbilder eines Abschnitts ohne Video an ihren Platz: Der Encoder bekommt `stills` Bilder dicht an dicht
 * (je 1/`fps` s), dieser Bitstromfilter streckt die Zeiten danach auf eine Sekunde je Bild. Das letzte Bild steht nur
 * so lange, bis der Abschnitt nach `frameCount` Bildern zu 1/`fps` s endet. So hat der Abschnitt genau die Länge, die
 * er mit `fps` Bildern je Sekunde hätte, und der Ton bleibt auf die Probe genau am Bild.
 *
 * Die Dekodierzeit (DTS) behält ihren Abstand zur Anzeigezeit, statt mitgestreckt zu werden: libx264 schreibt sie zwei
 * Bilder früher, und gestreckt wären das zwei Sekunden, um die die Spur am Ende zu kurz geriete. Das geht, weil diese
 * Abschnitte keine umsortierten Bilder haben (jedes zweite Bild ist ein Schlüsselbild).
 */
function stillTimes(stills: number, frameCount: number, fps: number): string[] {
  const last = frameCount - (stills - 1) * fps;
  const duration = `if(lt(N\\,${stills - 1})\\,DURATION*${fps}\\,DURATION*${last})`;
  return ["-bsf:v", `setts=pts=PTS*${fps}:dts=PTS*${fps}-(PTS-DTS):duration=${duration}`];
}

/** Was im fertigen Video steckt, soweit andere Ausgaben es brauchen (der Viewer). */
export interface MontageResult {
  /** Tonspuren in ihrer Reihenfolge; Spur 1 ist die Mischung, danach je Gerät eine. */
  audioTracks: { title: string; deviceId?: Id }[];
}

/**
 * Rechnet das Montagevideo nach `outFile`. Bild und Ton entstehen nebeneinander: die Bildabschnitte parallel (jeder
 * mit einem Schlüssel aus allem, was sein Aussehen bestimmt, im Zwischenspeicher), der Ton je Spur einmal über die
 * ganze Länge. Bei Abbruch oder Fehler bleibt keine halbe Datei in `outFile` zurück.
 */
export async function renderMontage(
  transcript: SessionTranscript,
  outFile: string,
  opts: MontageVideoOptions,
): Promise<MontageResult> {
  const outer = opts.signal;
  outer?.throwIfAborted();
  const started = performance.now();
  // Scheitert ein Teil (ein Abschnitt oder der Ton), beendet `inner` alle übrigen ffmpeg-Prozesse,
  // statt sie zu Ende rechnen zu lassen (Issue #136). Gemeldet wird der erste echte Fehler.
  const inner = new AbortController();
  const signal = outer ? AbortSignal.any([outer, inner.signal]) : inner.signal;
  let firstError: unknown = null;
  const fail = (e: unknown) => {
    if (firstError === null && !outer?.aborted) firstError = e;
    inner.abort();
  };
  const dir = join(opts.workDir, "montage");
  await mkdir(dir, { recursive: true });
  // Stücke für den Ton (ganze Länge), Abschnitte (`parts`, höchstens eine Minute) für das Bild.
  const format = opts.format ?? DEFAULT_FORMAT;
  const fps = format.fps;
  const oneFrameMs = frameMs(fps);
  const layout = montageLayout(format);
  const pieces = planPieces(transcript, fps);
  const parts = chunks(pieces, fps);
  const header = overlayHeader(transcript);
  const enc = await videoEncoder(format);
  const cacheDir = opts.cacheDir ?? join(dir, "abschnitte");
  await mkdir(cacheDir, { recursive: true });
  // Ein Kern bleibt für die Oberfläche und den Ton frei. Mehr als vier gleichzeitig bringt nichts: Spätestens dann
  // ist der Encoder ausgelastet (gemessen für Issue #249; mit VideoToolbox schon bei drei).
  const parallel = opts.parallel ?? Math.max(1, Math.min(4, availableParallelism() - 1));

  // Dateien im Zwischenspeicher, die diese Ausgabe braucht; alles andere wird am Ende gelöscht.
  const used = new Set<string>();
  // Kennung einer Originaldatei für die Schlüssel: Pfad, Größe, Änderungszeit (schnell, ohne die Datei zu lesen).
  const fileId = async (path: string) => {
    const st = await stat(path);
    return `${path}|${st.size}|${st.mtimeMs}`;
  };

  // Welche Tonquellen je Stück: alle laufenden übereinander oder nur die Hauptquelle.
  // Videos ohne Tonspur fallen heraus (einmal je Datei nachgesehen).
  const soundCache = new Map<string, Promise<boolean>>();
  const hasSound = (src: Source) => {
    if (src.kind === "audio") return Promise.resolve(true);
    let got = soundCache.get(src.originalPath);
    if (!got) {
      got = probeMedia(src.originalPath, { signal }).then(
        (pr) => pr.hasAudio,
        (e: unknown) => {
          // Nicht lesbar: ohne Ton weiter. Abgebrochen: nicht als „ohne Ton“ merken, sondern abbrechen.
          if (signal?.aborted) throw e;
          return false;
        },
      );
      soundCache.set(src.originalPath, got);
    }
    return got;
  };
  const soundOf = async (p: Piece) => {
    const wanted = opts.audioMix === "main" ? p.audios.slice(0, 1) : p.audios;
    const ok = await Promise.all(wanted.map((a) => hasSound(a.source)));
    return wanted.filter((_, k) => ok[k]);
  };

  // Ton nebenher: je Stück PCM mit exakter Länge, danach AAC in Teilen gleichzeitig (`aac-parts.ts`), über alle
  // Tonspuren zusammen höchstens so viele Teile, wie Kerne da sind (höchstens acht). Unverändert:
  // aus dem Zwischenspeicher.
  const audioSlot = limiter(Math.max(2, Math.min(8, availableParallelism())));
  const RAW = ["-f", "s16le", "-c:a", "pcm_s16le"];
  // Eine Spur entsteht aus den Tonquellen je Stück (sounds[i]); mehrere Quellen werden gleich laut addiert.
  const renderTrack = async (tag: string, sounds: MediaRef[][], bitrate: string): Promise<string> => {
    const audioKey = createHash("sha1")
      .update(
        JSON.stringify(
          await Promise.all(
            pieces.map(async (p, i) => [
              p.f1 - p.f0,
              await Promise.all(
                sounds[i]!.map(async (a) => [
                  await fileId(a.source.originalPath),
                  a.fromMs,
                  opts.levels?.get(a.source.id) ?? null,
                ]),
              ),
            ]),
          ),
        ) + bitrate,
      )
      .digest("hex");
    const cached = join(cacheDir, `ton-${audioKey}.m4a`);
    used.add(basename(cached));
    if (await exists(cached)) {
      log("montage", `Ton aus dem Zwischenspeicher: ${cached}`);
      return cached;
    }
    log("montage", `mischt Ton neu: ${cached}`);
    const aList: string[] = [];
    for (const [i, p] of pieces.entries()) {
      signal?.throwIfAborted();
      const durS = ((p.f1 - p.f0) * oneFrameMs) / 1000;
      const aOut = join(dir, `${tag}-${i}.pcm`);
      const samples = Math.round(durS * RATE);
      // Auf die Probe genau so lang wie das Bild des Stücks: zu kurzen Ton mit Stille auffüllen, zu langen kappen.
      const fit = `apad,atrim=end_sample=${samples}`;
      const src = sounds[i]!;
      if (!src.length) {
        await ff(
          ["-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=stereo`, "-af", `atrim=end_sample=${samples}`, ...RAW, aOut],
          signal,
        );
      } else {
        // Mehrere Geräte übereinander: gleich laut addiert, ein Begrenzer fängt Spitzen ab.
        const args: string[] = [];
        const f: string[] = [];
        for (const [k, a] of src.entries()) {
          args.push("-ss", (a.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3), "-i", a.source.originalPath);
          const level = levelFilter(opts.levels?.get(a.source.id) ?? null);
          f.push(
            `[${k}:a]aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo${level ? `,${level}` : ""}[a${k}]`,
          );
        }
        const mix =
          src.length > 1
            ? `${src.map((_, k) => `[a${k}]`).join("")}amix=inputs=${src.length}:normalize=0:duration=longest,alimiter=limit=0.95,`
            : "[a0]";
        f.push(`${mix}aformat=sample_fmts=s16:channel_layouts=stereo,${fit}[out]`);
        await ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", ...RAW, aOut], signal);
      }
      aList.push(aOut);
    }
    const m4a = join(dir, `${tag}.m4a`);
    await encodeAacParts({ pcmFiles: aList, rate: RATE, bitrate, out: m4a, dir, tag, slot: audioSlot, signal });
    await rename(m4a, cached).catch(() => copyFile(m4a, cached));
    for (const f of aList) await rm(f, { force: true });
    return cached;
  };

  // Spur 1: Mischung oder Hauptquelle. Dazu, falls gewünscht, je Gerät eine Spur. Alle Spuren gleichzeitig, und jede
  // in Teilen: Der AAC-Encoder nutzt nur einen Kern und schafft etwa das 50- bis 110-Fache der Echtzeit. Nacheinander
  // und am Stück gerechnet, wartete eine lange Ausgabe am Ende auf den Ton (Issue #249).
  const devices = opts.deviceTracks ? deviceTracksOf(transcript, pieces) : [];
  const audioDone = (async () => {
    const all = await Promise.all(
      pieces.map(async (p) => {
        const ok = await Promise.all(p.audios.map((a) => hasSound(a.source)));
        return p.audios.filter((_, k) => ok[k]);
      }),
    );
    const withSound = devices.filter((d) => all.some((list) => list.some((a) => a.source.deviceId === d.deviceId)));
    const [mix, ...files] = await Promise.all([
      renderTrack("a", await Promise.all(pieces.map(soundOf)), `${MIX_KBPS}k`),
      ...(withSound.length >= 2 ? withSound : []).map((d, k) =>
        renderTrack(
          `g${k}`,
          all.map((list) => list.filter((a) => a.source.deviceId === d.deviceId)),
          `${DEVICE_TRACK_KBPS}k`,
        ),
      ),
    ]);
    log("montage", `Ton fertig nach ${logSince(started)}`);
    return { mix: mix!, perDevice: files.map((file, k) => ({ track: withSound[k]!, file })) };
  })();
  // Scheitert der Ton, gleich alles beenden; der Fehler kommt beim Zusammenfügen bzw. im catch unten.
  audioDone.catch(fail);

  try {
    const totalS = Math.round((pieces.at(-1)?.f1 ?? 0) / fps);
    const doneFrames = new Map<number, number>();
    const report = () => {
      let f = 0;
      for (const v of doneFrames.values()) f += v;
      opts.onProgress?.(Math.min(totalS, Math.round(f / fps)), totalS);
    };
    report();

    const vFiles: string[] = [];

    await pool(
      parts,
      parallel,
      async (p, i) => {
        const frameCount = p.f1 - p.f0;
        const durS = (frameCount * oneFrameMs) / 1000;
        const frames = opts.overlay ? framesFor(p, fps) : null;
        const key = createHash("sha1")
          .update(
            JSON.stringify({
              v: LOOK_VERSION,
              enc,
              frameCount,
              kind: p.kind,
              videos: await Promise.all(
                p.videos.map(async (v) => ({ id: await fileId(v.source.originalPath), fromMs: v.fromMs })),
              ),
              // Die Stelle im Video gehört nicht zum Bild: Abschnitte bleiben gültig, wenn sich davor etwas ändert.
              frames: frames?.map(({ montageMs: _m, ...f }) => f),
              header: frames ? header : null,
              // Bildrate steckt schon in `frameCount` und den Stellen; die Größe nicht. Im Standardformat fehlt das
              // Format im Schlüssel, damit Abschnitte von vor Issue #250 gültig bleiben.
              ...(isDefaultFormat(format) ? {} : { format }),
            }),
          )
          .digest("hex");
        const vOut = join(cacheDir, `${key}.mp4`);
        vFiles[i] = vOut;
        used.add(`${key}.mp4`);
        const what = `Abschnitt ${i + 1}/${parts.length} (${durS.toFixed(1).replace(".", ",")} s, ${p.videos.length} ${p.videos.length === 1 ? "Video" : "Videos"})`;
        if (await exists(vOut)) {
          log("montage", `${what} aus dem Zwischenspeicher: ${vOut}`);
          doneFrames.set(i, frameCount);
          report();
          return;
        }

        log(
          "montage",
          `${what} wird gerechnet: ${p.videos.map((v) => v.source.originalPath).join(", ") || "nur Einblendungen"}`,
        );
        const pdir = join(dir, `p${i}`);
        await mkdir(pdir, { recursive: true });
        // Ohne Video ändert sich das Bild höchstens einmal je Sekunde (die Uhrzeit): Dann entsteht auch nur ein Bild je
        // Sekunde, das im fertigen Video eine Sekunde lang steht (Issue #249). 24 von 25 Bildern zu kodieren, die
        // nichts Neues zeigen, kostete vorher den größten Teil der Rechenzeit dieser Abschnitte, und beim
        // Hardware-Encoder (VideoToolbox) Durchsatz, der den Abschnitten mit Video fehlte.
        // Die Standbilder gehen dicht an dicht durch ffmpeg, als wären es `fps` je Sekunde: So bekommt der Encoder
        // dieselben Einstellungen wie in den Abschnitten mit Video. An ihre Stelle im Video rückt sie `stillTimes`.
        const still = p.videos.length === 0;
        // Angefangene Sekunden in ganzen Bildern gezählt (siehe `framesFor`), nicht aus der gerundeten Dauer.
        const stills = Math.ceil(frameCount / fps);
        const srcDur = still ? ((stills + 1) / fps).toFixed(3) : (stills + 1).toString();
        const args: string[] = ["-f", "lavfi", "-i", `color=c=0x10171b:s=${layout.w}x${layout.h}:r=${fps}:d=${srcDur}`];
        const filters: string[] = [];
        let last = "[0:v]";
        let input = 1;
        // Gleichzeitige Videos nebeneinander, jedes in sein Feld eingepasst.
        const tiles = videoTiles(p.videos.length, layout);
        for (const [k, v] of p.videos.entries()) {
          const box = tiles[k]!;
          args.push("-hwaccel", "auto", "-ss", (v.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3));
          args.push("-i", v.source.originalPath);
          filters.push(
            `[${input}:v]fps=${fps},scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[v${input}]`,
            `${last}[v${input}]overlay=x=${box.x}+(${box.w}-overlay_w)/2:y=${box.y}+(${box.h}-overlay_h)/2:eof_action=pass[b${input}]`,
          );
          last = `[b${input}]`;
          input++;
        }
        if (opts.overlay && frames) {
          const pngs = await opts.overlay(header, frames, format);
          signal?.throwIfAborted();
          await Promise.all(pngs.map((b, j) => writeFile(join(pdir, `o${String(j).padStart(5, "0")}.png`), b)));
          args.push("-framerate", String(still ? fps : 1), "-i", join(pdir, "o%05d.png"));
          filters.push(
            // Erst ins Format der Überlagerung wandeln, dann vervielfachen: sonst wandelt ffmpeg dasselbe Bild 25-mal.
            still ? `[${input}:v]null[o${input}]` : `[${input}:v]format=yuva420p,fps=${fps}[o${input}]`,
            `${last}[o${input}]overlay=0:0:eof_action=repeat[b${input}]`,
          );
          last = `[b${input}]`;
          input++;
        }
        filters.push(
          `${last}format=yuv420p,trim=${still ? `end_frame=${stills}` : `duration=${durS.toFixed(3)}`}[out]`,
        );
        const tmp = join(pdir, "v.mp4");
        const full = [
          ...args,
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[out]",
          "-frames:v",
          String(still ? stills : frameCount),
          "-r",
          String(fps),
          ...enc,
          // Alle zwei Sekunden ein Bild, an das Player springen können, mit und ohne Video.
          "-g",
          String(still ? 2 : fps * 2),
          ...(still ? stillTimes(stills, frameCount, fps) : []),
          "-an",
          tmp,
        ];
        // ffmpeg meldet die Zeit vor dem Strecken der Standbilder (`stillTimes`): dort zählt jedes Bild `fps`-fach.
        const progress = (ms: number) => {
          doneFrames.set(i, Math.min(frameCount, Math.round(ms / oneFrameMs) * (still ? fps : 1)));
          report();
        };
        // Mehrere Abschnitte laufen gleichzeitig: Jeder merkt sich, ob er mit Hardware-Dekodierung begonnen hat.
        const hw = hwaccel && p.videos.length > 0;
        try {
          await ffProgress(hw ? full : withoutHwaccel(full), progress, signal);
        } catch (e) {
          // Abgebrochen (auch weil ein anderer Abschnitt oder der Ton gescheitert ist) oder ohnehin ohne: Fehler melden.
          if (!hw || signal?.aborted || !(e instanceof ToolError)) throw e;
          // Sonst einmal ohne Hardware-Dekodierung, auch nach einem Stillstand (hängender Treiber). Lag es nicht
          // daran, scheitert auch dieser Lauf, und sein Fehler nennt den Grund ohne die Meldungen der Treiber.
          log("montage", `${what}: mit Hardware-Dekodierung gescheitert (${e.message}), rechnet ohne neu`);
          doneFrames.set(i, 0);
          report();
          await ffProgress(withoutHwaccel(full), progress, signal);
          if (hwaccel) log("montage", "Hardware-Dekodierung geht hier nicht, bis zum Neustart abgeschaltet");
          hwaccel = false;
        }
        await rename(tmp, vOut).catch(async () => {
          await copyFile(tmp, vOut);
        });
        // Aufräumen darf die Ausgabe nicht scheitern lassen: Unter macOS meldet rm gelegentlich ENOTEMPTY,
        // wenn das System noch Dateien im Ordner anlegt oder freigibt. Der Arbeitsordner wird am Ende ohnehin entfernt.
        await rm(pdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
        doneFrames.set(i, frameCount);
        report();
      },
      signal,
      fail,
    );

    // Die Länge steht ausdrücklich dabei: Der nächste Abschnitt beginnt genau nach `f1 - f0` Bildern, auch wo ein
    // Abschnitt aus Standbildern besteht oder ein Encoder die Dauer des letzten Bilds anders vermerkt.
    await writeFile(
      join(dir, "v.txt"),
      vFiles
        .map((f, i) => {
          const durS = ((parts[i]!.f1 - parts[i]!.f0) * oneFrameMs) / 1000;
          return `file '${f.replace(/'/g, "'\\''")}'\nduration ${durS.toFixed(6)}`;
        })
        .join("\n"),
    );
    await writeFile(join(dir, "meta.txt"), chapterFile(transcript));
    log("montage", `Abschnitte fertig nach ${logSince(started)}`);
    const audio = await audioDone;
    signal?.throwIfAborted();
    // Spur 1 trägt die Mischung und ist Standard; die Gerätespuren folgen, nicht als Standard markiert.
    const tracks = [
      { file: audio.mix, title: mixTrackTitle(opts.audioMix) },
      ...audio.perDevice.map((d) => ({ file: d.file, title: d.track.title })),
    ];
    const meta = 1 + tracks.length;
    // Endet die Montage ohne Video, steht ihr letztes Standbild bis zum Ende. Ältere ffmpeg-Fassungen (6.x) lesen die
    // Dauer dieses einen Bilds falsch aus dem Abschnitt; hier steht sie deshalb noch einmal ausdrücklich. Gerechnet über
    // die Dekodierzeit: Der MP4-Muxer nimmt als Spurlänge letzte DTS plus Dauer, weniger erste DTS. libx264 mancher
    // Fassungen (etwa aus Homebrew und choco) legt die DTS ein Bild vor die PTS, ein Abschnitt aus nur einem Standbild
    // aber nicht; beginnt die Montage so, geriete die Bildspur mit PTS gerechnet ein Bild zu kurz. Wo DTS und PTS
    // überall gleich sind (das ffmpeg der App), ändert sich nichts.
    const tail = parts.at(-1);
    const packets = parts.reduce((n, p) => n + (p.videos.length ? p.f1 - p.f0 : Math.ceil((p.f1 - p.f0) / fps)), 0);
    const lastStill =
      tail && !tail.videos.length
        ? [
            "-bsf:v",
            `setts=pts=PTS:dts=DTS:duration=if(eq(N\\,${packets - 1})\\,${(tail.f1 / fps).toFixed(6)}/TB-DTS+STARTDTS\\,DURATION)`,
          ]
        : [];
    log("montage", `setzt ${vFiles.length} Abschnitte und ${tracks.length} Tonspuren zusammen: ${outFile}`);
    // Abgebrochen oder gescheitert: keine halbe Videodatei im Ausgabeordner liegen lassen.
    await ff(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        join(dir, "v.txt"),
        ...tracks.flatMap((t) => ["-i", t.file]),
        "-i",
        join(dir, "meta.txt"),
        "-map",
        "0:v",
        ...tracks.flatMap((_, k) => ["-map", `${k + 1}:a`]),
        ...tracks.flatMap((t, k) => [
          `-metadata:s:a:${k}`,
          `title=${t.title}`,
          `-metadata:s:a:${k}`,
          `handler_name=${t.title}`,
          `-disposition:a:${k}`,
          k === 0 ? "default" : "0",
        ]),
        "-map_metadata",
        String(meta),
        "-map_chapters",
        String(meta),
        "-c",
        "copy",
        ...lastStill,
        "-movflags",
        "+faststart",
        outFile,
      ],
      signal,
    ).catch(async (e: unknown) => {
      // Unter Windows hält der eben beendete ffmpeg-Prozess die Datei noch kurz offen: mehrmals versuchen,
      // und ein Aufräumfehler darf den eigentlichen Fehler (z. B. den Abbruch) nicht verdecken.
      await rm(outFile, { force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
      throw e;
    });
    // Zwischenspeicher aufräumen: nur behalten, was diese Ausgabe gebraucht hat.
    for (const f of await readdir(cacheDir)) {
      if (used.has(f)) continue;
      log("montage", `räumt Zwischenspeicher auf: ${join(cacheDir, f)}`);
      await rm(join(cacheDir, f), { force: true });
    }
    // Zuletzt benutzt: danach richtet sich, wann pruneMontageCache den Ordner wegräumt.
    const now = new Date();
    await utimes(cacheDir, now, now);
    return {
      audioTracks: [
        { title: tracks[0]!.title },
        ...audio.perDevice.map((d) => ({ title: d.track.title, deviceId: d.track.deviceId })),
      ],
    };
  } catch (e) {
    // Erst zurückkehren, wenn auch der Ton steht: Danach löscht exportSession den Arbeitsordner.
    inner.abort();
    await audioDone.catch(() => {});
    throw outer?.aborted ? e : (firstError ?? e);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Kapitel je Episode und Tafel (nur mit Episoden), dazu Titel und Herkunft als Metadaten. */
function chapterFile(transcript: SessionTranscript): string {
  const esc = (s: string) => s.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const h = transcript.header;
  const lines = [
    ";FFMETADATA1",
    `title=${esc(`${h.title} ${h.date}`)}`,
    `comment=${esc(`Feldspur-Montage. Quellen: ${h.sources.join(", ")}. Zeitmarken im Einsatztranskript beziehen sich auf dieses Video.`)}`,
    `date=${esc(h.date)}`,
  ];
  for (const s of transcript.episodes ? transcript.plan.segments : []) {
    const title =
      s.kind === "episode"
        ? `Episode ${s.episode.index} · ${formatClock(s.fromMs)}–${formatClock(s.toMs)}`
        : `Zwischentafel · ${formatClock(s.fromMs)}`;
    lines.push(
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      `START=${Math.round(s.montageStartMs)}`,
      `END=${Math.round(s.montageStartMs + s.montageMs)}`,
      `title=${esc(title)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** So lange bleibt der Zwischenspeicher eines Einsatzes nach seiner letzten Ausgabe liegen. */
const MONTAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Zwischenspeicher von Einsätzen entfernen, die länger als `maxAgeMs` nicht ausgegeben wurden. Fertige Abschnitte
 * beschleunigen nur die nächste Ausgabe; je Einsatz liegt sonst dauerhaft etwa ein Montagevideo auf der Platte.
 * Nicht schon beim Löschen eines Einsatzes, denn das lässt sich rückgängig machen. Gibt die entfernten Ordner zurück.
 */
export async function pruneMontageCache(
  root: string,
  { maxAgeMs = MONTAGE_CACHE_MAX_AGE_MS, now = Date.now() }: { maxAgeMs?: number; now?: number } = {},
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    const { mtimeMs } = await stat(dir);
    if (now - mtimeMs < maxAgeMs) continue;
    log("montage", `räumt alten Zwischenspeicher weg: ${dir}`);
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    removed.push(dir);
  }
  return removed;
}
