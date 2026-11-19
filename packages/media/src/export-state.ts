/**
 * Stand einer Ausgabe über Neustarts hinweg (Issue #72).
 *
 * Beim Ausgeben wird ein Fingerabdruck in die Projektdatei geschrieben: ein SHA-256 über alles aus dem Projekt, was
 * in Einsatztranskript, Dokumentvariablen, Begleitprotokoll und Montagevideo eingeht, dazu Größe und Änderungszeit jeder
 * Originaldatei und die gewählten Einstellungen. Später wird derselbe Abdruck neu gerechnet und verglichen. Weicht
 * ein Teil ab, ist die Ausgabe veraltet, und es lässt sich sagen, welcher Teil.
 *
 * Der Abdruck ist bewusst vorsichtig: Lieber einmal zu oft „Veraltet“ als eine alte Ausgabe als aktuell zeigen.
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExportFingerprint, ExportRecord, ExportSettings, Id, ProjectStore, Source } from "@feldspur/core";
import { baseName, documentVariables, protocolCsv } from "./export.ts";
import { buildSessionTranscript, entryText, type SessionTranscript } from "./session-transcript.ts";

/** Verfahren des Fingerabdrucks. Erhöhen, wenn sich ändert, was in eine Ausgabe eingeht. */
export const FINGERPRINT_VERSION = 1;

/** JSON mit Maps als sortierte Einträge und ohne Funktionen, damit gleicher Stand gleichen Text ergibt. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Map) return [...v.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
    if (v instanceof Uint8Array) return undefined;
    if (typeof v === "function") return undefined;
    return v;
  });
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** „Größe:Änderungszeit“ der Datei, oder „missing“. Liest die Datei nicht. */
export function fileStampText(path: string): string {
  try {
    const st = statSync(path);
    return st.isFile() ? `${st.size}:${Math.round(st.mtimeMs)}` : "missing";
  } catch {
    return "missing";
  }
}

function contentHash(store: ProjectStore, sessionId: Id, transcript: SessionTranscript): string {
  const levels = store.listAudioAnalyses(sessionId).map((a) => [a.sourceId, a.speechLevelDb, a.version]);
  return sha(
    stable({
      base: baseName(transcript),
      header: transcript.header,
      entries: transcript.entries.map((e) => [e.montageMs, e.kind, entryText(e), e.images]),
      // Kontext nur, wenn es welchen gibt: So bleibt der Abdruck von Einsätzen ohne Kontext wie vor Issue #108.
      ...(transcript.context.length ? { context: transcript.context } : {}),
      segments: transcript.plan.segments,
      durationMs: transcript.plan.durationMs,
      placements: transcript.resolved.placements,
      // Ohne die Kontext-Felder der Quellen (Issue #108): die ändern den Abdruck nur über `context`.
      sources: transcript.input.sources.map(({ role: _r, contextOrder: _o, contextMade: _m, ...rest }) => rest),
      devices: transcript.input.devices,
      persons: store.listPersons(),
      levels,
      protocol: protocolCsv(store, transcript),
      variables: documentVariables(transcript, baseName(transcript)),
    }),
  );
}

/** Fingerabdruck des jetzigen Stands für die Einstellungen `settings`. */
export function exportFingerprint(store: ProjectStore, sessionId: Id, settings: ExportSettings): ExportFingerprint {
  const episodes = store.getSession(sessionId).episodes;
  const transcript = buildSessionTranscript(store, sessionId, {
    mode: episodes && !settings.realtime ? "episodes" : "realtime",
    episodes,
  });
  const originals: Record<string, string> = {};
  for (const s of transcript.input.sources) originals[s.id] = fileStampText(s.originalPath);
  return { version: FINGERPRINT_VERSION, content: contentHash(store, sessionId, transcript), originals };
}

/** Warum eine Ausgabe nicht mehr zum Projekt passt; leer = aktuell. */
export interface ExportDifference {
  kind: "version" | "content" | "settings" | "originals-changed" | "originals-missing" | "sources";
  text: string;
  /** Kurzzeichen betroffener Quellen (bei Originalen). */
  labels?: string[];
}

export interface ExportStatus {
  record: ExportRecord;
  differences: ExportDifference[];
  /** Dateien der Ausgabe, die im Ordner nicht mehr liegen. */
  missingFiles: string[];
}

const SETTING_TEXT: Record<keyof ExportSettings, [on: string, off: string]> = {
  video: ["mit Montagevideo", "ohne Montagevideo"],
  resolve: ["mit Schnittliste für Resolve", "ohne Schnittliste für Resolve"],
  mixAudio: ["Ton aller Geräte gemischt", "nur Ton der Hauptquelle"],
  realtime: ["in Echtzeit", "nach Episoden geschnitten"],
};

/** Die Einstellungen, die sich unterscheiden, als „damals …, jetzt …“. */
export function settingsDifference(was: ExportSettings, now: ExportSettings): string[] {
  return (Object.keys(SETTING_TEXT) as (keyof ExportSettings)[])
    .filter((k) => was[k] !== now[k])
    .map((k) => `damals ${SETTING_TEXT[k][was[k] ? 0 : 1]}, jetzt ${SETTING_TEXT[k][now[k] ? 0 : 1]}`);
}

/**
 * Letzte Ausgabe mit dem jetzigen Stand vergleichen. `settings` sind die gerade gewählten Einstellungen: Eine
 * Ausgabe mit anderen Einstellungen ist nicht die, die man jetzt bekäme.
 */
export function compareExport(
  store: ProjectStore,
  record: ExportRecord,
  settings: ExportSettings,
  now: ExportFingerprint = exportFingerprint(store, record.sessionId, settings),
): ExportStatus {
  const differences: ExportDifference[] = [];
  const was = record.fingerprint;
  if (was.version !== now.version) {
    differences.push({
      kind: "version",
      text: "Die Ausgabe stammt aus einer älteren Fassung von Feldspur, die anders ausgegeben hat.",
    });
  } else if (was.content !== now.content) {
    differences.push({
      kind: "content",
      text: "Im Einsatz hat sich seitdem etwas geändert (Zeiten, Mitschrift, Tagebuch, Episoden oder Angaben).",
    });
  }
  const settingsDiff = settingsDifference(record.options, settings);
  if (settingsDiff.length) {
    const head = settingsDiff.length === 1 ? "Einstellung anders" : "Einstellungen anders";
    differences.push({ kind: "settings", text: `${head}: ${settingsDiff.join("; ")}.` });
  }
  const sources = new Map<Id, Source>(store.listSources(record.sessionId).map((s) => [s.id, s]));
  const label = (id: Id) => sources.get(id)?.label ?? "?";
  const changed: Id[] = [];
  const missing: Id[] = [];
  for (const [id, stamp] of Object.entries(now.originals)) {
    const before = was.originals[id];
    if (before === undefined) continue; // neue Quelle: steckt schon im Inhalt
    if (stamp === "missing" && before !== "missing") missing.push(id);
    else if (stamp !== "missing" && stamp !== before) changed.push(id);
  }
  if (changed.length) {
    differences.push({
      kind: "originals-changed",
      text:
        changed.length === 1
          ? "Eine Originaldatei wurde seitdem verändert."
          : `${changed.length} Originaldateien wurden seitdem verändert.`,
      labels: changed.map(label),
    });
  }
  if (missing.length) {
    differences.push({
      kind: "originals-missing",
      text:
        missing.length === 1 ? "Eine Originaldatei fehlt jetzt." : `${missing.length} Originaldateien fehlen jetzt.`,
      labels: missing.map(label),
    });
  }
  const added = Object.keys(now.originals).filter((id) => !(id in was.originals)).length;
  const removed = Object.keys(was.originals).filter((id) => !(id in now.originals)).length;
  if (was.version === now.version && (added || removed)) {
    const parts = [];
    if (added) parts.push(`${added} ${added === 1 ? "Quelle" : "Quellen"} dazugekommen`);
    if (removed) parts.push(`${removed} ${removed === 1 ? "Quelle" : "Quellen"} entfernt`);
    differences.push({ kind: "sources", text: `Seitdem ${parts.join(", ")}.` });
  }
  const missingFiles = record.files.filter((f) => !existsSync(join(record.dir, f)));
  return { record, differences, missingFiles };
}
