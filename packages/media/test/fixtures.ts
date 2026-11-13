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

/**
 * Erfundene Tagebuchseite: liniertes Papier mit „Schrift“ als graue Striche,
 * in Absätzen, damit sich Einträge als Rahmen darauf ziehen lassen.
 */
export function makeDiaryPage(path: string, seed: number) {
  const w = 620;
  const h = 877;
  const boxes: string[] = [];
  for (let y = 70; y < h - 40; y += 26) boxes.push(`drawbox=x=40:y=${y}:w=${w - 80}:h=1:color=0xc9d6e8:t=fill`);
  boxes.push(`drawbox=x=78:y=40:w=1:h=${h - 70}:color=0xe8b4b4:t=fill`);
  let r = seed * 9301 + 49297;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  let line = 0;
  for (let y = 70 + 26 * 1; y < h - 60; y += 26, line++) {
    if (line % 7 === 6) continue; // Absatz
    const words = 3 + Math.floor(rnd() * 6);
    let x = line % 7 === 0 ? 92 : 88;
    for (let k = 0; k < words && x < w - 70; k++) {
      const len = 18 + Math.floor(rnd() * 46);
      boxes.push(`drawbox=x=${x}:y=${y - 12}:w=${Math.min(len, w - 50 - x)}:h=3:color=0x3a3f58:t=fill`);
      x += len + 9;
    }
  }
  ff("-f", "lavfi", "-i", `color=c=0xf6f0e1:size=${w}x${h}:duration=1`, "-vf", boxes.join(","), "-frames:v", "1", path);
}

/**
 * Erfundener PDF-Scan: je Seite ein paar Zeilen Text auf hellem Papier.
 * Von Hand geschrieben, damit die Tests ohne PDF-Bibliothek auskommen.
 */
export function makePdf(path: string, pages: string[][]) {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length;
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = pages.map((lines) => {
    const ops = ["0.96 0.94 0.88 rg 0 0 420 595 re f", "0.23 0.25 0.35 rg", "BT /F1 14 Tf 40 540 Td 22 TL"];
    for (const l of lines) ops.push(`(${esc(l)}) Tj T*`);
    ops.push("ET");
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(path, out, "latin1");
}

/** Ein kleiner erfundener Feldtag wie im Testpaket, nur kürzer. */
export function makeFieldDay(dir: string) {
  mkdirSync(join(dir, "Kamera"), { recursive: true });
  mkdirSync(join(dir, "Handy"), { recursive: true });
  makeAudio(join(dir, "ZOOM0004.m4a"), { seconds: 6, creationTime: "2026-09-14T08:15:00.000000Z" });
  makeVideo(join(dir, "Kamera", "C0012.MP4"), { seconds: 2, creationTime: "2026-09-14T08:18:47.000000Z" });
  makeVideo(join(dir, "Kamera", "C0013.MP4"), { seconds: 2, creationTime: "2026-09-14T08:42:57.000000Z" });
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

/** Ausdruck für FFmpeg aevalsrc: Raumrauschen, Sprech-Abschnitte (Töne), Klatscher. */
function audioExpr(opts: { talk?: [number, number][]; claps?: number[] }): string {
  const noise = "0.003*(random(0)-0.5)";
  const talk = (opts.talk ?? []).map(([a, b]) => `between(t,${a},${b})*lt(mod(t,4),2)*0.3*sin(2*PI*220*t)`);
  const claps = (opts.claps ?? []).map((c) => `if(between(t,${c},${c + 0.2}),0.9*(random(1)-0.5)*exp(-(t-${c})*40),0)`);
  return [noise, ...talk, ...claps].join("+");
}

export function makeSyncAudio(
  path: string,
  opts: { seconds: number; creationTime?: string; talk?: [number, number][]; claps?: number[] },
) {
  ff(
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs='${audioExpr(opts)}':s=8000:d=${opts.seconds}`,
    "-c:a",
    "aac",
    ...(opts.creationTime ? ["-metadata", `creation_time=${opts.creationTime}`] : []),
    path,
  );
}

export function makeSyncVideo(
  path: string,
  opts: { seconds: number; creationTime?: string; talk?: [number, number][]; claps?: number[] },
) {
  ff(
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=160x90:rate=5:duration=${opts.seconds}`,
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs='${audioExpr(opts)}':s=8000:d=${opts.seconds}`,
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

/**
 * Feldtag zum Abgleichen: Diktiergerät 10 Min. ab 10:15:00 (Referenz), mit
 * Gesprächen am Anfang und Ende und langer Stille dazwischen. Die Kamera geht
 * 2:47 vor; in beiden Clips wird geklatscht.
 */
export function makeSyncDay(dir: string) {
  mkdirSync(dir, { recursive: true });
  makeSyncAudio(join(dir, "ZOOM0001.m4a"), {
    seconds: 600,
    creationTime: "2026-09-14T08:15:00.000000Z",
    talk: [
      [0, 60],
      [480, 540],
    ],
    claps: [80, 300, 502.5],
  });
  // Clip 1: echte Zeit 10:16:00 (= Rekorder 60 s), Kamera zeigt 10:18:47. Klatschen bei 20 s.
  makeSyncVideo(join(dir, "C0001.MP4"), { seconds: 30, creationTime: "2026-09-14T08:18:47.000000Z", claps: [20] });
  // Clip 2: echte Zeit 10:23:00 (= Rekorder 480 s), Kamera zeigt 10:25:47. Klatschen bei 22,5 s.
  makeSyncVideo(join(dir, "C0002.MP4"), { seconds: 30, creationTime: "2026-09-14T08:25:47.000000Z", claps: [22.5] });
}
