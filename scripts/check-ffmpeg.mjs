/**
 * Prüft, ob ein ffmpeg alles kann, was Feldspur beim Einsammeln und Ausgeben braucht.
 * Läuft nach dem Holen oder Bauen (scripts/fetch-ffmpeg.mjs) und im Paket-Workflow, auch
 * wenn ffmpeg aus dem Cache kommt. So fällt ein Build ohne PNG-Decoder (z. B. weil zlib
 * fehlt) schon beim Paketieren auf und nicht erst bei der ersten Ausgabe.
 *
 *   node scripts/check-ffmpeg.mjs <pfad/zu/ffmpeg>
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Was die App aufruft (packages/media/src: montage-video, stills, audio, waveform, …). */
export const REQUIRED = {
  // png: Einblendungen im Montagevideo; jpeg/png/tiff/webp/bmp/gif: Fotos und Tagebuchseiten.
  decoders: ["png", "mjpeg", "tiff", "webp", "bmp", "gif", "h264", "aac", "mp3", "pcm_s16le"],
  // mjpeg: Standbilder fürs Einsatztranskript; mpeg4: Rückfall, wenn kein H.264-Encoder da ist.
  encoders: ["mjpeg", "aac", "pcm_s16le", "mpeg4"],
  demuxers: ["image2", "concat", "lavfi", "mov", "wav", "mp3"],
  muxers: ["mp4", "f32le", "wav", "image2"],
  filters: [
    "overlay",
    "scale",
    "fps",
    "crop",
    "setsar",
    "null",
    "format",
    "color",
    "trim",
    "amix",
    "aresample",
    "atrim",
    "aformat",
    "volume",
    "anullsrc",
  ],
};

/** Namen aus der Ausgabe von `ffmpeg -decoders`, `-encoders`, `-filters`, `-demuxers` oder `-muxers`. */
export function parseList(text) {
  const names = new Set();
  for (const line of text.split("\n")) {
    const m = /^\s*[A-Z.|d]{1,6}\s+([\w,]+)\s/.exec(line);
    if (m) for (const n of m[1].split(",")) names.add(n);
  }
  return names;
}

/** Fehlende Bausteine je Liste; leer, wenn alles da ist. */
export function missing(lists, required = REQUIRED) {
  const out = {};
  for (const [kind, need] of Object.entries(required)) {
    const have = lists[kind] ?? new Set();
    const gone = need.filter((n) => !have.has(n));
    if (gone.length) out[kind] = gone;
  }
  return out;
}

/** 2×2 Pixel, halbtransparent, wie die Einblendungen aus dem Renderer (RGBA, deflate). */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4//9/AwgzwBgAgKAN9bWuqBwAAAAASUVORK5CYII=";

/**
 * Prüft ffmpeg in zwei Stufen: erst die Listen, dann ein echter Lauf wie bei der Ausgabe
 * (PNG-Folge als Einblendung über eine Farbfläche, PNG als JPEG-Standbild).
 */
export function checkFfmpeg(ffmpeg) {
  const list = (flag) => parseList(execFileSync(ffmpeg, ["-hide_banner", flag], { encoding: "utf8" }));
  const lists = {
    decoders: list("-decoders"),
    encoders: list("-encoders"),
    demuxers: list("-demuxers"),
    muxers: list("-muxers"),
    filters: list("-filters"),
  };
  const gone = missing(lists);
  const problems = Object.entries(gone).map(([kind, names]) => `${kind}: ${names.join(", ")}`);
  if (problems.length) return problems;

  const dir = mkdtempSync(join(tmpdir(), "feldspur-ffcheck-"));
  try {
    const png = Buffer.from(PNG_BASE64, "base64");
    writeFileSync(join(dir, "o00000.png"), png);
    writeFileSync(join(dir, "o00001.png"), png);
    const run = (args) => {
      try {
        execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
      } catch (e) {
        problems.push(`ffmpeg ${args.join(" ")}\n${String(e.stderr ?? e.message).trim()}`);
      }
    };
    run([
      "-f",
      "lavfi",
      "-i",
      "color=c=0x10171b:s=64x36:r=1:d=2",
      "-framerate",
      "1",
      "-i",
      join(dir, "o%05d.png"),
      "-filter_complex",
      "[1:v]null[o1];[0:v][o1]overlay=0:0:eof_action=repeat[out]",
      "-map",
      "[out]",
      "-c:v",
      "mpeg4",
      join(dir, "einblendung.mp4"),
    ]);
    run(["-i", join(dir, "o00000.png"), "-vf", "scale='min(1000,iw)':-2", "-frames:v", "1", join(dir, "still.jpg")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ffmpeg = process.argv[2] ?? "ffmpeg";
  const problems = checkFfmpeg(ffmpeg);
  if (problems.length) {
    console.error(`${ffmpeg} kann nicht alles, was Feldspur braucht:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`${ffmpeg}: alle Bausteine für Einsammeln und Ausgeben vorhanden`);
}
