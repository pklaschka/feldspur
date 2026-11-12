/**
 * Test-Fixtures, die zur Laufzeit mit FFmpeg erzeugt werden. Es liegen keine
 * Mediendateien im Repository, und es kommen nie echte Forschungsdaten vor.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

export function makeVideo(path: string, opts: { seconds: number; creationTime?: string }) {
  ff(
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=160x90:rate=10:duration=${opts.seconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${opts.seconds}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    ...(opts.creationTime ? ["-metadata", `creation_time=${opts.creationTime}`] : []),
    path,
  );
}

export function makeAudio(
  path: string,
  opts: { seconds: number; creationTime?: string; bwf?: { date: string; time: string } },
) {
  ff(
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${opts.seconds}`,
    ...(opts.creationTime ? ["-metadata", `creation_time=${opts.creationTime}`] : []),
    ...(opts.bwf
      ? [
          "-metadata",
          `origination_date=${opts.bwf.date}`,
          "-metadata",
          `origination_time=${opts.bwf.time}`,
          "-write_bext",
          "1",
        ]
      : []),
    path,
  );
}

/** Minimales EXIF (Make, Model, DateTimeOriginal) als APP1-Segment. */
function exifSegment(make: string, model: string, dateTimeOriginal: string): Buffer {
  const ascii = (s: string) => Buffer.from(`${s}\0`, "ascii");
  const makeB = ascii(make);
  const modelB = ascii(model);
  const dtoB = ascii(dateTimeOriginal);
  // TIFF-Layout (little endian): Header 8 | IFD0 (3 Einträge) | ExifIFD (1 Eintrag) | Daten
  const ifd0Size = 2 + 3 * 12 + 4;
  const exifIfdSize = 2 + 1 * 12 + 4;
  const ifd0 = 8;
  const exifIfd = ifd0 + ifd0Size;
  let data = exifIfd + exifIfdSize;
  const tiff = Buffer.alloc(data + makeB.length + modelB.length + dtoB.length);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };
  tiff.writeUInt16LE(3, ifd0);
  const makeAt = data;
  makeB.copy(tiff, data);
  data += makeB.length;
  const modelAt = data;
  modelB.copy(tiff, data);
  data += modelB.length;
  const dtoAt = data;
  dtoB.copy(tiff, data);
  entry(ifd0 + 2, 0x010f, 2, makeB.length, makeAt);
  entry(ifd0 + 14, 0x0110, 2, modelB.length, modelAt);
  entry(ifd0 + 26, 0x8769, 4, 1, exifIfd);
  tiff.writeUInt32LE(0, ifd0 + 38);
  tiff.writeUInt16LE(1, exifIfd);
  entry(exifIfd + 2, 0x9003, 2, dtoB.length, dtoAt);
  tiff.writeUInt32LE(0, exifIfd + 14);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export function makePhoto(
  path: string,
  color: string,
  exif?: { make: string; model: string; dateTimeOriginal: string },
) {
  ff("-f", "lavfi", "-i", `color=c=${color}:size=64x48:duration=1`, "-frames:v", "1", path);
  if (exif) {
    const jpg = readFileSync(path);
    writeFileSync(
      path,
      Buffer.concat([jpg.subarray(0, 2), exifSegment(exif.make, exif.model, exif.dateTimeOriginal), jpg.subarray(2)]),
    );
  }
}

/** Ein kleiner erfundener Feldtag wie im Testpaket, nur kürzer. */
export function makeFieldDay(dir: string) {
  mkdirSync(join(dir, "Kamera"), { recursive: true });
  mkdirSync(join(dir, "Handy"), { recursive: true });
  makeAudio(join(dir, "ZOOM0004.m4a"), { seconds: 6, creationTime: "2026-09-14T10:15:00.000000Z" });
  makeVideo(join(dir, "Kamera", "C0012.MP4"), { seconds: 2, creationTime: "2026-09-14T10:18:47.000000Z" });
  makeVideo(join(dir, "Kamera", "C0013.MP4"), { seconds: 2, creationTime: "2026-09-14T10:42:57.000000Z" });
  makePhoto(join(dir, "Handy", "IMG_0231.jpg"), "0x8a4fbf", {
    make: "Beispiel",
    model: "Handy Testperson A",
    dateTimeOriginal: "2026:09:14 10:12:34",
  });
  makePhoto(join(dir, "Handy", "IMG_20260914_104050.jpg"), "0x1f8a70");
  makePhoto(join(dir, "Tagebuch_S01.jpg"), "0xc2703d");
  writeFileSync(join(dir, ".DS_Store"), "x");
  writeFileSync(join(dir, "Kamera", "C0012M01.XML"), "<x/>");
}
