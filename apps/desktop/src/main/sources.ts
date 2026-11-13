/** Quellen und Geräte pflegen: entfernen, umhängen, Geräte zusammenlegen. */
import type { ProjectStore } from "@feldspur/core";

/** Quelle aus dem Projekt nehmen; die Originaldatei bleibt, wo sie ist. Gibt die Einsatz-Id zurück. */
export function removeSource(s: ProjectStore, sourceId: string): string {
  const src = s.getSource(sourceId);
  s.deleteSource(sourceId);
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
    s.updateSource(sourceId, { partOf: main.id, kind: main.kind, deviceId: main.deviceId });
  });
  return src.sessionId;
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
  const metaStart = (id: string) =>
    evidence
      .filter((e) => e.sourceId === id && e.enabled && (e.kind === "metadata" || e.kind === "filename"))
      .sort((a, b) => a.uncertaintyMs - b.uncertaintyMs)
      .map((e) => e.localMs - e.atMediaMs)[0];
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
