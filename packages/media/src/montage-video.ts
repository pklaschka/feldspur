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
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

interface Piece {
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
function planPieces(sc: Scaffold, stillFiles: Map<ScaffoldEntry, string | null>): Piece[] {
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
  onProgress?: (done: number, total: number) => void;
}

export async function renderMontage(
  sc: Scaffold,
  stills: Map<ScaffoldEntry, (Still | null)[]>,
  outFile: string,
  opts: MontageVideoOptions,
): Promise<void> {
  const dir = join(opts.workDir, "montage");
  await mkdir(dir, { recursive: true });
  // Erstes darstellbares Bild je Eintrag als Datei für ffmpeg.
  const stillFiles = new Map<ScaffoldEntry, string | null>();
  let k = 0;
  for (const [e, list] of stills) {
    const s = list.find(Boolean);
    if (!s) continue;
    const f = join(dir, `still-${k++}.jpg`);
    await writeFile(f, s.data);
    stillFiles.set(e, f);
  }
  const pieces = planPieces(sc, stillFiles);
  const timeline = overlayTimeline(sc);
  const enc = await videoEncoder();
  const vList: string[] = [];
  const aList: string[] = [];

  for (const [i, p] of pieces.entries()) {
    opts.onProgress?.(i, pieces.length);
    const durS = ((p.f1 - p.f0) * FRAME_MS) / 1000;
    const dur = durS.toFixed(3);
    const pdir = join(dir, `p${i}`);
    await mkdir(pdir, { recursive: true });
    const args: string[] = ["-f", "lavfi", "-i", `color=c=0x10171b:s=${W}x${H}:r=${FPS}:d=${dur}`];
    const filters: string[] = [];
    let last = "[0:v]";
    let input = 1;
    const m = LAYOUT.main;
    const sd = LAYOUT.side;
    if (p.video) {
      args.push("-ss", (p.video.fromMs / 1000).toFixed(3), "-t", dur, "-i", p.video.source.originalPath);
      filters.push(
        `[${input}:v]fps=${FPS},scale=${m.w}:${m.h}:force_original_aspect_ratio=decrease,setsar=1[v${input}]`,
        `${last}[v${input}]overlay=x=${m.x}+(${m.w}-overlay_w)/2:y=${m.y}+(${m.h}-overlay_h)/2:eof_action=pass[b${input}]`,
      );
      last = `[b${input}]`;
      input++;
    }
    if (p.still) {
      const box = p.kind === "item" ? { x: m.x, y: m.y, w: m.w, h: m.h } : sd;
      args.push("-loop", "1", "-t", dur, "-i", p.still.file);
      filters.push(
        `[${input}:v]scale=${box.w - 16}:${box.h - 40}:force_original_aspect_ratio=decrease,setsar=1[s${input}]`,
        `${last}[s${input}]overlay=x=${box.x}+(${box.w}-overlay_w)/2:y=${box.y}+8:shortest=1[b${input}]`,
      );
      last = `[b${input}]`;
      input++;
    }
    if (opts.overlay) {
      const pngs = await opts.overlay(timeline, framesFor(p));
      await Promise.all(pngs.map((b, j) => writeFile(join(pdir, `o${String(j).padStart(5, "0")}.png`), b)));
      args.push("-framerate", "1", "-i", join(pdir, "o%05d.png"));
      filters.push(`[${input}:v]fps=${FPS}[o${input}]`, `${last}[o${input}]overlay=0:0:eof_action=repeat[b${input}]`);
      last = `[b${input}]`;
      input++;
    }
    filters.push(`${last}format=yuv420p,trim=duration=${dur}[out]`);
    const vOut = join(pdir, "v.mp4");
    await ff([
      ...args,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-frames:v",
      String(p.f1 - p.f0),
      "-r",
      String(FPS),
      ...enc,
      "-g",
      String(FPS * 2),
      "-an",
      vOut,
    ]);
    vList.push(vOut);

    // Ton: PCM mit exakter Länge (Stille, wo nichts läuft).
    const aOut = join(pdir, "a.wav");
    const samples = Math.round(durS * RATE);
    if (p.audio) {
      await ff([
        "-ss",
        (p.audio.fromMs / 1000).toFixed(3),
        "-t",
        dur,
        "-i",
        p.audio.source.originalPath,
        "-vn",
        "-af",
        `aresample=${RATE},aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=end_sample=${samples}`,
        "-c:a",
        "pcm_s16le",
        aOut,
      ]);
    } else {
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
    }
    aList.push(aOut);
  }

  const listFile = (name: string, files: string[]) =>
    writeFile(join(dir, name), files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await listFile("v.txt", vList);
  await listFile("a.txt", aList);
  opts.onProgress?.(pieces.length, pieces.length);
  const chapters = chapterFile(sc);
  await writeFile(join(dir, "meta.txt"), chapters);
  await ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "v.txt"),
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "a.txt"),
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
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outFile,
  ]);
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
