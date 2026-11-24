/**
 * Quellen und Geräte pflegen: entfernen, umhängen, Geräte zusammenlegen, Bilder zu Seiten und Aufnahmen zu
 * Folgeaufnahmen verbinden.
 *
 * Gehört zum Aufräumen nach dem Einsammeln: aufgerufen aus `ipc/sessions.ts` (Kanäle `source:…`, `device:merge`),
 * bedient über das Menü an einer Quelle (`src/renderer/SourceMenu.tsx`). Das Gerät zählt, weil jedes Gerät eine
 * eigene Uhr mit eigener Abweichung hat: Eine Quelle umzuhängen ändert, welche Abweichung für sie gilt.
 */
import { contextKey, effectiveLocal, type Device, type ProjectStore, type Source } from "@feldspur/core";
import { dropRefsTo } from "./context.ts";
import { deviceGuess, evidenceFromExif, evidenceFromFilename, type ImageExif } from "@feldspur/media";

/** Quelle aus dem Projekt nehmen; die Originaldatei bleibt, wo sie ist. Gibt die Einsatz-Id zurück. */
export function removeSource(s: ProjectStore, sourceId: string): string {
  const src = s.getSource(sourceId);
  s.transaction(() => {
    // Einträge, die nur auf dieser Seite liegen, gehen mit ihr; Verweise auf sie und auf die Quelle entfallen.
    const gone = s
      .listDiaryEntries(src.sessionId)
      .filter((e) => e.regions.length && e.regions.every((r) => r.sourceId === sourceId))
      .map((e) => contextKey.entry(e.id));
    s.deleteSource(sourceId);
    dropRefsTo(s, src.sessionId, [contextKey.source(sourceId), ...gone]);
  });
  return src.sessionId;
}

/**
 * Quelle einem anderen Gerät zuordnen. target = Geräte-Id, oder { newLabel } für ein neues Gerät.
 * Ein dadurch leeres Gerät verschwindet; war es die Referenzuhr, wird das Zielgerät Referenz.
 */
export function moveSource(s: ProjectStore, sourceId: string, target: string | { newLabel: string }): string {
  const src = s.getSource(sourceId);
  const from = src.deviceId ? s.getDevice(src.deviceId) : null;
  s.transaction(() => {
    let deviceId: string;
    if (typeof target === "string") {
      const to = s.getDevice(target);
      if (to.sessionId !== src.sessionId) throw new Error("Gerät gehört zu einem anderen Einsatz");
      deviceId = to.id;
    } else {
      const label = target.newLabel.trim();
      if (!label) throw new Error("Bitte einen Namen für das neue Gerät angeben");
      deviceId = s.addDevice({ sessionId: src.sessionId, label, matchKey: `manuell:${label}` }).id;
    }
    if (deviceId === src.deviceId) return;
    s.updateSource(sourceId, { deviceId });
    if (from && s.deleteDeviceIfEmpty(from.id) && from.isReference) s.setReferenceDevice(deviceId);
  });
  return src.sessionId;
}

/**
 * Alle Quellen von fromId nach intoId verschieben und fromId löschen.
 * Die Uhrabweichung von intoId gilt danach für alle; war fromId die Referenz, wird intoId Referenz.
 */
export function mergeDevices(s: ProjectStore, fromId: string, intoId: string): string {
  if (fromId === intoId) throw new Error("Ein Gerät lässt sich nicht mit sich selbst zusammenlegen");
  const from = s.getDevice(fromId);
  const into = s.getDevice(intoId);
  if (from.sessionId !== into.sessionId) throw new Error("Die Geräte gehören zu verschiedenen Einsätzen");
  s.transaction(() => {
    for (const src of s.listSources(from.sessionId).filter((x) => x.deviceId === fromId)) {
      s.updateSource(src.id, { deviceId: intoId });
    }
    s.deleteDeviceIfEmpty(fromId);
    if (from.isReference) s.setReferenceDevice(intoId);
  });
  return from.sessionId;
}

const IMAGE_KINDS = new Set(["photo", "diary"]);
const AV_KINDS = new Set(["audio", "video"]);

/**
 * Bild als weiteren Teil einer Seite an eine Hauptquelle hängen (mainId), oder lösen (null).
 * Hat das Bild selbst schon Teile, wandern diese mit zur neuen Hauptquelle.
 */
export function setPartOf(s: ProjectStore, sourceId: string, mainId: string | null): string {
  const src = s.getSource(sourceId);
  if (mainId === null) {
    s.updateSource(sourceId, { partOf: null });
    return src.sessionId;
  }
  if (mainId === sourceId) throw new Error("Ein Bild kann nicht Teil von sich selbst sein");
  let main = s.getSource(mainId);
  if (main.partOf) main = s.getSource(main.partOf);
  if (main.id === sourceId) throw new Error("Ein Bild kann nicht Teil von sich selbst sein");
  if (main.sessionId !== src.sessionId) throw new Error("Die Bilder gehören zu verschiedenen Einsätzen");
  if (!IMAGE_KINDS.has(src.kind) || !IMAGE_KINDS.has(main.kind)) {
    throw new Error("Nur Fotos und Tagebuchseiten lassen sich zu einer Seite verbinden");
  }
  s.transaction(() => {
    for (const child of s.listSources(src.sessionId).filter((x) => x.partOf === sourceId)) {
      s.updateSource(child.id, { partOf: main.id });
    }
    // Wechselt die Art (Foto an Tagebuchseite), passt auch das Kurzzeichen dazu: F-… wird T-…
    const label = src.kind === main.kind ? src.label : s.nextLabel(src.sessionId, main.kind);
    s.updateSource(sourceId, { partOf: main.id, kind: main.kind, deviceId: main.deviceId, label });
    if (src.deviceId && src.deviceId !== main.deviceId) s.deleteDeviceIfEmpty(src.deviceId);
  });
  return src.sessionId;
}

/**
 * Bild als Tagebuchseite oder als Foto behandeln. Die Einschätzung beim Einsammeln richtet sich nach Dateiname
 * und Kamera-EXIF; abfotografierte Notizbuchseiten landen so oft bei den Fotos. Neues Kurzzeichen, weitere Bilder
 * der Seite ziehen mit. Das Gerät wählt sich wie beim Einsammeln: Tagebuch für Seiten, für Fotos nach Modell
 * bzw. Dateinamen-Familie. Ein dadurch leeres Gerät verschwindet. Zeitbelege bleiben erhalten (eine Tagebuchseite
 * liegt trotzdem nur nach ihren Randnotizen); fehlen einem neuen Foto welche, kommen sie aus EXIF und Dateinamen.
 */
export function setSourceKind(s: ProjectStore, sourceId: string, kind: "diary" | "photo"): string {
  const src = s.getSource(sourceId);
  if (!IMAGE_KINDS.has(src.kind)) throw new Error("Nur Fotos und Tagebuchseiten lassen sich umstellen");
  if (src.partOf) throw new Error("Weitere Bilder einer Seite haben die Art ihrer Hauptseite");
  if (src.kind === kind) return src.sessionId;
  const parts = s.listSources(src.sessionId).filter((x) => x.partOf === sourceId);
  if (kind === "photo") {
    const ids = new Set([sourceId, ...parts.map((x) => x.id)]);
    const n = s.listDiaryEntries(src.sessionId).filter((e) => e.regions.some((r) => ids.has(r.sourceId))).length;
    if (n) {
      throw new Error(
        `${src.label} hat ${n === 1 ? "einen Tagebucheintrag" : `${n} Tagebucheinträge`}. Bitte erst die Einträge löschen, dann als Foto behandeln.`,
      );
    }
  }
  s.transaction(() => {
    const from = src.deviceId ? s.getDevice(src.deviceId) : null;
    const to = targetDevice(s, src, kind, from);
    for (const x of [src, ...parts]) {
      s.updateSource(x.id, { kind, label: s.nextLabel(src.sessionId, kind), deviceId: to.id });
      if (kind === "photo" && !s.listEvidence(src.sessionId).some((e) => e.sourceId === x.id)) {
        const exif = (x.metadata.exif ?? null) as ImageExif | null;
        for (const e of [...evidenceFromExif(exif), ...evidenceFromFilename(x.fileName)]) {
          s.addEvidence({ ...e, sourceId: x.id });
        }
      }
    }
    for (const id of new Set([src.deviceId, ...parts.map((x) => x.deviceId)])) {
      if (!id || id === to.id) continue;
      const wasReference = id === from?.id && from.isReference;
      if (s.deleteDeviceIfEmpty(id) && wasReference && kind === "photo") s.setReferenceDevice(to.id);
    }
  });
  return src.sessionId;
}

/** Gerät für ein umgestelltes Bild: vorhandenes passendes Gerät, sonst neu wie beim Einsammeln. */
function targetDevice(s: ProjectStore, src: Source, kind: "diary" | "photo", from: Device | null): Device {
  const exif = (src.metadata.exif ?? null) as ImageExif | null;
  const guess = deviceGuess(src.fileName, kind, exif, null);
  const devices = s.listDevices(src.sessionId);
  const sources = s.listSources(src.sessionId);
  const onlyDiary = (d: Device) => {
    const own = sources.filter((x) => x.deviceId === d.id && x.id !== src.id && x.partOf !== src.id);
    return own.length > 0 && own.every((x) => x.kind === "diary");
  };
  const found =
    devices.find((d) => d.matchKey === guess.key) ?? (kind === "diary" ? devices.find(onlyDiary) : undefined);
  if (found) return found;
  return s.addDevice({
    sessionId: src.sessionId,
    label: guess.label,
    matchKey: guess.key,
    personId: from?.personId ?? null,
  });
}

/** Folgeaufnahme setzen: sourceId setzt prevId nahtlos fort (null = lösen). */
export function setFollows(s: ProjectStore, sourceId: string, prevId: string | null): string {
  const src = s.getSource(sourceId);
  if (prevId === null) {
    s.updateSource(sourceId, { follows: null });
    return src.sessionId;
  }
  const prev = s.getSource(prevId);
  if (prev.sessionId !== src.sessionId) throw new Error("Die Aufnahmen gehören zu verschiedenen Einsätzen");
  if (!AV_KINDS.has(src.kind) || !AV_KINDS.has(prev.kind)) {
    throw new Error("Nur Audio- und Videoaufnahmen können einander fortsetzen");
  }
  if (prev.durationMs === null) throw new Error(`${prev.label} hat keine bekannte Länge`);
  // Keine Kreise: prev darf nicht (über Umwege) auf sourceId folgen.
  const byId = new Map(s.listSources(src.sessionId).map((x) => [x.id, x]));
  for (let cur: string | null = prevId, n = 0; cur && n < byId.size + 1; cur = byId.get(cur)?.follows ?? null, n++) {
    if (cur === sourceId) throw new Error("Das ergäbe einen Kreis von Folgeaufnahmen");
  }
  const taken = [...byId.values()].find((x) => x.follows === prevId && x.id !== sourceId);
  if (taken) throw new Error(`${taken.label} setzt ${prev.label} schon fort`);
  s.updateSource(sourceId, { follows: prevId });
  return src.sessionId;
}

/** Bis zu dieser Lücke (ms) zwischen Ende und nächstem Beginn gilt eine Datei als Fortsetzung. */
const FOLLOW_GAP_MS = 3_000;

/**
 * Folgeaufnahmen nach dem Einsammeln erkennen: gleiches Gerät, gleiche Art, und
 * (a) die Metadatenzeit der nächsten Datei liegt am Ende der vorigen, oder
 * (b) GoPro-Kapitel (GX01xxxx → GX02xxxx). Setzt nur, wo noch nichts gesetzt ist.
 * Gibt die Zahl neu verketteter Dateien zurück.
 */
export function linkFollowUps(s: ProjectStore, sessionId: string): number {
  const sources = s.listSources(sessionId).filter((x) => AV_KINDS.has(x.kind) && x.deviceId && !x.partOf);
  const evidence = s.listEvidence(sessionId);
  const devices = new Map(s.listDevices(sessionId).map((d) => [d.id, d]));
  const tz = s.getSession(sessionId).timeZone;
  const deviceOf = new Map(sources.map((x) => [x.id, x.deviceId ? devices.get(x.deviceId) : undefined]));
  const metaStart = (id: string) =>
    evidence
      .filter((e) => e.sourceId === id && e.enabled && (e.kind === "metadata" || e.kind === "filename"))
      .sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)
      .map((e) => effectiveLocal(e, deviceOf.get(id), tz) - e.atMediaMs)[0];
  const followed = new Set(sources.map((x) => x.follows).filter(Boolean));
  let linked = 0;
  for (const b of sources) {
    if (b.follows) continue;
    const peers = sources.filter((a) => a.id !== b.id && a.deviceId === b.deviceId && a.kind === b.kind);
    const prev =
      peers.find((a) => goproNext(a.fileName) === b.fileName.toUpperCase()) ??
      peers.find((a) => {
        const sa = metaStart(a.id);
        const sb = metaStart(b.id);
        if (sa === undefined || sb === undefined || a.durationMs === null) return false;
        return Math.abs(sa + a.durationMs - sb) <= FOLLOW_GAP_MS;
      });
    if (!prev || followed.has(prev.id) || prev.follows === b.id) continue;
    s.updateSource(b.id, { follows: prev.id });
    followed.add(prev.id);
    linked++;
  }
  return linked;
}

/** GoPro-Kapitel: GX010123.MP4 → GX020123.MP4 (auch GH/GL). */
function goproNext(fileName: string): string | null {
  const m = /^(G[HXL])(\d{2})(\d{4})(\.\w+)$/i.exec(fileName);
  if (!m) return null;
  const next = Number(m[2]) + 1;
  if (next > 99) return null;
  return `${m[1]}${String(next).padStart(2, "0")}${m[3]}${m[4]}`.toUpperCase();
}
