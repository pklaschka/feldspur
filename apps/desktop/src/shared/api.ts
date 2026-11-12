/**
 * Schnittstelle zwischen Oberfläche (Renderer) und Hauptprozess.
 * Alles hier muss sich per IPC übertragen lassen (nur JSON-artige Daten).
 */
import type { FieldSession, OffsetBasis, PlacementStatus, SourceKind } from "@feldspur/core";

export interface ProjectInfo {
  path: string;
  name: string;
  sessions: FieldSession[];
}

export interface SourceRow {
  id: string;
  label: string;
  kind: SourceKind;
  fileName: string;
  deviceId: string | null;
  deviceLabel: string;
  personName: string;
  /** „Zeit erkannt aus“ */
  basis: string;
  startMs: number | null;
  endMs: number | null;
  correctionMs: number;
  /** Nur Tagebuchseiten: Notierzeit "hh:mm" des ersten Eintrags. */
  diaryNote: string | null;
  /** Nur Tagebuchseiten: Bezugszeitraum (Beginn, Notierzeit). */
  diaryWindow: { fromMs: number; toMs: number } | null;
  durationMs: number | null;
  sizeBytes: number;
  sha256: string;
  originalPath: string;
  /** ± Unsicherheit der Lage in ms. */
  uncertaintyMs: number | null;
  /** Alle Zeitbelege, der gewählte zuerst. */
  evidence: { kind: string; detail: string; raw: string; chosen: boolean; enabled: boolean }[];
  /** Leerlauf in echter Zeit (nur Audio/Video nach Analyse). */
  idle: { startMs: number; endMs: number }[];
  /** Laute Stellen im Leerlauf, echte Zeit. */
  loudAtMs: number[];
  /** Bild, das sich als Vorschau zeigen lässt (Foto, Scan). */
  previewable: boolean;
  status: PlacementStatus;
  notes: string[];
}

export interface DeviceRow {
  id: string;
  label: string;
  /** Vorherrschende Quellenart, für Symbol und Farbe. */
  kind: SourceKind;
  personName: string;
  isReference: boolean;
  offsetMs: number | null;
  offsetBasis: OffsetBasis;
  sourceCount: number;
}

export interface ProposalRow {
  anchorId: string;
  sourceLabel: string;
  fileName: string;
  refLabel: string;
  /** "Klatschen bei 0:20 ↔ A-01 bei 1:20" */
  description: string;
  note: string;
  confidence: number | null;
  /** Daraus folgende Abweichung des Geräts, z. B. "+2:47". */
  impliedOffset: string | null;
  /** Dieselbe Abweichung in ms, für die Skala. */
  impliedOffsetMs: number | null;
  deviceId: string | null;
  deviceLabel: string;
}

export interface EpisodeRow {
  index: number;
  startMs: number;
  endMs: number;
  sourceLabels: string[];
}

export interface GapRow {
  startMs: number;
  endMs: number;
  /** Fotos, Tagebuch in der Zwischenzeit. */
  itemLabels: string[];
  /** Laute Stellen im Leerlauf (Wachhund), als Uhrzeiten. */
  loudAtMs: number[];
}

export interface SessionView {
  session: FieldSession;
  rows: SourceRow[];
  /** Alle Geräte, auch ohne eigene Uhr (Tagebuch). */
  allDevices: DeviceRow[];
  /** Geräte mit Uhr, die abgeglichen werden müssen. */
  devices: DeviceRow[];
  proposals: ProposalRow[];
  /** null = Tonspuren noch nicht analysiert */
  episodes: EpisodeRow[] | null;
  gaps: GapRow[];
  analyzedCount: number;
  avCount: number;
}

export interface ImportOutcome {
  added: number;
  duplicates: number;
  warnings: { fileName: string; message: string }[];
  view: SessionView;
}

export interface NewSessionInput {
  title: string;
  date: string;
  place: string;
}

export interface FeldspurApi {
  newProject(): Promise<ProjectInfo | null>;
  openProject(): Promise<ProjectInfo | null>;
  currentProject(): Promise<ProjectInfo | null>;
  createSession(input: NewSessionInput): Promise<ProjectInfo>;
  getSession(sessionId: string): Promise<SessionView>;
  pickFiles(): Promise<string[]>;
  importPaths(sessionId: string, paths: string[]): Promise<ImportOutcome>;
  setReference(deviceId: string): Promise<SessionView>;
  renameDevice(deviceId: string, label: string): Promise<SessionView>;
  /** null = Abweichung unbekannt */
  setDeviceOffset(deviceId: string, offsetMs: number | null): Promise<SessionView>;
  /** Randnotiz einer Tagebuchseite setzen ("10:12"); leer = entfernen. Erzeugt einen Eintrag über die ganze Seite. */
  setDiaryNote(sourceId: string, clock: string): Promise<SessionView>;
  /** Tonspuren analysieren (Hüllkurve, Leerlauf) und Anker vorschlagen. */
  analyze(sessionId: string): Promise<{ view: SessionView; analyzed: number; failed: string[] }>;
  confirmAnchor(anchorId: string): Promise<SessionView>;
  rejectAnchor(anchorId: string): Promise<SessionView>;
  onProgress(cb: (p: { done: number; total: number; fileName: string }) => void): () => void;
  /** Pfad einer per Drag & Drop abgelegten Datei. */
  pathForFile(file: File): string;
}

/** Eigenes Protokoll, über das die Oberfläche Originalbilder anzeigen darf (nur lesend, nur Fotos/Scans). */
export const MEDIA_SCHEME = "feldspur-media";
export const mediaUrl = (sourceId: string) => `${MEDIA_SCHEME}://source/${encodeURIComponent(sourceId)}`;

export const IPC = {
  newProject: "project:new",
  openProject: "project:open",
  currentProject: "project:current",
  createSession: "session:create",
  getSession: "session:get",
  pickFiles: "import:pick",
  importPaths: "import:paths",
  setReference: "device:set-reference",
  renameDevice: "device:rename",
  setDeviceOffset: "device:set-offset",
  setDiaryNote: "diary:set-note",
  analyze: "audio:analyze",
  confirmAnchor: "anchor:confirm",
  rejectAnchor: "anchor:reject",
  progress: "progress",
} as const;
