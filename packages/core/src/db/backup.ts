/**
 * Sicherungen einer Projektdatei: anlegen, auflisten, ausdünnen, prüfen und als Kopie wiederherstellen.
 *
 * Eine Sicherung ist eine vollständige, eigenständige Projektdatei (per `VACUUM INTO`, also mit allem, was noch im
 * WAL steht). Sie liegt in einem Ordner neben dem Projekt, „<Projekt>-Sicherungen“, und trägt Zeit und Anlass im
 * Namen, z. B. `Feldforschung_2026-11-18_16-47-05_automatisch.feldspur`. Die Zeit ist Ortszeit, damit man die
 * Dateien im Dateimanager ohne Umrechnen zuordnen kann.
 *
 * Wiederhergestellt wird nie über das Original, sondern immer in eine neue Datei („Als Kopie öffnen“).
 */
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  closeSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations.ts";

/** Stand des Schemas, den diese Version schreibt, und die Kennung einer Feldspur-Projektdatei in project_meta. */
export const SCHEMA_VERSION = MIGRATIONS.length;
export const FILE_FORMAT = "feldspur-project";

/** Anlass einer Sicherung; steht im Dateinamen. */
export type BackupKind = "automatisch" | "vor-Aktualisierung" | "manuell";

/** So viele Sicherungen je Anlass bleiben liegen; ältere löscht Feldspur. Von Hand angelegte nie. */
export const BACKUP_KEEP: Record<BackupKind, number | null> = {
  automatisch: 10,
  "vor-Aktualisierung": 5,
  manuell: null,
};

export interface BackupInfo {
  path: string;
  fileName: string;
  kind: BackupKind;
  /** ISO-Zeit, aus dem Dateinamen (Ortszeit) gelesen. */
  createdAt: string;
  size: number;
}

const projectBase = (projectPath: string) => basename(projectPath).replace(/\.feldspur$/i, "");

/** Ordner für die Sicherungen eines Projekts: neben der Projektdatei. */
export function backupDir(projectPath: string): string {
  return join(dirname(projectPath), `${projectBase(projectPath)}-Sicherungen`);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Zeitstempel für Dateinamen, Ortszeit: 2026-11-18_16-47-05. */
export function fileStamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function backupFileName(projectPath: string, kind: BackupKind, at: Date = new Date()): string {
  return `${projectBase(projectPath)}_${fileStamp(at)}_${kind}.feldspur`;
}

const NAME =
  /^_(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)(?:-(\d+))?_(automatisch|vor-Aktualisierung|manuell)\.feldspur$/;

/** Sicherungen im Ordner des Projekts, neueste zuerst. Fremde Dateien im Ordner werden übergangen. */
export function listBackups(projectPath: string): BackupInfo[] {
  const dir = backupDir(projectPath);
  const prefix = `${projectBase(projectPath)}_`;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: (BackupInfo & { seq: number })[] = [];
  for (const fileName of names) {
    if (!fileName.startsWith(prefix)) continue;
    const m = NAME.exec(fileName.slice(prefix.length - 1));
    if (!m) continue;
    const [, y, mo, d, h, mi, s, seq, kind] = m;
    const path = join(dir, fileName);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    out.push({ path, fileName, kind: kind as BackupKind, createdAt: at.toISOString(), size, seq: Number(seq ?? 1) });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq).map(({ seq: _seq, ...b }) => b);
}

/** Ältere Sicherungen eines Anlasses löschen, sodass höchstens `keep` bleiben. Gibt die gelöschten Pfade zurück. */
export function rotateBackups(projectPath: string, kind: BackupKind, keep = BACKUP_KEEP[kind]): string[] {
  if (keep === null) return [];
  const old = listBackups(projectPath)
    .filter((b) => b.kind === kind)
    .slice(keep);
  const removed: string[] = [];
  for (const b of old) {
    try {
      unlinkSync(b.path);
      removed.push(b.path);
    } catch {
      // Lässt sich eine alte Sicherung nicht löschen, bleibt sie eben liegen.
    }
  }
  return removed;
}

/** Freier Dateiname im Sicherungsordner (zwei Sicherungen in derselben Sekunde bekommen -2, -3 …). */
export function nextBackupPath(projectPath: string, kind: BackupKind, at: Date = new Date()): string {
  const dir = backupDir(projectPath);
  const name = backupFileName(projectPath, kind, at);
  let path = join(dir, name);
  for (let i = 2; existsSync(path); i++) path = join(dir, name.replace(`_${kind}.`, `-${i}_${kind}.`));
  return path;
}

/** Datenbank über eine offene Verbindung in eine neue Datei schreiben (konsistent, mit WAL-Inhalt). */
export function vacuumInto(sqlite: Database.Database, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  // Erst daneben schreiben, dann ersetzen: Scheitert das Schreiben (voller Datenträger), bleibt eine vorhandene Datei
  // heil. Begleitdateien einer früheren Datei gleichen Namens müssen weg, sonst hielte SQLite ihr altes Journal für
  // einen Teil der neuen Datei.
  const part = `${dest}.teil`;
  rmSync(part, { force: true });
  try {
    sqlite.prepare("VACUUM INTO ?").run(part);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) rmSync(dest + suffix, { force: true });
  renameSync(part, dest);
}

/** Ergebnis der Prüfung einer Projektdatei, bevor Feldspur sie öffnet. */
export type ProjectFileCheck =
  | { ok: true; name: string | null; schemaVersion: number }
  | { ok: false; problem: string };

const SQLITE_HEADER = "SQLite format 3\0";

function readHeader(path: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(100);
    const n = readSync(fd, buf, 0, 100, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * Prüft, ob sich eine Datei als Feldspur-Projekt öffnen lässt, ohne sie zu verändern: Ist sie da, ist sie eine
 * SQLite-Datei, ist sie vollständig, besteht sie die Integritätsprüfung von SQLite, und ist es ein Feldspur-Projekt
 * aus dieser oder einer älteren Version? Die Meldung ist für Menschen geschrieben.
 */
export function checkProjectFile(path: string, opts: { nativeBinding?: string } = {}): ProjectFileCheck {
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) return { ok: false, problem: "Das ist keine Datei." };
    size = st.size;
  } catch {
    return { ok: false, problem: "Die Datei wurde nicht gefunden." };
  }
  if (size === 0)
    return { ok: false, problem: "Die Datei ist leer (0 Byte). Vermutlich wurde sie nie fertig geschrieben." };
  let header: Buffer;
  try {
    header = readHeader(path);
  } catch (e) {
    return { ok: false, problem: `Die Datei lässt sich nicht lesen (${(e as Error).message}).` };
  }
  if (header.length < 100 || header.subarray(0, 16).toString("latin1") !== SQLITE_HEADER)
    return {
      ok: false,
      problem: "Das ist keine Feldspur-Projektdatei (kein SQLite-Format) oder ihr Anfang ist beschädigt.",
    };
  // Seitengröße und Seitenzahl aus dem Kopf: ist die Datei kürzer, wurde sie abgeschnitten (z. B. Kopie abgebrochen).
  const rawPage = header.readUInt16BE(16);
  const pageSize = rawPage === 1 ? 65536 : rawPage;
  const pages = header.readUInt32BE(28);
  const sizeValid = pages > 0 && header.readUInt32BE(24) === header.readUInt32BE(92);
  if (sizeValid && size < pages * pageSize)
    return {
      ok: false,
      problem: `Die Datei ist unvollständig: ${size.toLocaleString("de-DE")} statt ${(pages * pageSize).toLocaleString("de-DE")} Byte. Vermutlich wurde eine Kopie oder Übertragung abgebrochen.`,
    };

  let db: Database.Database | null = null;
  try {
    db = new Database(path, {
      fileMustExist: true,
      ...(opts.nativeBinding ? { nativeBinding: opts.nativeBinding } : {}),
    });
    const rows = db.pragma("quick_check(5)") as { quick_check: string }[];
    const issues = rows.map((r) => r.quick_check).filter((m) => m !== "ok");
    if (issues.length)
      return {
        ok: false,
        problem: `Die Projektdatei ist beschädigt (SQLite meldet: ${issues.slice(0, 3).join("; ")}).`,
      };
    const version = db.pragma("user_version", { simple: true }) as number;
    if (version > SCHEMA_VERSION)
      return {
        ok: false,
        problem: `Die Projektdatei stammt aus einer neueren Feldspur-Version (Schema ${version}, unterstützt bis ${SCHEMA_VERSION}).`,
      };
    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_meta'").get();
    if (!hasMeta) return { ok: false, problem: "Das ist eine SQLite-Datei, aber kein Feldspur-Projekt." };
    const meta = new Map(
      (db.prepare("SELECT key, value FROM project_meta").all() as { key: string; value: string }[]).map((r) => [
        r.key,
        r.value,
      ]),
    );
    const format = meta.get("format");
    if (format !== undefined && format !== FILE_FORMAT)
      return { ok: false, problem: "Das ist eine SQLite-Datei, aber kein Feldspur-Projekt." };
    return { ok: true, name: meta.get("name") ?? null, schemaVersion: version };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT")
      return { ok: false, problem: "Die Projektdatei ist beschädigt und lässt sich nicht lesen." };
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED")
      return { ok: false, problem: "Die Projektdatei ist gerade von einem anderen Programm gesperrt." };
    return { ok: false, problem: `Die Projektdatei lässt sich nicht öffnen (${(e as Error).message}).` };
  } finally {
    db?.close();
  }
}

/**
 * Eine Projektdatei (z. B. eine Sicherung) als neue, eigenständige Datei kopieren. Nie auf sich selbst; liegt am Ziel
 * schon etwas, wird es ersetzt (der Speichern-Dialog hat vorher gefragt).
 */
export function copyProjectFile(src: string, dest: string, opts: { nativeBinding?: string } = {}): void {
  if (resolve(src) === resolve(dest)) throw new Error("Quelle und Ziel sind dieselbe Datei.");
  const db = new Database(src, {
    fileMustExist: true,
    ...(opts.nativeBinding ? { nativeBinding: opts.nativeBinding } : {}),
  });
  try {
    vacuumInto(db, dest);
  } finally {
    db.close();
  }
}
