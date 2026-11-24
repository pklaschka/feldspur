/**
 * Datenmodell von Feldspur.
 *
 * Projekt (.feldspur-Datei) → Einsätze → Quellen. Jede Quelle gehört zu einem Gerät,
 * jedes Gerät zu einer forschenden Person. Die Lage einer Quelle auf der Zeitachse
 * wird nie direkt gespeichert, sondern aus ihren Zeitbelegen (`TimeEvidence`),
 * der Uhrabweichung ihres Geräts und Sync-Ankern berechnet (siehe resolve.ts).
 * So bleibt jederzeit nachvollziehbar, worauf sich eine Einordnung stützt.
 *
 * Die Zod-Schemas sind Typ und Prüfung zugleich: `packages/core/src/db/store.ts` prüft damit alles, was in die
 * Projektdatei geht oder aus ihr gelesen wird. Die Tabellen dazu stehen in `packages/core/src/db/schema.ts`. Die
 * Oberfläche erreicht die Typen über `@feldspur/core/model`.
 *
 * Deutsch ↔ Code: Einsatz = `FieldSession`, Quelle = `Source`, Gerät = `Device`, Zeitbeleg = `TimeEvidence`,
 * Anker = `SyncAnchor`, Tagebucheintrag = `DiaryEntry`, Mitschrift-Zeile = `TranscriptLine`,
 * Kontext/Chronologie = `Role`, Abweichung = `clockOffsetMs`, Bezugszeitraum = `lookbackMs`.
 */
import { z } from "zod";

/** Kennung einer Zeile in der Projektdatei. `ProjectStore` vergibt eine UUID, wenn keine mitkommt. */
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Ortszeit in ms (siehe time.ts). */
const LocalMs = z.number().int();
/** Position innerhalb einer Quelle in ms ab Dateianfang. */
const MediaMs = z.number().int().nonnegative();

/**
 * Rolle einer Quelle oder eines Tagebucheintrags: „timeline“ = gehört auf die Zeitachse (Chronologie);
 * „context“ = bewusst ohne Uhrzeit, gilt für den ganzen Tag (Karte, Personenliste, Zwischenzusammenfassung) und steht
 * im Einsatztranskript vor der ersten Zeitmarke. Zeitbelege und Notierzeit bleiben gespeichert, ruhen aber.
 */
export const Role = z.enum(["timeline", "context"]);
export type Role = z.infer<typeof Role>;

/**
 * Art einer Quelle. Bestimmt das Kurzzeichen (V, A, F, T, N, G, X; `LABEL_PREFIX` in `packages/core/src/db/store.ts`)
 * und die Form auf der Zeitachse: „video“ und „audio“ sind Strecken, alles andere Zeitpunkte. „diary“ =
 * Tagebuch-Scan (Bild oder PDF), „note“ = Textdatei, „gps“ = Wegaufzeichnung. Beim Einsammeln aus Dateiendung und
 * Namen erkannt (`packages/media/src/classify.ts`); zwischen Foto und Tagebuch-Scan lässt sich von Hand umstellen
 * (`setSourceKind` in `apps/desktop/src/main/sources.ts`).
 */
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
  /**
   * Episoden bilden (Zeiträume mit hörbarer Aufnahme, dazwischen Zwischenzeiten). Nur auf Wunsch:
   * ohne sie zeigt die Zeitachse keine Episoden und die Ausgabe läuft in Echtzeit ohne Episodenzeilen.
   */
  episodes: z.boolean().default(false),
});
export type FieldSession = z.infer<typeof FieldSession>;

/** Forschende Person, der Geräte gehören (`Device.personId`). Gilt für das ganze Projekt, nicht je Einsatz. */
export const Person = z.object({
  id: Id,
  name: z.string().min(1),
  /** Rolle im Einsatz, z. B. "Forschende", "Hilfskraft". */
  role: z.string().default(""),
});
export type Person = z.infer<typeof Person>;

/**
 * Woher die Uhrabweichung eines Geräts stammt: „reference“ = das Gerät ist die Referenzuhr, „manual“ = von Hand
 * eingetragen, „anchor“ = aus einem Anker gespeichert, „unknown“ = noch nicht abgeglichen. Abweichungen, die die
 * Zeitbestimmung aus Ankern oder Ansagen errechnet, stehen nicht hier, sondern in `DeviceClock`
 * (`packages/core/src/resolve.ts`).
 */
export const OffsetBasis = z.enum(["reference", "manual", "anchor", "unknown"]);
export type OffsetBasis = z.infer<typeof OffsetBasis>;

/**
 * Gerät (`Device`): alles mit einer eigenen Uhr, auch das Tagebuch. Gehört zu genau einem Einsatz. Hier hängt, wie
 * die Zeitstempel seiner Quellen zu lesen sind: Uhrabweichung, UTC oder Ortszeit, Zeitzone, Dateinamen-Muster.
 */
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
  /** ± Unsicherheit der Abweichung in ms. */
  clockOffsetUncertaintyMs: z.number().int().nonnegative().default(0),
  offsetBasis: OffsetBasis.default("unknown"),
  /**
   * Als UTC markierte Zeitstempel (creation_time "…Z") sind laut Format UTC und werden in die
   * Ortszeit des Einsatzes umgerechnet. Manche Kameras schreiben dort aber die Ortszeit hinein;
   * für solche Geräte false (beim Einsammeln am Dateinamen erkannt oder von Hand umgestellt).
   */
  timestampsAreUtc: z.boolean().default(true),
  /**
   * Zeitzone, auf die die Geräteuhr gestellt ist (IANA, z. B. "UTC", "America/New_York").
   * null = wie der Einsatz. Ortszeit-Belege des Geräts werden von hier in die Einsatzzeit umgerechnet.
   */
  timeZone: z.string().nullable().default(null),
  /** Eigenes Dateinamen-Muster, z. B. "REC_YYYYMMDD_hhmm". */
  filenamePattern: z.string().nullable().default(null),
});
export type Device = z.infer<typeof Device>;

/**
 * Quelle (`Source`): eine eingesammelte Originaldatei mit Prüfsumme und Kurzzeichen. Feldspur merkt sich nur den
 * Pfad und die Prüfsumme, die Datei selbst bleibt, wo sie ist. Die Lage auf der Zeitachse steht nicht hier.
 */
export const Source = z.object({
  id: Id,
  sessionId: Id,
  /** null = keinem Gerät zugeordnet; Zeiten einer Geräteuhr gelten dann als nicht abgeglichen. */
  deviceId: Id.nullable(),
  /** Kurzzeichen im Quellennachweis: V-01, A-01, F-001, T-01. */
  label: z.string().min(1),
  kind: SourceKind,
  title: z.string().default(""),
  /** Pfad der Originaldatei zum Importzeitpunkt. Originale werden nie verändert. */
  originalPath: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Prüfsumme der Originaldatei; je Einsatz eindeutig, dieselbe Datei kommt nicht zweimal hinein. */
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
  /**
   * Lautstärke beim Abhören und in der Montage (siehe level.ts): automatisch auf gleichen
   * Sprachpegel, von Hand (levelGainDb) oder unverändert. Das Original bleibt, wie es ist.
   */
  levelMode: z.enum(["auto", "manual", "off"]).default("auto"),
  levelGainDb: z.number().default(0),
  /** Leise Stellen anheben (Kompressor). */
  levelCompress: z.boolean().default(true),
  /**
   * Tagebuch-Scans: Seitenzahl im Notizbuch für das (erste) Bild; null = nicht gezählt.
   * Bei PDFs zählt jede PDF-Seite weiter. Siehe pages.ts.
   */
  firstPage: z.number().int().nullable().default(null),
  /** Tagebuch-Scans: Ein Bild zeigt eine Doppelseite (links und rechts je eine Seite). */
  pageSpread: z.boolean().default(false),
  /** Chronologie oder Kontext (siehe Role). Tagebuchseiten werden über ihre Einträge Kontext, nicht hier. */
  role: Role.default("timeline"),
  /** Gewünschte Stelle unter den Kontextstücken des Einsatzes; null = keine (dann nach Fundstelle ans Ende). */
  contextOrder: z.number().int().nullable().default(null),
  /** Freie Angabe, wann ein Kontextstück entstand („am Vorabend“). Nur Nachweis, keine Lage. */
  contextMade: z.string().default(""),
});
export type Source = z.infer<typeof Source>;

/**
 * Art eines Zeitbelegs, von automatisch bis Handarbeit (Konzept: „Fünf Zeitquellen“).
 * - metadata: Datei-Metadaten (creation_time, EXIF DateTimeOriginal)
 * - filename: Uhrzeit im Dateinamen
 * - spoken: angesagte Uhrzeit („es ist jetzt halb elf“), beim Anhören markiert
 * - anchor: abgeleitet aus einem Sync-Anker zu einer bereits eingeordneten Quelle
 * - manual: von Hand auf der Zeitachse platziert; gewinnt immer
 * - checked: eine unsichere Lage wurde geprüft und so bestätigt, wie sie war; gilt dann als sicher
 */
export const EvidenceKind = z.enum(["metadata", "filename", "spoken", "anchor", "manual", "checked"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/**
 * Bewusste Entscheidung bei widersprüchlichen Zeitbelegen. Hängt am Beleg der Art „checked“:
 * dessen Lage ist die entschiedene, hier steht, worauf sie sich stützt und was die Forscherin dabei sah.
 */
export const Decision = z.object({
  /** Wann entschieden wurde (ISO, UTC). */
  at: z.iso.datetime(),
  /** Beleg, der gelten soll; null = Lage bestätigt, ohne einen Beleg zu wählen. */
  basisId: Id.nullable(),
  /** Art des gewählten Belegs, damit der Satz auch dann noch stimmt, wenn der Beleg gelöscht ist. */
  basisKind: z.string().default(""),
  reason: z.string().default(""),
  /** Stand beim Entscheiden: Abweichung jedes Belegs von der entschiedenen Lage. */
  seen: z.array(z.object({ id: Id, kind: z.string(), differenceMs: z.number().int() })).default([]),
});
export type Decision = z.infer<typeof Decision>;

/**
 * Zeitbeleg (`TimeEvidence`): eine Angabe, wann eine Stelle einer Quelle war. Eine Quelle kann mehrere haben;
 * welcher gilt und ob sie sich widersprechen, rechnet `packages/core/src/resolve.ts` aus. Beim Einsammeln entstehen
 * die Arten „metadata“ und „filename“ (`packages/media/src/evidence.ts`); „anchor“ leitet die Zeitbestimmung selbst
 * ab und speichert es nicht; die übrigen entstehen durch Handlungen in der App.
 */
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
  /** Abgeschaltete Belege bestimmen die Lage nicht, bleiben aber gespeichert und im Vergleich sichtbar. */
  enabled: z.boolean().default(true),
  /** Nur bei kind "checked": die Entscheidung bei einem Widerspruch (ältere Bestätigungen: null). */
  decision: Decision.nullable().optional(),
});
export type TimeEvidence = z.infer<typeof TimeEvidence>;

/**
 * Anker (`SyncAnchor`): „Dieser Moment in Quelle A = dieser Moment in Quelle B“. Aus einem Anker ergibt sich die
 * Uhrabweichung eines Geräts oder direkt die Lage einer Quelle ohne eigene Zeit (`packages/core/src/resolve.ts`).
 * Vorschläge („clap“ = Klatschen, „audio-correlation“ = Tonspur-Vergleich) findet `packages/media/src/sync.ts`.
 */
export const SyncAnchor = z.object({
  id: Id,
  sessionId: Id,
  kind: z.enum(["clap", "audio-correlation", "manual"]),
  a: z.object({ sourceId: Id, atMediaMs: MediaMs }),
  b: z.object({ sourceId: Id, atMediaMs: MediaMs }),
  /** ± Unsicherheit, mit der die beiden Stellen zusammenfallen. */
  uncertaintyMs: z.number().int().nonnegative().default(50),
  note: z.string().default(""),
  enabled: z.boolean().default(true),
  /** Automatisch gefunden und noch nicht bestätigt. Zählt erst nach Bestätigung. */
  proposed: z.boolean().default(false),
  /** Bei Vorschlägen: Eindeutigkeit 0 … 1. */
  confidence: z.number().min(0).max(1).nullable().default(null),
});
export type SyncAnchor = z.infer<typeof SyncAnchor>;

/** Wie weit ein Tagebucheintrag abgetippt ist: „scan“ = nur Scan, „short“ = Kurzform, „full“ = Volltext. */
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
        /** Seitenzahl im Notizbuch, von Hand am Eintrag eingetragen; fehlt = aus der Zählung des Scans. */
        pageNo: z.number().int().nonnegative().nullable().optional(),
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
  /** Chronologie oder Kontext (siehe Role). Ein Kontext-Eintrag ohne Rahmen ist ein Text ohne Scan. */
  role: Role.default("timeline"),
  contextOrder: z.number().int().nullable().default(null),
  /** Titel, unter dem ein Kontextstück im Einsatztranskript steht („Karte 2: Standplan“); leer = Fundstelle. */
  title: z.string().default(""),
  contextMade: z.string().default(""),
  /** Verweise auf Kontextstücke: „entry:<id>“ oder „source:<id>“. Ziele, die gerade kein Kontext sind, ruhen. */
  contextRefs: z.array(z.string()).default([]),
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

/**
 * Arbeitsnotiz zu einer Datei, z. B. „ab 12:30 noch abtippen, zwei Stimmen durcheinander“.
 * Mit Strecke (fromMs/toMs, Stelle in der Aufnahme) oder ohne (gilt für die ganze Datei).
 * Notizen sind Arbeitsstand, kein Forschungsmaterial: sie gehen nicht ins Einsatztranskript.
 */
export const SourceNote = z.object({
  id: Id,
  sourceId: Id,
  /** Beginn der Strecke in ms ab Dateibeginn; null = ganze Datei. */
  fromMs: z.number().int().nonnegative().nullable().default(null),
  /** Ende der Strecke; null = nur ein Zeitpunkt (oder ganze Datei, wenn fromMs null ist). */
  toMs: z.number().int().nonnegative().nullable().default(null),
  text: z.string().default(""),
  /** Abgehakt, z. B. wenn der Abschnitt inzwischen abgetippt ist. */
  done: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type SourceNote = z.infer<typeof SourceNote>;

/**
 * Episode von Hand angepasst: eine Strecke einer Aufnahme (ms ab Dateibeginn) gehört sicher zu einer Episode
 * („include“, z. B. eine laute Stelle in der Stille) oder nicht („exclude“). Bezogen auf die Aufnahme statt auf die
 * Uhrzeit, damit die Anpassung beim späteren Abgleich der Uhren mitwandert.
 */
export const EpisodeEdit = z.object({
  id: Id,
  sourceId: Id,
  fromMs: z.number().int().nonnegative(),
  toMs: z.number().int().nonnegative(),
  mode: z.enum(["include", "exclude"]),
  createdAt: z.iso.datetime(),
});
export type EpisodeEdit = z.infer<typeof EpisodeEdit>;

/** Strecke von–bis in ms. Je nach Stelle ab Dateianfang (Tonspur-Analyse) oder als Ortszeit (Episoden). */
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
  /** Werte der Hüllkurve je Sekunde. */
  envelopeRate: z.number().int().positive(),
  /** Grundrauschen in dBFS. */
  noiseFloorDb: z.number(),
  /** Leerlauf: Strecken langer Stille. Sie zählen nicht zu Episoden (episodes.ts). */
  idle: z.array(Interval),
  /** Kurze laute Stellen innerhalb der Stille (Stimmen, Klatschen), mit dB über dem Grundrauschen. */
  loudInIdle: z.array(z.object({ atMs: z.number().int(), aboveFloorDb: z.number() })),
  /** Sprachpegel in dBFS (level.ts speechLevelDb); null = nichts Hörbares oder noch nicht berechnet. */
  speechLevelDb: z.number().nullable().default(null),
  /** Version des Analyseverfahrens; bei Änderung wird neu analysiert. */
  version: z.number().int(),
  analyzedAt: z.iso.datetime(),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;

/** Einstellungen einer Ausgabe, soweit sie das Ergebnis verändern. */
export const ExportSettings = z.object({
  /** Montagevideo mit ausgeben. */
  video: z.boolean(),
  /** Schnittliste für DaVinci Resolve (FCPXML, `packages/media/src/fcpxml.ts`). */
  resolve: z.boolean(),
  /** Ton aller Geräte mischen; false = nur der Ton der Hauptquelle. */
  mixAudio: z.boolean(),
  /** Montage in Echtzeit; false = nach Episoden geschnitten (montage.ts). */
  realtime: z.boolean(),
  /** Je Gerät eine eigene Tonspur im Montagevideo (Issue #122). Ältere Ausgaben kannten das nicht: aus. */
  deviceTracks: z.boolean().default(false),
  /** Viewer (.html) neben dem Montagevideo (Issue #122). Ältere Ausgaben kannten ihn nicht: aus. */
  viewer: z.boolean().default(false),
  /** LIESMICH.html mit der Tabelle für den Methodenteil (Issues #130, #149). Ältere Ausgaben kannten sie nicht: aus. */
  readme: z.boolean().default(false),
  /** Änderungsprotokoll des Einsatzes als CSV (Issue #204). Ältere Ausgaben kannten es nicht: aus. */
  changeLog: z.boolean().default(false),
  /** Prüfsummenliste manifest-sha256.txt (Issue #204). Ältere Ausgaben kannten sie nicht: aus. */
  manifest: z.boolean().default(false),
});
export type ExportSettings = z.infer<typeof ExportSettings>;

/**
 * Fingerabdruck einer Ausgabe, in Teilen, damit sich sagen lässt, was sich seitdem geändert hat:
 * - content: SHA-256 über alles aus der Projektdatei, was in Einsatztranskript, Variablen, Protokoll und Video eingeht
 * - originals: je Quelle Größe und Änderungszeit der Originaldatei beim Ausgeben („missing“, wenn sie fehlte)
 * - version: Verfahren des Fingerabdrucks; ein anderes zählt immer als veraltet
 * Berechnet und verglichen in `packages/media/src/export-state.ts`.
 */
export const ExportFingerprint = z.object({
  version: z.number().int(),
  content: z.string(),
  originals: z.record(z.string(), z.string()),
});
export type ExportFingerprint = z.infer<typeof ExportFingerprint>;

/** Was von der letzten Ausgabe eines Einsatzes in der Projektdatei steht. */
export const ExportRecord = z.object({
  sessionId: Id,
  exportedAt: z.iso.datetime(),
  /** Ordner, in den ausgegeben wurde. */
  dir: z.string(),
  /** Dateinamen im Ordner, ohne Pfad. */
  files: z.array(z.string()),
  /** Länge der Montage in ms. */
  durationMs: z.number().int().nonnegative(),
  options: ExportSettings,
  fingerprint: ExportFingerprint,
});
export type ExportRecord = z.infer<typeof ExportRecord>;
