/**
 * Originaldateien für Vorschau und Wiedergabe ausliefern, mit Range-Anfragen,
 * damit sich Audio und Video spulen lassen. Nur lesend.
 */
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};

/** MIME-Typ, falls die Datei ausgeliefert werden darf; sonst null. */
export function mediaType(fileName: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return (ext && TYPES[ext]) ?? null;
}

/** "bytes=100-199", "bytes=100-", "bytes=-500" → [start, end] (inklusive) oder null, wenn ungültig. */
export function parseRange(header: string | null, size: number): [number, number] | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}

export function fileResponse(path: string, fileName: string, rangeHeader: string | null): Response {
  const type = mediaType(fileName);
  if (!type) return new Response("Dateityp wird nicht ausgeliefert", { status: 415 });
  const size = statSync(path).size;
  const range = parseRange(rangeHeader, size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const [start, end] = range ?? [0, size - 1];
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}
