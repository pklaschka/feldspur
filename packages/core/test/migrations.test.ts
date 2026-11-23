import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ProjectStore, SCHEMA_VERSION } from "../src/index.ts";
import { MIGRATIONS } from "../src/db/migrations.ts";

/**
 * Fingerabdrücke der Migrationen, die schon in veröffentlichten Versionen stecken. Projektdateien leben jahrelang in
 * Forschungsarchiven: Eine geänderte alte Stufe liefe dort nie mehr, und neue und alte Dateien wichen still
 * voneinander ab. Neue Stufen werden angehängt und hier mit ihrem Fingerabdruck nachgetragen.
 */
const FROZEN = [
  "e84dc508c52e309e",
  "da56e793aead2bf9",
  "9b9faa07c03b728e",
  "a5d31093e0c3eba7",
  "1882bf7742bf4cbb",
  "b07f546b7b242ae2",
  "eccf2acce3ca0ef0",
  "1ebcfaec2c7f4587",
  "e971ebf306e75bc9",
  "166b3c465ddbc930",
  "c529469ad1dc57dd",
  "86ea8cba669fe232",
  "a9fa8a15a86af0b7",
  "1079975c2a49d14b",
  "4be265cdc492802f",
];

const fingerprint = (sql: string) => createHash("sha256").update(sql).digest("hex").slice(0, 16);

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-migrationen-"));
  file = join(dir, "Alt.feldspur");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Migrationen der Projektdatei", () => {
  it("ändern keine Stufe, die schon veröffentlicht ist, und hängen neue nur an", () => {
    const now = MIGRATIONS.map(fingerprint);
    expect(now.slice(0, FROZEN.length)).toEqual(FROZEN);
    // Neue Stufe? Ihren Fingerabdruck oben nachtragen, sobald sie in einem Release steckt.
    expect(now.length).toBeGreaterThanOrEqual(FROZEN.length);
  });

  it("heben eine Datei aus dem ersten Stand mit allen Daten auf den heutigen", () => {
    // Angenommen: eine Projektdatei aus der ersten Version mit einem erfundenen Einsatz
    const db = new Database(file);
    db.exec(MIGRATIONS[0]!);
    db.pragma("user_version = 1");
    db.exec(`
      INSERT INTO project_meta (key, value) VALUES ('name', 'Alt');
      INSERT INTO sessions (id, title, date, place, time_zone, diary_lookback_ms)
        VALUES ('s1', 'Wochenmarkt', '2026-09-14', 'Marktplatz', 'Europe/Berlin', 600000);
      INSERT INTO devices (id, session_id, label, is_reference, offset_basis)
        VALUES ('d1', 's1', 'Rekorder', 1, 'reference');
      INSERT INTO sources (id, session_id, device_id, label, kind, original_path, file_name, size_bytes, sha256,
          duration_ms, imported_at)
        VALUES ('q1', 's1', 'd1', 'A1', 'audio', '/roh/ZOOM0001.WAV', 'ZOOM0001.WAV', 1000, '${"1".repeat(64)}',
          600000, '2026-09-14T12:00:00.000Z'),
          ('q2', 's1', 'd1', 'A2', 'audio', '/roh/ZOOM0002.WAV', 'ZOOM0002.WAV', 1000, '${"2".repeat(64)}',
          600000, '2026-09-14T12:00:00.000Z');
      INSERT INTO time_evidence (id, source_id, kind, clock, local_ms, uncertainty_ms, detail)
        VALUES ('e1', 'q1', 'metadata', 'device', ${Date.UTC(2026, 8, 14, 8, 0)}, 1000, 'Aufnahmebeginn');
      INSERT INTO sync_anchors (id, session_id, kind, a_source_id, a_at_media_ms, b_source_id, b_at_media_ms,
          uncertainty_ms)
        VALUES ('k1', 's1', 'clap', 'q1', 1000, 'q2', 2000, 40);
      INSERT INTO diary_entries (id, session_id, short_text) VALUES ('t1', 's1', 'Ankunft am Stand');
    `);
    db.close();

    // Wenn: Feldspur sie öffnet und alle Stufen nachholt
    const store = ProjectStore.open(file);
    try {
      // Dann: steht die Datei im heutigen Stand, und alles lässt sich lesen wie zuvor
      const db2 = new Database(file, { readonly: true });
      expect(db2.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
      db2.close();
      expect(store.listSessions().map((s) => s.title)).toEqual(["Wochenmarkt"]);
      expect(store.listDevices("s1").map((d) => d.label)).toEqual(["Rekorder"]);
      expect(store.listSources("s1").map((s) => s.fileName)).toEqual(["ZOOM0001.WAV", "ZOOM0002.WAV"]);
      expect(store.listEvidence("s1").map((e) => e.detail)).toEqual(["Aufnahmebeginn"]);
      expect(store.listAnchors("s1").map((a) => a.id)).toEqual(["k1"]);
      expect(store.listDiaryEntries("s1").map((t) => t.shortText)).toEqual(["Ankunft am Stand"]);
    } finally {
      store.close();
    }
  });

  it.each(Array.from({ length: SCHEMA_VERSION - 1 }, (_, i) => i + 1))(
    "heben eine leere Datei aus Stand %i ohne Fehler auf den heutigen",
    (version) => {
      const db = new Database(file);
      for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${version}`);
      db.prepare("INSERT INTO project_meta (key, value) VALUES ('name', 'Alt')").run();
      db.close();
      const store = ProjectStore.open(file);
      expect(store.listSessions()).toEqual([]);
      store.close();
    },
  );
});
