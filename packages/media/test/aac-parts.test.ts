/**
 * Tonspur in Teilen gleichzeitig kodieren (`encodeAacParts` in `packages/media/src/aac-parts.ts`, Issue #249): Das
 * Ergebnis muss sich einfügen wie eine am Stück kodierte Spur (gleiche Länge, gleiche Zeiten) und darf an den
 * Nahtstellen nicht knacken.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { encodeAacParts, limiter } from "../src/aac-parts.ts";
import { ff, hasFfmpeg } from "./fixtures.ts";

const RATE = 48_000;
/** Teile von 300 Blöcken (6,4 s) statt zwei Minuten, damit der Test mit wenig Ton mehrere Nähte hat. */
const PART_BLOCKS = 300;

/**
 * Zeiten und Größen aller AAC-Blöcke einer Datei, je Zeile "Beginn,Dauer,Größe". Beim letzten Block fehlt die Dauer:
 * Je nach ffmpeg-Fassung endet er am Stück kodiert mit dem Ton oder erst mit dem vollen Block; die Länge der Spur
 * prüft `duration`.
 */
function packets(file: string): string[] {
  const lines = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "packet=pts,duration,size",
    "-of",
    "csv=p=0",
    file,
  ])
    .toString()
    .trim()
    .split(/\r?\n/);
  const last = lines.pop()!.split(",");
  return [...lines, `${last[0]},,${last[2]}`];
}

/** Dauer der Tonspur in Sekunden, wie Player sie lesen. */
function duration(file: string): number {
  return Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=duration", "-of", "csv=p=0", file]).toString(),
  );
}

/** Dekodierter Ton als Abtastwerte (16 Bit, Stereo, Kanäle abwechselnd). */
function decode(file: string): Int16Array {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
  return new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
}

/** Mittlere Abweichung zweier Tonfolgen im AAC-Block `block` (1024 Abtastwerte, Stereo). */
function deviation(a: Int16Array, b: Int16Array, block: number): number {
  let sum = 0;
  for (let i = block * 2048; i < (block + 1) * 2048; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / 2048);
}

describe.skipIf(!hasFfmpeg())("Tonspur in Teilen kodieren", () => {
  let dir: string;
  /** Roher Ton der ganzen Spur und derselbe Ton in zwei ungleich langen Stücken, wie die Montage sie liefert. */
  let all: string;
  let pieces: string[];
  let direct: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-aac-"));
    all = join(dir, "alles.pcm");
    // Angenommen: 20,3 s Ton aus Rauschen mit schwankender Lautstärke und einem Dauerton, am Stück kodiert als Vergleich.
    ff(
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=r=48000:c=pink:a=0.4:d=20.3:seed=7,tremolo=f=3:d=0.9[n];sine=f=330:r=48000:d=20.3,volume=0.2[s];[n][s]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo",
      "-f",
      "s16le",
      all,
    );
    const raw = readFileSync(all);
    const cut = 4 * 313_337;
    pieces = [join(dir, "stueck0.pcm"), join(dir, "stueck1.pcm")];
    writeFileSync(pieces[0]!, raw.subarray(0, cut));
    writeFileSync(pieces[1]!, raw.subarray(cut));
    direct = join(dir, "direkt.m4a");
    ff("-f", "s16le", "-ar", String(RATE), "-ac", "2", "-i", all, "-c:a", "aac", "-b:a", "160k", direct);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const encode = (out: string, partBlocks?: number) =>
    encodeAacParts({
      pcmFiles: pieces,
      rate: RATE,
      bitrate: "160k",
      out,
      dir,
      tag: "spur",
      slot: limiter(3),
      ...(partBlocks ? { partBlocks } : {}),
    });

  it("eine kurze Spur aus einem Teil ist dieselbe wie am Stück kodiert", async () => {
    const out = join(dir, "ein-teil.m4a");
    await encode(out);
    expect(packets(out)).toEqual(packets(direct));
    expect(duration(out)).toBeCloseTo(20.3, 3);
  });

  it("mehrere Teile ergeben eine Spur mit denselben Zeiten und derselben Länge", async () => {
    const out = join(dir, "teile.m4a");
    await encode(out, PART_BLOCKS);
    const times = (file: string) => packets(file).map((l) => l.split(",").slice(0, 2).join());
    expect(times(out)).toEqual(times(direct));
    expect(duration(out)).toBeCloseTo(20.3, 3);
    // Zwischendateien sind aufgeräumt.
    expect(() => readFileSync(join(dir, "spur.aac"))).toThrow();
  });

  it("an den Nahtstellen klingt der Ton wie überall sonst", async () => {
    const out = join(dir, "naehte.m4a");
    await encode(out, PART_BLOCKS);
    const original = new Int16Array(readFileSync(all).buffer.slice(0));
    const whole = decode(direct);
    const parts = decode(out);
    expect(parts.length).toBe(whole.length);
    // Dann: Um jede Naht weicht der Ton vom Original nicht stärker ab als die am Stück kodierte Spur an derselben
    // Stelle (bis auf den üblichen Spielraum des Encoders). Ein Knacksen wäre ein Vielfaches davon.
    const blocks = Math.floor(original.length / 2048);
    for (let seam = PART_BLOCKS; seam < blocks - 2; seam += PART_BLOCKS) {
      for (const block of [seam - 1, seam, seam + 1, seam + 2]) {
        expect(deviation(original, parts, block)).toBeLessThan(1.5 * deviation(original, whole, block) + 50);
      }
    }
  });
});
