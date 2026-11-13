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

export type PlacementStatus = "ok" | "check" | "unplaced";

export interface DeviceClock {
  deviceId: Id;
  /** Geräteuhr minus Referenzuhr; null = unbekannt (wird dann als 0 angenommen). */
  offsetMs: number | null;
  uncertaintyMs: number;
  /** "spoken": aus einer angesagten Uhrzeit in einer Aufnahme des Geräts (nur berechnet, nie gespeichert). */
  basis: OffsetBasis | "spoken";
  /** Bei basis "anchor": aus welchem Anker und welchem Beleg berechnet. */
  viaAnchorId?: Id;
  viaEvidenceId?: Id;
}

export interface PlacementBasis {
  /** "follows": Folgeaufnahme, beginnt am Ende der Vorgängerdatei; "part": weiteres Bild einer Seite. */
  kind: EvidenceKind | "diary" | "follows" | "part";
  evidenceId?: Id;
  detail: string;
}

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
  /** Belege, die der gewählten Lage widersprechen. */
  conflicts: { evidenceId: Id; differenceMs: number }[];
}

export interface DiaryPlacement {
  entryId: Id;
  notedAtMs: LocalMs;
  /** Beginn des Bezugszeitraums. Hier wird der Eintrag im Zeitgerüst platziert. */
  fromMs: LocalMs;
  toMs: LocalMs;
}

export interface ResolveInput {
  session: FieldSession;
  devices: Device[];
  sources: Source[];
  evidence: TimeEvidence[];
  anchors: SyncAnchor[];
  diaryEntries: DiaryEntry[];
}

export interface ResolveResult {
  placements: Map<Id, Placement>;
  deviceClocks: Map<Id, DeviceClock>;
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

/**
 * Unabhängige Fehler (Ablesefehler zweier Uhren, Anker) addieren sich nicht
 * linear, sondern als Wurzel der Quadratsumme.
 */
export function combineUncertainty(...parts: number[]): number {
  return Math.round(Math.sqrt(parts.reduce((s, p) => s + p * p, 0)));
}

const KIND_RANK: Record<EvidenceKind, number> = {
  manual: 0,
  anchor: 1,
  metadata: 2,
  filename: 3,
  spoken: 4,
};

interface Candidate {
  ev: TimeEvidence;
  startMs: number;
  uncertaintyMs: number;
  correctionMs: number;
  trusted: boolean;
}

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

function candidatesFor(
  source: Source,
  evidence: TimeEvidence[],
  device: Device | undefined,
  clock: DeviceClock | undefined,
  tz: string,
): Candidate[] {
  return evidence
    .filter((ev) => ev.enabled)
    .map((ev) => {
      const local = effectiveLocal(ev, device, tz);
      if (ev.clock === "true") {
        return { ev, startMs: local - ev.atMediaMs, uncertaintyMs: ev.uncertaintyMs, correctionMs: 0, trusted: true };
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
        startMs: local - ev.atMediaMs - offset,
        uncertaintyMs: Math.round(offsetUnc),
        correctionMs: -offset,
        trusted: known,
      };
    });
}

function pickBest(cands: Candidate[]): Candidate | undefined {
  return [...cands].sort((a, b) => {
    if ((a.ev.kind === "manual") !== (b.ev.kind === "manual")) return a.ev.kind === "manual" ? -1 : 1;
    if (a.trusted !== b.trusted) return a.trusted ? -1 : 1;
    if (a.uncertaintyMs !== b.uncertaintyMs) return a.uncertaintyMs - b.uncertaintyMs;
    return KIND_RANK[a.ev.kind] - KIND_RANK[b.ev.kind];
  })[0];
}

function placeDiaryPages(input: ResolveInput, diary: Map<Id, DiaryPlacement>, placements: Map<Id, Placement>): void {
  // Rahmen auf weiteren Bildern einer Seite zählen für die Hauptquelle.
  const pageOf = new Map(input.sources.map((x) => [x.id, x.partOf ?? x.id]));
  for (const src of input.sources) {
    if (src.kind !== "diary" || src.partOf) continue;
    const entries = input.diaryEntries.filter((e) => e.regions.some((r) => pageOf.get(r.sourceId) === src.id));
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
    });
  }
}

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
    if (e.notedAtMs === null) continue;
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

  const placeAll = () => {
    placements = new Map();
    candidates = new Map();
    for (const src of input.sources) {
      if (src.kind === "diary") continue;
      const device = src.deviceId ? deviceById.get(src.deviceId) : undefined;
      const clock = src.deviceId ? clocks.get(src.deviceId) : undefined;
      const evs = [...(evidenceBySource.get(src.id) ?? []), ...derived.filter((d) => d.sourceId === src.id)];
      const cands = candidatesFor(src, evs, device, clock, session.timeZone);
      candidates.set(src.id, cands);
      const best = pickBest(cands);
      if (!best) continue;
      const notes: string[] = [];
      const conflicts = cands
        .filter((c) => c !== best)
        .map((c) => ({ evidenceId: c.ev.id, differenceMs: c.startMs - best.startMs, c }))
        .filter(
          ({ differenceMs, c }) =>
            Math.abs(differenceMs) > combineUncertainty(best.uncertaintyMs, c.uncertaintyMs) + CONFLICT_TOLERANCE_MS,
        )
        .map(({ evidenceId, differenceMs }) => ({ evidenceId, differenceMs }));
      if (!best.trusted) notes.push(hasReference ? "Uhr weicht ab?" : "Keine Referenzuhr gewählt");
      if (best.uncertaintyMs >= 30_000 && best.uncertaintyMs < 60_000) notes.push("nur Minute");
      else if (best.uncertaintyMs > OK_UNCERTAINTY_MS) notes.push(`± ${formatDuration(best.uncertaintyMs)}`);
      for (const c of conflicts) notes.push(`Widerspruch ${formatDuration(c.differenceMs, { sign: true })}`);
      const ok = best.trusted && best.uncertaintyMs <= OK_UNCERTAINTY_MS && conflicts.length === 0;
      placements.set(src.id, {
        sourceId: src.id,
        startMs: best.startMs,
        endMs: best.startMs + (src.durationMs ?? 0),
        uncertaintyMs: best.uncertaintyMs,
        basis: { kind: best.ev.kind, evidenceId: best.ev.id, detail: best.ev.detail },
        deviceCorrectionMs: best.correctionMs,
        status: ok ? "ok" : "check",
        notes,
        conflicts,
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
        if (own && (own.basis.kind === "manual" || own.basis.kind === "spoken")) continue;
        if (own?.basis.kind === "follows" && own.startMs === prev.endMs) continue;
        placements.set(src.id, {
          sourceId: src.id,
          startMs: prev.endMs,
          endMs: prev.endMs + (src.durationMs ?? 0),
          uncertaintyMs: prev.uncertaintyMs,
          basis: { kind: "follows", detail: `Folgeaufnahme von ${prevSrc.label}` },
          deviceCorrectionMs: prev.deviceCorrectionMs,
          status: prev.status,
          notes: prev.notes.filter((n) => !n.startsWith("Widerspruch")),
          conflicts: [],
        });
        if (trustedPlacement(prevSrc.id)) chainTrusted.add(src.id);
        changed = true;
      }
      if (!changed) break;
    }
  };

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
        src,
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

  const maxRounds = input.anchors.length + 1;
  for (let round = 0; round <= maxRounds; round++) {
    placeAll();
    let changed = false;
    anchorConflicts.length = 0;
    for (const anchor of input.anchors) {
      if (!anchor.enabled || anchor.proposed) continue;
      for (const [known, other] of [
        [anchor.a, anchor.b],
        [anchor.b, anchor.a],
      ] as const) {
        const pk = trustedPlacement(known.sourceId);
        if (!pk) continue;
        const moment = pk.startMs + known.atMediaMs;
        const unc = combineUncertainty(anchor.uncertaintyMs, pk.uncertaintyMs);
        const po = trustedPlacement(other.sourceId);
        if (po) {
          const diff = po.startMs + other.atMediaMs - moment;
          if (
            Math.abs(diff) > combineUncertainty(unc, po.uncertaintyMs) + CONFLICT_TOLERANCE_MS &&
            known === anchor.a
          ) {
            anchorConflicts.push({ anchorId: anchor.id, differenceMs: diff });
          }
          continue;
        }
        const otherSrc = sourceById.get(other.sourceId);
        if (!otherSrc) continue;
        const clock = otherSrc.deviceId ? clocks.get(otherSrc.deviceId) : undefined;
        const device = otherSrc.deviceId ? deviceById.get(otherSrc.deviceId) : undefined;
        const deviceEv = pickBest(
          candidatesFor(
            otherSrc,
            (evidenceBySource.get(otherSrc.id) ?? []).filter((e) => e.clock === "device"),
            device,
            clock,
            session.timeZone,
          ),
        );
        if (clock && clock.offsetMs === null && deviceEv) {
          // Geräteuhr zeigte im Moment des Ankers:
          const deviceShows =
            effectiveLocal(deviceEv.ev, device, session.timeZone) - deviceEv.ev.atMediaMs + other.atMediaMs;
          clocks.set(clock.deviceId, {
            deviceId: clock.deviceId,
            offsetMs: deviceShows - moment,
            uncertaintyMs: combineUncertainty(unc, deviceEv.ev.uncertaintyMs),
            basis: "anchor",
            viaAnchorId: anchor.id,
            viaEvidenceId: deviceEv.ev.id,
          });
          changed = true;
        } else if (!deviceEv && !derived.some((d) => d.id === `anchor:${anchor.id}:${other.sourceId}`)) {
          derived.push({
            id: `anchor:${anchor.id}:${other.sourceId}`,
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
          });
          changed = true;
        }
      }
    }
    if (!changed) break;
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
    });
  }

  return { placements, deviceClocks: clocks, diary, derivedEvidence: derived, anchorConflicts };
}

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
