/**
 * Schnittstelle zwischen Oberfläche (Renderer) und Hauptprozess.
 * Alles hier muss sich per IPC übertragen lassen (nur JSON-artige Daten).
 */
import type { FieldSession, OffsetBasis, PlacementStatus, SourceKind } from "@feldspur/core";
import type { MontagePreview } from "@feldspur/media";

export interface ProjectInfo {
  path: string;
  name: string;
  sessions: FieldSession[];
}

export interface SourceRow {
  id: string;
  label: string;
  kind: SourceKind;
  /** Weiteres Bild einer Seite: Id der Hauptquelle. */
  partOf: string | null;
  /** Ids der weiteren Bilder dieser Seite. */
  parts: string[];
  /** Folgeaufnahme von … / fortgesetzt durch … */
  follows: string | null;
  followedBy: string | null;
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
  evidence: EvidenceRow[];
  /** Hat die Quelle einen Beleg der Geräteuhr? Nur dann lässt sich die Uhr des Geräts an ihr abgleichen. */
  hasDeviceClock: boolean;
  /** Leerlauf in echter Zeit (nur Audio/Video nach Analyse). */
  idle: { startMs: number; endMs: number }[];
  /** Laute Stellen im Leerlauf, echte Zeit. */
  loudAtMs: number[];
  /** Bild, das sich als Vorschau zeigen lässt (Foto, Scan). */
  previewable: boolean;
  /** PDF-Datei (Scan), wird mit pdf.js angezeigt. */
  isPdf: boolean;
  status: PlacementStatus;
  notes: string[];
}

export interface EvidenceRow {
  id: string;
  kind: string;
  detail: string;
  raw: string;
  chosen: boolean;
  enabled: boolean;
  /** Von Hand eingetragen (löschbar). */
  own: boolean;
  /** Aus einem Anker abgeleitet, nicht gespeichert. */
  derived: boolean;
  uncertaintyMs: number;
}

/** Bestätigter oder von Hand gesetzter Anker. */
export interface AnchorRow {
  id: string;
  kind: "clap" | "audio-correlation" | "manual";
  /** "A-01 bei 1:20 = V-01 bei 0:20" */
  description: string;
  note: string;
  /** Widerspricht anderen Belegen um so viel; null = passt. */
  conflictMs: number | null;
}

export type Precision = "exact" | "approx" | "rough";

export interface TimeInput {
  sourceId: string;
  kind: "manual" | "spoken";
  /** "10:15" oder "10:15:30" */
  clock: string;
  /** Stelle in der Aufnahme, "3:20"; leer = Anfang. */
  atMedia: string;
  precision: Precision;
  note: string;
  /**
   * Nur bei "manual": Die Uhr des Geräts danach richten, sodass alle anderen Dateien des Geräts
   * mitwandern (Abweichung = Geräteuhr dieser Datei minus eingetragene Zeit).
   */
  syncDevice?: boolean;
}

export interface AnchorInput {
  aSourceId: string;
  aAt: string;
  bSourceId: string;
  bAt: string;
  precision: Precision;
  note: string;
}

/** Rahmen auf einer Scan-Seite, relativ 0 … 1. */
export interface Region {
  /** Seite in einem mehrseitigen PDF (ab 0); bei Bildern 0 oder weggelassen. */
  page?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DiaryMode = "scan" | "short" | "full";

/** Eine Zeile Mitschrift; clockMs = Uhrzeit, solange die Quelle verortet ist. */
export interface TranscriptRow {
  id: string;
  sourceId: string;
  /** Stelle in der Aufnahme */
  atMs: number;
  clockMs: number | null;
  speaker: string;
  text: string;
}

export interface TranscriptPatch {
  atMs?: number;
  speaker?: string;
  text?: string;
}

export interface DiaryEntryRow {
  id: string;
  /** Laufende Nummer im Einsatz, nach Seite und Lage auf der Seite. */
  number: number;
  /** "10:12" oder null */
  notedAt: string | null;
  /** Bezugszeitraum, falls eine Notierzeit gesetzt ist. */
  window: { fromMs: number; toMs: number } | null;
  /** Eigener Bezugszeitraum in Minuten; null = Standard des Einsatzes. */
  lookbackMin: number | null;
  mode: DiaryMode;
  shortText: string;
  fullText: string;
  regions: (Region & { sourceId: string; pageLabel: string })[];
}

export interface DiaryPatch {
  notedAt?: string;
  lookbackMin?: number | null;
  mode?: DiaryMode;
  shortText?: string;
  fullText?: string;
}

export interface DeviceRow {
  id: string;
  label: string;
  /** Vorherrschende Quellenart, für Symbol und Farbe. */
  kind: SourceKind;
  personName: string;
  isReference: boolean;
  offsetMs: number | null;
  offsetBasis: OffsetBasis | "spoken";
  sourceCount: number;
  /** Trägt eine Datei des Geräts einen als UTC markierten Zeitstempel? Dann gibt es die Einstellung. */
  hasUtcStamps: boolean;
  /** Als UTC markierte Zeitstempel umrechnen (true) oder als Ortszeit lesen (false). */
  timestampsAreUtc: boolean;
  /** Zeitzone, auf die die Geräteuhr gestellt ist; null = wie der Einsatz. */
  timeZone: string | null;
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
  anchors: AnchorRow[];
  diary: DiaryEntryRow[];
  /** Mitschrift aller Ton- und Videoquellen, je Quelle nach Stelle sortiert. */
  transcript: TranscriptRow[];
  /** Standard-Bezugszeitraum des Einsatzes in Minuten. */
  diaryLookbackMin: number;
  /** null = Tonspuren noch nicht analysiert */
  episodes: EpisodeRow[] | null;
  gaps: GapRow[];
  analyzedCount: number;
  avCount: number;
}

export interface ExportOutcome {
  dir: string;
  files: string[];
  durationMs: number;
}

export interface ExportProgress {
  sessionId: string;
  step: string;
  done: number;
  total: number;
}

/** Zeitgerüst ohne Video, zur Vorschau im Schritt „Ausgeben“. */
export type { MontagePreview, PreviewPiece } from "@feldspur/media";

export interface ScaffoldPreview {
  base: string;
  durationMs: number;
  episodes: number;
  cards: number;
  lines: string[];
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

/** Einsatzdaten ändern; nur gesetzte Felder werden übernommen. */
export interface SessionPatch {
  title?: string;
  date?: string;
  place?: string;
  timeZone?: string;
  diaryLookbackMin?: number;
  /** Zusatzfelder für den Quellennachweis, z. B. { DOI: "10.…" }. Ersetzt alle bisherigen. */
  extra?: Record<string, string>;
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
  setDeviceUtc(deviceId: string, utc: boolean): Promise<SessionView>;
  /** Zeitzone der Geräteuhr (IANA); null = wie der Einsatz. */
  setDeviceTimeZone(deviceId: string, timeZone: string | null): Promise<SessionView>;
  updateSession(sessionId: string, patch: SessionPatch): Promise<{ view: SessionView; project: ProjectInfo }>;
  /** Quelle aus dem Projekt nehmen (Originaldatei bleibt). */
  removeSource(sourceId: string): Promise<SessionView>;
  /** Quelle in ein anderes Gerät verschieben; { newLabel } legt ein neues Gerät an. */
  moveSource(sourceId: string, target: string | { newLabel: string }): Promise<SessionView>;
  mergeDevices(fromDeviceId: string, intoDeviceId: string): Promise<SessionView>;
  /** Bild als weiteren Teil einer Seite an mainId hängen; null löst es. */
  setPartOf(sourceId: string, mainId: string | null): Promise<SessionView>;
  /** Aufnahme als Fortsetzung von prevId markieren; null löst es. */
  setFollows(sourceId: string, prevId: string | null): Promise<SessionView>;
  /** null = Abweichung unbekannt */
  setDeviceOffset(deviceId: string, offsetMs: number | null): Promise<SessionView>;
  /** Randnotiz einer Tagebuchseite setzen ("10:12"); leer = entfernen. Erzeugt einen Eintrag über die ganze Seite. */
  setDiaryNote(sourceId: string, clock: string): Promise<SessionView>;
  /** Tonspuren analysieren (Hüllkurve, Leerlauf) und Anker vorschlagen. */
  analyze(sessionId: string): Promise<{ view: SessionView; analyzed: number; failed: string[] }>;
  confirmAnchor(anchorId: string): Promise<SessionView>;
  /** Vorschlag verwerfen oder Anker löschen. */
  rejectAnchor(anchorId: string): Promise<SessionView>;
  addTime(input: TimeInput): Promise<SessionView>;
  setEvidenceEnabled(evidenceId: string, enabled: boolean): Promise<SessionView>;
  removeEvidence(evidenceId: string): Promise<SessionView>;
  addAnchor(input: AnchorInput): Promise<SessionView>;
  /** Neuer Tagebucheintrag mit Rahmen; gibt die Id des Eintrags mit zurück. */
  createDiaryEntry(sourceId: string, region: Region): Promise<{ view: SessionView; entryId: string }>;
  addDiaryRegion(entryId: string, sourceId: string, region: Region): Promise<SessionView>;
  removeDiaryRegion(entryId: string, index: number): Promise<SessionView>;
  deleteDiaryEntry(entryId: string): Promise<SessionView>;
  patchDiaryEntry(entryId: string, patch: DiaryPatch): Promise<SessionView>;
  /** Neue Zeile Mitschrift; gibt die Id mit zurück. */
  /**
   * Automatisches Transkript (.srt, .vtt, .json, .tsv, z. B. Whisper) an eine Aufnahme hängen.
   * Ohne path fragt die App nach der Datei. null = abgebrochen.
   */
  importTranscript(
    sourceId: string,
    opts: { mode: "append" | "replace"; path?: string },
  ): Promise<{ view: SessionView; count: number; dropped: number } | null>;
  addTranscriptLine(
    sourceId: string,
    line: { atMs: number; speaker: string; text: string },
  ): Promise<{ view: SessionView; lineId: string }>;
  updateTranscriptLine(lineId: string, patch: TranscriptPatch): Promise<SessionView>;
  deleteTranscriptLine(lineId: string): Promise<SessionView>;
  /** Zeitgerüst ohne Bilder und Video, wie es im Dokument stehen wird. */
  previewExport(sessionId: string): Promise<ScaffoldPreview>;
  /** Ablauf der Montage zum Abspielen in der App (ohne zu rechnen). */
  montagePreview(sessionId: string): Promise<MontagePreview>;
  /**
   * Montagevideo, Zeitgerüst und Begleitprotokoll schreiben. Ohne dir fragt die App nach einem
   * Ordner; darin entsteht ein Unterordner je Einsatz. null = abgebrochen.
   */
  exportSession(
    sessionId: string,
    opts: { video: boolean; resolve?: boolean; dir?: string },
  ): Promise<ExportOutcome | null>;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
  /** Die Oberfläche zeichnet die Einblendungen des Montagevideos. */
  onOverlayRequest(render: (timeline: unknown, frames: unknown[]) => Promise<Uint8Array[]>): () => void;
  showInFolder(path: string): Promise<void>;
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
  setDeviceUtc: "device:set-utc",
  setDeviceTimeZone: "device:set-timezone",
  renameDevice: "device:rename",
  updateSession: "session:update",
  removeSource: "source:remove",
  moveSource: "source:move",
  mergeDevices: "device:merge",
  setPartOf: "source:part-of",
  setFollows: "source:follows",
  addTranscriptLine: "transcript:add",
  importTranscript: "transcript:import",
  updateTranscriptLine: "transcript:update",
  deleteTranscriptLine: "transcript:delete",
  setDeviceOffset: "device:set-offset",
  setDiaryNote: "diary:set-note",
  analyze: "audio:analyze",
  confirmAnchor: "anchor:confirm",
  rejectAnchor: "anchor:reject",
  addTime: "evidence:add",
  setEvidenceEnabled: "evidence:enable",
  removeEvidence: "evidence:remove",
  addAnchor: "anchor:add",
  createDiaryEntry: "diary:create",
  addDiaryRegion: "diary:add-region",
  removeDiaryRegion: "diary:remove-region",
  deleteDiaryEntry: "diary:delete",
  patchDiaryEntry: "diary:patch",
  progress: "progress",
  previewExport: "export:preview",
  montagePreview: "export:montage",
  exportSession: "export:run",
  exportProgress: "export:progress",
  overlayRequest: "overlay:request",
  overlayReply: "overlay:reply",
  showInFolder: "shell:show-in-folder",
} as const;
