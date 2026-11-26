/**
 * Messung des Ausgebens (Issue #249): ein fester, erfundener Vergleichseinsatz, der wie ein echter Feldeinsatz aussieht
 * (Tonaufnahme über die ganze Zeit, zwei Handyvideos in Full HD, die sich eine Weile überlappen, danach nur Ton), und
 * die Dauer je Schritt der Ausgabe. Gerechnet wird mit dem ffmpeg im Pfad, also für echte Werte mit dem mitgelieferten
 * (`node scripts/fetch-ffmpeg.mjs`, dann `apps/desktop/vendor/ffmpeg/<plattform>` vorn in den Pfad).
 *
 *   vpx scripts/messung-ausgeben.ts                 20 Minuten Montage
 *   MESSUNG_MINUTEN=60 vpx scripts/messung-ausgeben.ts
 *   MESSUNG_ORDNER=/tmp/messung …                   Material dort anlegen und behalten (zweiter Lauf geht schneller)
 *
 * Gemessen werden drei Läufe: ohne Zwischenspeicher (erste Ausgabe), unverändert noch einmal (alles aus dem
 * Zwischenspeicher) und nach einer kleinen Verschiebung einer Quelle (neue Montage-ID). Die Einblendungen zeichnet hier
 * ein einfacher PNG-Zeichner statt der Oberfläche; jede Sekunde ergibt ein anderes Bild, wie in der App.
 * Ergebnis: eine Tabelle auf stdout, Rohdaten als JSON in `messung.json` im Arbeitsordner.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, platform, arch, tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { ProjectStore } from "@feldspur/core";
import {
  applyImport,
  buildSessionTranscript,
  exportSession,
  H,
  scanPaths,
  setLogEnabled,
  setLogSink,
  videoEncoder,
  W,
  type OverlayFrame,
  type OverlayRenderer,
} from "@feldspur/media";

const minutes = Number(process.env.MESSUNG_MINUTEN ?? 20);
const keep = process.env.MESSUNG_ORDNER;
const root = keep ?? mkdtempSync(join(tmpdir(), "feldspur-messung-"));
mkdirSync(root, { recursive: true });
const raw = join(root, "roh");

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

/** H.264-Encoder für das erfundene Material: wie ein Handy, etwa 12 Mbit/s. */
function sourceEncoder(): string[] {
  const list = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const has = (n: string) => new RegExp(`^\\s*V\\S*\\s+${n}\\s`, "m").test(list);
  if (has("libx264")) return ["-c:v", "libx264", "-preset", "veryfast", "-b:v", "12M"];
  if (has("h264_videotoolbox")) return ["-c:v", "h264_videotoolbox", "-b:v", "12M"];
  if (has("libopenh264")) return ["-c:v", "libopenh264", "-b:v", "12M"];
  return ["-c:v", "h264_mf", "-b:v", "12M"];
}

/**
 * Vergleichseinsatz, Anteile der Länge L: Ton von 0 bis L; Video A von 0,1 L bis 0,4 L, Video B von 0,25 L bis 0,5 L
 * (gleichzeitig von 0,25 L bis 0,4 L); in der zweiten Hälfte nur Ton. Das entspricht grob einem Feldtag, an dem die
 * Kamera nur zeitweise läuft.
 */
function makeMaterial() {
  const done = join(raw, ".fertig");
  if (existsSync(done)) return;
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(join(raw, "Zoom"), { recursive: true });
  mkdirSync(join(raw, "HandyA"), { recursive: true });
  mkdirSync(join(raw, "HandyB"), { recursive: true });
  const L = minutes * 60;
  const t0 = Date.UTC(2026, 8, 14, 8, 0, 0);
  const iso = (s: number) => new Date(t0 + s * 1000).toISOString().replace("Z", "000Z");
  const started = performance.now();
  // Ton: Raumrauschen und ein Ton alle paar Sekunden, Stereo 48 kHz wie ein Feldrekorder.
  ff(
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs='0.01*(random(0)-0.5)+lt(mod(t,7),3)*0.2*sin(2*PI*220*t)|0.01*(random(1)-0.5)+lt(mod(t,5),2)*0.2*sin(2*PI*330*t)':s=48000:d=${L}`,
    "-c:a",
    "pcm_s16le",
    // Feldrekorder schreiben die Ortszeit in den BWF-Kopf; 10:00 Uhr Sommerzeit ist 08:00 UTC.
    "-metadata",
    "origination_date=2026-09-14",
    "-metadata",
    "origination_time=10:00:00",
    "-write_bext",
    "1",
    join(raw, "Zoom", "ZOOM0001.WAV"),
  );
  const video = (file: string, from: number, to: number, hue: number) =>
    ff(
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1920x1080:rate=30:duration=${to - from},hue=h=${hue},noise=alls=12:allf=t`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${440 + hue}:sample_rate=48000:duration=${to - from}`,
      ...sourceEncoder(),
      "-g",
      "30",
      "-c:a",
      "aac",
      "-shortest",
      "-metadata",
      `creation_time=${iso(from)}`,
      file,
    );
  video(join(raw, "HandyA", "VID_A001.mp4"), 0.1 * L, 0.4 * L, 0);
  video(join(raw, "HandyB", "VID_B001.mp4"), 0.25 * L, 0.5 * L, 120);
  writeFileSync(done, "");
  console.error(`Material erzeugt in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

/** Kleiner PNG-Schreiber (RGBA, ohne Filter): reicht für die Einblendungen der Messung. */
function png(rgba: Buffer): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
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
  const rows = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) rgba.copy(rows, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Einblendung wie in der App in Grundzügen: Kopf- und Fußleiste, „Schrift“ als Muster, das jede Sekunde wechselt. */
function drawFrame(f: OverlayFrame): Buffer {
  const b = Buffer.alloc(W * H * 4);
  const rect = (x0: number, y0: number, w: number, h: number, c: [number, number, number, number]) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++)
      for (let x = x0; x < Math.min(W, x0 + w); x++) b.set(c, (y * W + x) * 4);
  };
  rect(0, 0, W, 52, [28, 20, 14, 240]);
  rect(0, 684, W, 36, [28, 20, 14, 240]);
  // „Ziffern“: je Stelle der Uhrzeit ein Muster aus Blöcken.
  const digits = String(Math.floor(f.clockMs / 1000)).padStart(6, "0");
  for (const [i, d] of [...digits].entries())
    for (let k = 0; k < 7; k++)
      if ((Number(d) + k * 3) % 5 < 3)
        rect(16 + i * 20 + (k % 2) * 8, 10 + Math.floor(k / 2) * 9, 7, 7, [245, 236, 223, 255]);
  for (let k = 0; k < 40; k++) rect(300 + k * 22, 20, 16, 12, [201, 183, 162, 255]);
  for (const [t, _m] of f.tiles.entries()) rect(10 + t * 640, 640, 420, 26, [28, 20, 14, 240]);
  for (let k = 0; k < 30; k++) rect(52 + k * 30, 696, 22, 10, [245, 236, 223, 255]);
  return b;
}

const overlay: OverlayRenderer = async (_head, frames) => {
  const out: Buffer[] = [];
  for (const f of frames) {
    out.push(png(drawFrame(f)));
    await new Promise((r) => setImmediate(r));
  }
  return out;
};

interface Run {
  name: string;
  totalS: number;
  steps: Record<string, number>;
  sectionsS: number;
  joinS: number;
  computed: number;
  cached: number;
  bytes: number;
  /** Sekunden ab Beginn des Montagevideos, bis alle Bildabschnitte bzw. alle Tonspuren stehen (soweit protokolliert). */
  pictureS: number | null;
  soundS: number | null;
  /** Länge der Bildspur im fertigen Video und Zahl ihrer Bilder, laut ffprobe. */
  videoS: number;
  frames: number;
}

async function run(name: string, store: ProjectStore, sessionId: string, cacheDir: string): Promise<Run> {
  const out = join(root, "ausgabe");
  rmSync(out, { recursive: true, force: true });
  const firstAt = new Map<string, number>();
  const lastAt = new Map<string, number>();
  let computed = 0;
  let cached = 0;
  let joinAt = 0;
  let pictureAt = 0;
  let soundAt = 0;
  setLogEnabled(true);
  const prev = setLogSink((line) => {
    if (/Abschnitt .* wird gerechnet/.test(line)) computed++;
    if (/Abschnitt .* aus dem Zwischenspeicher/.test(line)) cached++;
    if (/setzt \d+ Abschnitte/.test(line)) joinAt = performance.now();
    if (/Abschnitte fertig nach/.test(line)) pictureAt = performance.now();
    if (/Ton fertig nach/.test(line)) soundAt = performance.now();
    if (process.env.MESSUNG_PROTOKOLL) process.stderr.write(`${line}\n`);
  });
  const started = performance.now();
  const r = await exportSession(store, sessionId, out, {
    overlay,
    cacheDir,
    deviceTracks: true,
    viewer: true,
    manifest: true,
    readme: true,
    onProgress: (step) => {
      const now = performance.now();
      if (!firstAt.has(step)) firstAt.set(step, now);
      lastAt.set(step, now);
    },
  });
  const ended = performance.now();
  setLogSink(prev);
  // Schritt bis zum Beginn des nächsten (die Oberfläche zeigt denselben Ablauf).
  const order = [...firstAt.entries()].sort((a, b) => a[1] - b[1]);
  const steps: Record<string, number> = {};
  for (const [k, [step, at]] of order.entries()) {
    const next = order[k + 1]?.[1] ?? ended;
    steps[step] = (next - at) / 1000;
  }
  const montageStart = firstAt.get("Montagevideo") ?? started;
  const mp4 = r.files.find((f) => f.endsWith(".mp4"))!;
  return {
    name,
    totalS: (ended - started) / 1000,
    steps,
    sectionsS: ((joinAt || ended) - montageStart) / 1000,
    joinS: joinAt ? ((firstAt.get("Einsatztranskript") ?? ended) - joinAt) / 1000 : 0,
    computed,
    cached,
    bytes: statSync(join(out, mp4)).size,
    pictureS: pictureAt ? (pictureAt - montageStart) / 1000 : null,
    soundS: soundAt ? (soundAt - montageStart) / 1000 : null,
    ...videoStream(join(out, mp4)),
  };
}

/** Länge und Bildzahl der Bildspur: Der Ton passt nur, wenn die Bildspur genau so lang ist wie die Montage. */
function videoStream(file: string): { videoS: number; frames: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration,nb_frames", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  const [duration, frames] = out.trim().split(",");
  return { videoS: Number(duration), frames: Number(frames) };
}

async function main() {
  makeMaterial();
  const store = ProjectStore.open(":memory:");
  const sessionId = store.addSession({ title: "Messung", date: "2026-09-14" }).id;
  applyImport(store, sessionId, await scanPaths([raw]));
  const plan = buildSessionTranscript(store, sessionId);
  console.error(
    `Montage ${(plan.plan.durationMs / 60000).toFixed(1)} min, Quellen auf der Zeitachse: ${plan.resolved.placements.size}`,
  );
  const cacheDir = join(root, "zwischenspeicher");
  rmSync(cacheDir, { recursive: true, force: true });
  const enc = await videoEncoder();
  const runs: Run[] = [];
  runs.push(await run("erste Ausgabe", store, sessionId, cacheDir));
  runs.push(await run("unverändert", store, sessionId, cacheDir));
  // Video B um 40 ms verschieben (wie nach einer neuen Ankerberechnung): Die Montage-ID ändert sich, sonst nichts.
  const b = store.listSources(sessionId).find((s) => s.fileName === "VID_B001.mp4")!;
  const was = buildSessionTranscript(store, sessionId).resolved.placements.get(b.id)!;
  store.addEvidence({
    sourceId: b.id,
    kind: "manual",
    clock: "true",
    atMediaMs: 0,
    localMs: was.startMs + 40,
    uncertaintyMs: 0,
    detail: "Messung: 40 ms später",
  });
  runs.push(await run("40 ms verschoben", store, sessionId, cacheDir));

  const info = {
    platform: `${platform()}-${arch()}`,
    cpu: cpus()[0]?.model ?? "?",
    cores: availableParallelism(),
    encoder: enc.join(" "),
    ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0],
    minutes,
    runs,
  };
  writeFileSync(join(root, "messung.json"), JSON.stringify(info, null, 2));
  const s = (x: number) => `${x.toFixed(1).replace(".", ",")} s`;
  console.log(`\n## Messung Ausgeben, ${info.platform}, ${info.cores} Kerne (${info.cpu})`);
  console.log(`Encoder: \`${info.encoder}\`, ${info.ffmpeg}, Montage ${minutes} min\n`);
  const opt = (x: number | null) => (x === null ? "–" : s(x));
  console.log(
    "| Lauf | gesamt | Bild und Ton | davon Bild | davon Ton | Zusammenfügen | gerechnet/übernommen | Lautstärke | Prüfsummen | Größe | Bildspur |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of runs)
    console.log(
      `| ${r.name} | ${s(r.totalS)} | ${s(r.sectionsS)} | ${opt(r.pictureS)} | ${opt(r.soundS)} | ${s(r.joinS)} | ${r.computed}/${r.cached} | ${s(r.steps["Lautstärke messen"] ?? 0)} | ${s(r.steps["Prüfsummen"] ?? 0)} | ${(r.bytes / 1e6).toFixed(1)} MB | ${r.videoS.toFixed(2).replace(".", ",")} s, ${r.frames} Bilder |`,
    );
  store.close();
  if (!keep) rmSync(root, { recursive: true, force: true });
}

await main();
