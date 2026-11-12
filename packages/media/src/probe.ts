/**
 * Metadaten aus Audio/Video lesen (ffprobe) und aus Bildern (EXIF).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import exifr from "exifr";
import { toolPaths } from "./tools.ts";

const run = promisify(execFile);

export interface MediaProbe {
  durationMs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Alle Tags aus Container und Streams, Schlüssel klein geschrieben. */
  tags: Record<string, string>;
  formatName: string;
  width?: number;
  height?: number;
}

interface FfprobeJson {
  format?: { duration?: string; format_name?: string; tags?: Record<string, string> };
  streams?: { codec_type?: string; width?: number; height?: number; tags?: Record<string, string> }[];
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const { stdout } = await run(
    toolPaths().ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { maxBuffer: 16 << 20 },
  );
  const j = JSON.parse(stdout) as FfprobeJson;
  const tags: Record<string, string> = {};
  // Stream-Tags zuerst, Container-Tags überschreiben: der Container ist maßgeblich.
  for (const s of j.streams ?? []) for (const [k, v] of Object.entries(s.tags ?? {})) tags[k.toLowerCase()] ??= v;
  for (const [k, v] of Object.entries(j.format?.tags ?? {})) tags[k.toLowerCase()] = v;
  const video = j.streams?.find((s) => s.codec_type === "video");
  const dur = Number(j.format?.duration);
  return {
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null,
    hasVideo: !!video,
    hasAudio: !!j.streams?.some((s) => s.codec_type === "audio"),
    tags,
    formatName: j.format?.format_name ?? "",
    ...(video?.width ? { width: video.width } : {}),
    ...(video?.height ? { height: video.height } : {}),
  };
}

export interface ImageExif {
  make?: string;
  model?: string;
  /** "2026:09:14 10:12:34" wie in der Datei. */
  dateTimeOriginal?: string;
  subSec?: string;
  offsetTime?: string;
  gps?: { latitude: number; longitude: number };
}

export async function readImageExif(path: string): Promise<ImageExif | null> {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = (await exifr.parse(path, {
      tiff: true,
      exif: true,
      gps: true,
      reviveValues: false,
      pick: [
        "Make",
        "Model",
        "DateTimeOriginal",
        "CreateDate",
        "SubSecTimeOriginal",
        "OffsetTimeOriginal",
        "latitude",
        "longitude",
      ],
    })) as Record<string, unknown> | undefined;
  } catch {
    return null;
  }
  if (!raw) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const out: ImageExif = {};
  const set = <K extends keyof ImageExif>(k: K, v: ImageExif[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("make", str(raw.Make));
  set("model", str(raw.Model));
  set("dateTimeOriginal", str(raw.DateTimeOriginal) ?? str(raw.CreateDate));
  set("subSec", str(raw.SubSecTimeOriginal));
  set("offsetTime", str(raw.OffsetTimeOriginal));
  if (typeof raw.latitude === "number" && typeof raw.longitude === "number") {
    out.gps = { latitude: raw.latitude, longitude: raw.longitude };
  }
  return Object.keys(out).length ? out : null;
}
