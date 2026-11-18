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
    addSession("Vorher");
    auto.attach(store, { fresh: false });
    expect(automatic()).toHaveLength(1);
  });

  it("sichert beim Öffnen nicht erneut, wenn die letzte Sicherung jünger als 30 Minuten ist", () => {
    auto.attach(store, { fresh: false });
    now += 10 * 60_000;
    new AutoBackup(() => now).attach(store, { fresh: false });
    expect(automatic()).toHaveLength(1);
  });

  it("sichert während der Arbeit nur bei Änderungen und höchstens alle 30 Minuten", () => {
    auto.attach(store, { fresh: true });
    now += AUTO_BACKUP_INTERVAL_MS;
    auto.tick();
    expect(automatic()).toHaveLength(0);
    addSession("A");
    auto.tick();
    expect(automatic()).toHaveLength(1);
    addSession("B");
    now += 5 * 60_000;
    auto.tick();
    expect(automatic()).toHaveLength(1);
    now += AUTO_BACKUP_INTERVAL_MS;
    auto.tick();
    expect(automatic()).toHaveLength(2);
  });

  it("sichert beim Schließen, was seit der letzten Sicherung dazukam", () => {
    auto.attach(store, { fresh: true });
    auto.detach();
    expect(automatic()).toHaveLength(0);
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
    for (let i = 0; i < 12; i++) {
      addSession(`S${i}`);
      now += AUTO_BACKUP_INTERVAL_MS;
      auto.tick();
    }
    expect(automatic()).toHaveLength(10);
  });

  it("meldet eine gescheiterte Sicherung, ohne die Arbeit zu stören", () => {
    writeFileSync(backupDir(store.path), "kein Ordner");
    addSession("A");
    auto.attach(store, { fresh: false });
    expect(auto.overview()?.lastError).toMatch(/fehlgeschlagen/);
    expect(() => addSession("B")).not.toThrow();
  });
});
