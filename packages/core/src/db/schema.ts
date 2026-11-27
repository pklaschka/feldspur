/**
 * SQLite-Schema einer .feldspur-Projektdatei (Drizzle).
 * Änderungen hier brauchen immer eine neue Migration in migrations.ts. Die Migrationen gelten in der Datei;
 * test/schema.test.ts vergleicht beide Fassungen (Spalten, Standardwerte, Fremdschlüssel, Indizes).
 *
 * Benutzt nur von `packages/core/src/db/store.ts` (Abfragen) und dem Schematest. Was die Spalten bedeuten, steht
 * an den gleichnamigen Feldern in `packages/core/src/model.ts`; hier heißen sie camelCase, in der Datei
 * snake_case. Tabellen: `sessions` = Einsätze, `sources` = Quellen, `devices` = Geräte, `time_evidence` =
 * Zeitbelege, `sync_anchors` = Anker, `diary_entries` = Tagebucheinträge, `transcript_lines` = Mitschrift,
 * `source_notes` = Arbeitsnotizen, `episode_edits` = Episoden von Hand.
 */
import { sql } from "drizzle-orm";
import type { Decision, ExportFingerprint, ExportSettings } from "../model.ts";
import {
  blob,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// Spalten-Kürzel: JSON als Text gespeichert bzw. Wahrheitswert als 0/1.
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });

/** Angaben zur Projektdatei selbst als Schlüssel und Wert, z. B. `name`, `format`, `created_at`. */
export const projectMeta = sqliteTable("project_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  date: text("date").notNull(),
  place: text("place").notNull().default(""),
  timeZone: text("time_zone").notNull(),
  diaryLookbackMs: integer("diary_lookback_ms").notNull(),
  extra: json<Record<string, string>>("extra")
    .notNull()
    .default(sql`'{}'`),
  episodes: bool("episodes").notNull().default(false),
  dataset: json<Record<string, string>>("dataset")
    .notNull()
    .default(sql`'{}'`),
});

export const persons = sqliteTable("persons", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
});

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    personId: text("person_id").references(() => persons.id, { onDelete: "set null" }),
    matchKey: text("match_key").notNull().default(""),
    isReference: bool("is_reference").notNull().default(false),
    clockOffsetMs: integer("clock_offset_ms").notNull().default(0),
    clockOffsetUncertaintyMs: integer("clock_offset_uncertainty_ms").notNull().default(0),
    offsetBasis: text("offset_basis", { enum: ["reference", "manual", "anchor", "unknown"] })
      .notNull()
      .default("unknown"),
    // Bewusst anders als die Datei (dort 0 aus Migration 1; Migration 5 hat alle bestehenden Geräte auf 1 gesetzt).
    // Drizzle schreibt diesen Wert bei jedem Insert ohne das Feld selbst; der SQL-Standard 0 greift nur bei rohem SQL.
    // „true“ ist der sichere Wert wie in Zod: „false“ ließe UTC-Zeitstempel still als Ortszeit lesen. Der Schematest
    // führt die Stelle als benannte Ausnahme (Issue #191).
    timestampsAreUtc: bool("timestamps_are_utc").notNull().default(true),
    timeZone: text("time_zone"),
    filenamePattern: text("filename_pattern"),
  },
  (t) => [index("devices_session").on(t.sessionId)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["video", "audio", "photo", "diary", "note", "gps", "other"] }).notNull(),
    title: text("title").notNull().default(""),
    originalPath: text("original_path").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    durationMs: integer("duration_ms"),
    metadata: json<Record<string, unknown>>("metadata")
      .notNull()
      .default(sql`'{}'`),
    importedAt: text("imported_at").notNull(),
    partOf: text("part_of").references((): AnySQLiteColumn => sources.id, { onDelete: "set null" }),
    follows: text("follows").references((): AnySQLiteColumn => sources.id, { onDelete: "set null" }),
    levelMode: text("level_mode", { enum: ["auto", "manual", "off"] })
      .notNull()
      .default("auto"),
    levelGainDb: real("level_gain_db").notNull().default(0),
    levelCompress: bool("level_compress").notNull().default(true),
    firstPage: integer("first_page"),
    pageSpread: bool("page_spread").notNull().default(false),
    role: text("role", { enum: ["timeline", "context"] })
      .notNull()
      .default("timeline"),
    contextOrder: integer("context_order"),
    contextMade: text("context_made").notNull().default(""),
  },
  (t) => [
    index("sources_session").on(t.sessionId),
    uniqueIndex("sources_session_sha").on(t.sessionId, t.sha256),
    uniqueIndex("sources_session_label").on(t.sessionId, t.label),
  ],
);

export const evidence = sqliteTable(
  "time_evidence",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["metadata", "filename", "spoken", "anchor", "manual", "checked"] }).notNull(),
    clock: text("clock", { enum: ["device", "true"] }).notNull(),
    atMediaMs: integer("at_media_ms").notNull().default(0),
    localMs: integer("local_ms").notNull(),
    utcMs: integer("utc_ms"),
    uncertaintyMs: integer("uncertainty_ms").notNull(),
    detail: text("detail").notNull(),
    raw: text("raw").notNull().default(""),
    enabled: bool("enabled").notNull().default(true),
    decision: json<Decision>("decision"),
  },
  (t) => [index("evidence_source").on(t.sourceId)],
);

export const anchors = sqliteTable(
  "sync_anchors",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["clap", "audio-correlation", "manual"] }).notNull(),
    aSourceId: text("a_source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    aAtMediaMs: integer("a_at_media_ms").notNull(),
    bSourceId: text("b_source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    bAtMediaMs: integer("b_at_media_ms").notNull(),
    uncertaintyMs: integer("uncertainty_ms").notNull(),
    note: text("note").notNull().default(""),
    enabled: bool("enabled").notNull().default(true),
    proposed: bool("proposed").notNull().default(false),
    confidence: real("confidence"),
  },
  (t) => [index("anchors_session").on(t.sessionId)],
);

/** Ein Rahmen eines Tagebucheintrags, wie er als JSON in `diary_entries.regions` steht (`DiaryEntry.regions`). */
export interface DiaryRegionRow {
  sourceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pageNo?: number | null;
}

export const diaryEntries = sqliteTable(
  "diary_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    regions: json<DiaryRegionRow[]>("regions")
      .notNull()
      .default(sql`'[]'`),
    notedAtMs: integer("noted_at_ms"),
    lookbackMs: integer("lookback_ms"),
    mode: text("mode", { enum: ["scan", "short", "full"] })
      .notNull()
      .default("scan"),
    shortText: text("short_text").notNull().default(""),
    fullText: text("full_text").notNull().default(""),
    role: text("role", { enum: ["timeline", "context"] })
      .notNull()
      .default("timeline"),
    contextOrder: integer("context_order"),
    title: text("title").notNull().default(""),
    contextMade: text("context_made").notNull().default(""),
    contextRefs: json<string[]>("context_refs")
      .notNull()
      .default(sql`'[]'`),
  },
  (t) => [index("diary_session").on(t.sessionId)],
);

export const transcriptLines = sqliteTable(
  "transcript_lines",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    atMs: integer("at_ms").notNull(),
    speaker: text("speaker").notNull().default(""),
    text: text("text").notNull().default(""),
  },
  (t) => [index("transcript_source").on(t.sourceId, t.atMs)],
);

export const sourceNotes = sqliteTable(
  "source_notes",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    fromMs: integer("from_ms"),
    toMs: integer("to_ms"),
    text: text("text").notNull().default(""),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("source_notes_source").on(t.sourceId)],
);

export const episodeEdits = sqliteTable(
  "episode_edits",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    fromMs: integer("from_ms").notNull(),
    toMs: integer("to_ms").notNull(),
    mode: text("mode", { enum: ["include", "exclude"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("episode_edits_source").on(t.sourceId)],
);

/**
 * Dauerhaftes Änderungsprotokoll. Schreiben nur Trigger (siehe history.ts); eine Zeile je geänderter Zeile, mit den
 * Spalten vorher und nachher als JSON. `step` fasst die Zeilen einer Aktion zusammen, `label` ist ihre Beschriftung
 * (leer bei Änderungen ohne Beschriftung, etwa beim Einsammeln).
 */
export const changeLog = sqliteTable(
  "change_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull(),
    step: integer("step"),
    label: text("label"),
    tbl: text("tbl").notNull(),
    op: text("op", { enum: ["insert", "update", "delete"] }).notNull(),
    rowKey: text("row_key").notNull(),
    before: text("before"),
    after: text("after"),
  },
  (t) => [index("change_log_step").on(t.step)],
);

/** Zwischengespeicherte Tonspur-Analyse je Quelle (`AudioAnalysis`); lässt sich jederzeit neu berechnen. */
export const audioAnalysis = sqliteTable("audio_analysis", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id, { onDelete: "cascade" }),
  envelope: blob("envelope", { mode: "buffer" }).notNull(),
  envelopeRate: integer("envelope_rate").notNull(),
  noiseFloorDb: real("noise_floor_db").notNull(),
  idle: json<{ startMs: number; endMs: number }[]>("idle")
    .notNull()
    .default(sql`'[]'`),
  loudInIdle: json<{ atMs: number; aboveFloorDb: number }[]>("loud_in_idle")
    .notNull()
    .default(sql`'[]'`),
  speechLevelDb: real("speech_level_db"),
  version: integer("version").notNull(),
  analyzedAt: text("analyzed_at").notNull(),
});

/** Letzte Ausgabe je Einsatz: wohin, welche Dateien, mit welchen Einstellungen und mit welchem Fingerabdruck. */
export const exportRecords = sqliteTable("export_records", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  exportedAt: text("exported_at").notNull(),
  dir: text("dir").notNull(),
  files: json<string[]>("files")
    .notNull()
    .default(sql`'[]'`),
  durationMs: integer("duration_ms").notNull(),
  options: json<ExportSettings>("options")
    .notNull()
    .default(sql`'{}'`),
  fingerprint: json<ExportFingerprint>("fingerprint")
    .notNull()
    .default(sql`'{}'`),
});
