/**
 * Montagevideo: nur, was zum Zuordnen nötig ist. Episoden in voller Länge mit kurzen Tafeln
 * für übersprungene Zwischenzeiten, oder alles in Echtzeit.
 *
 * Aufbau (1280×720, 25 fps): oben Uhrzeit, Einsatz und Montage-ID; in der Mitte die laufenden
 * Videos (gleichzeitige nebeneinander) mit Kurzzeichen, Datei und Stelle im Original; unten die
 * laufenden Tonquellen. Fotos und Tagebuch stehen im Zeitgerüst, nicht im Video.
 * Text zeichnet ein OverlayRenderer (in der App: die Oberfläche per Canvas), weil die
 * LGPL-Fassung von ffmpeg nicht überall Schrift setzen kann. Ohne Renderer entsteht das Video
 * trotzdem, nur ohne Einblendungen.
 *
 * Das Video entsteht stückweise mit festen Parametern und wird ohne Neukodierung verbunden.
 * Der Ton wird als PCM je Stück erzeugt und am Ende einmal kodiert, damit er auf die
 * Probe genau zur Bildzeit passt.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { formatClock, type Id, type Placement, type Source } from "@feldspur/core";
import type { Scaffold } from "./scaffold.ts";
import { FPS, H, MAX_TILES, videoTiles, W } from "./layout.ts";
import { probeMedia } from "./probe.ts";
import { toolPaths } from "./tools.ts";

const run = promisify(execFile);

const FRAME_MS = 1000 / FPS;
const RATE = 48_000;

/** Was für die ganze Montage gleich bleibt (Kopfzeile). */
export interface OverlayHeader {
  title: string;
  date: string;
  /** Ordnet Video und Zeitgerüst einander zu, z. B. „FS-7KQ2-M9XD“. */
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
function ffProgress(args: string[], onTimeMs: (ms: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      toolPaths().ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    let buf = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m) onTimeMs(Number(m[1]) / 1000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim() || code}`))));
  });
}

async function ff(args: string[]): Promise<void> {
  await run(toolPaths().ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

let encoderCache: string[] | null = null;
/** H.264, wenn möglich: libx264 (Entwicklung), VideoToolbox (macOS), Media Foundation (Windows), OpenH264; sonst MPEG-4. */
export async function videoEncoder(): Promise<string[]> {
  if (encoderCache) return encoderCache;
  const { stdout } = await run(toolPaths().ffmpeg, ["-hide_banner", "-encoders"], { maxBuffer: 8 * 1024 * 1024 });
  const has = (n: string) => new RegExp(`^\\s*V\\S*\\s+${n}\\s`, "m").test(stdout);
  encoderCache = has("libx264")
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    : has("h264_videotoolbox")
      ? ["-c:v", "h264_videotoolbox", "-b:v", "3M"]
      : has("h264_mf")
        ? ["-c:v", "h264_mf", "-b:v", "3M"]
        : has("libopenh264")
          ? ["-c:v", "libopenh264", "-b:v", "3M"]
          : ["-c:v", "mpeg4", "-q:v", "4"];
  return encoderCache;
}

/** Stücke der Montage: Grenzen dort, wo eine Aufnahme beginnt oder endet. */
export function planPieces(sc: Scaffold): Piece[] {
  const { input, resolved, plan } = sc;
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
      const card = sc.entries.find((e) => e.kind === "card" && e.montageMs === seg.montageStartMs);
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
        [...audioOnly].sort((x, y) => span(place(y.id)!) - span(place(x.id)!))[0] ??
        videos[0];
      const sounding = running.filter((s) => s.kind === "audio" || s.kind === "video");
      const audios = mainAudio ? [mainAudio, ...sounding.filter((s) => s !== mainAudio)] : sounding;
      const ref = (s: Source): MediaRef => ({ source: s, fromMs: a - place(s.id)!.startMs, label: describe(s) });
      pieces.push({
        f0,
        f1,
        kind: seg.kind === "episode" ? "episode" : "gap",
        clock0: a,
        title: seg.kind === "episode" ? `Episode ${seg.episode.index}` : "Zwischenzeit",
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

export function overlayHeader(sc: Scaffold): OverlayHeader {
  const h = sc.header;
  return { title: h.title, date: h.date, montageId: h.montageId, modeLabel: h.modeLabel };
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
  /** Wie viele Abschnitte gleichzeitig; Standard: halbe Kernzahl, höchstens 4. */
  parallel?: number;
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

/** Einfache Warteschlange: höchstens n Aufgaben gleichzeitig. */
async function pool<T>(items: T[], n: number, work: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i]!, i);
    }
  });
  await Promise.all(workers);
}

export async function renderMontage(sc: Scaffold, outFile: string, opts: MontageVideoOptions): Promise<void> {
  const dir = join(opts.workDir, "montage");
  await mkdir(dir, { recursive: true });
  // Erstes darstellbares Bild je Eintrag als Datei für ffmpeg, benannt nach Inhalt (für den Zwischenspeicher).
  const pieces = planPieces(sc);
  const parts = chunks(pieces);
  const header = overlayHeader(sc);
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
      got = probeMedia(src.originalPath).then(
        (pr) => pr.hasAudio,
        () => false,
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
  const audioDone = (async () => {
    const sounds = await Promise.all(pieces.map(soundOf));
    const audioKey = createHash("sha1")
      .update(
        JSON.stringify(
          await Promise.all(
            pieces.map(async (p, i) => [
              p.f1 - p.f0,
              await Promise.all(sounds[i]!.map(async (a) => [await fileId(a.source.originalPath), a.fromMs])),
            ]),
          ),
        ),
      )
      .digest("hex");
    const cached = join(cacheDir, `ton-${audioKey}.m4a`);
    used.add(basename(cached));
    if (await exists(cached)) return cached;
    const aList: string[] = [];
    for (const [i, p] of pieces.entries()) {
      const durS = ((p.f1 - p.f0) * FRAME_MS) / 1000;
      const aOut = join(dir, `a${i}.wav`);
      const samples = Math.round(durS * RATE);
      const fit = `apad,atrim=end_sample=${samples}`;
      const src = sounds[i]!;
      if (!src.length) {
        await ff([
          "-f",
          "lavfi",
          "-i",
          `anullsrc=r=${RATE}:cl=stereo`,
          "-af",
          `atrim=end_sample=${samples}`,
          "-c:a",
          "pcm_s16le",
          aOut,
        ]);
      } else {
        // Mehrere Geräte übereinander: gleich laut addiert, ein Begrenzer fängt Spitzen ab.
        const args: string[] = [];
        const f: string[] = [];
        for (const [k, a] of src.entries()) {
          args.push("-ss", (a.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3), "-i", a.source.originalPath);
          f.push(`[${k}:a]aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo[a${k}]`);
        }
        const mix =
          src.length > 1
            ? `${src.map((_, k) => `[a${k}]`).join("")}amix=inputs=${src.length}:normalize=0:duration=longest,alimiter=limit=0.95,`
            : "[a0]";
        f.push(`${mix}aformat=sample_fmts=s16:channel_layouts=stereo,${fit}[out]`);
        await ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", "-c:a", "pcm_s16le", aOut]);
      }
      aList.push(aOut);
    }
    await writeFile(join(dir, "a.txt"), aList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const m4a = join(dir, "a.m4a");
    await ff(["-f", "concat", "-safe", "0", "-i", join(dir, "a.txt"), "-c:a", "aac", "-b:a", "160k", m4a]);
    await rename(m4a, cached).catch(() => copyFile(m4a, cached));
    for (const f of aList) await rm(f, { force: true });
    return cached;
  })();
  // Fehler im Ton erst beim Zusammenfügen melden, aber nicht unbehandelt lassen.
  audioDone.catch(() => {});

  const totalS = Math.round((pieces.at(-1)?.f1 ?? 0) / FPS);
  const doneFrames = new Map<number, number>();
  const report = () => {
    let f = 0;
    for (const v of doneFrames.values()) f += v;
    opts.onProgress?.(Math.min(totalS, Math.round(f / FPS)), totalS);
  };
  report();

  const vFiles: string[] = [];

  await pool(parts, parallel, async (p, i) => {
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
    if (await exists(vOut)) {
      doneFrames.set(i, frameCount);
      report();
      return;
    }

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
    );
    await rename(tmp, vOut).catch(async () => {
      await copyFile(tmp, vOut);
    });
    await rm(pdir, { recursive: true, force: true });
    doneFrames.set(i, frameCount);
    report();
  });

  await writeFile(join(dir, "v.txt"), vFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await writeFile(join(dir, "meta.txt"), chapterFile(sc));
  const m4a = await audioDone;
  await ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "v.txt"),
    "-i",
    m4a,
    "-i",
    join(dir, "meta.txt"),
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map_metadata",
    "2",
    "-map_chapters",
    "2",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outFile,
  ]);
  // Zwischenspeicher aufräumen: nur behalten, was diese Ausgabe gebraucht hat.
  for (const f of await readdir(cacheDir)) if (!used.has(f)) await rm(join(cacheDir, f), { force: true });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Kapitel je Episode und Tafel, dazu Titel und Herkunft als Metadaten. */
function chapterFile(sc: Scaffold): string {
  const esc = (s: string) => s.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
  const h = sc.header;
  const lines = [
    ";FFMETADATA1",
    `title=${esc(`${h.title} ${h.date}`)}`,
    `comment=${esc(`Feldspur-Montage. Quellen: ${h.sources.join(", ")}. Zeitmarken im Zeitgerüst beziehen sich auf dieses Video.`)}`,
    `date=${esc(h.date)}`,
  ];
  for (const s of sc.plan.segments) {
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
