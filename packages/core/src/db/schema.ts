/**
 * SQLite-Schema einer .feldspur-Projektdatei (Drizzle).
 * Änderungen hier brauchen immer eine neue Migration in migrations.ts.
 */
import { sql } from "drizzle-orm";
import { blob, integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const bool = (name: string) => integer(name, { mode: "boolean" });

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
    timestampsAreUtc: bool("timestamps_are_utc").notNull().default(false),
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
    partOf: text("part_of"),
    follows: text("follows"),
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
    kind: text("kind", { enum: ["metadata", "filename", "spoken", "anchor", "manual"] }).notNull(),
    clock: text("clock", { enum: ["device", "true"] }).notNull(),
    atMediaMs: integer("at_media_ms").notNull().default(0),
    localMs: integer("local_ms").notNull(),
    utcMs: integer("utc_ms"),
    uncertaintyMs: integer("uncertainty_ms").notNull(),
    detail: text("detail").notNull(),
    raw: text("raw").notNull().default(""),
    enabled: bool("enabled").notNull().default(true),
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

export interface DiaryRegionRow {
  sourceId: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  version: integer("version").notNull(),
  analyzedAt: text("analyzed_at").notNull(),
});
