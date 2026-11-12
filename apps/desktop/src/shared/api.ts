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
  status: PlacementStatus;
  notes: string[];
}

export interface DeviceRow {
  id: string;
  label: string;
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

export const IPC = {
  newProject: "project:new",
  openProject: "project:open",
  currentProject: "project:current",
  createSession: "session:create",
  getSession: "session:get",
  pickFiles: "import:pick",
  importPaths: "import:paths",
  setReference: "device:set-reference",
  setDeviceOffset: "device:set-offset",
  setDiaryNote: "diary:set-note",
  analyze: "audio:analyze",
  confirmAnchor: "anchor:confirm",
  rejectAnchor: "anchor:reject",
  progress: "progress",
} as const;
