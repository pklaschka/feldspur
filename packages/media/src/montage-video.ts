/**
 * Montagevideo: Episoden in voller Länge, Zwischenzeiten als Tafeln, alles nach Uhrzeit.
 *
 * Aufbau (1280×720, 25 fps): oben eine Leiste, links das Video (oder dunkle Fläche),
 * rechts eine Seitenspalte mit dem jüngsten Foto oder Tagebuchausschnitt, unten die Zeitleisten.
 * Text und Zeitleisten zeichnet ein OverlayRenderer (in der App: die Oberfläche per Canvas),
 * weil die LGPL-Fassung von ffmpeg nicht überall Schrift setzen kann. Ohne Renderer entsteht
 * das Video trotzdem, nur ohne Einblendungen.
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
import type { Scaffold, ScaffoldEntry } from "./scaffold.ts";
import type { Still } from "./stills.ts";
import { toolPaths } from "./tools.ts";

const run = promisify(execFile);

export const W = 1280;
export const H = 720;
export const FPS = 25;
const FRAME_MS = 1000 / FPS;
const RATE = 48_000;
/** Bereiche im Bild. */
export const LAYOUT = {
  top: { x: 0, y: 0, w: W, h: 52 },
  main: { x: 0, y: 52, w: 944, h: 531 },
  side: { x: 944, y: 52, w: W - 944, h: 531 },
  bottom: { x: 0, y: 583, w: W, h: H - 583 },
} as const;

/** Daten für die Zeitleisten, einmal je Export. */
export interface OverlayTimeline {
  title: string;
  date: string;
  fromMs: number;
  toMs: number;
  episodes: { index: number; fromMs: number; toMs: number }[];
  tracks: { label: string; kind: Source["kind"]; spans: { fromMs: number; toMs: number; label: string }[] }[];
  points: { atMs: number; kind: Source["kind"] }[];
}

/** Was in einer Sekunde Montage zu sehen ist. */
export interface OverlayFrame {
  montageMs: number;
  /** Uhrzeit an dieser Stelle; in Tafeln der Beginn der Zwischenzeit. */
  clockMs: number;
  kind: "episode" | "card" | "item";
  title: string;
  /** Laufende Quellen, z. B. „A-01 Audiorekorder · V-01 Kamera (Testperson A)“. */
  sources: string[];
  /** Bildunterschrift zur Seitenspalte oder zum Standbild der Tafel. */
  caption: string;
  /** Text einer Tafel. */
  body: string;
  /** Hat das Hauptfeld ein Video? Sonst zeichnet der Renderer eine Fläche mit Hinweis. */
  hasVideo: boolean;
  /** Steht in der Seitenspalte (bzw. bei Tafeln groß) ein Standbild? */
  hasStill: boolean;
}

export type OverlayRenderer = (timeline: OverlayTimeline, frames: OverlayFrame[]) => Promise<Buffer[]>;

export interface Piece {
  /** Grenzen in Bildern ab Montagebeginn. */
  f0: number;
  f1: number;
  kind: "episode" | "card" | "item";
  /** Uhrzeit am Beginn des Stücks (in Episoden läuft sie mit). */
  clock0: number;
  title: string;
  body: string;
  video: { source: Source; fromMs: number } | null;
  audio: { source: Source; fromMs: number } | null;
  still: { file: string; caption: string } | null;
  sources: string[];
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

/** Stücke der Montage: Grenzen dort, wo Video, Ton oder Standbild wechseln. */
export function planPieces(sc: Scaffold, stillFiles: Map<ScaffoldEntry, string | null>): Piece[] {
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
  const stillOf = (e: ScaffoldEntry) => {
    const f = stillFiles.get(e);
    return f ? { file: f, caption: `${e.head} · ${e.clock}` } : null;
  };

  const pieces: Piece[] = [];
  for (const seg of plan.segments) {
    if (seg.kind === "card") {
      const items = sc.entries.filter(
        (e) =>
          (e.kind === "photo" || e.kind === "diary") &&
          e.montageMs >= seg.montageStartMs &&
          e.montageMs < seg.montageStartMs + seg.montageMs,
      );
      const card = sc.entries.find((e) => e.kind === "card" && e.montageMs === seg.montageStartMs);
      if (!items.length) {
        pieces.push({
          f0: frame(seg.montageStartMs),
          f1: frame(seg.montageStartMs + seg.montageMs),
          kind: "card",
          clock0: seg.fromMs,
          title: "Zwischentafel",
          body: card ? `${card.clock}\n${card.body}` : "",
          video: null,
          audio: null,
          still: null,
          sources: [],
        });
        continue;
      }
      items.forEach((e, i) => {
        const end = i + 1 < items.length ? items[i + 1]!.montageMs : seg.montageStartMs + seg.montageMs;
        pieces.push({
          f0: frame(e.montageMs),
          f1: frame(end),
          kind: "item",
          clock0: e.clockMs ?? seg.fromMs,
          title: e.head,
          body: `${e.clock}\n${e.body}`,
          video: null,
          audio: null,
          still: stillOf(e),
          sources: [],
        });
      });
      continue;
    }

    // Episode: Schnittpunkte an Beginn/Ende jeder Aufnahme und an jedem neuen Standbild.
    const from = seg.fromMs;
    const to = seg.toMs;
    const toM = (t: number) => seg.montageStartMs + (t - from);
    const stills = sc.entries
      .filter((e) => (e.kind === "photo" || e.kind === "diary") && e.montageMs >= toM(from) && e.montageMs <= toM(to))
      .filter((e) => stillFiles.get(e));
    const cuts = new Set<number>([from, to]);
    for (const s of av) {
      const p = place(s.id)!;
      if (p.startMs > from && p.startMs < to) cuts.add(p.startMs);
      if (p.endMs > from && p.endMs < to) cuts.add(p.endMs);
    }
    for (const e of stills) cuts.add(from + (e.montageMs - seg.montageStartMs));
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
        .sort((x, y) => place(x.id)!.startMs - place(y.id)!.startMs);
      const video = videos[0];
      const audios = running.filter((s) => s.kind === "audio");
      const mainAudio =
        audios.find((s) => s.deviceId === refDevice) ??
        audios.sort((x, y) => span(place(y.id)!) - span(place(x.id)!))[0] ??
        video;
      const lastStill = stills.filter((e) => e.montageMs <= toM(a)).at(-1);
      pieces.push({
        f0,
        f1,
        kind: "episode",
        clock0: a,
        title: `Episode ${seg.episode.index}`,
        body: "",
        video: video ? { source: video, fromMs: a - place(video.id)!.startMs } : null,
        audio: mainAudio ? { source: mainAudio, fromMs: a - place(mainAudio.id)!.startMs } : null,
        still: lastStill ? stillOf(lastStill) : null,
        sources: running.map(describe),
      });
    }
  }
  // Lückenlos machen (Rundung): jedes Stück endet, wo das nächste beginnt.
  pieces.sort((a, b) => a.f0 - b.f0);
  for (let i = 0; i + 1 < pieces.length; i++) pieces[i]!.f1 = pieces[i + 1]!.f0;
  return pieces.filter((p) => p.f1 > p.f0);
}

const span = (p: Placement) => p.endMs - p.startMs;

export function overlayTimeline(sc: Scaffold): OverlayTimeline {
  const { input, resolved } = sc;
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const tracks = new Map<string, OverlayTimeline["tracks"][number]>();
  const points: OverlayTimeline["points"] = [];
  let from = Infinity;
  let to = -Infinity;
  for (const s of input.sources) {
    const p = resolved.placements.get(s.id);
    if (!p || s.partOf) continue;
    from = Math.min(from, p.startMs);
    to = Math.max(to, p.endMs);
    if (s.kind === "audio" || s.kind === "video") {
      const key = s.deviceId ?? s.id;
      const t = tracks.get(key) ?? { label: devices.get(s.deviceId ?? "")?.label ?? s.label, kind: s.kind, spans: [] };
      t.spans.push({ fromMs: p.startMs, toMs: p.endMs, label: s.label });
      tracks.set(key, t);
    } else points.push({ atMs: p.startMs, kind: s.kind });
  }
  for (const d of resolved.diary.values()) {
    points.push({ atMs: d.fromMs, kind: "diary" });
    from = Math.min(from, d.fromMs);
    to = Math.max(to, d.toMs);
  }
  return {
    title: input.session.title,
    date: input.session.date,
    fromMs: from,
    toMs: to,
    episodes: sc.plan.segments.flatMap((s) =>
      s.kind === "episode" ? [{ index: s.episode.index, fromMs: s.fromMs, toMs: s.toMs }] : [],
    ),
    tracks: [...tracks.values()],
    points,
  };
}

function framesFor(p: Piece): OverlayFrame[] {
  const n = Math.ceil(((p.f1 - p.f0) * FRAME_MS) / 1000);
  return Array.from({ length: n }, (_, k) => ({
    montageMs: p.f0 * FRAME_MS + k * 1000,
    clockMs: p.kind === "episode" ? p.clock0 + k * 1000 : p.clock0,
    kind: p.kind,
    title: p.title,
    sources: p.sources,
    caption: p.still?.caption ?? "",
    body: p.body,
    hasVideo: !!p.video,
    hasStill: !!p.still,
  }));
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
  /** Wie viele Abschnitte gleichzeitig; Standard: halbe Kernzahl, höchstens 4. */
  parallel?: number;
}

/** Längere Stücke werden in Abschnitte dieser Länge geteilt: parallel rechenbar, feiner Fortschritt. */
const CHUNK_FRAMES = 60 * FPS;
/** Erhöhen, wenn sich das Aussehen ändert, damit alte Abschnitte nicht wiederverwendet werden. */
const LOOK_VERSION = 2;

function chunks(pieces: Piece[]): Piece[] {
  return pieces.flatMap((p) => {
    const out: Piece[] = [];
    for (let f0 = p.f0; f0 < p.f1; f0 += CHUNK_FRAMES) {
      const shift = (f0 - p.f0) * FRAME_MS;
      out.push({
        ...p,
        f0,
        f1: Math.min(p.f1, f0 + CHUNK_FRAMES),
        clock0: p.kind === "episode" ? p.clock0 + shift : p.clock0,
        video: p.video ? { ...p.video, fromMs: p.video.fromMs + shift } : null,
        audio: p.audio ? { ...p.audio, fromMs: p.audio.fromMs + shift } : null,
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

export async function renderMontage(
  sc: Scaffold,
  stills: Map<ScaffoldEntry, (Still | null)[]>,
  outFile: string,
  opts: MontageVideoOptions,
): Promise<void> {
  const dir = join(opts.workDir, "montage");
  await mkdir(dir, { recursive: true });
  // Erstes darstellbares Bild je Eintrag als Datei für ffmpeg, benannt nach Inhalt (für den Zwischenspeicher).
  const stillFiles = new Map<ScaffoldEntry, string | null>();
  for (const [e, list] of stills) {
    const s = list.find(Boolean);
    if (!s) continue;
    const f = join(dir, `still-${createHash("sha1").update(s.data).digest("hex").slice(0, 16)}.jpg`);
    await writeFile(f, s.data);
    stillFiles.set(e, f);
  }
  const pieces = planPieces(sc, stillFiles);
  const parts = chunks(pieces);
  const timeline = overlayTimeline(sc);
  const enc = await videoEncoder();
  const cacheDir = opts.cacheDir ?? join(dir, "abschnitte");
  await mkdir(cacheDir, { recursive: true });
  const parallel = opts.parallel ?? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

  const used = new Set<string>();
  const fileId = async (path: string) => {
    const st = await stat(path);
    return `${path}|${st.size}|${st.mtimeMs}`;
  };

  // Ton nebenher: je Stück PCM mit exakter Länge, am Ende einmal AAC. Unverändert: aus dem Zwischenspeicher.
  const audioDone = (async () => {
    const audioKey = createHash("sha1")
      .update(
        JSON.stringify(
          await Promise.all(
            pieces.map(async (p) => [
              p.f1 - p.f0,
              p.audio ? [await fileId(p.audio.source.originalPath), p.audio.fromMs] : null,
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
      const pad = `aresample=${RATE},aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${samples}`;
      await ff(
        p.audio
          ? [
              "-ss",
              (p.audio.fromMs / 1000).toFixed(3),
              "-t",
              durS.toFixed(3),
              "-i",
              p.audio.source.originalPath,
              "-vn",
            ].concat(["-af", pad, "-c:a", "pcm_s16le", aOut])
          : ["-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=stereo`, "-af", `atrim=end_sample=${samples}`].concat([
              "-c:a",
              "pcm_s16le",
              aOut,
            ]),
      );
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
          video: p.video ? { id: await fileId(p.video.source.originalPath), fromMs: p.video.fromMs } : null,
          still: p.still ? { file: basename(p.still.file), kind: p.kind } : null,
          // Die Stelle im Video gehört nicht zum Bild: Abschnitte bleiben gültig, wenn sich davor etwas ändert.
          frames: frames?.map(({ montageMs: _m, ...f }) => f),
          timeline: frames ? timeline : null,
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
    const m = LAYOUT.main;
    const sd = LAYOUT.side;
    // Ohne Video ändert sich das Bild höchstens einmal je Sekunde: mit 1 Bild/s zusammensetzen,
    // erst ganz am Ende auf 25 Bilder/s vervielfachen. Spart den größten Teil der Rechenzeit.
    const rate = p.video ? FPS : 1;
    const srcDur = (Math.ceil(durS) + 1).toString();
    const args: string[] = ["-f", "lavfi", "-i", `color=c=0x10171b:s=${W}x${H}:r=${rate}:d=${srcDur}`];
    const filters: string[] = [];
    let last = "[0:v]";
    let input = 1;
    if (p.video) {
      args.push("-hwaccel", "auto", "-ss", (p.video.fromMs / 1000).toFixed(3), "-t", durS.toFixed(3));
      args.push("-i", p.video.source.originalPath);
      filters.push(
        `[${input}:v]fps=${FPS},scale=${m.w}:${m.h}:force_original_aspect_ratio=decrease,setsar=1[v${input}]`,
        `${last}[v${input}]overlay=x=${m.x}+(${m.w}-overlay_w)/2:y=${m.y}+(${m.h}-overlay_h)/2:eof_action=pass[b${input}]`,
      );
      last = `[b${input}]`;
      input++;
    }
    if (p.still) {
      const box = p.kind === "item" ? { x: m.x, y: m.y, w: m.w, h: m.h } : sd;
      args.push("-framerate", String(rate), "-loop", "1", "-t", srcDur, "-i", p.still.file);
      filters.push(
        `[${input}:v]scale=${box.w - 16}:${box.h - 40}:force_original_aspect_ratio=decrease,setsar=1[s${input}]`,
        `${last}[s${input}]overlay=x=${box.x}+(${box.w}-overlay_w)/2:y=${box.y}+8:shortest=1[b${input}]`,
      );
      last = `[b${input}]`;
      input++;
    }
    if (opts.overlay && frames) {
      const pngs = await opts.overlay(timeline, frames);
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
