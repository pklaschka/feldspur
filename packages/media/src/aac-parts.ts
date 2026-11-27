/**
 * Kodiert eine Tonspur in Teilen gleichzeitig nach AAC (Issue #249). Der AAC-Encoder von ffmpeg nutzt nur einen
 * Kern und schafft je Spur etwa das 50- bis 110-Fache der Echtzeit; bei langen Einsätzen wartete die Ausgabe am Ende
 * auf den Ton. Hier wird die Spur in Teile von zwei Minuten geschnitten, jeder Teil für sich kodiert und das Ergebnis
 * ohne erneutes Kodieren aneinandergehängt.
 *
 * Damit an den Nahtstellen nichts knackt: AAC arbeitet in Blöcken von 1024 Abtastwerten, die sich mit dem Block davor
 * überlappen. Alle Teile liegen deshalb auf demselben 1024er-Raster der ganzen Spur, und jeder Teil wird mit etwas
 * Vorlauf und Nachlauf kodiert (derselbe Ton wie im Nachbarteil). Die Blöcke aus Vor- und Nachlauf werden verworfen;
 * an der Naht folgt so auf den letzten Block des einen Teils genau der Block, der auch beim Kodieren am Stück gefolgt
 * wäre. Eine kurze Spur (ein Teil) ist bitgleich mit dem Kodieren am Stück.
 *
 * Einordnung: Hilfsmodul von `montage-video.ts` (Schritt Ausgeben). Eingang sind die rohen Tonstücke der Montage
 * (PCM, 16 Bit, Stereo), Ausgang ist eine .m4a-Datei je Tonspur für den Zwischenspeicher.
 */
import { createWriteStream } from "node:fs";
import { open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { runTool } from "./process.ts";

/** Abtastwerte je AAC-Block. */
const BLOCK = 1024;
/** Bytes je Abtastzeitpunkt im rohen Ton (16 Bit, Stereo). */
const BYTES = 4;
/** Länge eines Teils in Blöcken: 5625 × 1024 Abtastwerte sind bei 48 kHz genau zwei Minuten. */
const PART_BLOCKS = 5625;
/**
 * Vorlauf in Blöcken (gut fünf Sekunden): So lange braucht die Ratensteuerung des Encoders nach einem Neustart, bis
 * sie rechnet wie mitten in der Spur. Gemessen an rosa Rauschen: Mit 32 Blöcken rauschen die ersten Sekunden nach der
 * Naht gut 2 dB mehr als am Stück kodiert, mit 256 Blöcken ist kein Unterschied mehr messbar.
 */
const LEAD = 256;
/** Nachlauf in Blöcken: Der Encoder schaut für die Wahl der Fensterform einen Block voraus. */
const TAIL = 4;

/** Höchstens `n` Aufgaben gleichzeitig; weitere warten, bis eine fertig ist. */
export function limiter(n: number): <T>(work: () => Promise<T>) => Promise<T> {
  let free = Math.max(1, n);
  const waiting: (() => void)[] = [];
  return async (work) => {
    if (free > 0) free--;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else free++;
    }
  };
}

export interface AacPartsOptions {
  /** Rohe Tonstücke in ihrer Reihenfolge: PCM, 16 Bit, Stereo, ohne Kopf. */
  pcmFiles: string[];
  /** Abtastrate der Stücke in Hz. */
  rate: number;
  /** Bitrate für ffmpeg, z. B. "160k". */
  bitrate: string;
  /** Fertige Tonspur (.m4a). */
  out: string;
  /** Arbeitsordner und Namensanfang für die Zwischendateien. */
  dir: string;
  tag: string;
  /** Begrenzt, wie viele Teile über alle Tonspuren hinweg gleichzeitig kodiert werden (siehe `limiter`). */
  slot: <T>(work: () => Promise<T>) => Promise<T>;
  signal?: AbortSignal | undefined;
  /** Länge eines Teils in Blöcken; nur für Tests kürzer. */
  partBlocks?: number;
}

/** Schreibt die Abtastwerte `from` bis `to` (über alle Stücke gezählt) als rohen Ton nach `out`. */
async function copySamples(files: { path: string; samples: number }[], from: number, to: number, out: string) {
  const target = createWriteStream(out);
  const buf = Buffer.allocUnsafe(1 << 20);
  let start = 0;
  try {
    for (const f of files) {
      const a = Math.max(from, start);
      const b = Math.min(to, start + f.samples);
      if (a < b) {
        const fh = await open(f.path, "r");
        try {
          let pos = (a - start) * BYTES;
          const end = (b - start) * BYTES;
          while (pos < end) {
            const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, end - pos), pos);
            if (!bytesRead) throw new Error(`Tonstück ist kürzer als erwartet: ${f.path}`);
            pos += bytesRead;
            if (!target.write(Buffer.from(buf.subarray(0, bytesRead))))
              await new Promise<void>((go) => target.once("drain", go));
          }
        } finally {
          await fh.close();
        }
      }
      start += f.samples;
    }
  } finally {
    target.end();
    await finished(target);
  }
}

/** Anfänge der AAC-Blöcke in einer ADTS-Datei (jeder Block trägt seine Länge im Kopf). */
function adtsBlocks(data: Buffer): number[] {
  const starts: number[] = [];
  let pos = 0;
  while (pos + 7 <= data.length) {
    if (data[pos] !== 0xff || (data[pos + 1]! & 0xf0) !== 0xf0) throw new Error("AAC-Daten sind nicht lesbar");
    const length = ((data[pos + 3]! & 0x03) << 11) | (data[pos + 4]! << 3) | (data[pos + 5]! >> 5);
    if (length < 7) throw new Error("AAC-Daten sind nicht lesbar");
    starts.push(pos);
    pos += length;
  }
  starts.push(pos);
  return starts;
}

/** Kodiert die Stücke einer Tonspur in Teilen gleichzeitig nach AAC und schreibt sie als .m4a nach `out`. */
export async function encodeAacParts(o: AacPartsOptions): Promise<void> {
  const { signal } = o;
  const run = (args: string[]) => runTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { signal });
  const files = await Promise.all(
    o.pcmFiles.map(async (path) => ({ path, samples: Math.floor((await stat(path)).size / BYTES) })),
  );
  const total = files.reduce((n, f) => n + f.samples, 0);
  const part = (o.partBlocks ?? PART_BLOCKS) * BLOCK;
  // Der letzte Teil darf bis zu anderthalb Teile lang sein, damit kein winziger Rest für sich kodiert wird.
  const count = Math.max(1, Math.round(total / part));
  // Blöcke der ganzen Spur: einer Vorlauf des Encoders, dann je angefangene 1024 Abtastwerte einer.
  const blocks = Math.ceil(total / BLOCK) + 1;
  const pieces = await Promise.all(
    Array.from({ length: count }, (_, k) =>
      o.slot(async () => {
        signal?.throwIfAborted();
        const last = k === count - 1;
        // Vorlauf: derselbe Ton wie am Ende des Teils davor, höchstens bis zum Anfang der Spur.
        const lead = Math.min(LEAD, (k * part) / BLOCK);
        const from = k * part - lead * BLOCK;
        const to = last ? total : Math.min(total, (k + 1) * part + TAIL * BLOCK);
        const pcm = join(o.dir, `${o.tag}-teil${k}.pcm`);
        const aac = join(o.dir, `${o.tag}-teil${k}.aac`);
        await copySamples(files, from, to, pcm);
        await run(["-f", "s16le", "-ar", String(o.rate), "-ac", "2", "-i", pcm, "-c:a", "aac", "-b:a", o.bitrate, aac]);
        await rm(pcm, { force: true });
        // Behalten: ohne den Vorlauf (und den einen Block, den der Encoder selbst davorsetzt) genau die Blöcke
        // dieses Teils; der erste Teil behält seinen Encoder-Vorlauf, der letzte alles bis zum Ende.
        const data = await readFile(aac);
        const starts = adtsBlocks(data);
        const skip = k === 0 ? 0 : lead + 1;
        const keep = last ? starts.length - 1 - skip : part / BLOCK + (k === 0 ? 1 : 0);
        if (keep <= 0 || skip + keep > starts.length - 1)
          throw new Error(`Tonspur ${o.tag}: Teil ${k} hat zu wenige AAC-Blöcke`);
        await writeFile(aac, data.subarray(starts[skip], starts[skip + keep]));
        return { aac, blocks: keep };
      }),
    ),
  );
  signal?.throwIfAborted();
  const found = pieces.reduce((n, p) => n + p.blocks, 0);
  if (found !== blocks) throw new Error(`Tonspur ${o.tag}: ${found} statt ${blocks} AAC-Blöcke`);
  // Aneinanderhängen, dann ohne Kodieren in .m4a verpacken. Die Zeiten setzt der Bitstromfilter so, wie ffmpeg sie
  // beim Kodieren am Stück schreibt: Der erste Block ist Vorlauf des Encoders (liegt vor der Zeit 0), der letzte
  // endet mit dem Ton.
  const joined = join(o.dir, `${o.tag}.aac`);
  const target = createWriteStream(joined);
  try {
    for (const p of pieces) {
      if (!target.write(await readFile(p.aac))) await new Promise<void>((go) => target.once("drain", go));
      await rm(p.aac, { force: true });
    }
  } finally {
    target.end();
    await finished(target);
  }
  const rest = total - (blocks - 2) * BLOCK;
  const times = `setts=ts=TS-${BLOCK}/${o.rate}/TB:duration=if(eq(N\\,${blocks - 1})\\,${rest}/${o.rate}/TB\\,DURATION)`;
  await run(["-i", joined, "-c", "copy", "-bsf:a", times, o.out]);
  await rm(joined, { force: true });
}
