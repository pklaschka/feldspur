/**
 * Originaldateien im Hauptprozess: Zustand für die Ansicht, Prüfung mit Prüfsumme, Neu-Verknüpfen.
 * Ohne Electron, damit es sich direkt testen lässt. Die Logik selbst steckt in @feldspur/media (integrity.ts).
 *
 * Prüfergebnisse bleiben im Speicher (HashCache), nicht in der Projektdatei: Sie sind kein Forschungsdatum.
 * Ein neuer Pfad dagegen ist eine Änderung am Projekt und landet als eigener Schritt im Änderungsprotokoll.
 */
import type { Id, ProjectStore, Source } from "@feldspur/core";
import {
  checkSources,
  exportVerdict,
  findOriginals,
  HashCache,
  NEEDS_RELINK,
  quickCheck,
  verifyOriginal,
  type FileCheck,
} from "@feldspur/media";
import type { OriginalsCheck, OriginalsSearch } from "../shared/api.ts";

/** Ein Zwischenspeicher für die ganze Sitzung: Er hängt an Pfad, Größe und Änderungszeit, nicht am Projekt. */
export const hashCache = new HashCache();

export const RELINK_LABEL = "Originaldatei neu verknüpft";

/** Schneller Zustand aller Quellen eines Einsatzes (ohne Lesen der Dateien). */
export function quickStates(sources: Source[]): Map<Id, FileCheck> {
  return new Map(sources.map((s) => [s.id, quickCheck(s, hashCache)]));
}

function summarize(sources: Source[], checks: FileCheck[], video: boolean): OriginalsCheck {
  const { blocking, warnings } = exportVerdict(sources, checks, { video });
  return { checks, blocking: blocking.map((c) => c.sourceId), warnings: warnings.map((c) => c.sourceId) };
}

/** Alle Originale eines Einsatzes vollständig prüfen (Existenz, Größe, SHA-256). */
export async function checkOriginals(
  s: ProjectStore,
  sessionId: Id,
  opts: {
    video: boolean;
    onProgress?: (done: number, total: number, fileName: string) => void;
    onBytes?: (done: number, total: number, fileName: string) => void;
    signal?: AbortSignal;
  },
): Promise<OriginalsCheck> {
  const sources = s.listSources(sessionId);
  const { video, ...rest } = opts;
  const checks = await checkSources(sources, { cache: hashCache, ...rest });
  return summarize(sources, checks, video);
}

/**
 * Ohne Lesen der Dateien: Fehlt etwas, das die Ausgabe braucht? Schutz im Hauptprozess, falls die Oberfläche
 * die Prüfung übersprungen hat. Gibt eine verständliche Meldung zurück oder null.
 */
export function exportBlocker(s: ProjectStore, sessionId: Id, video: boolean): string | null {
  const sources = s.listSources(sessionId);
  const states = quickStates(sources);
  const { blocking } = exportVerdict(sources, [...states.values()], { video });
  if (!blocking.length) return null;
  const labels = blocking.map((c) => sources.find((x) => x.id === c.sourceId)?.label ?? "?");
  return `Feldspur findet ${blocking.length === 1 ? "eine Originaldatei" : `${blocking.length} Originaldateien`} nicht (${labels.join(", ")}). Bitte zuerst neu verknüpfen.`;
}

/** Ids der Quellen, die die Tonanalyse überspringen muss, mit Grund. */
export function unreachableForAnalysis(s: ProjectStore, sessionId: Id): Map<Id, string> {
  const out = new Map<Id, string>();
  for (const src of s.listSources(sessionId)) {
    if (src.kind !== "audio" && src.kind !== "video") continue;
    const c = quickCheck(src, hashCache);
    if (c.state === "missing" || c.state === "unreadable") out.set(src.id, `Originaldatei nicht gefunden: ${c.detail}`);
  }
  return out;
}

/**
 * Eine Quelle mit einer gewählten Datei verknüpfen. Nur mit passender Prüfsumme; sonst Fehler mit Grund.
 * Gibt die Einsatz-Id zurück.
 */
export async function relinkFile(s: ProjectStore, sourceId: Id, path: string): Promise<Id> {
  const src = s.getSource(sourceId);
  if (path === src.originalPath && quickCheck(src, hashCache).state === "ok") return src.sessionId;
  const v = await verifyOriginal(src, path, hashCache);
  if (!v.ok) throw new Error(`${src.label}: Diese Datei ist nicht das Original. ${v.reason}.`);
  s.history.record(RELINK_LABEL, () => s.updateSource(sourceId, { originalPath: path }));
  return src.sessionId;
}

/**
 * Fehlende oder veränderte Originale eines Einsatzes in einem Ordner suchen und alle mit passender Prüfsumme
 * in einem Schritt neu verknüpfen.
 */
export async function searchOriginals(
  s: ProjectStore,
  sessionId: Id,
  dir: string,
  onProgress?: (scanned: number, phase: "suchen" | "prüfen", fileName: string) => void,
): Promise<OriginalsSearch> {
  const sources = s.listSources(sessionId);
  // Erst schnell (fehlt, Größe anders), dann für den Rest die Prüfsumme: sonst bliebe ein gleich großes,
  // aber verändertes Original unentdeckt.
  const checks = await checkSources(sources, { cache: hashCache });
  const open = new Set(checks.filter((c) => NEEDS_RELINK.has(c.state)).map((c) => c.sourceId));
  const wanted = sources.filter((x) => open.has(x.id));
  if (!wanted.length) return { relinked: [], rejected: [], stillOpen: [], scanned: 0, truncated: false };
  const r = await findOriginals(wanted, dir, { cache: hashCache, onProgress });
  if (r.found.length) {
    s.history.record(r.found.length === 1 ? RELINK_LABEL : `${r.found.length} Originaldateien neu verknüpft`, () => {
      for (const f of r.found) s.updateSource(f.sourceId, { originalPath: f.path });
    });
  }
  const label = (id: Id) => sources.find((x) => x.id === id)?.label ?? "?";
  const found = new Set(r.found.map((f) => f.sourceId));
  return {
    relinked: r.found.map((f) => ({ label: label(f.sourceId), path: f.path })),
    rejected: r.rejected.map((x) => ({ label: label(x.sourceId), path: x.path, reason: x.reason })),
    stillOpen: wanted.filter((x) => !found.has(x.id)).map((x) => x.label),
    scanned: r.scanned,
    truncated: r.truncated,
  };
}

/**
 * Beim Einsammeln: Eine schon vorhandene Datei (gleiche Prüfsumme), deren gespeichertes Original fehlt, bekommt
 * den neuen Pfad. Die Prüfsumme hat das Einsammeln gerade gerechnet, also ist es sicher das Original.
 * Gibt die Zahl neu verknüpfter Quellen zurück.
 */
export function relinkDuplicates(s: ProjectStore, duplicates: { path: string; existing: Source }[]): number {
  const todo = duplicates.filter(
    (d) => d.path !== d.existing.originalPath && NEEDS_RELINK.has(quickCheck(d.existing, hashCache).state),
  );
  if (!todo.length) return 0;
  s.history.record(todo.length === 1 ? RELINK_LABEL : `${todo.length} Originaldateien neu verknüpft`, () => {
    for (const d of todo) s.updateSource(d.existing.id, { originalPath: d.path });
  });
  return todo.length;
}
