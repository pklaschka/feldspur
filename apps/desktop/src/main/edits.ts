/**
 * Änderungen, die Forschende von Hand machen: Uhrzeiten eintragen, angesagte
 * Uhrzeiten markieren, Belege abschalten, Anker setzen. Ohne Electron, damit
 * sich das direkt testen lässt.
 */
import {
  combineUncertainty,
  effectiveLocal,
  formatClock,
  formatDuration,
  LEVEL_MANUAL_RANGE_DB,
  localMs,
  resolveTimeline,
  type Decision,
  type Id,
  type ProjectStore,
} from "@feldspur/core";
import { kindHolds, kindName, kindVerb } from "../shared/conflict-text.ts";
import type { AnchorInput, DecideInput, LevelInput, PageNumberingInput, TimeInput } from "../shared/api.ts";

/** ± je Genauigkeitsstufe. */
export const PRECISION_MS = { exact: 1_000, approx: 60_000, rough: 15 * 60_000 } as const;

/**
 * Uhrzeit "10:15", "10:15:30" oder "10.15" in Stunde/Minute/Sekunde zerlegen und auf Bereiche prüfen
 * (Stunde 0–23, Minute und Sekunde 0–59). Mit `seconds: false` sind keine Sekunden erlaubt.
 */
export function parseClock(text: string, opts: { seconds?: boolean } = {}): { h: number; mi: number; se: number } {
  const seconds = opts.seconds ?? true;
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(text.trim());
  const format = seconds ? "hh:mm oder hh:mm:ss" : "hh:mm";
  if (!m || (!seconds && m[3] !== undefined)) throw new Error(`„${text}“ ist keine gültige Uhrzeit (${format}).`);
  const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || se > 59) throw new Error(`„${text}“ ist keine gültige Uhrzeit (${format}).`);
  return { h, mi, se };
}

/** "10:15", "10:15:30", "10.15" → Ortszeit am Tag des Einsatzes. */
export function parseClockOnDate(date: string, text: string, opts: { seconds?: boolean } = {}): number {
  const { h, mi, se } = parseClock(text, opts);
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return localMs(y, mo, d, h, mi, se);
}

/** Stelle in einer Aufnahme: "3:20", "1:03:20", "200" (Sekunden), leer = Anfang. */
export function parseMediaPos(text: string): number {
  const t = text.trim().replace(",", ".");
  if (!t) return 0;
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) throw new Error(`Stelle bitte als m:ss oder h:mm:ss, nicht „${text}“`);
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Math.round(secs * 1000);
}

/**
 * Aus einer von Hand gesetzten Zeit in einer Datei die Uhrabweichung des ganzen Geräts ableiten:
 * Die Geräteuhr zeigte an dieser Stelle X, echt war es Y. Alle anderen Dateien des Geräts folgen.
 */
function syncDeviceClock(s: ProjectStore, sourceId: Id, atMediaMs: number, local: number, uncertaintyMs: number): void {
  const src = s.getSource(sourceId);
  const device = src.deviceId ? s.getDevice(src.deviceId) : undefined;
  if (!device) throw new Error("Die Datei gehört zu keinem Gerät");
  if (device.isReference) throw new Error("Die Referenzuhr hat keine Abweichung");
  const tz = s.getSession(src.sessionId).timeZone;
  const best = s
    .listEvidence(src.sessionId)
    .filter((e) => e.sourceId === sourceId && e.enabled && e.clock === "device")
    .sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)[0];
  if (!best) throw new Error("Diese Datei hat keine Zeit der Geräteuhr, an der sich die Abweichung ablesen ließe");
  const deviceShows = effectiveLocal(best, device, tz) - best.atMediaMs + atMediaMs;
  s.updateDevice(device.id, {
    offsetBasis: "manual",
    clockOffsetMs: Math.round(deviceShows - local),
    clockOffsetUncertaintyMs: combineUncertainty(uncertaintyMs, best.uncertaintyMs),
  });
}

/** Uhrzeit von Hand oder angesagte Uhrzeit als Zeitbeleg anlegen. Gibt die Einsatz-Id zurück. */
export function addTimeEvidence(s: ProjectStore, input: TimeInput): Id {
  const src = s.getSource(input.sourceId);
  if (src.kind === "diary") throw new Error("Tagebuchseiten bekommen ihre Zeit über die Randnotiz");
  const session = s.getSession(src.sessionId);
  const at = parseMediaPos(input.atMedia);
  if (src.durationMs !== null && at > src.durationMs) throw new Error("Die Stelle liegt hinter dem Ende der Aufnahme");
  if (input.kind === "spoken" && src.kind !== "audio" && src.kind !== "video") {
    throw new Error("Angesagte Uhrzeiten gibt es nur in Audio und Video");
  }
  const local = parseClockOnDate(session.date, input.clock);
  const where = at ? ` bei ${input.atMedia.trim()}` : "";
  const uncertaintyMs = PRECISION_MS[input.precision];
  if (input.syncDevice && input.kind === "manual") syncDeviceClock(s, src.id, at, local, uncertaintyMs);
  // Eine neue Zeit ersetzt eine frühere Bestätigung: Bestätigt war die alte Lage.
  if (input.kind === "manual") dropChecks(s, src.sessionId, src.id);
  s.addEvidence({
    sourceId: src.id,
    kind: input.kind,
    clock: "true",
    atMediaMs: at,
    localMs: local,
    uncertaintyMs,
    detail: (input.kind === "spoken" ? `Angesagt${where}` : `Von Hand${where}`) + (input.note ? `: ${input.note}` : ""),
    raw: input.clock.trim(),
  });
  return session.id;
}

function dropChecks(s: ProjectStore, sessionId: Id, sourceId: Id): void {
  for (const e of s.listEvidence(sessionId))
    if (e.sourceId === sourceId && e.kind === "checked") s.deleteEvidence(e.id);
}

/**
 * Eine unsichere Lage („prüfen“) so bestätigen, wie sie gerade auf der Zeitachse steht.
 * Die Lage wird als eigener Beleg festgehalten; ihn zu löschen nimmt die Bestätigung zurück.
 * `startMs` ist die Lage, die die Forscherin gesehen hat. Hat sie sich inzwischen verschoben,
 * wird nichts bestätigt.
 */
export function confirmPlacement(s: ProjectStore, sourceId: Id, startMs: number): Id {
  return decidePlacement(s, { sourceId, evidenceId: null, expectedStartMs: startMs, reason: "" });
}

export type { DecideInput };
export { kindHolds, kindName };

/**
 * Bei widersprüchlichen Zeitbelegen bewusst entscheiden, welche Zeit gilt (oder eine unsichere Lage bestätigen).
 * Legt einen Beleg „geprüft“ am Beginn des gewählten Belegs an, mit dessen Genauigkeit, einem lesbaren Satz und
 * dem Stand beim Entscheiden. Eine frühere Entscheidung derselben Quelle wird ersetzt.
 */
export function decidePlacement(s: ProjectStore, input: DecideInput): Id {
  const src = s.getSource(input.sourceId);
  if (src.kind === "diary") throw new Error("Tagebuchseiten bekommen ihre Zeit über die Randnotiz");
  if (src.partOf) throw new Error("Die Zeit kommt von der Hauptseite");
  const session = s.getSession(src.sessionId);
  const current = resolveTimeline(s.loadResolveInput(session.id)).placements.get(src.id);
  if (!current) throw new Error("Die Quelle liegt noch nicht auf der Zeitachse");
  if (current.startMs !== input.expectedStartMs)
    throw new Error("Die Lage hat sich inzwischen geändert. Bitte noch einmal ansehen.");
  const chosen = input.evidenceId
    ? current.comparison.find((c) => c.evidenceId === input.evidenceId)
    : current.comparison.find((c) => c.verdict === "chosen");
  if (input.evidenceId && !chosen) throw new Error("Diesen Zeitbeleg gibt es bei der Quelle nicht");
  const startMs = chosen?.startMs ?? current.startMs;
  const uncertaintyMs = chosen?.uncertaintyMs ?? current.uncertaintyMs;
  // Eine frühere Entscheidung zählt nicht als eigener Beleg: Verglichen wird mit dem, was sie verdrängt hat.
  const others = current.comparison.filter((c) => c.kind !== "checked" && c.enabled);
  const seen = others.map((c) => ({ id: c.evidenceId, kind: c.kind, differenceMs: c.startMs - startMs }));
  // Die Art des gewählten Belegs; bei einer früheren Entscheidung die des Belegs, dem sie folgte.
  const prior = current.basis.kind === "checked" ? s.getEvidence(current.basis.evidenceId!).decision : null;
  const basisKind = chosen?.kind === "checked" ? (prior?.basisKind ?? "checked") : (chosen?.kind ?? current.basis.kind);
  const basisId = chosen?.kind === "checked" ? (prior?.basisId ?? null) : (chosen?.evidenceId ?? null);
  const reason = input.reason.trim();
  const conflicting = new Set(
    current.comparison.filter((c) => c.verdict === "conflict" && c.enabled).map((c) => c.evidenceId),
  );
  // Im Satz stehen die Belege, die der gewählten Zeit widersprechen (Rundung bleibt draußen).
  const against = seen.filter((x) => x.id !== basisId && (conflicting.has(x.id) || Math.abs(x.differenceMs) > 60_000));
  const hasConflict = conflicting.size > 0 || current.conflict.state !== "none";
  const decision: Decision = { at: new Date().toISOString(), basisId, basisKind, reason, seen };
  const sentence = hasConflict
    ? [
        `Entschieden: ${kindHolds(basisKind)} (${formatClock(startMs)}).`,
        ...against.map(
          (x) =>
            `${kindName(x.kind)} ${kindVerb(x.kind, "weicht", "weichen")} ab (${formatDuration(x.differenceMs, { sign: true })}).`,
        ),
        reason ? `Begründung: ${reason}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : `Geprüft: Lage passt (vorher ${current.basis.detail || current.basis.kind})${reason ? `. Begründung: ${reason}` : ""}`;
  dropChecks(s, session.id, src.id);
  s.addEvidence({
    sourceId: src.id,
    kind: "checked",
    clock: "true",
    atMediaMs: 0,
    localMs: startMs,
    uncertaintyMs,
    detail: sentence,
    raw: formatClock(startMs),
    decision,
  });
  return session.id;
}

/**
 * Dieselbe Entscheidung für mehrere Quellen (z. B. alle Dateien einer Kamera): je Quelle gilt der eingeschaltete
 * Beleg der Art `kind`. Quellen ohne solchen Beleg bleiben unverändert. Gibt die Einsatz-Id zurück.
 */
export function decideMany(s: ProjectStore, input: { sourceIds: Id[]; kind: string; reason: string }): Id {
  let sessionId: Id | null = null;
  for (const id of input.sourceIds) {
    const src = s.getSource(id);
    sessionId = src.sessionId;
    const p = resolveTimeline(s.loadResolveInput(src.sessionId)).placements.get(id);
    const ev = p?.comparison.find((c) => c.kind === input.kind && c.enabled);
    if (!p || !ev) continue;
    decidePlacement(s, { sourceId: id, evidenceId: ev.evidenceId, expectedStartMs: p.startMs, reason: input.reason });
  }
  if (!sessionId) throw new Error("Keine Quellen gewählt");
  return sessionId;
}

/** Nur selbst eingetragene Belege dürfen gelöscht werden; gelesene lassen sich nur abschalten. */
export function removeEvidence(s: ProjectStore, evidenceId: Id): Id {
  const ev = s.getEvidence(evidenceId);
  if (ev.kind !== "manual" && ev.kind !== "spoken" && ev.kind !== "checked")
    throw new Error("Gelesene Zeitbelege lassen sich nur abschalten");
  s.deleteEvidence(evidenceId);
  return s.getSource(ev.sourceId).sessionId;
}

export function toggleEvidence(s: ProjectStore, evidenceId: Id, enabled: boolean): Id {
  const ev = s.getEvidence(evidenceId);
  s.setEvidenceEnabled(evidenceId, enabled);
  return s.getSource(ev.sourceId).sessionId;
}

/** „Diese Stelle in A ist derselbe Moment wie diese Stelle in B.“ */
export function addManualAnchor(s: ProjectStore, input: AnchorInput): Id {
  if (input.aSourceId === input.bSourceId) throw new Error("Ein Anker verbindet zwei verschiedene Aufnahmen");
  const a = s.getSource(input.aSourceId);
  const b = s.getSource(input.bSourceId);
  if (a.sessionId !== b.sessionId) throw new Error("Beide Aufnahmen müssen zum selben Einsatz gehören");
  for (const [src, pos] of [
    [a, input.aAt],
    [b, input.bAt],
  ] as const) {
    if (src.kind === "diary") throw new Error("Tagebuchseiten bekommen ihre Zeit über die Randnotiz");
    const ms = parseMediaPos(pos);
    if (src.durationMs !== null && ms > src.durationMs)
      throw new Error(`Die Stelle liegt hinter dem Ende von ${src.label}`);
  }
  s.addAnchor({
    sessionId: a.sessionId,
    kind: "manual",
    a: { sourceId: a.id, atMediaMs: parseMediaPos(input.aAt) },
    b: { sourceId: b.id, atMediaMs: parseMediaPos(input.bAt) },
    uncertaintyMs:
      input.uncertaintyMs !== undefined ? Math.max(1, Math.round(input.uncertaintyMs)) : PRECISION_MS[input.precision],
    note: input.note.trim(),
  });
  return a.sessionId;
}

/**
 * Anker oder Vorschlag durch einen fein justierten ersetzen. War es ein Vorschlag, erledigen sich
 * wie beim Übernehmen die übrigen Vorschläge für dasselbe Gerät.
 */
export function replaceAnchor(s: ProjectStore, anchorId: Id, input: AnchorInput): Id {
  const old = s.getAnchor(anchorId);
  return s.transaction(() => {
    s.deleteAnchor(anchorId);
    const sessionId = addManualAnchor(s, input);
    if (old.proposed) {
      const device = s.getSource(old.b.sourceId).deviceId;
      for (const other of s.listAnchors(sessionId)) {
        if (other.proposed && device && s.getSource(other.b.sourceId).deviceId === device) s.deleteAnchor(other.id);
      }
    }
    return sessionId;
  });
}

/** Ein Vorschlag, wie ihn die Sammelübernahme abwägt. */
export interface ProposalPick {
  id: Id;
  /** null = Quelle ohne Gerät; dann zählt der Vorschlag für sich. */
  deviceId: Id | null;
  confidence: number | null;
}

/**
 * Je Gerät nur den Vorschlag mit der höchsten Sicherheit; die übrigen erledigen sich mit ihm. Bei Gleichstand
 * gewinnt der zuerst genannte. Reihenfolge der Geräte wie in der Eingabe.
 */
export function pickBestPerDevice(proposals: ProposalPick[]): Id[] {
  const best = new Map<Id, ProposalPick>();
  for (const p of proposals) {
    const key = p.deviceId ?? p.id;
    const cur = best.get(key);
    if (!cur || (p.confidence ?? 0) > (cur.confidence ?? 0)) best.set(key, p);
  }
  return [...best.values()].map((p) => p.id);
}

/** Welche der genannten Vorschläge die Sammelübernahme tatsächlich übernimmt (gelöschte fallen weg). */
export function proposalsToConfirm(s: ProjectStore, sessionId: Id, anchorIds: Id[]): Id[] {
  const wanted = new Set(anchorIds);
  const open = s.listAnchors(sessionId).filter((a) => a.proposed && wanted.has(a.id));
  return pickBestPerDevice(
    open.map((a) => ({ id: a.id, deviceId: s.getSource(a.b.sourceId).deviceId ?? null, confidence: a.confidence })),
  );
}

/**
 * Mehrere Vorschläge auf einmal übernehmen: je Gerät den sichersten, danach erledigen sich alle weiteren
 * Vorschläge dieser Geräte. Gibt die Zahl der übernommenen Vorschläge zurück.
 */
export function confirmAnchors(s: ProjectStore, sessionId: Id, anchorIds: Id[]): number {
  const picked = proposalsToConfirm(s, sessionId, anchorIds);
  s.transaction(() => {
    const devices = new Set<Id>();
    for (const id of picked) {
      s.confirmAnchor(id);
      const device = s.getSource(s.getAnchor(id).b.sourceId).deviceId;
      if (device) devices.add(device);
    }
    for (const other of s.listAnchors(sessionId)) {
      const device = other.proposed ? s.getSource(other.b.sourceId).deviceId : null;
      if (device && devices.has(device)) s.deleteAnchor(other.id);
    }
  });
  return picked.length;
}

/** Lautstärke-Angleichung einer Ton- oder Videoquelle einstellen. */
export function setLevel(s: ProjectStore, sourceId: Id, input: LevelInput): Id {
  const src = s.getSource(sourceId);
  if (src.kind !== "audio" && src.kind !== "video") throw new Error(`${src.label} hat keinen Ton`);
  const [lo, hi] = LEVEL_MANUAL_RANGE_DB;
  s.updateSource(sourceId, {
    levelMode: input.mode,
    levelGainDb: Math.round(Math.min(hi, Math.max(lo, input.manualGainDb)) * 10) / 10,
    levelCompress: input.compress,
  });
  return src.sessionId;
}

/** Seitenzählung von Tagebuch-Scans setzen; alle in einem Schritt. */
export function setPageNumbering(s: ProjectStore, items: PageNumberingInput[]): Id {
  if (!items.length) throw new Error("Keine Seiten angegeben");
  let sessionId: Id | null = null;
  s.transaction(() => {
    for (const i of items) {
      const src = s.getSource(i.sourceId);
      if (src.kind !== "diary") throw new Error(`${src.label} ist keine Tagebuchseite`);
      if (i.firstPage !== null && (!Number.isInteger(i.firstPage) || i.firstPage < 0 || i.firstPage > 99_999))
        throw new Error("Seitenzahl bitte als ganze Zahl ab 0");
      if (sessionId && src.sessionId !== sessionId) throw new Error("Seiten aus verschiedenen Einsätzen");
      sessionId = src.sessionId;
      s.updateSource(i.sourceId, { firstPage: i.firstPage, pageSpread: i.spread });
    }
  });
  return sessionId!;
}
