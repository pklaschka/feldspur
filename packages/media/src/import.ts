/**
 * Einsammeln: Dateien und Ordner durchgehen, Art erkennen, Metadaten und
 * Prüfsumme lesen, Zeitbelege und eine Gerätevermutung bilden. Ergebnis ist
 * ein Importplan, den die Oberfläche anzeigt, bevor er ins Projekt übernommen wird.
 */
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Device, Id, ProjectStore, Source, SourceKind } from "@feldspur/core";
import { classify, filenameFamily, isIgnored } from "./classify.ts";
import {
  evidenceAppliesTo,
  evidenceFromExif,
  evidenceFromFilename,
  evidenceFromMediaTags,
  type EvidenceDraft,
} from "./evidence.ts";
import { sha256File } from "./hash.ts";
import { probeMedia, readImageExif, type ImageExif, type MediaProbe } from "./probe.ts";

export interface ImportCandidate {
  path: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  kind: SourceKind;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  /** Gerätevermutung: gleiche Schlüssel = gleiches Gerät. */
  deviceKey: string;
  deviceLabel: string;
  evidence: EvidenceDraft[];
  warnings: string[];
}

export interface ScanOptions {
  onProgress?: (done: number, total: number, path: string) => void;
}

async function walk(path: string, out: string[]): Promise<void> {
  const st = await stat(path);
  if (st.isDirectory()) {
    const entries = (await readdir(path)).sort((a, b) => a.localeCompare(b));
    for (const e of entries) if (!isIgnored(e)) await walk(join(path, e), out);
  } else if (st.isFile() && !isIgnored(basename(path))) {
    out.push(resolve(path));
  }
}

export async function listFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) await walk(p, out);
  return [...new Set(out)];
}

const KIND_DEVICE: Partial<Record<SourceKind, string>> = {
  video: "Kamera",
  audio: "Audiorekorder",
  photo: "Fotos",
  gps: "GPS",
  note: "Notizen",
};

/** Buchstaben am Anfang der Dateinamen-Familie: "C####.mp4" → "C", "IMG_########_######.jpg" → "IMG". */
function familyPrefix(family: string): string {
  return family.replace(/[#].*$/, "").replace(/[_\-\s.]+$/, "");
}

function deviceGuess(
  fileName: string,
  kind: SourceKind,
  exif: ImageExif | null,
  probe: MediaProbe | null,
): { key: string; label: string } {
  if (kind === "diary") return { key: "diary", label: "Tagebuch" };
  const make = exif?.make ?? probe?.tags["com.apple.quicktime.make"] ?? probe?.tags["make"];
  const model = exif?.model ?? probe?.tags["com.apple.quicktime.model"] ?? probe?.tags["model"];
  if (model) {
    const label = make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model;
    return { key: `model:${label.toLowerCase()}`, label };
  }
  const family = filenameFamily(fileName);
  const prefix = familyPrefix(family);
  const base = KIND_DEVICE[kind] ?? "Gerät";
  return { key: `family:${family.toLowerCase()}`, label: prefix ? `${base} ${prefix}` : base };
}

export async function inspectFile(path: string): Promise<ImportCandidate> {
  const fileName = basename(path);
  const st = await stat(path);
  const warnings: string[] = [];
  let kind = classify(fileName);
  let probe: MediaProbe | null = null;
  let exif: ImageExif | null = null;

  if (kind === "video" || kind === "audio") {
    try {
      probe = await probeMedia(path);
      if (kind === "video" && !probe.hasVideo && probe.hasAudio) kind = "audio";
      if (probe.durationMs === null) warnings.push("Länge nicht lesbar");
    } catch (e) {
      warnings.push(`ffprobe: ${(e as Error).message.split("\n")[0]}`);
    }
  } else if (kind === "photo" || kind === "diary") {
    exif = await readImageExif(path);
    kind = classify(fileName, { hasCameraExif: !!(exif?.model || exif?.dateTimeOriginal) });
  }

  const evidence: EvidenceDraft[] = [];
  if (evidenceAppliesTo(kind)) {
    if (probe) evidence.push(...evidenceFromMediaTags(probe));
    evidence.push(...evidenceFromExif(exif));
    evidence.push(...evidenceFromFilename(fileName));
  }
  if (evidenceAppliesTo(kind) && evidence.length === 0) warnings.push("Keine Zeitangabe gefunden");

  const device = deviceGuess(fileName, kind, exif, probe);
  const metadata: Record<string, unknown> = {};
  if (probe) metadata.media = probe;
  if (exif) metadata.exif = exif;

  return {
    path,
    fileName,
    sizeBytes: st.size,
    sha256: await sha256File(path),
    kind,
    durationMs: kind === "video" || kind === "audio" ? (probe?.durationMs ?? null) : null,
    metadata,
    deviceKey: device.key,
    deviceLabel: device.label,
    evidence,
    warnings,
  };
}

/** Dateien und Ordner einsammeln. Liest nur, verändert nichts. */
export async function scanPaths(paths: string[], opts: ScanOptions = {}): Promise<ImportCandidate[]> {
  const files = await listFiles(paths);
  const out: ImportCandidate[] = [];
  for (const [i, f] of files.entries()) {
    opts.onProgress?.(i, files.length, f);
    out.push(await inspectFile(f));
  }
  opts.onProgress?.(files.length, files.length, "");
  return out;
}

export interface ApplyImportOptions {
  /** Person, der neu angelegte Geräte zugeordnet werden. */
  personId?: Id | null;
}

export interface ApplyImportResult {
  sources: Source[];
  devicesCreated: Device[];
  /** Schon im Einsatz vorhandene Dateien (gleiche Prüfsumme). */
  duplicates: { candidate: ImportCandidate; existing: Source }[];
}

/** Importplan in den Einsatz übernehmen: Geräte zuordnen oder anlegen, Quellen und Belege speichern. */
export function applyImport(
  store: ProjectStore,
  sessionId: Id,
  candidates: ImportCandidate[],
  opts: ApplyImportOptions = {},
): ApplyImportResult {
  return store.transaction(() => {
    const devices = new Map(store.listDevices(sessionId).map((d) => [d.matchKey, d]));
    const result: ApplyImportResult = { sources: [], devicesCreated: [], duplicates: [] };
    const seen = new Map<string, Source>();
    // Chronologisch nach bestem Beleg, damit die Kurzzeichen der Reihenfolge im Feld folgen.
    const ordered = [...candidates].sort(
      (a, b) =>
        (a.evidence[0]?.localMs ?? Infinity) - (b.evidence[0]?.localMs ?? Infinity) ||
        a.fileName.localeCompare(b.fileName),
    );
    for (const c of ordered) {
      const existing = store.findSourceBySha(sessionId, c.sha256) ?? seen.get(c.sha256);
      if (existing) {
        result.duplicates.push({ candidate: c, existing });
        continue;
      }
      let device = devices.get(c.deviceKey);
      if (!device) {
        device = store.addDevice({
          sessionId,
          label: c.deviceLabel,
          matchKey: c.deviceKey,
          personId: opts.personId ?? null,
        });
        devices.set(c.deviceKey, device);
        result.devicesCreated.push(device);
      }
      const src = store.addSource({
        sessionId,
        deviceId: device.id,
        kind: c.kind,
        title: c.fileName,
        originalPath: c.path,
        fileName: c.fileName,
        sizeBytes: c.sizeBytes,
        sha256: c.sha256,
        durationMs: c.durationMs,
        metadata: c.metadata,
      });
      for (const e of c.evidence) store.addEvidence({ ...e, sourceId: src.id });
      seen.set(c.sha256, src);
      result.sources.push(src);
    }
    return result;
  });
}
