/**
 * Migrationen der Projektdatei. Jede Stufe läuft genau einmal, gesteuert über
 * `PRAGMA user_version`. Bestehende Stufen nie ändern, nur neue anhängen:
 * Projektdateien leben jahrelang in Forschungsarchiven.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: Grundmodell
  `
  CREATE TABLE project_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    time_zone TEXT NOT NULL,
    diary_lookback_ms INTEGER NOT NULL,
    extra TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE persons (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT '');
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    match_key TEXT NOT NULL DEFAULT '',
    is_reference INTEGER NOT NULL DEFAULT 0,
    clock_offset_ms INTEGER NOT NULL DEFAULT 0,
    clock_offset_uncertainty_ms INTEGER NOT NULL DEFAULT 0,
    offset_basis TEXT NOT NULL DEFAULT 'unknown',
    timestamps_are_utc INTEGER NOT NULL DEFAULT 0,
    filename_pattern TEXT
  );
  CREATE INDEX devices_session ON devices(session_id);
  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    original_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    duration_ms INTEGER,
    metadata TEXT NOT NULL DEFAULT '{}',
    imported_at TEXT NOT NULL
  );
  CREATE INDEX sources_session ON sources(session_id);
  CREATE UNIQUE INDEX sources_session_sha ON sources(session_id, sha256);
  CREATE UNIQUE INDEX sources_session_label ON sources(session_id, label);
  CREATE TABLE time_evidence (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    clock TEXT NOT NULL,
    at_media_ms INTEGER NOT NULL DEFAULT 0,
    local_ms INTEGER NOT NULL,
    utc_ms INTEGER,
    uncertainty_ms INTEGER NOT NULL,
    detail TEXT NOT NULL,
    raw TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX evidence_source ON time_evidence(source_id);
  CREATE TABLE sync_anchors (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    a_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    a_at_media_ms INTEGER NOT NULL,
    b_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    b_at_media_ms INTEGER NOT NULL,
    uncertainty_ms INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX anchors_session ON sync_anchors(session_id);
  CREATE TABLE diary_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    regions TEXT NOT NULL DEFAULT '[]',
    noted_at_ms INTEGER,
    lookback_ms INTEGER,
    mode TEXT NOT NULL DEFAULT 'scan',
    short_text TEXT NOT NULL DEFAULT '',
    full_text TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX diary_session ON diary_entries(session_id);
  `,
  // 2: Anker-Vorschläge, Tonspur-Analyse
  `
  ALTER TABLE sync_anchors ADD COLUMN proposed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sync_anchors ADD COLUMN confidence REAL;
  CREATE TABLE audio_analysis (
    source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    envelope BLOB NOT NULL,
    envelope_rate INTEGER NOT NULL,
    noise_floor_db REAL NOT NULL,
    idle TEXT NOT NULL DEFAULT '[]',
    loud_in_idle TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL,
    analyzed_at TEXT NOT NULL
  );
  `,
  // 3: Seiten aus mehreren Bildern, Folgeaufnahmen
  `
  ALTER TABLE sources ADD COLUMN part_of TEXT REFERENCES sources(id) ON DELETE SET NULL;
  ALTER TABLE sources ADD COLUMN follows TEXT REFERENCES sources(id) ON DELETE SET NULL;
  `,
  // 4: Mitschrift
  `
  CREATE TABLE transcript_lines (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    at_ms INTEGER NOT NULL,
    speaker TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX transcript_source ON transcript_lines(source_id, at_ms);
  `,
  // 5: Als UTC markierte Zeitstempel standardmäßig als UTC lesen. Die Einstellung war bisher
  // nicht in der Oberfläche erreichbar, also hat niemand sie bewusst gesetzt.
  `
  UPDATE devices SET timestamps_are_utc = 1;
  `,
];
