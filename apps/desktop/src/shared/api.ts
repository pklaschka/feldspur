/**
 * Schnittstelle zwischen Oberfläche (Renderer) und Hauptprozess.
 * Alles hier muss sich per IPC übertragen lassen (nur JSON-artige Daten).
 */
import type {
  BackupInfo,
  ChangeStep,
  ConflictCause,
  ConflictSeverity,
  ConflictSummary,
  EvidenceComparison,
  FieldSession,
  LevelMode,
  OffsetBasis,
  Peaks,
  PlacementStatus,
  SourceKind,
} from "@feldspur/core";
import type {
  CalendarDay,
  ExportStatus,
  FileCheck,
  FileState,
  MethodsSessionSummary,
  MontagePreview,
  SessionTranscriptKind,
  ScanProgress,
} from "@feldspur/media";

/** Sicherungen des offenen Projekts (Dialog „Sicherungen“). */
export interface BackupOverview {
  /** Ordner neben der Projektdatei. */
  dir: string;
  /** Neueste zuerst. */
  backups: BackupInfo[];
  /** So viele automatische Sicherungen bleiben liegen. */
  keepAutomatic: number;
  lastAutomaticAt: string | null;
  /** Meldung, wenn die letzte automatische Sicherung fehlgeschlagen ist. */
  lastError: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  /** ISO-Zeitpunkt des letzten Öffnens. */
  openedAt: string;
  /** Datei nicht mehr da (verschoben, gelöscht, Laufwerk fehlt). */
  missing: boolean;
}

export interface ProjectInfo {
  path: string;
  name: string;
  sessions: FieldSession[];
}

/**
 * Zustand einer Quelle in der Oberfläche: wie die Zeitbestimmung (sicher, prüfen, ohne Zeit), dazu „context“ =
 * bewusst ohne Uhrzeit, steht vor der Chronologie (Issue #108). Kontext ist kein offener Punkt.
 */
export type RowStatus = PlacementStatus | "context";

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
  /** Zustand der Originaldatei (schnell geprüft: da, Größe, schon gerechnete Prüfsumme). */
  file: FileState;
  /** Zustand in Worten, z. B. „Datei nicht gefunden“. */
  fileDetail: string;
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
  /** Tagebuch: Seitenzahl im Notizbuch für das (erste) Bild; null = nicht gezählt. */
  firstPage: number | null;
  /** Tagebuch: Jedes Bild zeigt eine Doppelseite. */
  pageSpread: boolean;
  status: RowStatus;
  /** Rolle der Quelle selbst (Tagebuchseiten: immer „timeline“, sie werden über ihre Einträge Kontext). */
  role: "timeline" | "context";
  /** Tagebuchseiten: so viele Einträge der Seite sind Kontext („2 Einträge, davon 1 Kontext“). */
  contextEntries: number;
  /** Tagebuchseiten: so viele Einträge hat die Seite insgesamt. */
  entryCount: number;
  notes: string[];
  /** Widersprüche zwischen den Zeitbelegen und ob sie entschieden sind. */
  conflict: ConflictSummary;
  /** Warum der verwendete Beleg gilt („genaueste Angabe …“); leer ohne Zeitbelege. */
  basisReason: string;
  /** Entscheidung (Beleg „geprüft“), falls die Lage darauf beruht. */
  decision: DecisionRow | null;
  /** Lautstärke-Angleichung (nur Audio/Video). */
  level: LevelRow | null;
}

export interface DecisionRow {
  /** Id des Belegs „geprüft“ (zum Zurücknehmen). */
  evidenceId: string;
  /** null bei älteren Bestätigungen ohne gespeicherten Stand. */
  at: string | null;
  reason: string;
  basisKind: string;
  basisId: string | null;
  /** Der lesbare Satz, wie er im Protokoll steht. */
  detail: string;
}

/** Gleichartige Widersprüche mehrerer Dateien eines Geräts (z. B. ganze Kamera falsch gestellt). */
export interface ConflictGroupRow {
  key: string;
  deviceId: string;
  deviceLabel: string;
  /** Art des verwendeten und des widersprechenden Belegs. */
  usedKind: string;
  otherKind: string;
  sourceIds: string[];
  /** Typische Abweichung (die der ersten Datei). */
  differenceMs: number;
  severity: ConflictSeverity;
  cause: ConflictCause | null;
}

export interface LevelRow {
  mode: LevelMode;
  /** Einstellung „von Hand“. */
  manualGainDb: number;
  compress: boolean;
  /** Gemessener Sprachpegel in dBFS; null = still; undefined = noch nicht gemessen. */
  measuredDb: number | null;
  measured: boolean;
  /** Verstärkung, die gerade gilt (beim Abhören und im Montagevideo). */
  gainDb: number;
}

export interface LevelInput {
  mode: LevelMode;
  manualGainDb: number;
  compress: boolean;
}

export interface DecideInput {
  sourceId: string;
  /** Beleg, der gelten soll; null = die Lage so bestätigen, wie sie steht. */
  evidenceId: string | null;
  /** Lage, die gesehen wurde; hat sie sich verschoben, wird nichts gespeichert. */
  expectedStartMs: number;
  reason: string;
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
  /** Vergleich mit der verwendeten Lage; null bei Quellen ohne eigenen Vergleich (Folgeaufnahme, Teil einer Seite). */
  compare: EvidenceComparison | null;
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
  /** Die beiden Stellen, für den Feinabgleich. */
  a: AnchorEnd;
  b: AnchorEnd;
}

export interface AnchorEnd {
  sourceId: string;
  atMs: number;
}

/** Ergebnis von „Einrasten“: die beste Stelle in B zur Stelle in A, im Suchfenster um die bisherige. */
export interface AlignResult {
  bAtMs: number;
  /** Korrelation 0 … 1 */
  score: number;
  /** Abstand zur nächstbesten Lage (ab ca. 1,5 eindeutig). */
  distinctness: number;
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
  /** Genauigkeit in ms statt der Stufe (Feinabgleich: wenige ms). */
  uncertaintyMs?: number;
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

export interface PageNumberingInput {
  sourceId: string;
  /** Seitenzahl im Notizbuch; null = nicht zählen. */
  firstPage: number | null;
  spread: boolean;
}

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

/** Arbeitsnotiz zu einer Datei; fromMs/toMs = Stelle in der Aufnahme, null = ganze Datei. */
export interface SourceNoteRow {
  id: string;
  sourceId: string;
  fromMs: number | null;
  toMs: number | null;
  text: string;
  done: boolean;
}

export interface SourceNoteInput {
  fromMs?: number | null;
  toMs?: number | null;
  text?: string;
  done?: boolean;
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
  /** pageNo = Seitenzahl im Notizbuch (von Hand oder aus der Zählung des Scans), null = unbekannt. */
  regions: (Region & { sourceId: string; pageLabel: string; pageNo: number | null; pageNoOwn: boolean })[];
  /** Chronologie oder Kontext (Issue #108). */
  role: "timeline" | "context";
  /** Titel als Kontextstück; leer = Fundstelle. */
  title: string;
  /** Freie Angabe „Entstanden“ als Kontextstück. */
  contextMade: string;
  /** Verweise auf Kontextstücke („entry:…“, „source:…“), auch ruhende. */
  refs: string[];
  /** Stelle unter den Kontextstücken (1 … n); null = kein Kontext. */
  contextPosition: number | null;
}

/** Ein Kontextstück: bewusst ohne Uhrzeit, steht im Einsatztranskript vor der ersten Zeitmarke. */
export interface ContextRow {
  /** „entry:<id>“ oder „source:<id>“. */
  key: string;
  /** 1 … n in der Reihenfolge des Einsatztranskripts. */
  position: number;
  entryId: string | null;
  sourceId: string | null;
  /** Art der Quelle (Foto, Notiz …) bzw. „diary“ bei Tagebucheinträgen und Texten ohne Scan. */
  kind: SourceKind;
  /** Eigener Titel; leer = keiner. */
  title: string;
  /** Titel oder, ohne Titel, die Fundstelle. */
  name: string;
  /** „Tagebuch T-01 · S. 3“, „Foto F-005, IMG_0007.jpg“, „Text ohne Scan“. */
  find: string;
  personName: string;
  /** Form des Texts: Nur Scan, Kurzform, Volltext; bei Fotos „scan“, bei Notizdateien „full“. */
  mode: DiaryMode;
  /** Text, wie er im Dokument steht (Kurzform, Volltext oder der Inhalt einer Textdatei). */
  text: string;
  /** Text lässt sich hier bearbeiten (Text ohne Scan). */
  textEditable: boolean;
  /** „Entstanden“, freie Angabe. */
  made: string;
  /** Notierzeit eines Kontext-Eintrags „13:05“; null = keine. */
  notedAt: string | null;
  /** Wohin das Stück zurück in der Chronologie käme; null = dann „ohne Uhrzeit“. */
  wouldStartMs: number | null;
  /** Woraus diese Lage käme („Metadaten“, „Randnotiz“). */
  wouldStartBasis: string;
  /** Lässt sich zurück in die Chronologie holen (nicht bei Text ohne Scan). */
  canReturn: boolean;
  /** Datierte Einträge, die hierher verweisen. */
  mentionedBy: { entryId: string; number: number; notedAt: string; pageId: string | null }[];
  /** Vorschau: ganzes Bild oder Rahmen auf einer Seite; null = nichts zu zeigen. */
  thumb: { sourceId: string; region: Region | null; previewable: boolean; isPdf: boolean } | null;
}

/** Titel und „Entstanden“ eines Kontextstücks; nur gesetzte Felder werden übernommen. */
export interface ContextDetails {
  title?: string;
  made?: string;
}

export interface DiaryPatch {
  notedAt?: string;
  /** Titel als Kontextstück. */
  title?: string;
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
  /** Wie viele Quellen des Geräts eine Bestätigung („geprüft“) tragen. */
  checkedCount: number;
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
  a: AnchorEnd;
  b: AnchorEnd;
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
  /** Gleichartige Widersprüche mehrerer Dateien eines Geräts. */
  conflictGroups: ConflictGroupRow[];
  anchors: AnchorRow[];
  diary: DiaryEntryRow[];
  /** Kontextstücke in der Reihenfolge des Einsatztranskripts (Issue #108). */
  context: ContextRow[];
  /** Mitschrift aller Ton- und Videoquellen, je Quelle nach Stelle sortiert. */
  transcript: TranscriptRow[];
  /** Arbeitsnotizen zu den Dateien des Einsatzes. */
  notes: SourceNoteRow[];
  /** Standard-Bezugszeitraum des Einsatzes in Minuten. */
  diaryLookbackMin: number;
  /** null = Episoden aus (session.episodes) oder Tonspuren noch nicht analysiert */
  episodes: EpisodeRow[] | null;
  gaps: GapRow[];
  /** Anzahl der Anpassungen von Hand (Grenzen verschoben, Mini-Episoden). */
  episodeEdits: number;
  analyzedCount: number;
  avCount: number;
}

export interface ExportOutcome {
  dir: string;
  files: string[];
  durationMs: number;
}

/** Ausgabe abgebrochen: Sie gilt nicht als ausgegeben, fertige Videoabschnitte bleiben im Zwischenspeicher. */
export interface ExportCancelled {
  cancelled: true;
}

/**
 * Die Prüfung der Originale (erster Schritt der Ausgabe) hat etwas gefunden; noch ist nichts geschrieben. parent ist
 * der gewählte Ordner: „Trotzdem ausgeben“ geht mit dir = parent dorthin, ohne erneut zu fragen.
 */
export interface ExportNeedsDecision {
  originals: OriginalsCheck;
  parent: string;
}

export type ExportRunResult = ExportOutcome | ExportCancelled | ExportNeedsDecision;

export interface ExportRequestOptions {
  video: boolean;
  resolve: boolean;
  mixAudio: boolean;
  realtime: boolean;
  /** Je Gerät eine eigene Tonspur im Montagevideo. */
  deviceTracks: boolean;
  /** Viewer (.html) neben dem Montagevideo. */
  viewer: boolean;
  /** LIESMICH.html mit der Tabelle für den Methodenteil. */
  readme: boolean;
  /** Änderungsprotokoll dieses Einsatzes (…_Aenderungsprotokoll.csv). */
  changeLog: boolean;
  /** Prüfsummenliste aller Dateien (manifest-sha256.txt). */
  manifest: boolean;
  /** Ohne Ordnerdialog in den Ordner der letzten Ausgabe. */
  reuseDir?: boolean;
  /** Ohne Ordnerdialog in diesen Ordner (z. B. nach „Trotzdem ausgeben“). */
  dir?: string;
  /** Auffälligkeiten der Prüfung übergehen; fehlende Pflichtdateien halten die Ausgabe weiter an. */
  acceptOriginals?: boolean;
}

export type { ExportStatus, ExportDifference } from "@feldspur/media";

/** Erster Schritt jeder Ausgabe, nach der Ordnerwahl: Originale mit Prüfsumme prüfen (done/total in Bytes). */
export const EXPORT_CHECK_STEP = "Originale prüfen";

export interface ExportProgress {
  sessionId: string;
  step: string;
  done: number;
  total: number;
}

/** Einsatztranskript ohne Video, zur Vorschau im Schritt „Ausgeben“. */
export type { MontagePreview, PreviewMedia, PreviewPiece } from "@feldspur/media";

/** Eine Zeile der Vorschau, in Teilen, damit sie wie im .docx eingefärbt werden kann. */
export interface SessionTranscriptPreviewEntry {
  kind: SessionTranscriptKind;
  /** Zeitmarke, „#00:12:04-0#“. */
  stamp: string;
  clock: string;
  head: string;
  body: string;
}

export interface SessionTranscriptPreview {
  base: string;
  durationMs: number;
  episodes: number;
  cards: number;
  /** Jede Zeile als reiner Text, wie MAXQDA sie liest; dient auch dem Vergleich mit der letzten Ausgabe. */
  lines: string[];
  entries: SessionTranscriptPreviewEntry[];
  /** Abschnitt „Kontext“ vor der ersten Zeitmarke (Issue #108); leer = keiner. */
  context: { key: string; head: string; details: string; body: string }[];
}

/** Einsammeln abgebrochen: Nichts wurde übernommen. */
export interface ImportCancelled {
  cancelled: { read: number; total: number };
}

export type ImportResult = ImportOutcome | ImportCancelled;

/** Fortschritt beim Einsammeln (siehe ScanProgress in @feldspur/media). */
export interface ImportProgress extends ScanProgress {
  sessionId: string;
}

export interface ImportOutcome {
  added: number;
  duplicates: number;
  /** Davon: schon vorhanden, Original fehlte, jetzt mit der neuen Datei verknüpft. */
  relinked: number;
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
  /** Episoden bilden (nur auf Wunsch). */
  episodes?: boolean;
  /** Zusatzfelder für den Quellennachweis, z. B. { DOI: "10.…" }. Ersetzt alle bisherigen. */
  extra?: Record<string, string>;
}

/** Wo ein rückgängig gemachter Schritt etwas geändert hat, damit „Zeigen“ dorthin springen kann. */
export interface HistoryTarget {
  kind: "line" | "note" | "diary" | "source";
  sourceId: string;
  /** Stelle in der Datei (Mitschrift, Notiz). */
  atMs?: number;
}

/** Ergebnis einer vollständigen Prüfung der Originale (Existenz, Größe, SHA-256). */
export interface OriginalsCheck {
  checks: FileCheck[];
  /** Quellen-Ids, ohne die die Ausgabe nicht geht (fehlt, nicht lesbar). */
  blocking: string[];
  /** Quellen-Ids mit Auffälligkeiten, die die Ausgabe nicht verhindern (verändert, fehlt, wird aber nicht gebraucht). */
  warnings: string[];
}

/** Ergebnis der Suche nach fehlenden Originalen in einem Ordner. */
export interface OriginalsSearch {
  relinked: { label: string; path: string }[];
  /** Gleichnamige Dateien, die nicht passen. */
  rejected: { label: string; path: string; reason: string }[];
  /** Kurzzeichen der Quellen, die weiter fehlen. */
  stillOpen: string[];
  scanned: number;
  truncated: boolean;
}

export interface OriginalsProgress {
  sessionId: string;
  phase: "prüfen" | "suchen";
  done: number;
  /** 0 = unbekannt (beim Durchsuchen eines Ordners). */
  total: number;
  fileName: string;
}

export interface HistoryResult {
  label: string | null;
  project: ProjectInfo;
  view: SessionView | null;
  target: HistoryTarget | null;
}

/** Angaben für „Feldspur zitieren“ (Issue #163). */
export interface CitationInfo {
  /** Laufende Version der App. */
  version: string;
  /** Erscheinungsdatum dieser Version, `YYYY-MM-DD` (aus CITATION.cff beim Bauen). */
  released: string;
  /** Schon nachgeschlagene DOI dieser Version. */
  versionDoi: { doi: string; url: string; checkedAt: string } | null;
}

export type CitationLookup =
  | { state: "found"; versionDoi: { doi: string; url: string; checkedAt: string } }
  | { state: "missing" }
  | { state: "offline" }
  | { state: "cancelled" };

/**
 * Beleg-Karte nach einer Ausgabe (Issue #192): der Einsatz in wenigen gezählten Tatsachen, gezählt aus dem jetzigen
 * Stand. Gilt für den jetzigen Stand, also nur, solange die Ausgabe aktuell ist.
 */
export interface ExportCard {
  title: string;
  /** Kalendertag, "2026-09-14". */
  date: string;
  place: string;
  /** Erste und letzte Uhrzeit der Montage, "10:15"; null, wenn nichts auf der Zeitachse liegt. */
  from: string | null;
  to: string | null;
  /** Dateien des Einsatzes und Geräte, von denen sie stammen (ohne Tagebuch). */
  sources: number;
  devices: number;
  /** Zeilen des Einsatztranskripts (Chronologie). */
  lines: number;
  montageId: string;
}

/** Ein Einsatz in der Übersicht (Issue #203): seine Kennwerte, dazu die Tatsachen, die auch an seinen Reitern stehen. */
export interface OverviewSession extends MethodsSessionSummary {
  place: string;
}

/** Übersicht des Projekts (Issue #203): alle Einsätze mit ihren Kennwerten und die Angaben zur Software. */
export interface ProjectOverview {
  sessions: OverviewSession[];
  citation: CitationInfo;
}

export interface FeldspurApi {
  newProject(): Promise<ProjectInfo | null>;
  openProject(): Promise<ProjectInfo | null>;
  /** Zuletzt geöffnete Projekte, neueste zuerst. */
  recentProjects(): Promise<RecentProject[]>;
  openRecent(path: string): Promise<ProjectInfo | null>;
  forgetRecent(path: string): Promise<RecentProject[]>;
  /** Sicherungen des offenen Projekts; null ohne Projekt. */
  backups(): Promise<BackupOverview | null>;
  /** „Sicherung erstellen…“: Speichern-Dialog, gibt den Pfad zurück (null bei Abbruch). */
  createBackup(): Promise<string | null>;
  /**
   * Sicherung als neues, eigenständiges Projekt öffnen: Datei prüfen, Ziel wählen lassen, kopieren, öffnen. Ohne
   * `path` erst eine Datei wählen. Das Original wird nie überschrieben.
   */
  openBackupCopy(path?: string): Promise<ProjectInfo | null>;
  /** Sicherungsordner im Dateimanager zeigen. */
  showBackupFolder(): Promise<void>;
  /** Version, Erscheinungsdatum und gemerkte DOI der Version für „Feldspur zitieren“. Fragt nichts im Netz ab. */
  citationInfo(): Promise<CitationInfo>;
  /** DOI der laufenden Version bei Zenodo nachschlagen (nur auf Knopfdruck). */
  lookupCitationDoi(): Promise<CitationLookup>;
  cancelCitationLookup(): Promise<void>;
  /** Text in die Zwischenablage. */
  copyText(text: string): Promise<void>;
  /** Tabelle in die Zwischenablage: als HTML (für Word und Co.) und als Text für alles andere. */
  copyTable(html: string, text: string): Promise<void>;
  /** Eine Adresse bei doi.org oder zenodo.org im Browser öffnen. */
  openCitationLink(url: string): Promise<void>;
  currentProject(): Promise<ProjectInfo | null>;
  createSession(input: NewSessionInput): Promise<ProjectInfo>;
  getSession(sessionId: string): Promise<SessionView>;
  pickFiles(): Promise<string[]>;
  importPaths(sessionId: string, paths: string[]): Promise<ImportResult>;
  /** Laufendes Einsammeln abbrechen; es wird nichts übernommen. */
  cancelImport(sessionId: string): Promise<void>;
  onImportProgress(cb: (p: ImportProgress) => void): () => void;
  setReference(deviceId: string): Promise<SessionView>;
  renameDevice(deviceId: string, label: string): Promise<SessionView>;
  setDeviceUtc(deviceId: string, utc: boolean): Promise<SessionView>;
  /** Zeitzone der Geräteuhr (IANA); null = wie der Einsatz. */
  setDeviceTimeZone(deviceId: string, timeZone: string | null): Promise<SessionView>;
  /**
   * Zeitbelege aller Quellen des Geräts erneut aus den Originaldateien lesen (Metadaten, Dateiname, Kamera-Timecode).
   * Anker, Handeingaben und Entscheidungen bleiben. `changed` = Quellen mit geänderten Belegen, `missing` = Kurzzeichen
   * der Quellen, deren Original nicht zu finden war.
   */
  rereadDevice(deviceId: string): Promise<{ view: SessionView; changed: number; missing: string[] }>;
  /** Alle Bestätigungen („geprüft“, auch Entscheidungen bei Widersprüchen) an den Quellen des Geräts entfernen. */
  clearDeviceChecks(deviceId: string): Promise<SessionView>;
  updateSession(sessionId: string, patch: SessionPatch): Promise<{ view: SessionView; project: ProjectInfo }>;
  /** Einsatz samt Quellen, Belegen, Tagebuch und Mitschrift aus dem Projekt nehmen (Originaldateien bleiben). */
  deleteSession(sessionId: string): Promise<ProjectInfo>;
  /** Quelle aus dem Projekt nehmen (Originaldatei bleibt). */
  removeSource(sourceId: string): Promise<SessionView>;
  /** Quelle in ein anderes Gerät verschieben; { newLabel } legt ein neues Gerät an. */
  moveSource(sourceId: string, target: string | { newLabel: string }): Promise<SessionView>;
  mergeDevices(fromDeviceId: string, intoDeviceId: string): Promise<SessionView>;
  /** Bild als weiteren Teil einer Seite an mainId hängen; null löst es. */
  setPartOf(sourceId: string, mainId: string | null): Promise<SessionView>;
  /** Bild als Tagebuchseite oder als Foto behandeln (neues Kurzzeichen, passendes Gerät). */
  setSourceKind(sourceId: string, kind: "diary" | "photo"): Promise<SessionView>;
  /** Aufnahme als Fortsetzung von prevId markieren; null löst es. */
  setFollows(sourceId: string, prevId: string | null): Promise<SessionView>;
  /** null = Abweichung unbekannt */
  setDeviceOffset(deviceId: string, offsetMs: number | null): Promise<SessionView>;
  /** Randnotiz einer Tagebuchseite setzen ("10:12"); leer = entfernen. Erzeugt einen Eintrag über die ganze Seite. */
  setDiaryNote(sourceId: string, clock: string): Promise<SessionView>;
  /** Tonspuren analysieren (Hüllkurve, Leerlauf) und Anker vorschlagen. `cancelled`: abgebrochen, ohne Vorschläge. */
  analyze(sessionId: string): Promise<{ view: SessionView; analyzed: number; failed: string[]; cancelled?: boolean }>;
  /** Laufende Tonspur-Analyse abbrechen; schon analysierte Tonspuren bleiben gespeichert. */
  cancelAnalyze(sessionId: string): Promise<void>;
  confirmAnchor(anchorId: string): Promise<SessionView>;
  /** Mehrere Vorschläge in einem Schritt übernehmen, je Gerät den sichersten; gelöschte werden übersprungen. */
  confirmAnchors(sessionId: string, anchorIds: string[]): Promise<SessionView>;
  /** Vorschlag verwerfen oder Anker löschen. */
  rejectAnchor(anchorId: string): Promise<SessionView>;
  addTime(input: TimeInput): Promise<SessionView>;
  /** Unsichere Lage so bestätigen, wie sie zu sehen war (startMs = gesehene Lage). */
  confirmPlacement(sourceId: string, startMs: number): Promise<SessionView>;
  /** Bei widersprüchlichen Zeitbelegen entscheiden, welche Zeit gilt (evidenceId null = Lage so bestätigen). */
  decidePlacement(input: DecideInput): Promise<SessionView>;
  /** Dieselbe Entscheidung für mehrere Quellen: je Quelle gilt ihr Beleg der Art `kind`. Ein Rückgängig-Schritt. */
  decideMany(input: { sourceIds: string[]; kind: string; reason: string }): Promise<SessionView>;
  setEvidenceEnabled(evidenceId: string, enabled: boolean): Promise<SessionView>;
  removeEvidence(evidenceId: string): Promise<SessionView>;
  addAnchor(input: AnchorInput): Promise<SessionView>;
  /** Anker oder Vorschlag durch einen fein justierten Anker ersetzen. */
  replaceAnchor(anchorId: string, input: AnchorInput): Promise<SessionView>;
  /** Stelle in B suchen, die am besten zur Stelle in A passt (± searchMs um bAtMs). */
  alignRefine(input: {
    aSourceId: string;
    aAtMs: number;
    bSourceId: string;
    bAtMs: number;
    searchMs: number;
  }): Promise<AlignResult | null>;
  /** Lautstärke-Angleichung einer Quelle einstellen. */
  setLevel(sourceId: string, input: LevelInput): Promise<SessionView>;
  /** Sprachpegel einer Quelle messen (dekodiert die ganze Datei). */
  measureLevel(sourceId: string): Promise<SessionView>;
  /** Seitenzählung von Tagebuch-Scans setzen (mehrere auf einmal, z. B. beim Weiterzählen). */
  setPageNumbering(items: PageNumberingInput[]): Promise<SessionView>;
  /** Neuer Tagebucheintrag mit Rahmen; gibt die Id des Eintrags mit zurück. */
  createDiaryEntry(sourceId: string, region: Region): Promise<{ view: SessionView; entryId: string }>;
  addDiaryRegion(entryId: string, sourceId: string, region: Region): Promise<SessionView>;
  removeDiaryRegion(entryId: string, index: number): Promise<SessionView>;
  /** Rahmen verschieben oder in der Größe ändern (Seite und Seitenzahl bleiben). */
  moveDiaryRegion(entryId: string, index: number, region: Region): Promise<SessionView>;
  /** Seitenzahl im Notizbuch an einem Rahmen; null = aus der Zählung des Scans. */
  setDiaryRegionPage(entryId: string, index: number, pageNo: number | null): Promise<SessionView>;
  deleteDiaryEntry(entryId: string): Promise<SessionView>;
  patchDiaryEntry(entryId: string, patch: DiaryPatch): Promise<SessionView>;
  /** Als Kontext führen (on) oder zurück in die Chronologie; key = „source:…“ oder „entry:…“. */
  setContext(key: string, on: boolean): Promise<SessionView>;
  /** Titel und „Entstanden“ eines Kontextstücks. */
  setContextDetails(key: string, details: ContextDetails): Promise<SessionView>;
  /** Kontextstück an Stelle position (1 … n) schieben. */
  moveContext(key: string, position: number): Promise<SessionView>;
  /** Kontext einmalig nach Fundstelle ordnen. */
  sortContextByPage(sessionId: string): Promise<SessionView>;
  /** Verweise eines Tagebucheintrags auf Kontextstücke (ersetzt alle). */
  setEntryRefs(entryId: string, refs: string[]): Promise<SessionView>;
  /** Neues Kontextstück als Text ohne Scan; gibt seinen Schlüssel mit zurück. */
  createContextText(
    sessionId: string,
    input: { title: string; text: string },
  ): Promise<{ view: SessionView; key: string }>;
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
  /**
   * Waveform-Spitzen eines Ausschnitts einer Ton- oder Videoquelle (ms ab Dateianfang).
   * Dekodiert nur das Fenster; bis ca. 2 min und 4000 Fächer geht das zügig.
   */
  addSourceNote(sourceId: string, note: SourceNoteInput): Promise<SessionView>;
  updateSourceNote(noteId: string, patch: SourceNoteInput): Promise<SessionView>;
  deleteSourceNote(noteId: string): Promise<SessionView>;
  waveformPeaks(sourceId: string, fromMs: number, toMs: number, buckets: number): Promise<Peaks>;
  /** Einsatztranskript ohne Bilder und Video, wie es im Dokument stehen wird. */
  /** realtime (Standard): alles in Echtzeit; false = nach Episoden, nur wenn der Einsatz Episoden bildet. */
  previewExport(sessionId: string, realtime?: boolean): Promise<SessionTranscriptPreview>;
  /** Letzte Ausgabe im Vergleich zum jetzigen Stand und den gewählten Einstellungen; null = noch nie ausgegeben. */
  exportStatus(sessionId: string, opts: ExportRequestOptions): Promise<ExportStatus | null>;
  /** Zahlen für die Beleg-Karte nach der Ausgabe (Issue #192). */
  exportCard(sessionId: string, opts: ExportRequestOptions): Promise<ExportCard>;
  /**
   * Eine Datei der letzten Ausgabe mit dem Standardprogramm öffnen (der Viewer im Browser). Nur Dateien, die zu
   * dieser Ausgabe gehören; false, wenn es sie nicht (mehr) gibt.
   */
  openExportFile(sessionId: string, name: string): Promise<boolean>;
  /**
   * Kennwerte aller Einsätze für die Übersicht: was hineingeflossen ist, was die Ausgabe ergibt und ob sie so schon
   * vorliegt. Beschreibt den Stand im Projekt.
   */
  projectOverview(): Promise<ProjectOverview>;
  /** Feldkalender der gewählten Tage als SVG-Grafik speichern (Dialog); Pfad oder null bei Abbruch. */
  saveFieldCalendar(days: CalendarDay[]): Promise<string | null>;
  /** Ablauf der Montage zum Abspielen in der App (ohne zu rechnen). */
  montagePreview(sessionId: string, realtime?: boolean): Promise<MontagePreview>;
  /**
   * Montagevideo, Einsatztranskript und Begleitprotokoll schreiben. Ohne dir fragt die App nach einem
   * Ordner; darin entsteht ein Unterordner je Einsatz. null = kein Ordner gewählt; { cancelled } = mit
   * cancelExport abgebrochen. Mit reuseDir ohne Dialog in den Ordner der letzten Ausgabe, falls er noch
   * existiert; der Dialog beginnt sonst dort. Erster Schritt nach der Ordnerwahl ist die Prüfung der Originale;
   * findet sie etwas, kommt { originals, parent } zurück (außer acceptOriginals übergeht Auffälligkeiten).
   */
  exportSession(
    sessionId: string,
    opts: {
      video: boolean;
      resolve?: boolean;
      mixAudio?: boolean;
      realtime?: boolean;
      deviceTracks?: boolean;
      viewer?: boolean;
      dir?: string;
      reuseDir?: boolean;
      acceptOriginals?: boolean;
    },
  ): Promise<ExportRunResult | null>;
  /** Laufende Ausgabe abbrechen; ffmpeg wird beendet, die Ausgabe gilt nicht als fertig. */
  cancelExport(sessionId: string): Promise<void>;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
  /** Die Oberfläche zeichnet die Einblendungen des Montagevideos. */
  onOverlayRequest(render: (timeline: unknown, frames: unknown[]) => Promise<Uint8Array[]>): () => void;
  /** Die Oberfläche zeichnet Bildausschnitte, die ffmpeg nicht lesen kann (PDF-Seiten), als JPEG. */
  onStillRequest(render: (ref: unknown, pdf: boolean) => Promise<Uint8Array>): () => void;
  showInFolder(path: string): Promise<void>;
  onProgress(cb: (p: { done: number; total: number; fileName: string }) => void): () => void;
  /**
   * Letzten Schritt rückgängig machen bzw. wiederholen. Gibt die Beschriftung des Schritts zurück (null, wenn es
   * keinen gab), das Projekt und die Ansicht des Einsatzes, falls es ihn danach noch gibt.
   */
  undo(sessionId: string | null): Promise<HistoryResult>;
  /**
   * Grenze einer Episode verschieben (Uhrzeiten in ms). edge: "start" oder "end" der Episode, die bei fromMs endet
   * bzw. beginnt. Nach außen nimmt Feldspur die Strecke in den laufenden Aufnahmen hinzu, nach innen heraus.
   */
  moveEpisodeEdge(sessionId: string, edge: "start" | "end", fromMs: number, toMs: number): Promise<SessionView>;
  /** Kurze Episode um eine Uhrzeit (laute Stelle in der Stille), aus allen dort laufenden Aufnahmen. */
  addEpisodeAround(sessionId: string, atMs: number): Promise<SessionView>;
  /** Alle Anpassungen von Hand an den Episoden verwerfen. */
  resetEpisodes(sessionId: string): Promise<SessionView>;
  /** Hüllkurven der analysierten Tonspuren, vier Werte je Sekunde (0–250, logarithmisch). */
  envelopes(sessionId: string): Promise<Record<string, { rate: number; data: Uint8Array }>>;
  redo(sessionId: string | null): Promise<HistoryResult>;
  historyState(): Promise<{ undo: string | null; redo: string | null; serial: number }>;
  /** Dauerhaftes Änderungsprotokoll des Projekts, neueste Schritte zuerst; `before` blättert weiter zurück. */
  changeLog(opts: { limit?: number; before?: number }): Promise<ChangeStep[]>;
  /** Ganzes Änderungsprotokoll als CSV speichern (Speichern-Dialog). Gibt den Pfad zurück, null bei Abbruch. */
  exportChangeLog(): Promise<string | null>;
  /** Pfad einer per Drag & Drop abgelegten Datei. */
  pathForFile(file: File): string;
  /**
   * Alle Originale eines Einsatzes prüfen: da, Größe und SHA-256 wie beim Einsammeln. video = mit Montagevideo
   * (dann sperren auch fehlende Ton- und Videodateien die Ausgabe).
   */
  checkOriginals(sessionId: string, video: boolean): Promise<OriginalsCheck>;
  /** Ordner wählen und dort fehlende Originale suchen; nur mit passender Prüfsumme verknüpft. null = abgebrochen. */
  searchOriginals(sessionId: string): Promise<{ view: SessionView; result: OriginalsSearch } | null>;
  /** Datei für eine Quelle wählen; nur mit passender Prüfsumme verknüpft, sonst Fehler. null = abgebrochen. */
  relinkOriginal(sourceId: string): Promise<SessionView | null>;
  onOriginalsProgress(cb: (p: OriginalsProgress) => void): () => void;
}

/** Eigenes Protokoll, über das die Oberfläche Originalbilder anzeigen darf (nur lesend, nur Fotos/Scans). */
export const MEDIA_SCHEME = "feldspur-media";
export const mediaUrl = (sourceId: string) => `${MEDIA_SCHEME}://source/${encodeURIComponent(sourceId)}`;

export const IPC = {
  newProject: "project:new",
  openProject: "project:open",
  recentProjects: "project:recent",
  openRecent: "project:open-recent",
  forgetRecent: "project:forget-recent",
  backups: "backup:list",
  createBackup: "backup:create",
  openBackupCopy: "backup:open-copy",
  showBackupFolder: "backup:show-folder",
  citationInfo: "citation:info",
  lookupCitationDoi: "citation:lookup",
  cancelCitationLookup: "citation:cancel",
  copyText: "clipboard:write",
  copyTable: "clipboard:write-table",
  openCitationLink: "citation:open-link",
  currentProject: "project:current",
  createSession: "session:create",
  getSession: "session:get",
  pickFiles: "import:pick",
  importPaths: "import:paths",
  cancelImport: "import:cancel",
  importProgress: "import:progress",
  setReference: "device:set-reference",
  setDeviceUtc: "device:set-utc",
  setDeviceTimeZone: "device:set-timezone",
  rereadDevice: "device:reread",
  clearDeviceChecks: "device:clear-checks",
  renameDevice: "device:rename",
  updateSession: "session:update",
  deleteSession: "session:delete",
  removeSource: "source:remove",
  moveSource: "source:move",
  mergeDevices: "device:merge",
  setPartOf: "source:part-of",
  setSourceKind: "source:kind",
  setFollows: "source:follows",
  addTranscriptLine: "transcript:add",
  importTranscript: "transcript:import",
  updateTranscriptLine: "transcript:update",
  deleteTranscriptLine: "transcript:delete",
  waveformPeaks: "waveform:peaks",
  addSourceNote: "note:add",
  updateSourceNote: "note:update",
  deleteSourceNote: "note:delete",
  setDeviceOffset: "device:set-offset",
  setDiaryNote: "diary:set-note",
  analyze: "audio:analyze",
  cancelAnalyze: "audio:analyze-cancel",
  confirmAnchor: "anchor:confirm",
  confirmAnchors: "anchor:confirm-many",
  rejectAnchor: "anchor:reject",
  addTime: "evidence:add",
  confirmPlacement: "evidence:confirm",
  decidePlacement: "evidence:decide",
  decideMany: "evidence:decide-many",
  setEvidenceEnabled: "evidence:enable",
  removeEvidence: "evidence:remove",
  addAnchor: "anchor:add",
  replaceAnchor: "anchor:replace",
  alignRefine: "anchor:refine",
  setLevel: "level:set",
  measureLevel: "level:measure",
  setPageNumbering: "diary:page-numbering",
  createDiaryEntry: "diary:create",
  addDiaryRegion: "diary:add-region",
  removeDiaryRegion: "diary:remove-region",
  moveDiaryRegion: "diary:move-region",
  setDiaryRegionPage: "diary:region-page",
  deleteDiaryEntry: "diary:delete",
  patchDiaryEntry: "diary:patch",
  setContext: "context:set",
  setContextDetails: "context:details",
  moveContext: "context:move",
  sortContextByPage: "context:sort",
  setEntryRefs: "context:refs",
  createContextText: "context:text",
  progress: "progress",
  undo: "history:undo",
  moveEpisodeEdge: "episodes:move-edge",
  addEpisodeAround: "episodes:add-around",
  resetEpisodes: "episodes:reset",
  envelopes: "episodes:envelopes",
  redo: "history:redo",
  historyState: "history:state",
  changeLog: "history:change-log",
  exportChangeLog: "history:export-change-log",
  previewExport: "export:preview",
  exportStatus: "export:status",
  exportCard: "export:card",
  openExportFile: "export:open-file",
  projectOverview: "project:overview",
  saveFieldCalendar: "project:save-field-calendar",
  montagePreview: "export:montage",
  exportSession: "export:run",
  cancelExport: "export:cancel",
  exportProgress: "export:progress",
  overlayRequest: "overlay:request",
  overlayReply: "overlay:reply",
  stillRequest: "still:request",
  stillReply: "still:reply",
  showInFolder: "shell:show-in-folder",
  checkOriginals: "originals:check",
  searchOriginals: "originals:search",
  relinkOriginal: "originals:relink",
  originalsProgress: "originals:progress",
} as const;
