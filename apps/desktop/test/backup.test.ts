import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDir, listBackups, ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AUTO_BACKUP_INTERVAL_MS, AutoBackup } from "../src/main/backup.ts";

let dir: string;
let store: ProjectStore;
let now: number;
let auto: AutoBackup;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-auto-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
  now = new Date(2026, 10, 18, 9, 0, 0).getTime();
  auto = new AutoBackup(() => now);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const addSession = (title: string) => store.addSession({ title, date: "2026-09-14", place: "", extra: {} });
const automatic = () => listBackups(store.path).filter((b) => b.kind === "automatisch");

describe("Automatische Sicherung", () => {
  it("sichert ein neu angelegtes Projekt nicht gleich beim Öffnen", () => {
    auto.attach(store, { fresh: true });
    expect(automatic()).toEqual([]);
  });

  it("sichert beim Öffnen den Stand vor der Sitzung", () => {
    // Angenommen: ein Projekt mit einem Einsatz
    addSession("Vorher");
    // Wenn: es geöffnet wird, dann gibt es eine Sicherung
    auto.attach(store, { fresh: false });
    expect(automatic()).toHaveLength(1);
  });

  it("sichert beim Öffnen nicht erneut, wenn die letzte Sicherung jünger als 30 Minuten ist", () => {
    // Angenommen: beim Öffnen wurde gesichert
    auto.attach(store, { fresh: false });
    // Wenn: zehn Minuten später wieder geöffnet wird, dann bleibt es bei einer Sicherung
    now += 10 * 60_000;
    new AutoBackup(() => now).attach(store, { fresh: false });
    expect(automatic()).toHaveLength(1);
  });

  it("sichert während der Arbeit nur bei Änderungen und höchstens alle 30 Minuten", () => {
    auto.attach(store, { fresh: true });
    // Wenn: 30 Minuten ohne Änderung vergehen, dann keine Sicherung
    now += AUTO_BACKUP_INTERVAL_MS;
    auto.tick();
    expect(automatic()).toHaveLength(0);
    // Wenn: etwas geändert wird, dann gleich eine
    addSession("A");
    auto.tick();
    expect(automatic()).toHaveLength(1);
    // Wenn: fünf Minuten später wieder etwas geändert wird, dann noch keine weitere
    addSession("B");
    now += 5 * 60_000;
    auto.tick();
    expect(automatic()).toHaveLength(1);
    // Wenn: weitere 30 Minuten vergehen, dann die zweite
    now += AUTO_BACKUP_INTERVAL_MS;
    auto.tick();
    expect(automatic()).toHaveLength(2);
  });

  it("sichert beim Schließen, was seit der letzten Sicherung dazukam", () => {
    // Wenn: ohne Änderung geschlossen wird, dann keine Sicherung
    auto.attach(store, { fresh: true });
    auto.detach();
    expect(automatic()).toHaveLength(0);
    // Wenn: nach einer Änderung geschlossen wird, dann enthält die Sicherung die Änderung
    auto.attach(store, { fresh: true });
    addSession("Zum Schluss");
    auto.detach();
    const [last] = automatic();
    const copy = ProjectStore.open(last!.path);
    expect(copy.listSessions().map((s) => s.title)).toEqual(["Zum Schluss"]);
    copy.close();
  });

  it("behält nur die letzten zehn", () => {
    auto.attach(store, { fresh: true });
    // Wenn: zwölfmal gesichert wird, dann bleiben zehn
    for (let i = 0; i < 12; i++) {
      addSession(`S${i}`);
      now += AUTO_BACKUP_INTERVAL_MS;
      auto.tick();
    }
    expect(automatic()).toHaveLength(10);
  });

  it("meldet eine gescheiterte Sicherung, ohne die Arbeit zu stören", () => {
    // Angenommen: der Sicherungsordner lässt sich nicht anlegen
    writeFileSync(backupDir(store.path), "kein Ordner");
    addSession("A");
    auto.attach(store, { fresh: false });
    // Dann: meldet die App den Fehler, und die Arbeit geht weiter
    expect(auto.overview()?.lastError).toMatch(/fehlgeschlagen/);
    expect(() => addSession("B")).not.toThrow();
  });
});
