/**
 * Datenmodell von Feldspur.
 *
 * Projekt (.feldspur-Datei) → Einsätze → Quellen. Jede Quelle gehört zu einem Gerät,
 * jedes Gerät zu einer forschenden Person. Die Lage einer Quelle auf der Zeitachse
 * wird nie direkt gespeichert, sondern aus ihren Zeitbelegen (`TimeEvidence`),
 * der Uhrabweichung ihres Geräts und Sync-Ankern berechnet (siehe resolve.ts).
 * So bleibt jederzeit nachvollziehbar, worauf sich eine Einordnung stützt.
 */
import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Ortszeit in ms (siehe time.ts). */
const LocalMs = z.number().int();
/** Position innerhalb einer Quelle in ms ab Dateianfang. */
const MediaMs = z.number().int().nonnegative();

export const SourceKind = z.enum(["video", "audio", "photo", "diary", "note", "gps", "other"]);
export type SourceKind = z.infer<typeof SourceKind>;

/** Ein Feldeinsatz: ein Tag, ein Ort, ein späteres MAXQDA-Dokument. */
export const FieldSession = z.object({
  id: Id,
  title: z.string().min(1),
  /** Kalendertag, an dem der Einsatz beginnt, "2026-09-14". */
  date: z.iso.date(),
  place: z.string().default(""),
  /** IANA-Zeitzone des Ortes, um UTC-Zeitstempel in Ortszeit umzurechnen. */
  timeZone: z.string().default("Europe/Berlin"),
  /** Standard-Bezugszeitraum für Tagebucheinträge: so weit reicht ein Eintrag vor die Notierzeit zurück. */
  diaryLookbackMs: z
    .number()
    .int()
    .nonnegative()
    .default(15 * 60_000),
  /** Optionale Felder für den Quellennachweis (DOI, Projektnummer, …). */
  extra: z.record(z.string(), z.string()).default({}),
});
export type FieldSession = z.infer<typeof FieldSession>;

export const Person = z.object({
  id: Id,
  name: z.string().min(1),
  /** Rolle im Einsatz, z. B. "Forschende", "Hilfskraft". */
  role: z.string().default(""),
});
export type Person = z.infer<typeof Person>;

/** Woher die Uhrabweichung eines Geräts stammt. */
export const OffsetBasis = z.enum(["reference", "manual", "anchor", "unknown"]);
export type OffsetBasis = z.infer<typeof OffsetBasis>;

export const Device = z.object({
  id: Id,
  sessionId: Id,
  label: z.string().min(1),
  personId: Id.nullable().default(null),
  /** Erkennungsmerkmal beim Import (Hersteller/Modell oder Dateinamen-Familie). */
  matchKey: z.string().default(""),
  /** Die Referenzuhr des Einsatzes. Genau ein Gerät pro Einsatz sollte sie sein. */
  isReference: z.boolean().default(false),
  /**
   * Uhrabweichung: Geräteuhr minus Referenzuhr. Positiv = Gerät geht vor.
   * Kamera geht 2:47 vor → +167000. Nur gültig, wenn offsetBasis ≠ "unknown".
   */
  clockOffsetMs: z.number().int().default(0),
  clockOffsetUncertaintyMs: z.number().int().nonnegative().default(0),
  offsetBasis: OffsetBasis.default("unknown"),
  /**
   * Als UTC markierte Zeitstempel (creation_time "…Z") sind laut Format UTC und werden in die
   * Ortszeit des Einsatzes umgerechnet. Manche Kameras schreiben dort aber die Ortszeit hinein;
   * für solche Geräte false (beim Einsammeln am Dateinamen erkannt oder von Hand umgestellt).
   */
  timestampsAreUtc: z.boolean().default(true),
  /** Eigenes Dateinamen-Muster, z. B. "REC_YYYYMMDD_hhmm". */
  filenamePattern: z.string().nullable().default(null),
});
export type Device = z.infer<typeof Device>;

export const Source = z.object({
  id: Id,
  sessionId: Id,
  deviceId: Id.nullable(),
  /** Kurzzeichen im Quellennachweis: V-01, A-01, F-001, T-01. */
  label: z.string().min(1),
  kind: SourceKind,
  title: z.string().default(""),
  /** Pfad der Originaldatei zum Importzeitpunkt. Originale werden nie verändert. */
  originalPath: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Länge bei Audio/Video, sonst null (Zeitpunkt statt Strecke). */
  durationMs: z.number().int().nonnegative().nullable(),
  /** Ausgelesene technische Metadaten, unverändert zur Dokumentation. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  importedAt: z.iso.datetime(),
  /**
   * Weiteres Bild derselben Seite (z. B. Seite in zwei Fotos, Rückseite): Id der Hauptquelle.
   * Teile übernehmen Lage und Kurzzeichen der Hauptquelle.
   */
  partOf: Id.nullable().default(null),
  /**
   * Folgeaufnahme: Diese Datei setzt die genannte Aufnahme nahtlos fort (Rekorder teilt einen
   * Dauermitschnitt in mehrere Dateien). Beginn = Ende der Vorgängerdatei.
   */
  follows: Id.nullable().default(null),
});
export type Source = z.infer<typeof Source>;

/**
 * Art eines Zeitbelegs, von automatisch bis Handarbeit (Konzept: „Fünf Zeitquellen“).
 * - metadata: Datei-Metadaten (creation_time, EXIF DateTimeOriginal)
 * - filename: Uhrzeit im Dateinamen
 * - spoken: angesagte Uhrzeit („es ist jetzt halb elf“), beim Anhören markiert
 * - anchor: abgeleitet aus einem Sync-Anker zu einer bereits eingeordneten Quelle
 * - manual: von Hand auf der Zeitachse platziert; gewinnt immer
 */
export const EvidenceKind = z.enum(["metadata", "filename", "spoken", "anchor", "manual"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const TimeEvidence = z.object({
  id: Id,
  sourceId: Id,
  kind: EvidenceKind,
  /**
   * "device": Zeit stammt von der Geräteuhr und wird um deren Abweichung korrigiert.
   * "true": Zeit ist schon Referenzzeit (Ansage, manuell, Anker).
   *
   * Tagebuchseiten bekommen keine Zeitbelege: ihre Lage folgt aus den Einträgen
   * (`DiaryEntry.notedAtMs`), weil eine Seite mehrere Uhrzeiten tragen kann.
   */
  clock: z.enum(["device", "true"]),
  /** Stelle in der Quelle, für die die Zeit gilt (0 = Anfang). */
  atMediaMs: MediaMs.default(0),
  /** Ortszeit, die an dieser Stelle galt (bzw. die Geräteuhr zeigte). */
  localMs: LocalMs,
  /** Falls die Angabe als UTC markiert war: der UTC-Wert, um je nach Geräteeinstellung umzurechnen. */
  utcMs: z.number().int().nullable().default(null),
  /** ± Unsicherheit der Angabe selbst. */
  uncertaintyMs: z.number().int().nonnegative(),
  /** Menschenlesbar, woraus die Angabe stammt: "EXIF DateTimeOriginal", "Dateiname REC_…". */
  detail: z.string(),
  /** Rohwert wie gelesen, für das Begleitprotokoll. */
  raw: z.string().default(""),
  enabled: z.boolean().default(true),
});
export type TimeEvidence = z.infer<typeof TimeEvidence>;

/** „Dieser Moment in Quelle A = dieser Moment in Quelle B“. */
export const SyncAnchor = z.object({
  id: Id,
  sessionId: Id,
  kind: z.enum(["clap", "audio-correlation", "manual"]),
  a: z.object({ sourceId: Id, atMediaMs: MediaMs }),
  b: z.object({ sourceId: Id, atMediaMs: MediaMs }),
  uncertaintyMs: z.number().int().nonnegative().default(50),
  note: z.string().default(""),
  enabled: z.boolean().default(true),
  /** Automatisch gefunden und noch nicht bestätigt. Zählt erst nach Bestätigung. */
  proposed: z.boolean().default(false),
  /** Bei Vorschlägen: Eindeutigkeit 0 … 1. */
  confidence: z.number().min(0).max(1).nullable().default(null),
});
export type SyncAnchor = z.infer<typeof SyncAnchor>;

export const DiaryMode = z.enum(["scan", "short", "full"]);
export type DiaryMode = z.infer<typeof DiaryMode>;

/**
 * Ein Tagebucheintrag. Seiten (Scans) und Einträge sind zweierlei: ein Eintrag
 * liegt als Rahmen auf einer oder mehreren Seiten, eine Seite kann mehrere
 * Einträge tragen.
 */
export const DiaryEntry = z.object({
  id: Id,
  sessionId: Id,
  /** Rahmen auf Scan-Seiten, in Lesereihenfolge. Region in relativen Koordinaten 0..1. */
  regions: z
    .array(
      z.object({
        sourceId: Id,
        /** Seite innerhalb eines mehrseitigen PDF-Scans (ab 0); bei Bildern immer 0. */
        page: z.number().int().nonnegative().default(0),
        x: z.number().min(0).max(1).default(0),
        y: z.number().min(0).max(1).default(0),
        w: z.number().min(0).max(1).default(1),
        h: z.number().min(0).max(1).default(1),
      }),
    )
    .default([]),
  /** Notierzeit (Randnotiz). null = noch nicht zugeordnet. */
  notedAtMs: LocalMs.nullable(),
  /** Abweichender Bezugszeitraum für diesen Eintrag; null = Standard des Einsatzes. */
  lookbackMs: z.number().int().nonnegative().nullable().default(null),
  mode: DiaryMode.default("scan"),
  shortText: z.string().default(""),
  fullText: z.string().default(""),
});
export type DiaryEntry = z.infer<typeof DiaryEntry>;

/**
 * Eine Zeile Mitschrift zu einer Ton- oder Videoquelle. Gespeichert wird die Stelle in der Aufnahme,
 * nicht die Uhrzeit: So bleibt die Zeile richtig, wenn sich der Abgleich oder die Montage ändert.
 */
export const TranscriptLine = z.object({
  id: Id,
  sourceId: Id,
  /** Stelle in der Aufnahme in ms ab Dateibeginn. */
  atMs: z.number().int().nonnegative(),
  /** Sprecherkürzel, z. B. „B1“ oder „H“; leer = ohne Angabe. */
  speaker: z.string().default(""),
  text: z.string().default(""),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

export const Interval = z.object({ startMs: z.number().int(), endMs: z.number().int() });
export type Interval = z.infer<typeof Interval>;

/**
 * Ergebnis der Tonspur-Analyse einer Quelle (zwischengespeichert, weil das
 * Dekodieren langer Aufnahmen dauert). Zeiten in ms ab Dateianfang.
 */
export const AudioAnalysis = z.object({
  sourceId: Id,
  /** Hüllkurve, 1 Byte je Wert (siehe @feldspur/media packEnvelope). */
  envelope: z.instanceof(Uint8Array),
  envelopeRate: z.number().int().positive(),
  noiseFloorDb: z.number(),
  idle: z.array(Interval),
  loudInIdle: z.array(z.object({ atMs: z.number().int(), aboveFloorDb: z.number() })),
  /** Version des Analyseverfahrens; bei Änderung wird neu analysiert. */
  version: z.number().int(),
  analyzedAt: z.iso.datetime(),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;
