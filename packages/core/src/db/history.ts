/**
 * Rückgängig und Wiederholen für eine Projektdatei.
 *
 * Nach dem bewährten Muster aus der SQLite-Dokumentation („Automatic Undo/Redo Using SQLite“): Temporäre Trigger
 * schreiben zu jeder Änderung den umgekehrten SQL-Befehl in ein Protokoll. Ein Schritt ist der Bereich des
 * Protokolls, den eine Aktion erzeugt hat. Beim Rückgängigmachen laufen seine Befehle rückwärts; die Trigger
 * protokollieren dabei wiederum die Umkehrung, und daraus wird der Schritt zum Wiederholen.
 *
 * Alles liegt im TEMP-Schema: Die Projektdatei ändert sich dadurch nicht, und nach dem Schließen ist der Verlauf weg.
 * Änderungen außerhalb eines Schritts (Einsammeln, Tonspur-Analyse) leeren den Verlauf, damit nie ein alter Schritt
 * über neuere Daten zurückgespielt wird. Zwischenspeicher-Tabellen zählen dabei nicht.
 */
import type Database from "better-sqlite3";

/** Tabellen, die nur Zwischenergebnisse halten. Sie werden mitprotokolliert, leeren aber den Verlauf nicht. */
const CACHE_TABLES = new Set(["audio_analysis"]);
/** Höchstens so viele Schritte behalten. */
const MAX_STEPS = 100;

interface Step {
  label: string;
  from: number;
  to: number;
}

export interface HistoryState {
  /** Beschriftung des Schritts, der als Nächstes rückgängig gemacht würde. */
  undo: string | null;
  redo: string | null;
  /** Zählt jeden neu aufgezeichneten Schritt; so erkennt die Oberfläche, dass gerade etwas passiert ist. */
  serial: number;
}

/** Eine Zeile, die der letzte Schritt verändert hat, mit ihren Spalten (vorher oder nachher, was es gibt). */
export interface TouchedRow {
  table: string;
  row: Record<string, unknown>;
}

const STMT = /^(?:DELETE FROM|UPDATE|INSERT INTO) main\."((?:[^"]|"")+)"/;
const ROWID = /(?:rowid=(\d+)$|VALUES\((\d+),)/;

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class History {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  /** Letzte Protokollzeile, die zu einem bekannten Schritt gehört (oder schon geprüft ist). */
  private seen = 0;
  private serial = 0;
  private touched: TouchedRow[] = [];

  constructor(private readonly sqlite: Database.Database) {
    sqlite.exec(
      "CREATE TEMP TABLE IF NOT EXISTS undolog(seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, sql TEXT NOT NULL)",
    );
    const tables = sqlite
      .prepare(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
      )
      .pluck()
      .all() as string[];
    for (const t of tables) {
      const cols = (sqlite.prepare(`PRAGMA main.table_info(${q(t)})`).all() as { name: string }[]).map((c) => c.name);
      const log = (sql: string) => `INSERT INTO temp.undolog(tbl, sql) VALUES (${lit(t)}, ${sql});`;
      const set = cols.map((c) => `${lit(`${q(c)}=`)}||quote(OLD.${q(c)})`).join(`||','||`);
      const values = cols.map((c) => `quote(OLD.${q(c)})`).join(`||','||`);
      sqlite.exec(`
        DROP TRIGGER IF EXISTS temp.${q(`undo_ins_${t}`)};
        DROP TRIGGER IF EXISTS temp.${q(`undo_upd_${t}`)};
        DROP TRIGGER IF EXISTS temp.${q(`undo_del_${t}`)};
        CREATE TEMP TRIGGER ${q(`undo_ins_${t}`)} AFTER INSERT ON main.${q(t)} BEGIN
          ${log(`${lit(`DELETE FROM main.${q(t)} WHERE rowid=`)}||NEW.rowid`)}
        END;
        CREATE TEMP TRIGGER ${q(`undo_upd_${t}`)} AFTER UPDATE ON main.${q(t)} BEGIN
          ${log(`${lit(`UPDATE main.${q(t)} SET `)}||${set}||' WHERE rowid='||OLD.rowid`)}
        END;
        CREATE TEMP TRIGGER ${q(`undo_del_${t}`)} AFTER DELETE ON main.${q(t)} BEGIN
          ${log(`${lit(`INSERT INTO main.${q(t)}(rowid,${cols.map(q).join(",")}) VALUES(`)}||OLD.rowid||','||${values}||')'`)}
        END;
      `);
    }
    this.seen = this.maxSeq();
  }

  private maxSeq(): number {
    return (this.sqlite.prepare("SELECT coalesce(max(seq), 0) FROM temp.undolog").pluck().get() as number) ?? 0;
  }

  /**
   * Änderungen seit dem letzten bekannten Schritt prüfen: Betrafen sie echte Daten, gilt der Verlauf nicht mehr.
   * Zwischenspeicher-Zeilen werden einfach verworfen.
   */
  private settle(): void {
    const max = this.maxSeq();
    if (max <= this.seen) return;
    const real = this.sqlite
      .prepare("SELECT tbl FROM temp.undolog WHERE seq > ? GROUP BY tbl")
      .pluck()
      .all(this.seen) as string[];
    if (real.some((t) => !CACHE_TABLES.has(t))) this.clear();
    else this.sqlite.prepare("DELETE FROM temp.undolog WHERE seq > ?").run(this.seen);
    this.seen = this.maxSeq();
  }

  /** Eine Aktion als einen Schritt aufzeichnen. Ändert sie nichts, entsteht kein Schritt. */
  record<T>(label: string, fn: () => T): T {
    this.settle();
    const from = this.seen + 1;
    const result = this.sqlite.transaction(fn)();
    const to = this.maxSeq();
    this.seen = to;
    if (to >= from) {
      this.undoStack.push({ label, from, to });
      this.serial++;
      this.dropRedo();
      if (this.undoStack.length > MAX_STEPS) {
        const old = this.undoStack.shift()!;
        this.sqlite.prepare("DELETE FROM temp.undolog WHERE seq <= ?").run(old.to);
      }
    }
    return result;
  }

  /** Letzten Schritt rückgängig machen; gibt seine Beschriftung zurück (null, wenn es keinen gibt). */
  undo(): string | null {
    this.settle();
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(this.replay(step));
    return step.label;
  }

  redo(): string | null {
    this.settle();
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(this.replay(step));
    return step.label;
  }

  state(): HistoryState {
    this.settle();
    return {
      undo: this.undoStack.at(-1)?.label ?? null,
      redo: this.redoStack.at(-1)?.label ?? null,
      serial: this.serial,
    };
  }

  /** Zeilen, die das letzte Rückgängig oder Wiederholen verändert hat (in der Reihenfolge der Aktion). */
  lastTouched(): TouchedRow[] {
    return this.touched;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.sqlite.exec("DELETE FROM temp.undolog");
    this.seen = 0;
  }

  /** Befehle eines Schritts rückwärts ausführen; die Trigger liefern dabei den Gegenschritt. */
  private replay(step: Step): Step {
    return this.sqlite.transaction(() => {
      // Zeilen mit Fremdschlüsseln kommen in umgekehrter Reihenfolge zurück: erst am Ende prüfen.
      this.sqlite.pragma("defer_foreign_keys = ON");
      const rows = this.sqlite
        .prepare("SELECT seq, sql FROM temp.undolog WHERE seq BETWEEN ? AND ? ORDER BY seq DESC")
        .all(step.from, step.to) as { seq: number; sql: string }[];
      this.sqlite.prepare("DELETE FROM temp.undolog WHERE seq BETWEEN ? AND ?").run(step.from, step.to);
      const from = this.maxSeq() + 1;
      const touched: TouchedRow[] = [];
      const snapshot = (table: string, rowid: number) =>
        this.sqlite.prepare(`SELECT * FROM main.${q(table)} WHERE rowid = ?`).get(rowid) as
          | Record<string, unknown>
          | undefined;
      for (const r of rows) {
        const t = STMT.exec(r.sql)?.[1]?.replace(/""/g, '"');
        const id = ROWID.exec(r.sql);
        const rowid = id ? Number(id[1] ?? id[2]) : NaN;
        const before = t && Number.isFinite(rowid) ? snapshot(t, rowid) : undefined;
        this.sqlite.exec(r.sql);
        const row = before ?? (t && Number.isFinite(rowid) ? snapshot(t, rowid) : undefined);
        if (t && row) touched.push({ table: t, row });
      }
      // Rückwärts ausgeführt: umdrehen, damit die Reihenfolge der ursprünglichen Aktion gilt.
      this.touched = touched.reverse();
      const to = this.maxSeq();
      this.seen = to;
      return { label: step.label, from, to };
    })();
  }

  private dropRedo(): void {
    for (const s of this.redoStack)
      this.sqlite.prepare("DELETE FROM temp.undolog WHERE seq BETWEEN ? AND ?").run(s.from, s.to);
    this.redoStack = [];
  }
}
