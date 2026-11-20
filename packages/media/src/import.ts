/**
 * Einsammeln: Dateien und Ordner durchgehen, Art erkennen, Metadaten und
 * Prüfsumme lesen, Zeitbelege und eine Gerätevermutung bilden. Ergebnis ist
 * ein Importplan, den die Oberfläche anzeigt, bevor er ins Projekt übernommen wird.
 */
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { utcToLocal, type Device, type Id, type ProjectStore, type Source, type SourceKind } from "@feldspur/core";
import { classify, filenameFamily, isIgnored } from "./classify.ts";
import {
  evidenceAppliesTo,
  evidenceFromExif,
  evidenceFromFilename,
  evidenceFromMediaTags,
  type EvidenceDraft,
} from "./evidence.ts";
import { refineClipTimes } from "./clip-times.ts";
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

/** Stand beim Einsammeln, für Fortschrittsbalken und Restzeit. */
export interface ScanProgress {
  /** Erst Dateien suchen (Anzahl wächst), dann jede lesen und prüfen. */
  phase: "listing" | "reading";
  /** Fertig gelesene Dateien. */
  done: number;
  /** Beim Suchen: bisher gefunden. Beim Lesen: alle. */
  total: number;
  /** Gelesene Bytes aller Dateien (Prüfsummen dominieren die Dauer). */
  bytesDone: number;
  bytesTotal: number;
  /** Datei, die gerade gelesen wird (leer, wenn fertig). */
  path: string;
  /** Davon aus einem früheren, abgebrochenen Versuch übernommen, ohne neu zu lesen. */
  reused: number;
  /** Bytes dieser übernommenen Dateien (zählen für die Restzeit nicht als gelesen). */
  bytesReused: number;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
  /** Abbrechen: scanPaths wirft dann einen AbortError und gibt nichts zurück. */
  signal?: AbortSignal;
  /** Schon vollständig gelesene Dateien; ein zweiter Versuch übernimmt sie, solange sie unverändert sind. */
  cache?: ScanCache;
  /**
   * Eine Datei oder ein Ordner ließ sich nicht lesen. Ohne diesen Rückruf bricht das ganze Einsammeln ab; mit ihm
   * wird die Datei übersprungen und der Grund gemeldet.
   */
  onSkipped?: (path: string, message: string) => void;
}

interface Listed {
  path: string;
  size: number;
  mtimeMs: number;
}

const stampKey = (f: Listed) => `${f.path}|${f.size}|${f.mtimeMs}`;

/**
 * Ergebnisse vollständig gelesener Dateien, je Pfad, Größe und Änderungszeit. Ändert sich die Datei, passt der
 * Schlüssel nicht mehr und sie wird neu gelesen. Liegt im Speicher, nicht im Projekt.
 */
export class ScanCache {
  private readonly known = new Map<string, ImportCandidate>();
  get(f: Listed): ImportCandidate | undefined {
    return this.known.get(stampKey(f));
  }
  set(f: Listed, c: ImportCandidate): void {
    this.known.set(stampKey(f), c);
  }
  get size(): number {
    return this.known.size;
  }
}

const errText = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return "nicht gefunden";
  if (code === "EACCES" || code === "EPERM") return "keine Leserechte";
  return (e as Error).message.split("\n")[0] ?? String(e);
};

async function walk(path: string, out: Listed[], opts: ScanOptions, found: () => void): Promise<void> {
  opts.signal?.throwIfAborted();
  let st;
  try {
    st = await stat(path);
  } catch (e) {
    if (!opts.onSkipped) throw e;
    opts.onSkipped(path, `übersprungen: ${errText(e)}`);
    return;
  }
  if (st.isDirectory()) {
    let entries: string[];
    try {
      entries = (await readdir(path)).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      if (!opts.onSkipped) throw e;
      opts.onSkipped(path, `Ordner übersprungen: ${errText(e)}`);
      return;
    }
    for (const e of entries) if (!isIgnored(e)) await walk(join(path, e), out, opts, found);
  } else if (st.isFile() && !isIgnored(basename(path))) {
    out.push({ path: resolve(path), size: st.size, mtimeMs: st.mtimeMs });
    found();
  }
}

async function listWithStats(paths: string[], opts: ScanOptions = {}): Promise<Listed[]> {
  const out: Listed[] = [];
  let last = 0;
  const found = () => {
    const now = Date.now();
    if (now - last < 150) return;
    last = now;
    opts.onProgress?.({
      phase: "listing",
      done: 0,
      total: out.length,
      bytesDone: 0,
      bytesTotal: 0,
      path: out.at(-1)?.path ?? "",
      reused: 0,
      bytesReused: 0,
    });
  };
  for (const p of paths) await walk(p, out, opts, found);
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.path) && !!seen.add(f.path));
}

export async function listFiles(paths: string[]): Promise<string[]> {
  return (await listWithStats(paths)).map((f) => f.path);
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
  return (
    family
      .replace(/[#].*$/, "")
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      // Endzeichen nicht mit „[…]+$“ abschneiden: das prüft lange Folgen davon quadratisch.
      .replace(/[^_\-\s.][_\-\s.]*$/, (m) => m[0]!)
      .replace(/^[_\-\s.]+$/, "")
  );
}

/** Gerätevermutung wie beim Einsammeln: Modell aus den Metadaten, sonst Dateinamen-Familie; Tagebuch eigenes Gerät. */
export function deviceGuess(
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

export async function inspectFile(
  path: string,
  opts: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<ImportCandidate> {
  const fileName = basename(path);
  const st = await stat(path);
  const warnings: string[] = [];
  let kind = classify(fileName);
  let probe: MediaProbe | null = null;
  let exif: ImageExif | null = null;

  if (kind === "video" || kind === "audio") {
    try {
      probe = await probeMedia(path, { signal: opts.signal });
      if (kind === "video" && !probe.hasVideo && probe.hasAudio) kind = "audio";
      if (probe.durationMs === null) warnings.push("Länge nicht lesbar");
    } catch (e) {
      opts.signal?.throwIfAborted();
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
    sha256: await sha256File(path, opts),
    kind,
    durationMs: kind === "video" || kind === "audio" ? (probe?.durationMs ?? null) : null,
    metadata,
    deviceKey: device.key,
    deviceLabel: device.label,
    evidence,
    warnings,
  };
}

/**
 * Dateien und Ordner einsammeln. Liest nur, verändert nichts: Ein Abbruch (signal) hinterlässt nichts, und erst
 * applyImport schreibt ins Projekt, in einem Rutsch.
 */
export async function scanPaths(paths: string[], opts: ScanOptions = {}): Promise<ImportCandidate[]> {
  const files = await listWithStats(paths, opts);
  const bytesTotal = files.reduce((n, f) => n + f.size, 0);
  const out: ImportCandidate[] = [];
  let bytesDone = 0;
  let reused = 0;
  let bytesReused = 0;
  let last = 0;
  const report = (done: number, path: string, extra = 0, force = false) => {
    const now = Date.now();
    if (!force && now - last < 150) return;
    last = now;
    opts.onProgress?.({
      phase: "reading",
      done,
      total: files.length,
      bytesDone: bytesDone + extra,
      bytesTotal,
      path,
      reused,
      bytesReused,
    });
  };
  for (const [i, f] of files.entries()) {
    opts.signal?.throwIfAborted();
    const known = opts.cache?.get(f);
    if (known) {
      out.push(known);
      reused++;
      bytesReused += f.size;
      bytesDone += f.size;
      report(i + 1, f.path);
      continue;
    }
    report(i, f.path, 0, true);
    try {
      const c = await inspectFile(f.path, { signal: opts.signal, onBytes: (b) => report(i, f.path, b) });
      opts.cache?.set(f, c);
      out.push(c);
    } catch (e) {
      opts.signal?.throwIfAborted();
      if (!opts.onSkipped) throw e;
      opts.onSkipped(f.path, `übersprungen: ${errText(e)}`);
    }
    bytesDone += f.size;
  }
  report(files.length, "", 0, true);
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

/**
 * Schreibt ein Gerät Ortszeit in als UTC markierte Felder? Prüfbar, wenn der Dateiname auch eine
 * Uhrzeit trägt: Liegt der Stempel wie geschrieben nahe am Dateinamen, umgerechnet aber nicht,
 * ist es Ortszeit. Die Mehrheit der Dateien eines Geräts entscheidet; ohne Hinweis gilt UTC.
 */
export function stampsLookLocal(candidates: ImportCandidate[], timeZone: string): boolean {
  const NEAR = 5 * 60_000;
  let local = 0;
  let utc = 0;
  for (const c of candidates) {
    const named = c.evidence.find((e) => e.kind === "filename");
    // Ein Name in UTC (Pixel) taugt nicht als Ortszeit-Vergleich.
    if (!named || (named.utcMs !== null && named.utcMs !== undefined)) continue;
    for (const e of c.evidence) {
      if (e.kind !== "metadata" || e.utcMs === null || e.utcMs === undefined) continue;
      // Verglichen wird der Beginn: ein Stempel am Aufnahmeende (siehe clip-times.ts) um die Länge zurückgerechnet.
      const atMs = e.atMediaMs ?? 0;
      const asWritten = Math.abs(e.localMs - atMs - named.localMs);
      const converted = Math.abs(utcToLocal(e.utcMs, timeZone) - atMs - named.localMs);
      if (Math.abs(asWritten - converted) < NEAR) continue; // Zeitzone UTC oder kein Unterschied
      if (asWritten <= NEAR && asWritten < converted) local++;
      else if (converted <= NEAR) utc++;
    }
  }
  return local > utc;
}

/**
 * Nennt das Aufnahme-XML einer Kamera eine andere Zeitzone als die des Einsatzes (etwa +01:00 im Sommer in
 * Deutschland), ist meist nur die Zone falsch eingestellt, die Uhr aber nach der Ortszeit gestellt. Dann gilt die
 * Uhrzeit wie geschrieben; die Zone steht im Zeitbeleg, und im Gerätemenü lässt sich auf UTC umstellen.
 */
export function cameraZoneDiffers(candidates: ImportCandidate[], timeZone: string): boolean {
  return candidates.some((c) =>
    c.evidence.some(
      (e) =>
        e.kind === "metadata" &&
        e.detail.includes("Kamera-XML") &&
        e.utcMs != null &&
        e.localMs - e.utcMs !== utcToLocal(e.utcMs, timeZone) - e.utcMs,
    ),
  );
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
    // Zeitbelege je Gerät nachschärfen (Aufnahmeende statt -beginn, Kamera-Timecode), dann chronologisch.
    const ordered = refineClipTimes(candidates).toSorted(
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
    const tz = store.getSession(sessionId).timeZone;
    result.devicesCreated = result.devicesCreated.map((d) => {
      const own = ordered.filter((c) => c.deviceKey === d.matchKey);
      return stampsLookLocal(own, tz) || cameraZoneDiffers(own, tz)
        ? store.updateDevice(d.id, { timestampsAreUtc: false })
        : d;
    });
    return result;
  });
}
