/**
 * Das Schema steht zweimal da: als SQL in den Migrationen (das legt die Datei tatsächlich an) und als Drizzle-
 * Beschreibung in schema.ts (für Abfragen und Typen). Dieser Test wendet alle Migrationen an und vergleicht das
 * Ergebnis mit Drizzle: Tabellen, Spalten mit Typ, NOT NULL, Standardwert und Primärschlüssel, Fremdschlüssel
 * (Spalte, Ziel, ON DELETE) und Indizes (Name, UNIQUE, Spalten) (Issue #191).
 *
 * Nicht verglichen werden: AUTOINCREMENT, ON UPDATE, zusammengesetzte Fremdschlüssel (nur die erste Spalte),
 * UNIQUE als Spalten- oder Tabellen-Constraint (heute gibt es nur CREATE UNIQUE INDEX), Teilindizes (WHERE) und die
 * Reihenfolge in zusammengesetzten Primärschlüsseln. Wer so etwas einführt, ergänzt den Vergleich.
 */
import Database from "better-sqlite3";
import { is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vite-plus/test";
import { MIGRATIONS } from "../src/db/migrations.ts";
import * as schema from "../src/db/schema.ts";

const db = new Database(":memory:");
for (const m of MIGRATIONS) db.exec(m);

/**
 * Bewusste Abweichungen beim Standardwert, je Spalte mit Grund. Drizzle schreibt seinen Standard bei Inserts selbst;
 * der Standard der Datei greift nur bei rohem SQL.
 */
const DEFAULT_EXCEPTIONS: Record<string, { drizzle: string; file: string; why: string }> = {
  "devices.timestamps_are_utc": {
    drizzle: "1",
    file: "0",
    why: "Drizzle-Inserts sollen wie Zod „true“ schreiben; „false“ ließe UTC-Zeitstempel als Ortszeit lesen",
  },
};

const tables = (Object.values(schema) as unknown[]).filter((t): t is SQLiteTable => is(t, SQLiteTable));

/** Standardwert so, wie SQLite ihn in PRAGMA table_info nennt. */
function drizzleDefault(col: ReturnType<typeof getTableConfig>["columns"][number]): string | null {
  if (!col.hasDefault || col.default === undefined) return null;
  const d = col.default as unknown;
  if (is(d, SQL)) return (d.queryChunks as { value?: string[] }[]).map((c) => c.value?.join("") ?? "").join("");
  if (typeof d === "boolean") return d ? "1" : "0";
  if (typeof d === "number") return String(d);
  return `'${String(d)}'`;
}

interface Info {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface Fk {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}
interface Idx {
  name: string;
  unique: number;
  origin: string;
}

describe("Schema der Projektdatei", () => {
  it("kennt dieselben Tabellen wie die Migrationen", () => {
    const inFile = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as {
        name: string;
      }[]
    )
      .map((r) => r.name)
      .sort();
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(inFile);
  });

  describe.each(tables.map((t) => [getTableConfig(t).name, t] as const))("%s", (name, table) => {
    const cfg = getTableConfig(table);
    const info = db.pragma(`table_info(${name})`) as Info[];

    it("hat dieselben Spalten mit Typ, NOT NULL, Standardwert und Primärschlüssel", () => {
      const file = info
        .map((c) => ({
          name: c.name,
          type: c.type.toLowerCase(),
          notNull: c.notnull === 1 || c.pk > 0,
          dflt: c.dflt_value,
          pk: c.pk > 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const pkCols = new Set(cfg.primaryKeys.flatMap((p) => p.columns.map((c) => c.name)));
      const drizzle = cfg.columns
        .map((c) => ({
          name: c.name,
          type: c.getSQLType().toLowerCase(),
          notNull: c.notNull || c.primary || pkCols.has(c.name),
          dflt: DEFAULT_EXCEPTIONS[`${name}.${c.name}`]?.file ?? drizzleDefault(c),
          pk: c.primary || pkCols.has(c.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(drizzle).toEqual(file);
    });

    it.each(
      Object.entries(DEFAULT_EXCEPTIONS)
        .filter(([key]) => key.startsWith(`${name}.`))
        .map(([key, e]) => [key.slice(name.length + 1), e] as const),
    )("weicht bei %s bewusst ab", (column, e) => {
      // Die Ausnahme gilt nur, solange beide Seiten genau so aussehen; ändert sich eine, muss sie neu begründet werden.
      expect(drizzleDefault(cfg.columns.find((c) => c.name === column)!)).toBe(e.drizzle);
      expect(info.find((c) => c.name === column)!.dflt_value).toBe(e.file);
      expect(e.why).not.toBe("");
    });

    it("hat dieselben Fremdschlüssel", () => {
      const file = (db.pragma(`foreign_key_list(${name})`) as Fk[])
        .map((f) => `${f.from} → ${f.table}.${f.to} (${f.on_delete.toLowerCase()})`)
        .sort();
      const drizzle = cfg.foreignKeys
        .map((fk) => {
          const r = fk.reference();
          return `${r.columns[0]!.name} → ${getTableConfig(r.foreignTable).name}.${r.foreignColumns[0]!.name} (${fk.onDelete ?? "no action"})`;
        })
        .sort();
      expect(drizzle).toEqual(file);
    });

    it("hat dieselben Indizes", () => {
      const file = (db.pragma(`index_list(${name})`) as Idx[])
        .filter((i) => i.origin === "c")
        .map((i) => {
          const cols = (db.pragma(`index_info(${i.name})`) as { name: string }[]).map((c) => c.name);
          return `${i.name}${i.unique ? " unique" : ""} (${cols.join(", ")})`;
        })
        .sort();
      const drizzle = cfg.indexes
        .map((i) => {
          const cols = i.config.columns.map((c) => (c as { name: string }).name);
          return `${i.config.name}${i.config.unique ? " unique" : ""} (${cols.join(", ")})`;
        })
        .sort();
      expect(drizzle).toEqual(file);
    });
  });
});
