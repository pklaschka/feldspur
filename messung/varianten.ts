/**
 * Einzelmessungen für Issue #249 (nur auf dem Messzweig): Wo geht die Zeit eines Abschnitts hin, je Plattform?
 * Aufruf: vpx messung/varianten.ts <Ordner mit roh/ aus messung-ausgeben.ts>
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { videoEncoder } from "@feldspur/media";

const root = process.argv[2]!;
const A = join(root, "roh", "HandyA", "VID_A001.mp4");
const work = join(root, "varianten");
mkdirSync(join(work, "o"), { recursive: true });

// Durchsichtige PNGs mit zwei Leisten, je Sekunde etwas anders.
function png(i: number): Buffer {
  const W = 1280;
  const H = 720;
  const rows = Buffer.alloc((W * 4 + 1) * H);
  const px = (x: number, y: number, c: number[]) => rows.set(c, y * (W * 4 + 1) + 1 + x * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (y < 52 || y >= 684)
        px(x, y, x > 16 + i * 14 && x < 136 + i * 14 && y > 12 && y < 40 ? [245, 236, 223, 255] : [28, 20, 14, 240]);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (let i = 0; i < 61; i++) writeFileSync(join(work, "o", `o${String(i).padStart(5, "0")}.png`), png(i));
const O = join(work, "o", "o%05d.png");

function run(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) console.log(`    (gescheitert: ${err.trim().split("\n").slice(-2).join(" / ").slice(0, 300)})`);
      resolve(code === 0 ? (performance.now() - t0) / 1000 : NaN);
    });
  });
}
async function t(name: string, args: string[], times = 1) {
  const t0 = performance.now();
  const each = await Promise.all(
    Array.from({ length: times }, (_, k) => run(args.map((a) => a.replace("%K", String(k))))),
  );
  const wall = (performance.now() - t0) / 1000;
  console.log(`| ${name} | ${times} | ${wall.toFixed(1)} s | ${each.map((x) => x.toFixed(1)).join(" ")} |`);
}

const enc = await videoEncoder();
console.log(`Encoder: ${enc.join(" ")}`);
console.log(execFileSync("ffmpeg", ["-hide_banner", "-hwaccels"], { encoding: "utf8" }).replace(/\n/g, " "));
console.log("| Variante | gleichzeitig | Dauer | einzeln |\n|---|---|---|---|");
const SC = "fps=25,scale=1280:632:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
const out = (n: string) => join(work, `${n}-%K.mp4`);
const NULL = ["-f", "null", "-"];
const src = (hw: boolean) => [...(hw ? ["-hwaccel", "auto"] : []), "-ss", "0", "-t", "54", "-i", A];
const color = (r: number, d: number) => ["-f", "lavfi", "-i", `color=c=0x10171b:s=1280x720:r=${r}:d=${d}`];
const E = [...enc, "-g", "50", "-an"];
const section = (overlayFirst: boolean) =>
  `[1:v]${SC}[v1];[0:v][v1]overlay=x=0+(1280-overlay_w)/2:y=52+(632-overlay_h)/2:eof_action=pass[b1];[2:v]${overlayFirst ? "format=yuva420p," : ""}fps=25[o2];[b1][o2]overlay=0:0:eof_action=repeat[b2];[b2]format=yuv420p,trim=duration=54.000[out]`;
const sectionArgs = (hw: boolean, first: boolean) => [
  ...color(25, 55),
  ...src(hw),
  "-framerate",
  "1",
  "-i",
  O,
  "-filter_complex",
  section(first),
  "-map",
  "[out]",
  "-frames:v",
  "1350",
  "-r",
  "25",
];
const stillFC = (fps: boolean) =>
  `[1:v]null[o1];[0:v][o1]overlay=0:0:eof_action=repeat[b1];[b1]format=yuv420p${fps ? ",fps=25" : ""},trim=duration=60.000${fps ? "" : ",setpts=N/25/TB"}[out]`;
const stillArgs = (fps: boolean) => [
  ...color(1, 61),
  "-framerate",
  "1",
  "-i",
  O,
  "-filter_complex",
  stillFC(fps),
  "-map",
  "[out]",
  "-frames:v",
  fps ? "1500" : "60",
  "-r",
  "25",
];

await t("nur dekodieren, Software", [...src(false), "-an", ...NULL]);
await t("nur dekodieren, -hwaccel auto", [...src(true), "-an", ...NULL]);
await t("dekodieren + skalieren (hw)", [...src(true), "-vf", SC, "-an", ...NULL]);
await t("Abschnitt mit Video, alt, ohne Encoder", [...sectionArgs(true, false), ...NULL]);
await t("Abschnitt mit Video, neu, ohne Encoder", [...sectionArgs(true, true), ...NULL]);
await t("Abschnitt mit Video, alt", [...sectionArgs(true, false), ...E, out("alt")]);
await t("Abschnitt mit Video, neu", [...sectionArgs(true, true), ...E, out("neu")]);
for (const n of [2, 3, 4, 6]) await t("Abschnitt mit Video, neu", [...sectionArgs(true, true), ...E, out("neu")], n);
await t("Abschnitt ohne Video, alt (1500 Bilder)", [...stillArgs(true), ...E, out("still-alt")]);
await t("Abschnitt ohne Video, neu (60 Bilder)", [...stillArgs(false), ...enc, "-g", "2", "-an", out("still-neu")]);
for (const n of [4, 8]) {
  await t("Abschnitt ohne Video, alt (1500 Bilder)", [...stillArgs(true), ...E, out("still-alt")], n);
  await t(
    "Abschnitt ohne Video, neu (60 Bilder)",
    [...stillArgs(false), ...enc, "-g", "2", "-an", out("still-neu")],
    n,
  );
}
await t("nur kodieren (720p aus Abschnitt)", ["-i", join(work, "neu-0.mp4"), ...E, out("enc")]);
await t("nur kodieren (720p aus Abschnitt)", ["-i", join(work, "neu-0.mp4"), ...E, out("enc")], 4);
if (process.platform === "darwin") {
  await t("VT: skalieren auf der Grafikkarte (scale_vt)", [
    "-hwaccel",
    "videotoolbox",
    "-hwaccel_output_format",
    "videotoolbox_vld",
    "-ss",
    "0",
    "-t",
    "54",
    "-i",
    A,
    "-vf",
    "scale_vt=w=1124:h=632,hwdownload,format=nv12,fps=25",
    "-an",
    ...NULL,
  ]);
  await t("VT: kodieren mit -prio_speed 1", [
    "-i",
    join(work, "neu-0.mp4"),
    ...E,
    "-prio_speed",
    "1",
    out("enc-speed"),
  ]);
}
// Ton: AAC einer Spur, einzeln und vierfach.
const wav = join(work, "ton.wav");
await run(["-t", "600", "-i", join(root, "roh", "Zoom", "ZOOM0001.WAV"), "-c:a", "pcm_s16le", wav]);
await t("AAC 160k, 10 min Ton", ["-i", wav, "-c:a", "aac", "-b:a", "160k", join(work, "ton-%K.m4a")]);
await t("AAC 160k, 10 min Ton", ["-i", wav, "-c:a", "aac", "-b:a", "160k", join(work, "ton-%K.m4a")], 4);
