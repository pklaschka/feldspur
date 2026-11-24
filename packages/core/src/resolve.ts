/**
 * Zeitbestimmung: aus Zeitbelegen, Geräteabweichungen und Sync-Ankern die Lage
 * jeder Quelle auf der gemeinsamen Zeitachse berechnen.
 *
 * Die Rechnung ist rein (keine Datenbank, kein Dateisystem) und wird bei jeder
 * Änderung komplett neu ausgeführt. Für einen Feldtag mit einigen hundert
 * Quellen ist das schnell genug und erspart jede Cache-Logik.
 *
 * Ablauf:
 * 1. Geräte mit bekannter Abweichung (Referenzuhr, manuell, gespeicherter Anker) festlegen.
 * 2. Jede Quelle aus ihrem besten Zeitbeleg platzieren.
 * 3. Sync-Anker auswerten: Ist eine Seite sicher eingeordnet, ergibt sich daraus
 *    die Abweichung des anderen Geräts, oder (falls die andere Quelle gar keine
 *    eigene Zeit hat) direkt ihre Lage. Sie „erbt“ so die Genauigkeit.
 * 4. Wiederholen, bis sich nichts mehr ändert (Anker können Ketten bilden).
 *
 * Gehört zu „Abgleichen“ und „Durchsehen“, wird aber überall gebraucht, wo eine Lage gefragt ist: Der Hauptprozess
 * baut daraus die Ansicht eines Einsatzes (`apps/desktop/src/main/view.ts`) und prüft Änderungen
 * (`apps/desktop/src/main/edits.ts`); `packages/media` nutzt das Ergebnis für Episoden, Anker-Vorschläge und das
 * Einsatztranskript. Die Eingabe (`ResolveInput`) lädt `ProjectStore.loadResolveInput`
 * (`packages/core/src/db/store.ts`). Das Ergebnis wird nie gespeichert.
 *
 * Wörter: „Lage“ = `Placement` (Beginn und Ende einer Quelle auf der Zeitachse), „sicher“/„prüfen“ =
 * `PlacementStatus` "ok"/"check", „echte Zeit“ = Referenzzeit (`clock: "true"`), „Geräteuhr“ = `clock: "device"`.
 */
import type {
  DiaryEntry,
  Device,
  EvidenceKind,
  FieldSession,
  Id,
  OffsetBasis,
  Source,
  SyncAnchor,
  TimeEvidence,
} from "./model.ts";
import { formatDuration, localToUtc, utcToLocal, type LocalMs } from "./time.ts";

/**
 * Status einer Quelle in der Oberfläche: "ok" = sicher, "check" = prüfen. "unplaced" (ohne Lage, „zuordnen“) setzt
 * nicht diese Datei: Quellen ohne Lage fehlen in `placements`, den Status ergänzt `apps/desktop/src/main/view.ts`.
 */
export type PlacementStatus = "ok" | "check" | "unplaced";

/** Uhr eines Geräts, wie die Zeitbestimmung sie am Ende annimmt (gespeicherte oder errechnete Abweichung). */
export interface DeviceClock {
  deviceId: Id;
  /** Geräteuhr minus Referenzuhr; null = unbekannt (wird dann als 0 angenommen). */
  offsetMs: number | null;
  /** ± Unsicherheit der Abweichung. */
  uncertaintyMs: number;
  /** "spoken": aus einer angesagten Uhrzeit in einer Aufnahme des Geräts (nur berechnet, nie gespeichert). */
  basis: OffsetBasis | "spoken";
  /** Bei basis "anchor": aus welchem Anker und welchem Beleg berechnet. */
  viaAnchorId?: Id;
  viaEvidenceId?: Id;
}

/** Worauf sich eine Lage stützt; steht in der Oberfläche als Begründung neben der Quelle. */
export interface PlacementBasis {
  /** "follows": Folgeaufnahme, beginnt am Ende der Vorgängerdatei; "part": weiteres Bild einer Seite. */
  kind: EvidenceKind | "diary" | "follows" | "part";
  /** Der verwendete Zeitbeleg; fehlt bei "diary", "follows" und "part". */
  evidenceId?: Id;
  /** Menschenlesbare Herkunft, z. B. das `detail` des Belegs oder „Folgeaufnahme von A-01“. */
  detail: string;
  /** Warum gerade dieser Beleg gilt, auf Deutsch (nur bei Lagen aus Zeitbelegen). */
  reason?: string;
}

/**
 * Wie ein Zeitbeleg zur verwendeten Lage steht.
 * - "chosen": der verwendete Beleg
 * - "agrees": passt im Rahmen der Unsicherheiten
 * - "rounding": knapp darüber, typisch für Rundung (Dateiname nur minutengenau); kein Widerspruch
 * - "unsynced": echte Zeit gegen eine Geräteuhr, deren Abweichung noch unbekannt ist; erwartet, kein Widerspruch
 * - "conflict": echter Widerspruch, die Lage muss geprüft werden
 */
export type EvidenceVerdict = "chosen" | "agrees" | "rounding" | "unsynced" | "conflict";
/** Schweregrad eines Widerspruchs: "clear" (deutlich) unter fünf Minuten, "strong" (stark) ab fünf Minuten. */
export type ConflictSeverity = "clear" | "strong";
/**
 * Vermutete Ursache eines Widerspruchs (nur Hinweis, nie automatisch korrigiert):
 * "utc" = in der anderen Lesart (UTC/Ortszeit) des Geräts passen beide; "hours" = glatter Versatz um
 * Stunden oder Viertelstunden (Zeitzone, Sommerzeit?); "clock" = echte Zeit gegen eine abgeglichene Geräteuhr.
 */
export type ConflictCause = "utc" | "hours" | "clock";

/** Ein Zeitbeleg im Vergleich zur verwendeten Lage: eine Zeile der Belegliste im Inspektor. */
export interface EvidenceComparison {
  evidenceId: Id;
  kind: EvidenceKind;
  /** Beginn der Quelle, wenn dieser Beleg gälte (Ortszeit des Einsatzes, Geräteuhr korrigiert). */
  startMs: LocalMs;
  uncertaintyMs: number;
  /** Wert wie gelesen (bzw. wie die Geräteuhr ihn zeigte), an der Stelle atMediaMs. */
  readMs: LocalMs;
  /** Aus einem als UTC markierten Zeitstempel in Ortszeit umgerechnet. */
  convertedFromUtc: boolean;
  /** Angewandte Korrektur der Geräteuhr (−Abweichung); 0 bei echter Zeit. */
  correctionMs: number;
  /** startMs minus Beginn der verwendeten Lage. */
  differenceMs: number;
  /** So weit dürfen die beiden voneinander abweichen, ohne dass es auffällt. */
  allowedMs: number;
  verdict: EvidenceVerdict;
  severity?: ConflictSeverity;
  cause?: ConflictCause;
  /** Bei cause "utc": der Beleg, der in der anderen Lesart passt. */
  utcEvidenceId?: Id;
  enabled: boolean;
}

/**
 * Stand der Widersprüche einer Quelle. "decided": bewusst entschieden (Beleg „geprüft“); "stale": seit der
 * Entscheidung ist ein widersprechender Beleg dazugekommen oder hat sich verschoben, die Quelle ist wieder „prüfen“.
 */
export type ConflictState = "none" | "open" | "decided" | "stale";

/** Zusammenfassung der Widersprüche einer Quelle für Status und Hinweise. */
export interface ConflictSummary {
  state: ConflictState;
  /** Schwerster Widerspruch (offen oder entschieden); null ohne Widerspruch. */
  severity: ConflictSeverity | null;
  /** Größte Abweichung mit Vorzeichen. */
  worstMs: number;
  count: number;
  /** Bei "stale": was sich seit der Entscheidung geändert hat (wasMs null = neuer Beleg). */
  staleBecause: { evidenceId: Id; wasMs: number | null; nowMs: number }[];
}

const NO_CONFLICT: ConflictSummary = { state: "none", severity: null, worstMs: 0, count: 0, staleBecause: [] };

/**
 * Lage einer Quelle auf der Zeitachse (Ortszeit des Einsatzes, Geräteuhr schon korrigiert) samt Begründung, Status
 * und Vergleich aller Belege. Daraus baut `apps/desktop/src/main/view.ts` die Zeile der Quelle für die Oberfläche.
 */
export interface Placement {
  sourceId: Id;
  startMs: LocalMs;
  /** Gleich startMs bei Fotos; Ende des Bezugszeitraums bei Tagebuchseiten. */
  endMs: LocalMs;
  /** ± Unsicherheit der Lage. */
  uncertaintyMs: number;
  basis: PlacementBasis;
  /** Angewandte Korrektur der Geräteuhr (−Abweichung). */
  deviceCorrectionMs: number;
  status: PlacementStatus;
  /** Hinweise für die Status-Spalte, auf Deutsch. */
  notes: string[];
  /** Eingeschaltete Belege, die der gewählten Lage widersprechen. */
  conflicts: { evidenceId: Id; differenceMs: number; severity: ConflictSeverity }[];
  /** Alle Zeitbelege der Quelle im Vergleich zur gewählten Lage (auch abgeschaltete), der verwendete zuerst. */
  comparison: EvidenceComparison[];
  conflict: ConflictSummary;
}

/** Lage eines Tagebucheintrags: Notierzeit und der Bezugszeitraum davor (fromMs … toMs, toMs = Notierzeit). */
export interface DiaryPlacement {
  entryId: Id;
  notedAtMs: LocalMs;
  /** Beginn des Bezugszeitraums. Hier wird der Eintrag im Einsatztranskript platziert. */
  fromMs: LocalMs;
  toMs: LocalMs;
}

/** Alles, was die Zeitbestimmung eines Einsatzes braucht, unverändert aus der Projektdatei. */
export interface ResolveInput {
  session: FieldSession;
  devices: Device[];
  sources: Source[];
  evidence: TimeEvidence[];
  anchors: SyncAnchor[];
  diaryEntries: DiaryEntry[];
}

/**
 * Ein Kontextstück: eine Quelle oder ein Tagebucheintrag in der Rolle „Kontext“. Es hat keine Lage, steht aber in
 * einer festen Reihenfolge vor der Chronologie. Berechnet, nie gespeichert (gespeichert ist nur die Wunschstelle).
 */
export interface ContextItem {
  /** „entry:<id>“ oder „source:<id>“, stabil; so verweisen Tagebucheinträge darauf. */
  key: string;
  entryId?: Id;
  sourceId?: Id;
  /** 1 … n in der Reihenfolge des Einsatztranskripts. */
  position: number;
  /** Notierzeit eines Kontext-Eintrags als Angabe; sie platziert nichts. */
  notedAtMs: LocalMs | null;
  /** Wo das Stück läge, käme es zurück in die Chronologie; null = dann „ohne Uhrzeit“. */
  wouldStartMs: LocalMs | null;
  /** Datierte Einträge, die auf das Stück verweisen, nach Notierzeit. */
  mentionedBy: { entryId: Id; notedAtMs: LocalMs }[];
}

/** Schlüssel eines Kontextstücks bilden, wie er in `DiaryEntry.contextRefs` steht. */
export const contextKey = {
  entry: (id: Id) => `entry:${id}`,
  source: (id: Id) => `source:${id}`,
};

/** Ergebnis der Zeitbestimmung eines Einsatzes. Quellen ohne Lage fehlen in `placements`. */
export interface ResolveResult {
  /** Kontextstücke in der Reihenfolge der Ausgabe (leer, wenn es keine gibt). */
  context: ContextItem[];
  /** Je Quelle (Schlüssel: Quellen-Id). Kontext-Quellen sind nicht enthalten. */
  placements: Map<Id, Placement>;
  /** Je Gerät (Schlüssel: Geräte-Id). */
  deviceClocks: Map<Id, DeviceClock>;
  /** Je datiertem Tagebucheintrag der Chronologie (Schlüssel: Eintrags-Id). */
  diary: Map<Id, DiaryPlacement>;
  /** Aus Ankern abgeleitete Belege (nicht gespeichert, nur berechnet). */
  derivedEvidence: TimeEvidence[];
  /** Widersprüche zwischen Ankern und bereits sicheren Lagen. */
  anchorConflicts: { anchorId: Id; differenceMs: number }[];
}

/** Ab dieser Unsicherheit gilt eine Lage nicht mehr als „sicher“. */
export const OK_UNCERTAINTY_MS = 2_000;
/** Belege dürfen um ihre Unsicherheiten plus diese Toleranz abweichen, ohne als Widerspruch zu gelten. */
const CONFLICT_TOLERANCE_MS = 1_000;
/** Rundung: höchstens so viel über der erlaubten Abweichung … */
const ROUNDING_EXTRA_MS = 5_000;
/** … und nie mehr als eine Minute insgesamt. */
const ROUNDING_MAX_MS = 60_000;
/** Ab dieser Abweichung ist ein Widerspruch „stark“ (wie die Episodengrenze bei Stille). */
export const STRONG_CONFLICT_MS = 5 * 60_000;
const QUARTER_HOUR = 15 * 60_000;

/** Grenze, bis zu der eine Abweichung noch als Rundung gilt. */
export function roundingLimit(allowedMs: number): number {
  return Math.min(ROUNDING_MAX_MS, Math.max(allowedMs + ROUNDING_EXTRA_MS, 2 * allowedMs));
}

/**
 * Abweichung eines Belegs von der verwendeten Lage einordnen.
 * Rundung: höchstens 5 s über der erlaubten Abweichung oder bis zu ihrem Doppelten, nie mehr als 60 s. So stören
 * weder ein minutengenauer Dateiname, der die Minute aufgerundet hat, noch ein Dateiname, den die Kamera erst
 * beim Schließen der Datei geschrieben hat.
 */
export function assessDeviation(
  differenceMs: number,
  allowedMs: number,
): { verdict: "agrees" | "rounding" | "conflict"; severity?: ConflictSeverity; hours?: boolean } {
  const d = Math.abs(differenceMs);
  if (d <= allowedMs) return { verdict: "agrees" };
  if (d <= roundingLimit(allowedMs)) return { verdict: "rounding" };
  const severity: ConflictSeverity = d >= STRONG_CONFLICT_MS ? "strong" : "clear";
  // Glatter Versatz nur, wenn die Angaben genau genug sind, dass ein Raster überhaupt auffallen kann.
  const rest = d % QUARTER_HOUR;
  const hours =
    allowedMs <= 2 * 60_000 &&
    d >= 30 * 60_000 &&
    d <= 14 * 3_600_000 &&
    Math.min(rest, QUARTER_HOUR - rest) <= Math.max(allowedMs, 30_000);
  return hours ? { verdict: "conflict", severity, hours } : { verdict: "conflict", severity };
}

/** Art eines Belegs als Wort für die Begründung (`choiceReason`). */
const KIND_SENTENCE: Record<EvidenceKind, string> = {
  metadata: "Metadaten",
  filename: "Dateiname",
  spoken: "angesagte Uhrzeit",
  anchor: "Anker",
  manual: "Handeingabe",
  checked: "Entscheidung",
};

/** Genauigkeit in Worten: „sekundengenau“, „nur Minute“, „auf 15 Minuten genau“. */
export function precisionText(uncertaintyMs: number): string {
  if (uncertaintyMs < 1_500) return "sekundengenau";
  if (uncertaintyMs === 30_000) return "nur Minute";
  if (uncertaintyMs < 60_000) return `auf ${Math.round(uncertaintyMs / 1000)} Sekunden genau`;
  if (uncertaintyMs < 3_600_000) {
    const min = Math.round(uncertaintyMs / 60_000);
    return min === 1 ? "auf 1 Minute genau" : `auf ${min} Minuten genau`;
  }
  return `auf ${formatDuration(uncertaintyMs)} genau`;
}

/**
 * Unabhängige Fehler (Ablesefehler zweier Uhren, Anker) addieren sich nicht
 * linear, sondern als Wurzel der Quadratsumme.
 */
export function combineUncertainty(...parts: number[]): number {
  return Math.round(Math.sqrt(parts.reduce((s, p) => s + p * p, 0)));
}

/** Vorrang der Arten bei sonst gleich guten Belegen (kleiner gewinnt); letztes Kriterium in `pickBest`. */
const KIND_RANK: Record<EvidenceKind, number> = {
  checked: 0,
  manual: 0,
  anchor: 1,
  metadata: 2,
  filename: 3,
  spoken: 4,
};

/** Ein Zeitbeleg, umgerechnet in einen möglichen Beginn der Quelle. */
interface Candidate {
  ev: TimeEvidence;
  /** Ortszeit laut Beleg (Lesart und Zeitzone der Geräteuhr angewandt, Abweichung noch nicht). */
  local: number;
  /** Beginn der Quelle, wenn dieser Beleg gälte (Abweichung der Geräteuhr abgezogen). */
  startMs: number;
  uncertaintyMs: number;
  correctionMs: number;
  /** Echte Zeit oder Geräteuhr mit bekannter Abweichung. Nur solche Lagen sind ohne Bestätigung „sicher“. */
  trusted: boolean;
}

/** Schritt 1: Uhren aus den gespeicherten Angaben der Geräte. */
function initialClocks(devices: Device[]): Map<Id, DeviceClock> {
  const clocks = new Map<Id, DeviceClock>();
  for (const d of devices) {
    if (d.isReference) {
      clocks.set(d.id, { deviceId: d.id, offsetMs: 0, uncertaintyMs: 0, basis: "reference" });
    } else if (d.offsetBasis === "manual" || d.offsetBasis === "anchor") {
      clocks.set(d.id, {
        deviceId: d.id,
        offsetMs: d.clockOffsetMs,
        uncertaintyMs: d.clockOffsetUncertaintyMs,
        basis: d.offsetBasis,
      });
    } else {
      clocks.set(d.id, { deviceId: d.id, offsetMs: null, uncertaintyMs: 0, basis: "unknown" });
    }
  }
  return clocks;
}

/**
 * Ortszeit des Einsatzes laut Geräteuhr: als UTC markierte Stempel je nach Geräteeinstellung umgerechnet,
 * Ortszeit-Stempel aus der Zeitzone der Geräteuhr in die des Einsatzes.
 */
export function effectiveLocal(ev: TimeEvidence, device: Device | undefined, tz: string): number {
  if (ev.utcMs !== null && device?.timestampsAreUtc) return utcToLocal(ev.utcMs, tz);
  if (ev.clock === "device" && device?.timeZone && device.timeZone !== tz)
    return utcToLocal(localToUtc(ev.localMs, device.timeZone), tz);
  return ev.localMs;
}

/** Belege einer Quelle in Kandidaten umrechnen; `withDisabled` nimmt abgeschaltete für den Vergleich mit. */
function candidatesFor(
  evidence: TimeEvidence[],
  device: Device | undefined,
  clock: DeviceClock | undefined,
  tz: string,
  withDisabled = false,
): Candidate[] {
  const cands = evidence
    .filter((ev) => withDisabled || ev.enabled)
    .map((ev): Candidate => {
      const local = effectiveLocal(ev, device, tz);
      if (ev.clock === "true") {
        return {
          ev,
          local,
          startMs: local - ev.atMediaMs,
          uncertaintyMs: ev.uncertaintyMs,
          correctionMs: 0,
          trusted: true,
        };
      }
      const known = clock?.offsetMs != null;
      const offset = clock?.offsetMs ?? 0;
      // Wurde die Abweichung aus genau diesem Beleg berechnet, hebt sich dessen Ablesefehler auf.
      const offsetUnc =
        clock?.viaEvidenceId === ev.id
          ? Math.sqrt(Math.max(0, clock.uncertaintyMs ** 2 - ev.uncertaintyMs ** 2))
          : combineUncertainty(clock?.uncertaintyMs ?? 0, ev.uncertaintyMs);
      return {
        ev,
        local,
        startMs: local - ev.atMediaMs - offset,
        uncertaintyMs: Math.round(offsetUnc),
        correctionMs: -offset,
        trusted: known,
      };
    });
  return followBasis(cands);
}

/**
 * Eine Bestätigung („geprüft“, auch eine entschiedene Abwägung) hält fest, welchem Beleg die Lage folgt. Hängt dieser
 * Beleg an der Geräteuhr, wandert die bestätigte Lage mit, wenn die Uhr später genauer abgeglichen wird (etwa über
 * einen Feinabgleich): Bestätigt war der Beleg, nicht eine feste Uhrzeit.
 */
function followBasis(cands: Candidate[]): Candidate[] {
  return cands.map((c) => {
    const d = c.ev.kind === "checked" ? c.ev.decision : null;
    if (!d?.basisId) return c;
    const basis = cands.find((b) => b.ev.id === d.basisId && b.ev.enabled && b.ev.clock === "device");
    if (!basis) return c;
    const seenMs = d.seen.find((x) => x.id === d.basisId)?.differenceMs ?? 0;
    return { ...c, startMs: basis.startMs - seenMs, local: basis.startMs - seenMs, uncertaintyMs: basis.uncertaintyMs };
  });
}

/**
 * Den Beleg wählen, der gilt: bestätigt, dann von Hand, dann vertrauenswürdig vor unabgeglichen, dann der genaueste,
 * zuletzt nach Art (`KIND_RANK`).
 */
function pickBest(cands: Candidate[]): Candidate | undefined {
  return cands.toSorted((a, b) => {
    // Bestätigt vor von Hand: eine neue Handeingabe entfernt die Bestätigung (apps/desktop/src/main/edits.ts).
    for (const k of ["checked", "manual"] as const)
      if ((a.ev.kind === k) !== (b.ev.kind === k)) return a.ev.kind === k ? -1 : 1;
    if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
    if (a.uncertaintyMs !== b.uncertaintyMs) return a.uncertaintyMs - b.uncertaintyMs;
    return KIND_RANK[a.ev.kind] - KIND_RANK[b.ev.kind];
  })[0];
}

const dateText = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

/** Warum gerade dieser Beleg gilt, als Satzteil („genaueste Angabe (sekundengenau statt nur Minute)“). */
function choiceReason(best: Candidate, cands: Candidate[]): string {
  if (best.ev.kind === "checked")
    return best.ev.decision ? `deine Entscheidung vom ${dateText(best.ev.decision.at)}` : "von dir geprüft";
  const others = cands.filter((c) => c !== best);
  if (!others.length) return "einziger Zeitbeleg";
  if (best.ev.kind === "manual") return "von Hand eingetragen, das geht vor gelesenen Zeiten";
  const next = pickBest(others)!;
  if (best.trusted && !next.trusted) return "einzige Angabe, die nicht an einer unabgeglichenen Uhr hängt";
  if (best.uncertaintyMs < next.uncertaintyMs) {
    const [a, b] = [precisionText(best.uncertaintyMs), precisionText(next.uncertaintyMs)];
    return a === b ? `etwas genauer als ${KIND_SENTENCE[next.ev.kind]}` : `genaueste Angabe (${a} statt ${b})`;
  }
  if (best.ev.kind !== next.ev.kind)
    return `bei gleicher Genauigkeit gehen ${KIND_SENTENCE[best.ev.kind]} vor ${KIND_SENTENCE[next.ev.kind]}`;
  return "erste von gleich guten Angaben";
}

/**
 * Jeden Beleg (auch abgeschaltete) mit dem verwendeten vergleichen.
 * Stammen beide von derselben Geräteuhr, hebt sich die Unsicherheit der Uhrabweichung auf: Es zählt nur die
 * Ableseunsicherheit der beiden Belege.
 */
function compareEvidence(
  best: Candidate,
  all: Candidate[],
  device: Device | undefined,
  clock: DeviceClock | undefined,
  tz: string,
): EvidenceComparison[] {
  const alt = device ? { ...device, timestampsAreUtc: !device.timestampsAreUtc } : undefined;
  // Beginn in der anderen Lesart UTC/Ortszeit; null, wenn der Beleg keinen UTC-Stempel trägt.
  const altStart = (c: Candidate) =>
    c.ev.utcMs !== null && alt ? c.startMs + (effectiveLocal(c.ev, alt, tz) - c.local) : null;
  const out = all.map((c): EvidenceComparison => {
    const base = {
      evidenceId: c.ev.id,
      kind: c.ev.kind,
      startMs: c.startMs,
      uncertaintyMs: c.uncertaintyMs,
      readMs: c.ev.localMs,
      convertedFromUtc: c.ev.utcMs !== null && !!device?.timestampsAreUtc,
      correctionMs: c.correctionMs,
      differenceMs: c.startMs - best.startMs,
      enabled: c.ev.enabled,
    };
    if (c.ev.id === best.ev.id) return { ...base, allowedMs: 0, verdict: "chosen" };
    const sameClock = c.ev.clock === "device" && best.ev.clock === "device";
    const allowedMs =
      (sameClock
        ? combineUncertainty(c.ev.uncertaintyMs, best.ev.uncertaintyMs)
        : combineUncertainty(c.uncertaintyMs, best.uncertaintyMs)) + CONFLICT_TOLERANCE_MS;
    const a = assessDeviation(base.differenceMs, allowedMs);
    if (a.verdict !== "conflict") return { ...base, allowedMs, verdict: a.verdict };
    // Echte Zeit gegen eine Uhr mit unbekannter Abweichung: genau das ist zu erwarten.
    if (c.trusted !== best.trusted) return { ...base, allowedMs, verdict: "unsynced" };
    const res: EvidenceComparison = { ...base, allowedMs, verdict: "conflict", severity: a.severity! };
    const limit = roundingLimit(allowedMs);
    const cAlt = altStart(c);
    const bAlt = altStart(best);
    if (cAlt !== null && Math.abs(cAlt - best.startMs) <= limit)
      return { ...res, cause: "utc", utcEvidenceId: c.ev.id };
    if (bAlt !== null && Math.abs(c.startMs - bAlt) <= limit)
      return { ...res, cause: "utc", utcEvidenceId: best.ev.id };
    if (a.hours) return { ...res, cause: "hours" };
    const mixed = (c.ev.clock === "true") !== (best.ev.clock === "true");
    if (mixed && clock && clock.basis !== "unknown") return { ...res, cause: "clock" };
    return res;
  });
  return out.toSorted((x, y) => Number(y.verdict === "chosen") - Number(x.verdict === "chosen"));
}

/** Widersprüche zusammenfassen und eine Entscheidung (Beleg „geprüft“) gegen den heutigen Stand prüfen. */
function summarizeConflicts(best: Candidate, comparison: EvidenceComparison[]): ConflictSummary {
  const live = comparison.filter((c) => c.enabled && c.verdict === "conflict");
  const checked = best.ev.kind === "checked";
  const decision = checked ? best.ev.decision : null;
  const staleBecause: ConflictSummary["staleBecause"] = [];
  if (decision) {
    for (const c of live) {
      const seen = decision.seen.find((x) => x.id === c.evidenceId);
      if (!seen) staleBecause.push({ evidenceId: c.evidenceId, wasMs: null, nowMs: c.differenceMs });
      else if (Math.abs(seen.differenceMs - c.differenceMs) > c.allowedMs)
        staleBecause.push({ evidenceId: c.evidenceId, wasMs: seen.differenceMs, nowMs: c.differenceMs });
    }
  }
  if (!live.length) return NO_CONFLICT;
  const worst = live.reduce((w, c) => (Math.abs(c.differenceMs) > Math.abs(w.differenceMs) ? c : w));
  return {
    state: staleBecause.length ? "stale" : checked ? "decided" : "open",
    severity: live.some((c) => c.severity === "strong") ? "strong" : "clear",
    worstMs: worst.differenceMs,
    count: live.length,
    staleBecause,
  };
}

/**
 * Tagebuchseiten (Scans) haben keine eigenen Zeitbelege: Sie liegen dort, wo ihre datierten Einträge notiert
 * wurden.
 */
function placeDiaryPages(input: ResolveInput, diary: Map<Id, DiaryPlacement>, placements: Map<Id, Placement>): void {
  // Rahmen auf weiteren Bildern einer Seite zählen für die Hauptquelle.
  const pageOf = new Map(input.sources.map((x) => [x.id, x.partOf ?? x.id]));
  for (const src of input.sources) {
    if (src.kind !== "diary" || src.partOf) continue;
    // Kontext-Einträge legen eine Seite nicht fest und fehlen auch nicht: Sie gehören nicht in die Chronologie.
    const entries = input.diaryEntries.filter(
      (e) => e.role !== "context" && e.regions.some((r) => pageOf.get(r.sourceId) === src.id),
    );
    const placed = entries.map((e) => diary.get(e.id)).filter((p): p is DiaryPlacement => !!p);
    if (placed.length === 0) continue; // bleibt „zuordnen“
    const missing = entries.length - placed.length;
    placements.set(src.id, {
      sourceId: src.id,
      // Seiten stehen dort, wo notiert wurde; der Bezugszeitraum gehört zum einzelnen Eintrag.
      startMs: Math.min(...placed.map((p) => p.notedAtMs)),
      endMs: Math.max(...placed.map((p) => p.notedAtMs)),
      uncertaintyMs: 60_000,
      basis: {
        kind: "diary",
        detail: placed.length === 1 ? "Randnotiz im Tagebuch" : `${placed.length} Randnotizen im Tagebuch`,
      },
      deviceCorrectionMs: 0,
      status: missing ? "check" : "ok",
      notes: missing ? [`${missing} Eintrag ohne Uhrzeit`] : [],
      conflicts: [],
      comparison: [],
      conflict: NO_CONFLICT,
    });
  }
}

/**
 * Die Zeitbestimmung eines Einsatzes (Ablauf siehe Dateikopf). Rein: gleiche Eingabe, gleiches Ergebnis, nichts
 * wird gespeichert oder verändert.
 */
export function resolveTimeline(input: ResolveInput): ResolveResult {
  const { session } = input;
  const deviceById = new Map(input.devices.map((d) => [d.id, d]));
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const clocks = initialClocks(input.devices);
  const derived: TimeEvidence[] = [];
  const hasReference = input.devices.some((d) => d.isReference);

  // Tagebucheinträge hängen nur an der Notierzeit, nicht an Geräten.
  const diary = new Map<Id, DiaryPlacement>();
  for (const e of input.diaryEntries) {
    if (e.notedAtMs === null || e.role === "context") continue;
    const back = e.lookbackMs ?? session.diaryLookbackMs;
    diary.set(e.id, { entryId: e.id, notedAtMs: e.notedAtMs, fromMs: e.notedAtMs - back, toMs: e.notedAtMs });
  }

  const evidenceBySource = new Map<Id, TimeEvidence[]>();
  for (const ev of input.evidence) {
    const list = evidenceBySource.get(ev.sourceId) ?? [];
    list.push(ev);
    evidenceBySource.set(ev.sourceId, list);
  }

  let placements = new Map<Id, Placement>();
  let candidates = new Map<Id, Candidate[]>();
  const anchorConflicts: { anchorId: Id; differenceMs: number }[] = [];

  // Schritt 2: alle Quellen (außer Tagebuchseiten) mit den Uhren von jetzt neu legen.
  const placeAll = () => {
    placements = new Map();
    candidates = new Map();
    for (const src of input.sources) {
      if (src.kind === "diary") continue;
      const device = src.deviceId ? deviceById.get(src.deviceId) : undefined;
      const clock = src.deviceId ? clocks.get(src.deviceId) : undefined;
      const evs = [...(evidenceBySource.get(src.id) ?? []), ...derived.filter((d) => d.sourceId === src.id)];
      const all = candidatesFor(evs, device, clock, session.timeZone, true);
      const cands = all.filter((c) => c.ev.enabled);
      candidates.set(src.id, cands);
      const best = pickBest(cands);
      if (!best) continue;
      const comparison = compareEvidence(best, all, device, clock, session.timeZone);
      const conflict = summarizeConflicts(best, comparison);
      const conflicts = comparison
        .filter((c) => c.enabled && c.verdict === "conflict")
        .map((c) => ({ evidenceId: c.evidenceId, differenceMs: c.differenceMs, severity: c.severity! }));
      const notes: string[] = [];
      if (!best.trusted) notes.push(hasReference ? "Uhr weicht ab?" : "Keine Referenzuhr gewählt");
      if (best.uncertaintyMs >= 30_000 && best.uncertaintyMs < 60_000) notes.push("nur Minute");
      else if (best.uncertaintyMs > OK_UNCERTAINTY_MS) notes.push(`± ${formatDuration(best.uncertaintyMs)}`);
      for (const c of conflicts) notes.push(`Widerspruch ${formatDuration(c.differenceMs, { sign: true })}`);
      if (conflict.state === "stale") notes.unshift("Entscheidung neu prüfen");
      // Geprüft heißt: Die Forscherin hat die Lage gesehen und für richtig befunden. Hinweise bleiben stehen.
      const checked = best.ev.kind === "checked";
      if (checked) notes.unshift("geprüft");
      const ok =
        (checked && conflict.state !== "stale") ||
        (best.trusted && best.uncertaintyMs <= OK_UNCERTAINTY_MS && conflicts.length === 0);
      placements.set(src.id, {
        sourceId: src.id,
        startMs: best.startMs,
        endMs: best.startMs + (src.durationMs ?? 0),
        uncertaintyMs: best.uncertaintyMs,
        basis: {
          kind: best.ev.kind,
          evidenceId: best.ev.id,
          detail: best.ev.detail,
          reason: choiceReason(best, cands),
        },
        deviceCorrectionMs: best.correctionMs,
        status: ok ? "ok" : "check",
        notes,
        conflicts,
        comparison,
        conflict,
      });
    }
    chainFollowUps();
  };

  // Folgeaufnahmen: Beginn = Ende der Vorgängerdatei. Eigene Handeingaben und angesagte Zeiten gehen vor.
  const chainTrusted = new Set<Id>();
  const chainFollowUps = () => {
    chainTrusted.clear();
    const pending = input.sources.filter((x) => x.follows && x.kind !== "diary");
    for (let round = 0; round < pending.length; round++) {
      let changed = false;
      for (const src of pending) {
        const prev = placements.get(src.follows!);
        const prevSrc = sourceById.get(src.follows!);
        if (!prev || !prevSrc || prevSrc.durationMs === null) continue;
        const own = placements.get(src.id);
        if (own && (own.basis.kind === "manual" || own.basis.kind === "spoken" || own.basis.kind === "checked"))
          continue;
        if (own?.basis.kind === "follows" && own.startMs === prev.endMs) continue;
        placements.set(src.id, {
          sourceId: src.id,
          startMs: prev.endMs,
          endMs: prev.endMs + (src.durationMs ?? 0),
          uncertaintyMs: prev.uncertaintyMs,
          basis: { kind: "follows", detail: `Folgeaufnahme von ${prevSrc.label}` },
          deviceCorrectionMs: prev.deviceCorrectionMs,
          status: prev.status,
          notes: prev.notes.filter(
            (n) => !n.startsWith("Widerspruch") && n !== "geprüft" && n !== "Entscheidung neu prüfen",
          ),
          conflicts: [],
          comparison: [],
          conflict: NO_CONFLICT,
        });
        if (trustedPlacement(prevSrc.id)) chainTrusted.add(src.id);
        changed = true;
      }
      if (!changed) break;
    }
  };

  // Lage, auf die sich ein Anker stützen darf: Ihr Beleg ist vertrauenswürdig (bei Folgeaufnahmen zählt die
  // Vorgängerdatei).
  const trustedPlacement = (sourceId: Id): Placement | undefined => {
    const p = placements.get(sourceId);
    if (!p) return undefined;
    if (p.basis.kind === "follows") return chainTrusted.has(sourceId) ? p : undefined;
    const c = candidates.get(sourceId)?.find((x) => x.ev.id === p.basis.evidenceId);
    return c?.trusted ? p : undefined;
  };

  // Angesagte Uhrzeiten („es ist zehn Uhr fünfzehn“) gleichen die Uhr des Geräts ab,
  // wenn dieselbe Aufnahme auch eine Zeit der Geräteuhr trägt.
  for (const src of input.sources) {
    const clock = src.deviceId ? clocks.get(src.deviceId) : undefined;
    if (!clock || clock.offsetMs !== null) continue;
    const evs = (evidenceBySource.get(src.id) ?? []).filter((e) => e.enabled);
    const spoken = evs
      .filter((e) => e.kind === "spoken" && e.clock === "true")
      .sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0];
    const device = deviceById.get(src.deviceId!);
    const deviceEv = pickBest(
      candidatesFor(
        evs.filter((e) => e.clock === "device"),
        device,
        clock,
        session.timeZone,
      ),
    );
    if (!spoken || !deviceEv) continue;
    const deviceShows =
      effectiveLocal(deviceEv.ev, device, session.timeZone) - deviceEv.ev.atMediaMs + spoken.atMediaMs;
    clocks.set(clock.deviceId, {
      deviceId: clock.deviceId,
      offsetMs: deviceShows - spoken.localMs,
      uncertaintyMs: combineUncertainty(spoken.uncertaintyMs, deviceEv.ev.uncertaintyMs),
      basis: "spoken",
      viaEvidenceId: deviceEv.ev.id,
    });
  }

  // Woraus eine über Anker abgeleitete Uhr stammt: die Geräte, an deren Uhr die bekannte Seite des Ankers hing (auch
  // über mehrere Anker hinweg). Ändert sich eine dieser Uhren, wird die abgeleitete neu berechnet (Issue #228): sonst
  // bliebe ein Foto an der alten Schätzung einer Kamera hängen, die ein zweiter Anker inzwischen korrigiert hat.
  const before = new Map(clocks);
  const via = new Map<Id, Set<Id>>();
  /** Geräte, von deren Uhr die Lage einer Quelle abhängt (leer, wenn ihr Beleg die wahre Uhrzeit nennt). */
  const derivedFrom = new Map<Id, Set<Id>>();
  const dependsOn = (sourceId: Id, ev: TimeEvidence | undefined): Set<Id> => {
    // Ein aus einem Anker abgeleiteter Beleg hängt an dem, woran die andere Seite jenes Ankers hing.
    const fromAnchor = ev ? derivedFrom.get(ev.id) : undefined;
    if (fromAnchor) return new Set([...fromAnchor].flatMap((d) => [d, ...(via.get(d) ?? [])]));
    const deviceId = sourceById.get(sourceId)?.deviceId;
    if (!deviceId || ev?.clock === "true") return new Set();
    return new Set([deviceId, ...(via.get(deviceId) ?? [])]);
  };
  const setClock = (c: DeviceClock, from: Set<Id>) => {
    clocks.set(c.deviceId, c);
    via.set(c.deviceId, from);
    for (const [id, deps] of via)
      if (id !== c.deviceId && deps.has(c.deviceId)) {
        clocks.set(id, before.get(id)!);
        via.delete(id);
      }
  };

  // Schritte 3 und 4. Die Schleife endet, sobald eine Runde nichts mehr ändert; die Obergrenze ist nur eine
  // Sicherung, falls sich Uhren gegenseitig immer wieder verschieben.
  const maxRounds = 4 * (input.anchors.length + input.devices.length) + 4;
  for (let round = 0; round <= maxRounds; round++) {
    placeAll();
    let changed = false;
    anchorConflicts.length = 0;
    // Nach jeder geänderten Uhr neu legen: Die Lagen dieser Runde stammen noch von der alten Uhr. Abgeleitete Belege
    // sammelt eine Runde dagegen wie bisher, sonst kostete jeder einzelne eine ganze Runde.
    anchors: for (const anchor of input.anchors) {
      if (!anchor.enabled || anchor.proposed) continue;
      for (const [known, other] of [
        [anchor.a, anchor.b],
        [anchor.b, anchor.a],
      ] as const) {
        const pk = trustedPlacement(known.sourceId);
        if (!pk) continue;
        const moment = pk.startMs + known.atMediaMs;
        const unc = combineUncertainty(anchor.uncertaintyMs, pk.uncertaintyMs);
        const otherSrc = sourceById.get(other.sourceId);
        if (!otherSrc) continue;
        const clock = otherSrc.deviceId ? clocks.get(otherSrc.deviceId) : undefined;
        const po = trustedPlacement(other.sourceId);
        // Liegt die andere Aufnahme nur über eine angesagte Uhrzeit ihres Geräts (auf die Minute genau),
        // gilt der Anker: Er verbindet zwei Stellen auf Bruchteile einer Sekunde, die Ansage nicht.
        // Auch eine Bestätigung, die einem Beleg der Geräteuhr folgt (followBasis), hängt an dieser Uhr.
        const otherCands = candidates.get(other.sourceId) ?? [];
        const usedEv = po ? otherCands.find((c) => c.ev.id === po.basis.evidenceId)?.ev : undefined;
        const followedId = usedEv?.kind === "checked" ? usedEv.decision?.basisId : undefined;
        const onDeviceClock =
          usedEv?.clock === "device" ||
          (!!followedId && otherCands.some((c) => c.ev.id === followedId && c.ev.clock === "device"));
        const viaSpokenClock = po !== undefined && clock?.basis === "spoken" && onDeviceClock;
        const device = otherSrc.deviceId ? deviceById.get(otherSrc.deviceId) : undefined;
        const deviceEv = pickBest(
          candidatesFor(
            (evidenceBySource.get(otherSrc.id) ?? []).filter((e) => e.clock === "device"),
            device,
            clock,
            session.timeZone,
          ),
        );
        // Eine von Hand eingetragene Abweichung ist eine Schätzung in ganzen Sekunden. Ein Anker misst dieselbe Uhr
        // an einer Stelle genau nach und geht deshalb vor, sofern die Aufnahme eine Zeit dieser Uhr trägt. Die
        // Eingabe bleibt gespeichert und gilt wieder, sobald der Anker entfernt ist.
        // Hängt die bekannte Seite selbst an einer geschätzten Uhr, gleicht der Anker nur ab (sonst schöben sich zwei
        // geschätzte Uhren gegenseitig).
        const knownSrc = sourceById.get(known.sourceId);
        const knownClock = knownSrc?.deviceId ? clocks.get(knownSrc.deviceId) : undefined;
        const knownEv = candidates.get(known.sourceId)?.find((c) => c.ev.id === pk.basis.evidenceId)?.ev;
        const from = dependsOn(known.sourceId, knownEv);
        // Auch eine Uhr, die nur über Anker an einer geschätzten Uhr hängt, ist geschätzt.
        const knownOnManual =
          (knownEv?.clock !== "true" && knownClock?.basis === "manual") ||
          [...from].some((d) => clocks.get(d)?.basis === "manual");
        // Hängt die bekannte Seite selbst an der Uhr des anderen Geräts, misst der Anker nichts Neues.
        const circular = !!otherSrc.deviceId && from.has(otherSrc.deviceId);
        const overManual = clock?.basis === "manual" && !!deviceEv && !knownOnManual && !circular;
        const refines = viaSpokenClock || overManual;
        // Liegt die andere Aufnahme über den Beleg, den dieser Anker selbst abgeleitet hat, ist das kein Widerspruch:
        // Der Beleg wandert unten mit der bekannten Seite mit (#228, Foto ohne eigene Zeit).
        const ownDerived = !deviceEv && po?.basis.evidenceId === `anchor:${anchor.id}:${other.sourceId}`;
        if (po && !refines && !ownDerived) {
          const diff = po.startMs + other.atMediaMs - moment;
          if (
            Math.abs(diff) > combineUncertainty(unc, po.uncertaintyMs) + CONFLICT_TOLERANCE_MS &&
            known === anchor.a
          ) {
            anchorConflicts.push({ anchorId: anchor.id, differenceMs: diff });
          }
          continue;
        }
        if (clock && (clock.offsetMs === null || refines) && deviceEv) {
          // Geräteuhr zeigte im Moment des Ankers:
          const deviceShows =
            effectiveLocal(deviceEv.ev, device, session.timeZone) - deviceEv.ev.atMediaMs + other.atMediaMs;
          if (circular) continue;
          setClock(
            {
              deviceId: clock.deviceId,
              offsetMs: deviceShows - moment,
              uncertaintyMs: combineUncertainty(unc, deviceEv.ev.uncertaintyMs),
              basis: "anchor",
              viaAnchorId: anchor.id,
              viaEvidenceId: deviceEv.ev.id,
            },
            from,
          );
          changed = true;
          break anchors;
        } else if (!deviceEv) {
          // Abgeleiteter Beleg für eine Aufnahme ohne eigene Zeit; liegt die bekannte Seite inzwischen anders (ihre Uhr
          // wurde nachgemessen), wandert er mit.
          const id = `anchor:${anchor.id}:${other.sourceId}`;
          const existing = derived.find((d) => d.id === id);
          derivedFrom.set(id, from);
          if (existing) {
            if (existing.localMs === moment && existing.uncertaintyMs === unc) continue;
            existing.localMs = moment;
            existing.uncertaintyMs = unc;
            changed = true;
            continue;
          }
          derived.push({
            id,
            sourceId: other.sourceId,
            kind: "anchor",
            clock: "true",
            atMediaMs: other.atMediaMs,
            localMs: moment,
            utcMs: null,
            uncertaintyMs: unc,
            detail: `${anchorLabel(anchor.kind)} mit ${sourceById.get(known.sourceId)?.label ?? "?"}`,
            raw: "",
            enabled: true,
            decision: null,
          });
          // Kein Neustart der Runde: Ein neuer Beleg ändert keine Uhr; die nächste Runde legt mit ihm neu.
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Ein widersprüchlicher Anker heißt: Eine der beiden Aufnahmen liegt falsch (oft eine Folgeaufnahme an der falschen
  // Stelle der Kette). Welche, weiß Feldspur nicht; beide kommen deshalb auf „prüfen“. Eine Bestätigung bleibt stehen.
  for (const c of anchorConflicts) {
    const anchor = input.anchors.find((a) => a.id === c.anchorId);
    if (!anchor) continue;
    for (const id of [anchor.a.sourceId, anchor.b.sourceId]) {
      const p = placements.get(id);
      if (!p || p.basis.kind === "checked") continue;
      const note = `Anker widerspricht um ${formatDuration(Math.abs(c.differenceMs))}`;
      placements.set(id, { ...p, status: "check", notes: p.notes.includes(note) ? p.notes : [...p.notes, note] });
    }
  }

  placeDiaryPages(input, diary, placements);
  // Weitere Bilder einer Seite liegen genau dort, wo die Hauptquelle liegt.
  for (const src of input.sources) {
    if (!src.partOf) continue;
    const main = placements.get(src.partOf);
    const mainSrc = sourceById.get(src.partOf);
    if (!main || !mainSrc) {
      placements.delete(src.id);
      continue;
    }
    placements.set(src.id, {
      ...main,
      sourceId: src.id,
      basis: { kind: "part", detail: `Teil von ${mainSrc.label}` },
      conflicts: [],
      comparison: [],
      conflict: NO_CONFLICT,
    });
  }

  // Kontext-Quellen verlassen die Zeitachse. Ihre Lage bleibt nur als Rückweg gemerkt; Teile folgen der Hauptquelle.
  const wouldStart = new Map<Id, LocalMs>();
  for (const src of input.sources) {
    const main = src.partOf ? sourceById.get(src.partOf) : src;
    if (main?.role !== "context" || main.kind === "diary") continue;
    const p = placements.get(src.id);
    if (p && !src.partOf) wouldStart.set(src.id, p.startMs);
    placements.delete(src.id);
  }

  return {
    context: contextItems(input, diary, wouldStart),
    placements,
    deviceClocks: clocks,
    diary,
    derivedEvidence: derived,
    anchorConflicts,
  };
}

// Sortiert hinter jedes echte Kurzzeichen.
const LAST = "\uffff";
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Sortierschlüssel nach Fundstelle: Kurzzeichen der Seite, weiteres Bild, PDF-Seite, Lage auf der Seite. */
function findKey(input: ResolveInput, item: { entryId?: Id; sourceId?: Id }): string {
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  // Wie im Notizbuch: erst das Tagebuch nach Seite und Lage, dann Fotos und Notizen nach Kurzzeichen.
  if (item.sourceId) return `1:${byId.get(item.sourceId)?.label ?? LAST}`;
  const e = input.diaryEntries.find((x) => x.id === item.entryId);
  const first = e?.regions[0];
  if (!first) return LAST; // Text ohne Scan: nach allem mit Fundstelle
  const src = byId.get(first.sourceId);
  const main = src?.partOf ? byId.get(src.partOf) : src;
  return `0:${main?.label ?? LAST}:${src?.partOf ? src.label : ""}:${String(first.page).padStart(4, "0")}:${first.y.toFixed(4)}:${first.x.toFixed(4)}`;
}

/** Kontextstücke des Einsatzes in Ausgabereihenfolge: gewünschte Stelle, dann Fundstelle. */
export function contextItems(
  input: ResolveInput,
  diary: Map<Id, DiaryPlacement>,
  wouldStart: Map<Id, LocalMs> = new Map(),
): ContextItem[] {
  type Raw = Omit<ContextItem, "position" | "mentionedBy"> & { order: number | null; find: string };
  const raw: Raw[] = [];
  for (const s of input.sources) {
    if (s.role !== "context" || s.partOf || s.kind === "diary") continue;
    const it = { key: contextKey.source(s.id), sourceId: s.id };
    raw.push({
      ...it,
      notedAtMs: null,
      wouldStartMs: wouldStart.get(s.id) ?? null,
      order: s.contextOrder,
      find: findKey(input, it),
    });
  }
  for (const e of input.diaryEntries) {
    if (e.role !== "context") continue;
    const it = { key: contextKey.entry(e.id), entryId: e.id };
    raw.push({
      ...it,
      notedAtMs: e.notedAtMs,
      wouldStartMs: e.notedAtMs,
      order: e.contextOrder,
      find: findKey(input, it),
    });
  }
  raw.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byCode(a.find, b.find) || byCode(a.key, b.key));
  const mentions = new Map<string, { entryId: Id; notedAtMs: LocalMs }[]>();
  for (const e of input.diaryEntries) {
    const dp = diary.get(e.id);
    if (!dp) continue;
    for (const k of new Set(e.contextRefs))
      mentions.set(k, [...(mentions.get(k) ?? []), { entryId: e.id, notedAtMs: dp.notedAtMs }]);
  }
  return raw.map(({ order: _o, find: _f, ...r }, i) => ({
    ...r,
    position: i + 1,
    mentionedBy: (mentions.get(r.key) ?? []).toSorted((a, b) => a.notedAtMs - b.notedAtMs),
  }));
}

/** Art eines Ankers als Wort für das `detail` eines abgeleiteten Belegs. */
function anchorLabel(kind: SyncAnchor["kind"]): string {
  switch (kind) {
    case "clap":
      return "Sync-Signal";
    case "audio-correlation":
      return "Tonspur-Vergleich";
    case "manual":
      return "Anker";
  }
}
