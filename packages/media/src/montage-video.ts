/**
 * Montagevideo: nur, was zum Zuordnen nötig ist. Episoden in voller Länge mit kurzen Tafeln
 * für übersprungene Zwischenzeiten, oder alles in Echtzeit.
 *
 * Aufbau (1280×720, 25 fps): oben Uhrzeit, Einsatz und Montage-ID; in der Mitte die laufenden
 * Videos (gleichzeitige nebeneinander) mit Kurzzeichen, Datei und Stelle im Original; unten die
 * laufenden Tonquellen. Fotos und Tagebuch stehen im Einsatztranskript, nicht im Video.
 * Text zeichnet ein OverlayRenderer (in der App: die Oberfläche per Canvas), weil die
 * LGPL-Fassung von ffmpeg nicht überall Schrift setzen kann. Ohne Renderer entsteht das Video
 * trotzdem, nur ohne Einblendungen.
 *
 * Das Video entsteht stückweise mit festen Parametern und wird ohne Neukodierung verbunden.
 * Der Ton wird als PCM je Stück erzeugt und am Ende einmal kodiert, damit er auf die
 * Probe genau zur Bildzeit passt.
 *
 * Tonspuren: Spur 1 ist immer die Mischung (oder nur die Hauptquelle) und als Standard markiert; das hören
 * MAXQDA und jeder Player. Auf Wunsch folgt je Gerät eine eigene Spur, so lang wie das Video und stumm, wo
 * das Gerät nicht läuft (Issue #122). Schnittprogramme, VLC und der Viewer können sie einzeln abspielen.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { formatClock, type Id, type Placement, type Source } from "@feldspur/core";
import type { SessionTranscript } from "./session-transcript.ts";
import { FPS, H, MAX_TILES, videoTiles, W } from "./layout.ts";
import { levelFilter, type AudioLevel } from "./audio.ts";
import { log } from "./log.ts";
import { probeMedia } from "./probe.ts";
import { PROBE_TIMEOUT_MS, runTool, STALL_MS } from "./process.ts";

const FRAME_MS = 1000 / FPS;
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
  montageMs: number;
  /** Uhrzeit an dieser Stelle; in Tafeln der Beginn der Zwischenzeit. */
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

export type OverlayRenderer = (header: OverlayHeader, frames: OverlayFrame[]) => Promise<Buffer[]>;

export interface MediaRef {
  source: Source;
  /** Stelle in der Datei am Beginn des Stücks. */
  fromMs: number;
  /** Kurzzeichen und Gerät, z. B. „V-01 Kamera Stativ“. */
  label: string;
}

export interface Piece {
  /** Grenzen in Bildern ab Montagebeginn. */
  f0: number;
  f1: number;
  kind: OverlayFrame["kind"];
  /** Uhrzeit am Beginn des Stücks (außer in Tafeln läuft sie mit). */
  clock0: number;
  title: string;
  body: string;
  /** Gleichzeitig laufende Videos (höchstens MAX_TILES), nebeneinander im Hauptfeld. */
  videos: MediaRef[];
  /** Laufende Tonquellen, die Hauptquelle zuerst (Referenzgerät, sonst die längste). */
  audios: MediaRef[];
}

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

async function ff(args: string[], signal?: AbortSignal): Promise<void> {
  await runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { signal });
}

/** Feste Bitrate der Hardware-Encoder (kbit/s); libx264 mit CRF landet bei ruhigen Bildern meist darunter. */
const VIDEO_KBPS = 3000;
/** Tonspur 1 (Mischung oder Hauptquelle) und jede Spur je Gerät, kbit/s. */
const MIX_KBPS = 160;
const DEVICE_TRACK_KBPS = 128;

/** Bild ohne laufendes Video (Tafel, Uhrzeit auf leerem Grund): fast nichts ändert sich, kbit/s. */
const STILL_KBPS = 100;

/**
 * Ungefähre Größe des Montagevideos in Bytes, Stück für Stück: volle Bildbitrate nur, wo ein Video läuft, sonst
 * kaum etwas; Ton nur, wo eine Tonquelle läuft (Stille kostet in AAC fast nichts). `video` ist das Video mit
 * Tonspur 1, `deviceTracks` kommt mit einer Spur je Gerät dazu (erst ab zwei Geräten mit Ton). Eine Schätzung; je
 * nach Encoder und Bild weicht die echte Datei ab.
 */
export function estimateMontageBytes(
  transcript: SessionTranscript,
  pieces: Piece[] = planPieces(transcript),
): { video: number; deviceTracks: number } {
  const bytes = (kbps: number, frames: number) => ((kbps * 1000) / 8) * (frames / FPS);
  let video = 0;
  const perDevice = new Map<Id, number>();
  for (const p of pieces) {
    const frames = p.f1 - p.f0;
    video += bytes(p.videos.length ? VIDEO_KBPS : STILL_KBPS, frames);
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

let encoderCache: string[] | null = null;
/** H.264, wenn möglich: libx264 (Entwicklung), VideoToolbox (macOS), Media Foundation (Windows), OpenH264; sonst MPEG-4. */
export async function videoEncoder(): Promise<string[]> {
  if (encoderCache) return encoderCache;
  const stdout = await runTool("ffmpeg", ["-hide_banner", "-encoders"], { timeoutMs: PROBE_TIMEOUT_MS });
  const has = (n: string) => new RegExp(`^\\s*V\\S*\\s+${n}\\s`, "m").test(stdout);
  encoderCache = has("libx264")
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    : has("h264_videotoolbox")
      ? ["-c:v", "h264_videotoolbox", "-b:v", `${VIDEO_KBPS}k`]
      : has("h264_mf")
        ? ["-c:v", "h264_mf", "-b:v", `${VIDEO_KBPS}k`]
        : has("libopenh264")
          ? ["-c:v", "libopenh264", "-b:v", `${VIDEO_KBPS}k`]
          : ["-c:v", "mpeg4", "-q:v", "4"];
  return encoderCache;
}

/** Stücke der Montage: Grenzen dort, wo eine Aufnahme beginnt oder endet. */
export function planPieces(transcript: SessionTranscript): Piece[] {
  const { input, resolved, plan } = transcript;
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const place = (id: Id) => resolved.placements.get(id);
  const av = input.sources.filter((s) => (s.kind === "audio" || s.kind === "video") && place(s.id));
  const refDevice = input.devices.find((d) => d.isReference)?.id;
  const frame = (ms: number) => Math.round(ms / FRAME_MS);
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
      const mid = (a + b) / 2;
      const running = av.filter((s) => covering(s, mid));
      const videos = running
        .filter((s) => s.kind === "video")
        .sort((x, y) => place(x.id)!.startMs - place(y.id)!.startMs)
        .slice(0, MAX_TILES);
      const audioOnly = running.filter((s) => s.kind === "audio");
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

export function overlayHeader(transcript: SessionTranscript): OverlayHeader {
  const h = transcript.header;
  return { title: h.title, date: h.date, montageId: h.montageVideoId, modeLabel: h.modeLabel };
}

/** Einblendung an einer Stelle eines Stücks (ms ab Stückbeginn). */
export function frameAt(p: Piece, offsetMs: number): OverlayFrame {
  const media = (m: MediaRef): OverlayMedia => ({
    label: m.label,
    fileName: m.source.fileName,
    atMs: m.fromMs + offsetMs,
  });
  const shown = new Set(p.videos.map((v) => v.source.id));
  return {
    montageMs: p.f0 * FRAME_MS + offsetMs,
    clockMs: p.kind === "card" ? p.clock0 : p.clock0 + offsetMs,
    kind: p.kind,
    title: p.title,
    body: p.body,
    tiles: p.videos.map(media),
    sounds: p.audios.filter((a) => !shown.has(a.source.id)).map(media),
  };
}

function framesFor(p: Piece): OverlayFrame[] {
  const n = Math.ceil(((p.f1 - p.f0) * FRAME_MS) / 1000);
  return Array.from({ length: n }, (_, k) => frameAt(p, k * 1000));
}

export interface MontageVideoOptions {
  workDir: string;
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
  /** Wie viele Abschnitte gleichzeitig; Standard: halbe Kernzahl, höchstens 4. */
  parallel?: number;
  /** Lautstärke-Angleichung je Quelle (audioLevelOf); fehlt eine Quelle, bleibt ihr Ton unverändert. */
  levels?: Map<string, AudioLevel | null>;
  /**
   * Abbrechen: laufende ffmpeg-Prozesse werden beendet, renderMontage wirft einen AbortError.
   * Schon fertige Abschnitte bleiben im Zwischenspeicher (cacheDir) und werden beim nächsten Mal übernommen.
   */
  signal?: AbortSignal;
}

/** Längere Stücke werden in Abschnitte dieser Länge geteilt: parallel rechenbar, feiner Fortschritt. */
const CHUNK_FRAMES = 60 * FPS;
/** Erhöhen, wenn sich das Aussehen ändert, damit alte Abschnitte nicht wiederverwendet werden. */
const LOOK_VERSION = 5;

function chunks(pieces: Piece[]): Piece[] {
  return pieces.flatMap((p) => {
    const out: Piece[] = [];
    for (let f0 = p.f0; f0 < p.f1; f0 += CHUNK_FRAMES) {
      const shift = (f0 - p.f0) * FRAME_MS;
      out.push({
        ...p,
        f0,
        f1: Math.min(p.f1, f0 + CHUNK_FRAMES),
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

/** Was im fertigen Video steckt, soweit andere Ausgaben es brauchen (der Viewer). */
export interface MontageResult {
  /** Tonspuren in ihrer Reihenfolge; Spur 1 ist die Mischung, danach je Gerät eine. */
  audioTracks: { title: string; deviceId?: Id }[];
}

export async function renderMontage(
  transcript: SessionTranscript,
  outFile: string,
  opts: MontageVideoOptions,
): Promise<MontageResult> {
  const outer = opts.signal;
  outer?.throwIfAborted();
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
  // Erstes darstellbares Bild je Eintrag als Datei für ffmpeg, benannt nach Inhalt (für den Zwischenspeicher).
  const pieces = planPieces(transcript);
  const parts = chunks(pieces);
  const header = overlayHeader(transcript);
  const enc = await videoEncoder();
  const cacheDir = opts.cacheDir ?? join(dir, "abschnitte");
  await mkdir(cacheDir, { recursive: true });
  const parallel = opts.parallel ?? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

  const used = new Set<string>();
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

  // Ton nebenher: je Stück PCM mit exakter Länge, am Ende einmal AAC. Unverändert: aus dem Zwischenspeicher.
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
      const durS = ((p.f1 - p.f0) * FRAME_MS) / 1000;
      const aOut = join(dir, `${tag}-${i}.wav`);
      const samples = Math.round(durS * RATE);
      const fit = `apad,atrim=end_sample=${samples}`;
      const src = sounds[i]!;
      if (!src.length) {
        await ff(
          [
            "-f",
            "lavfi",
            "-i",
            `anullsrc=r=${RATE}:cl=stereo`,
            "-af",
            `atrim=end_sample=${samples}`,
            "-c:a",
            "pcm_s16le",
            aOut,
          ],
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
        await ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", aOut], signal);
      }
      aList.push(aOut);
    }
    const listFile = join(dir, `${tag}.txt`);
    await writeFile(listFile, aList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const m4a = join(dir, `${tag}.m4a`);
    await ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", bitrate, m4a], signal);
    await rename(m4a, cached).catch(() => copyFile(m4a, cached));
    for (const f of aList) await rm(f, { force: true });
    return cached;
  };

  // Spur 1: Mischung oder Hauptquelle. Danach, falls gewünscht, je Gerät eine Spur. Nacheinander statt
  // gleichzeitig: Die Bildabschnitte brauchen die Rechenleistung, der Ton ist daneben schnell fertig.
  const devices = opts.deviceTracks ? deviceTracksOf(transcript, pieces) : [];
  const audioDone = (async () => {
    const all = await Promise.all(
      pieces.map(async (p) => {
        const ok = await Promise.all(p.audios.map((a) => hasSound(a.source)));
        return p.audios.filter((_, k) => ok[k]);
      }),
    );
    const mix = await renderTrack("a", await Promise.all(pieces.map(soundOf)), `${MIX_KBPS}k`);
    const perDevice: { track: DeviceTrack; file: string }[] = [];
    const withSound = devices.filter((d) => all.some((list) => list.some((a) => a.source.deviceId === d.deviceId)));
    if (withSound.length >= 2)
      for (const [k, d] of withSound.entries())
        perDevice.push({
          track: d,
          file: await renderTrack(
            `g${k}`,
            all.map((list) => list.filter((a) => a.source.deviceId === d.deviceId)),
            `${DEVICE_TRACK_KBPS}k`,
          ),
        });
    return { mix, perDevice };
  })();
  // Scheitert der Ton, gleich alles beenden; der Fehler kommt beim Zusammenfügen bzw. im catch unten.
  audioDone.catch(fail);

  try {
    const totalS = Math.round((pieces.at(-1)?.f1 ?? 0) / FPS);
    const doneFrames = new Map<number, number>();
    const report = () => {
      let f = 0;
      for (const v of doneFrames.values()) f += v;
      opts.onProgress?.(Math.min(totalS, Math.round(f / FPS)), totalS);
    };
    report();

    const vFiles: string[] = [];

    await pool(
      parts,
      parallel,
      async (p, i) => {
        const frameCount = p.f1 - p.f0;
        const durS = (frameCount * FRAME_MS) / 1000;
        const frames = opts.overlay ? framesFor(p) : null;
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
        // Ohne Video ändert sich das Bild höchstens einmal je Sekunde: mit 1 Bild/s zusammensetzen,
        // erst ganz am Ende auf 25 Bilder/s vervielfachen. Spart den größten Teil der Rechenzeit.
        const rate = p.videos.length ? FPS : 1;
        const srcDur = (Math.ceil(durS) + 1).toString();
        const args: string[] = ["-f", "lavfi", "-i", `color=c=0x10171b:s=${W}x${H}:r=${rate}:d=${srcDur}`];
        const filters: string[] = [];
        let last = "[0:v]";
        let input = 1;
        // Gleichzeitige Videos nebeneinander, jedes in sein Feld eingepasst.
        const tiles = videoTiles(p.videos.length);
        for (const [k, v] of p.videos.entries()) {
          const box = tiles[k]!;
          args.push("-hwaccel", "auto", "-ss", (v.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3));
          args.push("-i", v.source.originalPath);
          filters.push(
            `[${input}:v]fps=${FPS},scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[v${input}]`,
            `${last}[v${input}]overlay=x=${box.x}+(${box.w}-overlay_w)/2:y=${box.y}+(${box.h}-overlay_h)/2:eof_action=pass[b${input}]`,
          );
          last = `[b${input}]`;
          input++;
        }
        if (opts.overlay && frames) {
          const pngs = await opts.overlay(header, frames);
          signal?.throwIfAborted();
          await Promise.all(pngs.map((b, j) => writeFile(join(pdir, `o${String(j).padStart(5, "0")}.png`), b)));
          args.push("-framerate", "1", "-i", join(pdir, "o%05d.png"));
          filters.push(
            rate === 1 ? `[${input}:v]null[o${input}]` : `[${input}:v]fps=${FPS}[o${input}]`,
            `${last}[o${input}]overlay=0:0:eof_action=repeat[b${input}]`,
          );
          last = `[b${input}]`;
          input++;
        }
        filters.push(`${last}format=yuv420p${rate === 1 ? `,fps=${FPS}` : ""},trim=duration=${durS.toFixed(3)}[out]`);
        const tmp = join(pdir, "v.mp4");
        await ffProgress(
          [
            ...args,
            "-filter_complex",
            filters.join(";"),
            "-map",
            "[out]",
            "-frames:v",
            String(frameCount),
            "-r",
            String(FPS),
            ...enc,
            "-g",
            String(FPS * 2),
            "-an",
            tmp,
          ],
          (ms) => {
            doneFrames.set(i, Math.min(frameCount, Math.round(ms / FRAME_MS)));
            report();
          },
          signal,
        );
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

    await writeFile(join(dir, "v.txt"), vFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    await writeFile(join(dir, "meta.txt"), chapterFile(transcript));
    const audio = await audioDone;
    signal?.throwIfAborted();
    // Spur 1 trägt die Mischung und ist Standard; die Gerätespuren folgen, nicht als Standard markiert.
    const tracks = [
      { file: audio.mix, title: mixTrackTitle(opts.audioMix) },
      ...audio.perDevice.map((d) => ({ file: d.file, title: d.track.title })),
    ];
    const meta = 1 + tracks.length;
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
