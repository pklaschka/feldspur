/**
 * Originale in den Ausgabeordner kopieren und einen Ausgabeordner später prüfen (Issue #208, Gesamtkonzept #202).
 *
 * Auf Wunsch legt die Ausgabe Kopien der Originaldateien in den Unterordner `Originale/`, je Gerät ein Ordner. Der
 * Dateiname beginnt mit dem Kurzzeichen der Quelle (wie im Begleitprotokoll), so stoßen zwei `C0001.MP4` von
 * verschiedenen Karten nicht zusammen. Jede Kopie wird nach dem Schreiben neu gelesen und gegen die Prüfsumme vom
 * Einsammeln geprüft. Bei „Erneut ausgeben“ bleiben Kopien liegen, die schon zur letzten Ausgabe gehörten und dieselbe
 * Größe haben; sie neu zu schreiben, kostete bei 40 GB eine halbe Stunde. Ob sie noch stimmen, zeigt „Ordner prüfen…“.
 *
 * `verifyFolder` prüft einen Ausgabeordner gegen seine `manifest-sha256.txt`: Was fehlt, was sich verändert hat, was
 * dazugekommen ist. Es braucht kein Projekt und funktioniert mit jedem Ordner, den Feldspur ausgegeben hat.
 *
 * Einordnung: `exportSession` (`export.ts`) plant und kopiert, `apps/desktop/src/main/export.ts` reicht die Wahl
 * durch, die Prüfung startet `apps/desktop/src/main/ipc/export.ts`.
 */
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, statfs } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Device, Source } from "@feldspur/core";
import { MANIFEST_NAME } from "./dataset.ts";
import { sha256File } from "./hash.ts";
import { log, logSize } from "./log.ts";

/** Unterordner der Kopien im Ausgabeordner. */
export const ORIGINALS_DIR = "Originale";

/** Ordner- oder Dateiname ohne Zeichen, die Windows oder macOS stören; leer wird zu „_“. */
function pathPart(s: string): string {
  return (
    s
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex -- Steuerzeichen sind in Dateinamen unzulässig
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^[._]+|[. ]+$/g, "")
      .slice(0, 120) || "_"
  );
}

/** Eine Kopie: welche Quelle wohin (Pfad im Ausgabeordner, mit „/“). */
export interface OriginalCopy {
  source: Source;
  path: string;
}

/**
 * Wohin jede Quelle kopiert wird: `Originale/<Gerät>/<Kurzzeichen>_<Dateiname>`; Quellen ohne Gerät liegen in
 * `Originale/Ohne_Gerät/`. Zwei Geräte mit gleich klingendem Namen bekommen getrennte Ordner („Kamera“, „Kamera_2“).
 */
export function planOriginals(sources: readonly Source[], devices: readonly Device[]): OriginalCopy[] {
  const folder = new Map<string | null, string>();
  const used = new Set<string>();
  const folderOf = (id: string | null) => {
    if (!folder.has(id)) {
      const label = id ? (devices.find((d) => d.id === id)?.label ?? "Gerät") : "Ohne Gerät";
      const base = pathPart(label);
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
      used.add(name.toLowerCase());
      folder.set(id, name);
    }
    return folder.get(id)!;
  };
  return sources.map((s) => ({
    source: s,
    path: `${ORIGINALS_DIR}/${folderOf(s.deviceId)}/${pathPart(`${s.label}_${s.fileName}`)}`,
  }));
}

/** Gesamtgröße der Originale in Bytes, für die Angabe am Schalter und die Platzprüfung. */
export function originalsBytes(sources: readonly Source[]): number {
  return sources.reduce((n, s) => n + s.sizeBytes, 0);
}

/** Zu wenig Platz im Zielordner: Die Ausgabe bricht ab, bevor sie etwas schreibt. */
export class NotEnoughSpaceError extends Error {}

const GB = 1024 ** 3;
const sizeText = (b: number) =>
  b >= GB ? `${(b / GB).toFixed(1).replace(".", ",")} GB` : `${Math.ceil(b / 1024 ** 2)} MB`;

/**
 * Reicht der Platz für `bytes` im Ordner `dir` (oder dem nächsten vorhandenen Ordner darüber)? Lässt 1 % und mindestens
 * 200 MB Luft für die übrigen Dateien der Ausgabe. Wirft `NotEnoughSpaceError` mit verständlicher Meldung.
 */
export async function ensureSpace(dir: string, bytes: number): Promise<void> {
  let probe = dir;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const fs = await statfs(probe);
  const free = fs.bavail * fs.bsize;
  const need = bytes + Math.max(200 * 1024 ** 2, bytes / 100);
  log("ausgabe", `Platz für Originale: braucht ${logSize(need)}, frei ${logSize(free)}`);
  if (need > free)
    throw new NotEnoughSpaceError(
      `Für die Originale fehlt Platz: Sie brauchen ${sizeText(bytes)}, frei sind ${sizeText(free)}. Wähle einen anderen Ordner oder gib ohne Originale aus.`,
    );
}

/** Was `copyOriginals` getan hat. */
export interface CopyResult {
  /** Pfade im Ausgabeordner, in der Reihenfolge der Quellen. */
  files: string[];
  /** Davon unverändert aus der letzten Ausgabe übernommen. */
  kept: string[];
  /** Quellen, deren Original fehlte und die deshalb nicht im Ordner liegen. */
  missing: Source[];
}

/** Kopierfehler mit Kurzzeichen der Quelle. */
export class CopyMismatchError extends Error {}

/**
 * Kopiert die geplanten Originale nach `outDir`. Fortschritt in Bytes: Schreiben und Nachprüfen zählen je einmal die
 * Größe, `total` ist also das Doppelte der Originale. Abbrechen über `signal`; eine halb geschriebene Kopie wird
 * entfernt.
 */
export async function copyOriginals(
  outDir: string,
  plan: readonly OriginalCopy[],
  opts: {
    /** Kopien der letzten Ausgabe im selben Ordner: Bei gleicher Größe bleiben sie liegen. */
    previousFiles?: readonly string[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<CopyResult> {
  const previous = new Set(opts.previousFiles ?? []);
  const total = plan.reduce((n, c) => n + 2 * c.source.sizeBytes, 0);
  let done = 0;
  const report = () => opts.onProgress?.(done, total);
  const result: CopyResult = { files: [], kept: [], missing: [] };
  report();
  for (const { source, path } of plan) {
    opts.signal?.throwIfAborted();
    const dest = join(outDir, ...path.split("/"));
    if (!existsSync(source.originalPath)) {
      log("ausgabe", `Original fehlt, keine Kopie: ${source.label} ${source.originalPath}`);
      result.missing.push(source);
      done += 2 * source.sizeBytes;
      report();
      continue;
    }
    const there = await stat(dest).catch(() => null);
    if (there?.isFile() && there.size === source.sizeBytes && previous.has(path)) {
      log("ausgabe", `Kopie bleibt: ${path}`);
      result.files.push(path);
      result.kept.push(path);
      done += 2 * source.sizeBytes;
      report();
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    const before = done;
    try {
      // Schreiben mit Fortschritt, dann die Kopie neu lesen und gegen die Prüfsumme vom Einsammeln halten.
      await pipeline(
        createReadStream(source.originalPath, { highWaterMark: 1 << 20 }),
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            done += chunk.length;
            report();
            cb(null, chunk);
          },
        }),
        createWriteStream(dest),
        { signal: opts.signal },
      );
      const written = done;
      const sha = await sha256File(dest, {
        signal: opts.signal,
        onBytes: (b) => {
          done = written + b;
          report();
        },
      });
      if (sha !== source.sha256)
        throw new CopyMismatchError(
          `Die Kopie von ${source.label} (${source.fileName}) stimmt nicht mit der Prüfsumme vom Einsammeln überein. Das Original hat sich verändert oder der Datenträger hat einen Fehler. Bitte die Originale prüfen und erneut ausgeben.`,
        );
    } catch (e) {
      await rm(dest, { force: true }).catch(() => {});
      throw e;
    }
    done = before + 2 * source.sizeBytes;
    report();
    log("ausgabe", `kopiert und geprüft: ${path} (${logSize(source.sizeBytes)})`);
    result.files.push(path);
  }
  return result;
}

/** Leere Ordner unter `Originale/` entfernen, etwa nachdem alte Kopien weggefallen sind. */
export async function pruneOriginalsDir(outDir: string): Promise<void> {
  const root = join(outDir, ORIGINALS_DIR);
  if (!existsSync(root)) return;
  const walk = async (d: string): Promise<boolean> => {
    let empty = true;
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.isDirectory() && (await walk(join(d, e.name)))) await rm(join(d, e.name), { recursive: true });
      else empty = false;
    }
    return empty;
  };
  if (await walk(root)) await rm(root, { recursive: true });
}

/** Ergebnis von „Ordner prüfen…“. */
export interface FolderCheck {
  dir: string;
  /** Zahl der Dateien in der Prüfsummenliste. */
  listed: number;
  /** Davon unverändert. */
  ok: number;
  /** In der Liste, aber nicht im Ordner. */
  missing: string[];
  /** Im Ordner, aber mit anderer Prüfsumme. */
  changed: string[];
  /** Im Ordner, aber nicht in der Liste (etwa später dazugelegt). Kein Fehler, nur ein Hinweis. */
  extra: string[];
}

/** Keine Prüfsummenliste im Ordner oder eine, die sich nicht lesen lässt. */
export class NoManifestError extends Error {}

/** Zeilen der Prüfsummenliste: `<64 Hex>  <Pfad>` (Format von sha256sum, auch mit `*` vor dem Pfad). */
export function parseManifest(text: string): { sha: string; path: string }[] {
  const out: { sha: string; path: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
    if (m) out.push({ sha: m[1]!.toLowerCase(), path: m[2]! });
  }
  return out;
}

/** Alle Dateien unter `dir` als Pfade mit „/“, relativ zu `dir`. */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    out.push(relative(dir, join(e.parentPath, e.name)).split(sep).join("/"));
  }
  return out;
}

/**
 * Einen Ausgabeordner gegen seine Prüfsummenliste testen. Liest jede gelistete Datei ganz; Fortschritt in Bytes.
 * Systemdateien wie `.DS_Store` oder `Thumbs.db` zählen nicht als „dazugekommen“.
 */
export async function verifyFolder(
  dir: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<FolderCheck> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_NAME), "utf8");
  } catch {
    throw new NoManifestError(
      `In diesem Ordner liegt keine ${MANIFEST_NAME}. Prüfen lässt sich ein Ausgabeordner, der mit Prüfsummenliste ausgegeben wurde.`,
    );
  }
  const entries = parseManifest(text);
  if (!entries.length) throw new NoManifestError(`Die ${MANIFEST_NAME} in diesem Ordner enthält keine Prüfsummen.`);
  const result: FolderCheck = { dir, listed: entries.length, ok: 0, missing: [], changed: [], extra: [] };
  const sizes = new Map<string, number>();
  for (const e of entries) {
    const st = await stat(join(dir, ...e.path.split("/"))).catch(() => null);
    if (st?.isFile()) sizes.set(e.path, st.size);
  }
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  let done = 0;
  opts.onProgress?.(0, total);
  for (const e of entries) {
    opts.signal?.throwIfAborted();
    if (!sizes.has(e.path)) {
      result.missing.push(e.path);
      continue;
    }
    const before = done;
    const sha = await sha256File(join(dir, ...e.path.split("/")), {
      signal: opts.signal,
      onBytes: (b) => opts.onProgress?.(before + b, total),
    });
    done = before + sizes.get(e.path)!;
    if (sha === e.sha) result.ok++;
    else result.changed.push(e.path);
  }
  const listed = new Set([...entries.map((e) => e.path), MANIFEST_NAME]);
  result.extra = (await listFiles(dir)).filter(
    (f) => !listed.has(f) && !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f),
  );
  log(
    "ausgabe",
    `Ordner geprüft ${dir}: ${result.ok} von ${result.listed} unverändert, ${result.missing.length} fehlen, ${result.changed.length} verändert, ${result.extra.length} dazugekommen`,
  );
  return result;
}
