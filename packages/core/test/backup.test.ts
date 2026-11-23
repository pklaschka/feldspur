import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  backupDir,
  backupFileName,
  checkProjectFile,
  copyProjectFile,
  listBackups,
  nextBackupPath,
  ProjectStore,
  rotateBackups,
  SCHEMA_VERSION,
} from "../src/index.ts";
import { MIGRATIONS } from "../src/db/migrations.ts";

let dir: string;
let project: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-backup-"));
  project = join(dir, "Feldforschung.feldspur");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seeded(): ProjectStore {
  const s = ProjectStore.create(project, { name: "Feldforschung" });
  s.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
  return s;
}

describe("Dateinamen und Ordner", () => {
  it("legt Sicherungen neben das Projekt, mit Ortszeit und Anlass im Namen", () => {
    expect(backupDir(project)).toBe(join(dir, "Feldforschung-Sicherungen"));
    const at = new Date(2026, 10, 18, 16, 47, 5);
    expect(backupFileName(project, "automatisch", at)).toBe("Feldforschung_2026-11-18_16-47-05_automatisch.feldspur");
  });

  it("vergibt in derselben Sekunde einen freien Namen und listet die neueste zuerst", () => {
    const s = seeded();
    const at = new Date(2026, 10, 18, 16, 47, 5);
    // Wenn: zwei Sicherungen in derselben Sekunde angelegt werden, dann bekommt die zweite einen anderen Namen
    const a = nextBackupPath(project, "manuell", at);
    s.backupTo(a);
    const b = nextBackupPath(project, "manuell", at);
    expect(b).not.toBe(a);
    s.backupTo(b);
    s.close();
    // Dann: die Liste nennt die neueste zuerst, mit Anlass und Ortszeit
    const list = listBackups(project);
    expect(list.map((x) => x.path)).toEqual([b, a]);
    expect(list[0]!.kind).toBe("manuell");
    expect(new Date(list[0]!.createdAt).getHours()).toBe(16);
  });

  it("übergeht fremde Dateien und Sicherungen anderer Projekte im Ordner", () => {
    // Angenommen: im Sicherungsordner liegen eine Sicherung, eine Notiz und eine Sicherung eines anderen Projekts
    const s = seeded();
    s.backupTo(join(backupDir(project), backupFileName(project, "automatisch")));
    s.close();
    writeFileSync(join(backupDir(project), "notiz.txt"), "x");
    writeFileSync(join(backupDir(project), "Feldforschung_alt_2026-01-01_10-00-00_automatisch.feldspur"), "x");
    // Dann: zählt nur die eigene Sicherung
    expect(listBackups(project)).toHaveLength(1);
  });
});

describe("Sicherung anlegen", () => {
  it("schreibt eine vollständige, eigenständige Kopie, auch mit ungesicherten WAL-Inhalten", () => {
    const s = seeded();
    // Wenn: gesichert und danach noch ein Einsatz angelegt wird
    const dest = nextBackupPath(project, "manuell");
    s.backupTo(dest);
    s.addSession({ title: "Nach der Sicherung", date: "2026-09-15", place: "", extra: {} });
    s.close();
    // Dann: enthält die Sicherung den Stand von vorher, eigenständig lesbar
    const copy = ProjectStore.open(dest);
    expect(copy.listSessions().map((x) => x.title)).toEqual(["Testmarkt"]);
    expect(copy.getMeta("name")).toBe("Feldforschung");
    copy.close();
  });

  it("überschreibt nie die Projektdatei selbst", () => {
    const s = seeded();
    expect(() => s.backupTo(project)).toThrow(/nicht ersetzen/);
    s.close();
  });

  it("dünnt automatische Sicherungen aus, von Hand angelegte nie", () => {
    // Angenommen: vier automatische Sicherungen und eine von Hand
    const s = seeded();
    for (let i = 0; i < 4; i++) s.backupTo(nextBackupPath(project, "automatisch", new Date(2026, 10, 18, 10, i)));
    s.backupTo(nextBackupPath(project, "manuell", new Date(2026, 10, 17)));
    s.close();
    // Wenn: auf zwei automatische ausgedünnt wird
    const removed = rotateBackups(project, "automatisch", 2);
    // Dann: bleiben die zwei neuesten automatischen und die von Hand; von Hand wird nie ausgedünnt
    expect(removed).toHaveLength(2);
    const left = listBackups(project);
    expect(left.filter((b) => b.kind === "automatisch").map((b) => new Date(b.createdAt).getMinutes())).toEqual([3, 2]);
    expect(left.filter((b) => b.kind === "manuell")).toHaveLength(1);
    expect(rotateBackups(project, "manuell")).toEqual([]);
  });
});

function nextBackupPathFor(kind: "automatisch") {
  return nextBackupPath(project, kind);
}

describe("Sicherung vor dem Aktualisieren", () => {
  /** Projektdatei im Stand einer älteren Version: nur die ersten Migrationen. */
  function oldProject(version: number) {
    const db = new Database(project);
    for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v]!);
    db.pragma(`user_version = ${version}`);
    db.prepare("INSERT INTO project_meta (key, value) VALUES ('name', 'Alt')").run();
    db.close();
  }

  it("sichert eine ältere Projektdatei, bevor sie migriert wird", () => {
    // Angenommen: eine Projektdatei, der die letzte Migration fehlt
    oldProject(SCHEMA_VERSION - 1);
    // Wenn: Feldspur sie öffnet
    const s = ProjectStore.open(project, { backupBeforeMigration: true });
    s.close();
    // Dann: liegt eine Sicherung „vor-Aktualisierung“ im alten Stand daneben
    const list = listBackups(project);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("vor-Aktualisierung");
    const db = new Database(list[0]!.path, { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION - 1);
    db.close();
  });

  it("sichert nicht, wenn nichts zu migrieren ist", () => {
    // Angenommen: ein aktuelles Projekt
    seeded().close();
    ProjectStore.open(project, { backupBeforeMigration: true }).close();
    // Dann: entsteht beim Öffnen keine Sicherung
    expect(listBackups(project)).toEqual([]);
  });

  it("migriert nicht, wenn die Sicherung scheitert", () => {
    // Angenommen: eine ältere Projektdatei
    oldProject(SCHEMA_VERSION - 1);
    // Wo der Sicherungsordner hin soll, liegt eine Datei: Anlegen schlägt fehl.
    writeFileSync(backupDir(project), "kein Ordner");
    // Dann: lässt sich das Projekt nicht öffnen, und die Datei bleibt im alten Stand
    expect(() => ProjectStore.open(project, { backupBeforeMigration: true })).toThrow(/bleibt deshalb unverändert/);
    const db = new Database(project, { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION - 1);
    db.close();
  });
});

describe("Projektdatei prüfen", () => {
  it("nimmt ein gesundes Projekt an", () => {
    seeded().close();
    expect(checkProjectFile(project)).toEqual({ ok: true, name: "Feldforschung", schemaVersion: SCHEMA_VERSION });
  });

  it("meldet fehlende, leere und fremde Dateien verständlich", () => {
    // Wenn: die Datei fehlt
    expect(checkProjectFile(project)).toMatchObject({ ok: false, problem: expect.stringMatching(/nicht gefunden/) });
    // Wenn: die Datei leer ist
    writeFileSync(project, "");
    expect(checkProjectFile(project)).toMatchObject({ ok: false, problem: expect.stringMatching(/leer/) });
    // Wenn: die Datei Text enthält
    writeFileSync(project, "Das ist ein Text, kein Projekt. ".repeat(10));
    expect(checkProjectFile(project)).toMatchObject({ ok: false, problem: expect.stringMatching(/kein SQLite/) });
    // Wenn: die Datei eine fremde SQLite-Datenbank ist
    rmSync(project);
    const other = new Database(project);
    other.exec("CREATE TABLE t (x)");
    other.close();
    expect(checkProjectFile(project)).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/kein Feldspur-Projekt/),
    });
  });

  it("erkennt eine abgeschnittene Datei", () => {
    // Angenommen: eine Sicherung, auf die halbe Länge gekürzt
    const s = seeded();
    const dest = nextBackupPathFor("automatisch");
    s.backupTo(dest);
    s.close();
    truncateSync(dest, Math.floor(statSync(dest).size / 2));
    // Dann: gilt sie als unvollständig
    expect(checkProjectFile(dest)).toMatchObject({ ok: false, problem: expect.stringMatching(/unvollständig/) });
  });

  it("erkennt beschädigte Seiten", () => {
    // Angenommen: eine Sicherung
    const s = seeded();
    const dest = nextBackupPathFor("automatisch");
    s.backupTo(dest);
    s.close();
    // Mitten in die Datei Unsinn schreiben, Kopf und Länge bleiben heil.
    const db = new Database(dest);
    const pageSize = db.pragma("page_size", { simple: true }) as number;
    db.close();
    const fd = openSync(dest, "r+");
    writeSync(fd, Buffer.alloc(pageSize, 0xab), 0, pageSize, pageSize * 2);
    closeSync(fd);
    // Dann: gilt sie als beschädigt
    expect(checkProjectFile(dest)).toMatchObject({ ok: false, problem: expect.stringMatching(/beschädigt/) });
  });

  it("verändert die geprüfte Datei nicht", () => {
    // Angenommen: ein Projekt mit Änderungszeit 1.1.2026
    seeded().close();
    const past = new Date(2026, 0, 1);
    utimesSync(project, past, past);
    // Wenn: es geprüft wird
    checkProjectFile(project);
    // Dann: bleibt die Änderungszeit
    expect(statSync(project).mtime.getTime()).toBe(past.getTime());
  });
});

describe("Als Kopie öffnen", () => {
  it("kopiert eine Sicherung in eine neue Datei, das Original bleibt", () => {
    // Angenommen: eine automatische Sicherung
    const s = seeded();
    const backup = nextBackupPathFor("automatisch");
    s.backupTo(backup);
    s.close();
    // Wenn: sie als Kopie geöffnet wird
    const copy = join(dir, "Wiederhergestellt.feldspur");
    copyProjectFile(backup, copy);
    // Dann: ist die Kopie ein gesundes Projekt, nicht auf sich selbst kopierbar, und die Sicherung bleibt liegen
    expect(checkProjectFile(copy).ok).toBe(true);
    expect(() => copyProjectFile(copy, copy)).toThrow(/dieselbe Datei/);
    expect(readdirSync(dir).sort()).toEqual([
      "Feldforschung-Sicherungen",
      "Feldforschung.feldspur",
      "Wiederhergestellt.feldspur",
    ]);
  });

  it("ersetzt eine beschädigte Datei samt ihrem alten Journal durch eine gesunde Kopie", () => {
    // Angenommen: eine Sicherung und daneben eine beschädigte Projektdatei mit liegengebliebenem Journal
    const s = seeded();
    const backup = nextBackupPathFor("automatisch");
    s.backupTo(backup);
    s.close();
    const broken = join(dir, "Kaputt.feldspur");
    writeFileSync(broken, "kaputt");
    writeFileSync(`${broken}-wal`, "altes Journal");
    writeFileSync(`${broken}-shm`, "alter Index");
    // Wenn: die Sicherung unter dem Namen der beschädigten Datei gespeichert wird
    copyProjectFile(backup, broken);
    // Dann: ist sie gesund, und weder Journal noch halbe Datei bleiben liegen
    expect(checkProjectFile(broken).ok).toBe(true);
    expect(readdirSync(dir).filter((f) => f.startsWith("Kaputt"))).toEqual(["Kaputt.feldspur"]);
  });
});
