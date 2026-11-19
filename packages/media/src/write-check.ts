/**
 * Schreiben für die Ausgabe: Vorabprüfung bestehender Zieldateien und verständliche Meldungen zu Schreibfehlern.
 */
import { open } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

/**
 * Die Ausgabe scheiterte schon in der Vorabprüfung (Ordner anlegen, Zieldateien beschreibbar): Geschrieben wurde
 * noch nichts, eine frühere Ausgabe im selben Ordner ist unversehrt. Der Name bleibt „Error“, damit die Meldung
 * in der Oberfläche ohne Vorsatz erscheint.
 */
export class ExportPrecheckError extends Error {}

/**
 * Schreibfehler in einen Satz für Nutzer*innen übersetzen (EBUSY/EPERM, ENOSPC, EACCES); sonst die Originalmeldung.
 * `fallbackDir` nennt den Ordner, falls der Fehler keinen Pfad trägt.
 */
export function writeErrorText(e: unknown, fallbackDir = ""): string {
  const err = e as NodeJS.ErrnoException;
  const path = typeof err?.path === "string" ? err.path : "";
  switch (err?.code) {
    case "EBUSY":
    case "EPERM":
      return `„${path ? basename(path) : "Eine Datei"}“ ist noch in einem anderen Programm geöffnet (z. B. Word, Excel oder MAXQDA). Bitte dort schließen und erneut ausgeben.`;
    case "ENOSPC":
      return "Der Datenträger ist voll.";
    case "EACCES":
      return `Keine Schreibrechte im Ordner „${path ? dirname(path) : fallbackDir}“.`;
    default:
      return err instanceof Error ? err.message : String(e);
  }
}

const FRIENDLY = new Set(["EBUSY", "EPERM", "ENOSPC", "EACCES"]);

/** Wirft für die bekannten Schreibfehler einen Error mit verständlichem Text (Ursache bleibt dran), reicht alles andere unverändert durch. */
export function friendlyWriteError(e: unknown, fallbackDir = ""): unknown {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (!code || !FRIENDLY.has(code)) return e;
  return new Error(writeErrorText(e, fallbackDir), { cause: e });
}

/**
 * Wie friendlyWriteError, aber nur für Fehler an Dateien unter `dir` (oder ohne Pfad); ein gesperrter
 * Zwischenspeicher oder Arbeitsordner ist kein Problem des Ausgabeordners. Ein voller Datenträger bleibt verständlich.
 */
export function friendlyWriteErrorIn(e: unknown, dir: string): unknown {
  const err = e as NodeJS.ErrnoException;
  if (typeof err?.path === "string" && err.code !== "ENOSPC") {
    const root = resolve(dir);
    const path = resolve(err.path);
    if (path !== root && !path.startsWith(root + sep)) return e;
  }
  return friendlyWriteError(e, dir);
}

/**
 * Prüft vor der langen Arbeit, ob bestehende Zieldateien beschreibbar sind (nicht gesperrt, nicht schreibgeschützt).
 * Dateien, die es noch nicht gibt, sind in Ordnung. Wirft bei der ersten Datei, die nicht geht.
 */
export async function ensureWritable(paths: string[]): Promise<void> {
  for (const path of paths) {
    let fh;
    try {
      fh = await open(path, "r+");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw friendlyWriteError(e);
    }
    // Unter Windows lässt sich auch ein Ordner so öffnen; einer am Platz der Zieldatei ist nie beschreibbar.
    const isDir = (await fh.stat()).isDirectory();
    await fh.close();
    if (isDir) {
      throw Object.assign(new Error(`„${basename(path)}“ ist ein Ordner, keine Datei.`), { code: "EISDIR", path });
    }
  }
}
