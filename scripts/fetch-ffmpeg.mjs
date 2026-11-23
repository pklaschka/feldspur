/**
 * Holt die LGPL-Fassung von ffmpeg/ffprobe für das Installationspaket nach
 * apps/desktop/vendor/ffmpeg/<plattform>-<arch>/.
 *
 * Windows und Linux: fertige LGPL-Builds von BtbN (github.com/BtbN/FFmpeg-Builds),
 * Prüfsumme gegen deren checksums.sha256. macOS: dafür gibt es keine LGPL-Builds,
 * deshalb baut scripts/build-ffmpeg-macos.sh aus den Quellen (in CI auf macOS).
 *
 *   node scripts/fetch-ffmpeg.mjs            für die eigene Plattform
 *   FFMPEG_LINE=8.1 …                        Release-Linie (Standard 8.1)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFfmpeg } from "./check-ffmpeg.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const line = process.env.FFMPEG_LINE ?? "8.1";
const platform = process.env.npm_config_platform ?? process.platform;
const arch = process.env.npm_config_arch ?? process.arch;
const out = join(root, "apps", "desktop", "vendor", "ffmpeg", `${platform}-${arch}`);

/** Bricht ab, wenn dem Build etwas fehlt, das die App braucht (siehe check-ffmpeg.mjs). */
function verify() {
  const problems = checkFfmpeg(join(out, platform === "win32" ? "ffmpeg.exe" : "ffmpeg"));
  if (problems.length) throw new Error(`ffmpeg in ${out} reicht nicht:\n- ${problems.join("\n- ")}`);
}

/**
 * SHA-256 der Quellarchive von ffmpeg.org, aus denen der macOS-Build entsteht. Ein Release-Archiv ändert sich nie;
 * passt die Prüfsumme nicht, stimmt etwas mit dem Download nicht. Neue Linie: Prüfsumme hier eintragen (steht in der
 * BUILD.txt eines Builds und auf ffmpeg.org neben dem Archiv).
 */
const MACOS_SOURCE_SHA256 = {
  8.1: "b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a",
};

if (platform === "darwin") {
  const expected = MACOS_SOURCE_SHA256[line];
  if (!expected) throw new Error(`Für ffmpeg ${line} ist keine Prüfsumme des Quellarchivs hinterlegt`);
  execFileSync("bash", [join(root, "scripts", "build-ffmpeg-macos.sh"), line, out], { stdio: "inherit" });
  const actual = /^SHA-256: ([0-9a-f]{64})$/m.exec(readFileSync(join(out, "BUILD.txt"), "utf8"))?.[1];
  if (actual !== expected) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`Quellarchiv von ffmpeg ${line}: Prüfsumme ${actual ?? "fehlt"} statt ${expected}`);
  }
  verify();
  process.exit(0);
}

const targets = {
  "linux-x64": "linux64",
  "linux-arm64": "linuxarm64",
  "win32-x64": "win64",
  "win32-arm64": "winarm64",
};
const target = targets[`${platform}-${arch}`];
if (!target) throw new Error(`Keine LGPL-Builds für ${platform}-${arch}`);
const ext = platform === "win32" ? "zip" : "tar.xz";
const asset = `ffmpeg-n${line}-latest-${target}-lgpl-${line}.${ext}`;
const base = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const sums = (await get(`${base}/checksums.sha256`)).toString("utf8");
const expected = sums
  .split("\n")
  .map((l) => l.trim().split(/\s+/))
  .find(([, name]) => name === asset)?.[0];
if (!expected) throw new Error(`${asset} steht nicht in checksums.sha256`);

console.log(`Lade ${asset} …`);
const data = await get(`${base}/${asset}`);
const actual = createHash("sha256").update(data).digest("hex");
if (actual !== expected) throw new Error(`Prüfsumme passt nicht: ${actual} statt ${expected}`);

const work = mkdtempSync(join(tmpdir(), "feldspur-ffmpeg-"));
try {
  const archive = join(work, asset);
  writeFileSync(archive, data);
  // Auf Windows das mitgelieferte bsdtar nehmen: Es entpackt auch zip. Das GNU-tar aus Git Bash
  // kann kein zip und hält „C:“ für einen entfernten Rechner.
  const tar = platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", archive, "-C", work], { stdio: "inherit" });
  const dir = readdirSync(work)
    .map((n) => join(work, n))
    .find((p) => statSync(p).isDirectory());
  if (!dir) throw new Error("Archiv ohne Ordner");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const exe = platform === "win32" ? ".exe" : "";
  for (const tool of ["ffmpeg", "ffprobe"]) cpSync(join(dir, "bin", `${tool}${exe}`), join(out, `${tool}${exe}`));
  const license = ["LICENSE.txt", "LICENSE"].map((n) => join(dir, n)).find((p) => existsSync(p));
  if (license) cpSync(license, join(out, "LICENSE.txt"));
  const version = execFileSync(join(out, `ffmpeg${exe}`), ["-hide_banner", "-version"]).toString("utf8");
  if (/--enable-gpl|--enable-nonfree/.test(version)) throw new Error("Dieser Build ist nicht LGPL");
  writeFileSync(join(out, "BUILD.txt"), `Quelle: ${base}/${asset}\nSHA-256: ${actual}\n\n${version}`);
  console.log(`ffmpeg/ffprobe (LGPL) → ${out}`);
  console.log(version.split("\n")[0]);
  verify();
} finally {
  rmSync(work, { recursive: true, force: true });
}
