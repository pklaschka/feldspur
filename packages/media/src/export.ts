/**
 * Ausgeben: Zeitgerüst (.docx), Dokumentvariablen (.xlsx), Begleitprotokoll (.csv) und Montagevideo in einen Ordner.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { formatClock, formatDuration, type Id, type MontageMode, type ProjectStore, type Source } from "@feldspur/core";
import { levelText, sessionLevels } from "./analyze.ts";
import type { AudioLevel } from "./audio.ts";
import { scaffoldDocx } from "./docx.ts";
import { montageFcpxml } from "./fcpxml.ts";
import { planPieces, renderMontage, type OverlayRenderer } from "./montage-video.ts";
import { buildScaffold, type ImageRef, type Scaffold, type ScaffoldEntry } from "./scaffold.ts";
import { canRenderStill, jpegSize, renderStill, type Still } from "./stills.ts";
import { excelCsv } from "./csv.ts";
import { xlsx, type Cell } from "./xlsx.ts";

export interface ExportOptions {
  /** Ohne Video geht es schnell; nützlich zum Prüfen des Gerüsts. */
  video?: boolean;
  /** Zeichnet Uhrzeit, Leisten und Tafeltexte ins Video (in der App über die Oberfläche). */
  overlay?: OverlayRenderer;
  onProgress?: (step: string, done: number, total: number) => void;
  /** Zusätzlich eine Schnittliste für DaVinci Resolve (FCPXML) mit Standbildern daneben. */
  resolve?: boolean;
  /** Zwischenspeicher für fertige Videoabschnitte (je Einsatz ein eigener Ordner). */
  cacheDir?: string;
  /** Alles in Echtzeit (Standard) oder Episoden mit kurzen Tafeln dazwischen. */
  mode?: MontageMode;
  /** Episoden auch in Echtzeit benennen (siehe ScaffoldOptions.episodes). */
  episodes?: boolean;
  /** Ton aller laufenden Geräte übereinander (Standard) oder nur die Hauptquelle. */
  audioMix?: "all" | "main";
  /**
   * Bilder, die ffmpeg nicht lesen kann (PDF-Seiten), als JPEG liefern. In der App zeichnet
   * die Oberfläche sie mit pdf.js; ohne diese Hilfe fehlen solche Ausschnitte.
   */
  renderImage?: (src: Source, ref: ImageRef) => Promise<Buffer | null>;
  /**
   * Abbrechen: exportSession wirft dann einen AbortError (laufende ffmpeg-Prozesse werden beendet).
   * Fertige Videoabschnitte bleiben im cacheDir; im Ausgabeordner können einzelne Dateien fehlen.
   */
  signal?: AbortSignal;
}

export interface ExportResult {
  dir: string;
  files: string[];
  durationMs: number;
}

/** Dateiname ohne Zeichen, die Windows oder macOS stören. */
export function safeName(s: string): string {
  return (
    s
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex -- Steuerzeichen sind in Dateinamen unzulässig
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^[._]+/, "")
      .slice(0, 80)
      .replace(/[^._][._]*$/, (m) => m[0]!) || "Einsatz"
  );
}

/**
 * Dokumentvariablen für MAXQDA (Variablen › Dokumentvariablen importieren): erste Spalten Dokumentgruppe und
 * Dokumentname, danach je Variable eine Spalte. Der Dokumentname ist der Name, den MAXQDA beim Import des
 * Zeitgerüsts vergibt (Dateiname ohne Endung); die Gruppe bleibt leer und lässt sich in Excel nachtragen.
 */
export function documentVariables(sc: Scaffold, documentName: string): Cell[][] {
  const h = sc.header;
  const placed = new Set(sc.input.sources.filter((s) => sc.resolved.placements.has(s.id)).map((s) => s.deviceId));
  const devices = sc.input.devices.filter((d) => placed.has(d.id)).map((d) => d.label);
  const first = sc.plan.segments[0];
  const last = sc.plan.segments.at(-1);
  const vars: [string, Cell][] = [
    ["Einsatz", h.title],
    ["Datum", h.date],
    ["Ort", h.place],
    ["Zeitzone", sc.input.session.timeZone],
    ["Forschende", h.researchers.join(", ")],
    ["Geräte", devices.join(", ")],
    ["Referenzuhr", h.reference ?? ""],
    ["Quellen", h.sources.length],
    ["Beginn", first ? formatClock(first.fromMs) : ""],
    ["Ende", last ? formatClock(last.toMs) : ""],
    ["Videolänge (Min.)", Math.round(sc.plan.durationMs / 6000) / 10],
    ["Montage", h.modeLabel],
    ["Montage-ID", h.montageId],
  ];
  for (const [k, v] of Object.entries(h.extra)) {
    // Eigene Felder dürfen eingebaute nicht überschreiben; MAXQDA erlaubt höchstens 63 Zeichen im Namen.
    const name = (vars.some(([n]) => n === k) ? `${k} (Einsatz)` : k).slice(0, 63);
    if (k.trim()) vars.push([name, v]);
  }
  return [
    ["Dokumentgruppe", "Dokumentname", ...vars.map(([k]) => k)],
    ["", documentName, ...vars.map(([, v]) => v)],
  ];
}

export function baseName(sc: Scaffold): string {
  const base = `Feldtag_${sc.header.date}_${safeName(sc.header.title)}`;
  return sc.plan.mode === "episodes" ? `${base}_Episoden` : base;
}

/** Begleitprotokoll: Nachweis je Quelle (Semikolon, UTF-8 mit BOM für Excel). */
export function protocolCsv(store: ProjectStore, sc: Scaffold, levels: Map<Id, AudioLevel | null> = new Map()): string {
  const { input, resolved } = sc;
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const head = [
    "Kurzzeichen",
    "Art",
    "Datei",
    "Originalpfad",
    "SHA-256",
    "Gerät",
    "Person",
    "Beginn (Uhrzeit)",
    "Ende (Uhrzeit)",
    "Unsicherheit",
    "Zeit stammt aus",
    "Uhrkorrektur",
    "Im Montagevideo ab",
    "Teil von",
    "setzt fort",
    "Lautstärke im Montagevideo",
  ];
  const label = (id: Id | null) => (id ? (input.sources.find((s) => s.id === id)?.label ?? "") : "");
  const rows = input.sources.map((s) => {
    const p = resolved.placements.get(s.id);
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    const at = p ? sc.plan.toMontage(p.startMs, s.id) : null;
    return [
      s.label,
      s.kind,
      s.fileName,
      s.originalPath,
      s.sha256,
      d?.label ?? "",
      d?.personId ? (persons.get(d.personId) ?? "") : "",
      p ? formatClock(p.startMs) : "",
      p && p.endMs !== p.startMs ? formatClock(p.endMs) : "",
      p ? `± ${formatDuration(p.uncertaintyMs)}` : "",
      p?.basis.detail ?? "keine Zeit",
      p && p.deviceCorrectionMs ? formatDuration(p.deviceCorrectionMs, { sign: true }) : "",
      at === null ? "" : formatDuration(at),
      label(s.partOf),
      label(s.follows),
      s.kind === "audio" || s.kind === "video" ? levelText(levels.get(s.id)) : "",
    ];
  });
  return excelCsv([head, ...rows]);
}

/** Standbild: Rasterbilder über ffmpeg, PDF-Seiten über die Oberfläche (falls verfügbar). */
async function stillOf(
  src: Source,
  ref: ImageRef,
  work: string,
  name: string,
  opts: ExportOptions,
): Promise<Still | null> {
  if (canRenderStill(src)) return renderStill(src, ref, work, { name });
  if (!opts.renderImage) return null;
  const data = await opts.renderImage(src, ref).catch(() => null);
  const size = data && jpegSize(data);
  return data && size ? { data, ...size } : null;
}

/** Pfad einer Ausgabedatei im Zielordner; bricht ab, falls ein Name doch aus dem Ordner herausführen würde. */
function outPath(outDir: string, name: string): string {
  const dir = resolve(outDir);
  const path = resolve(dir, name);
  if (!path.startsWith(dir + sep)) throw new Error(`Ungültiger Dateiname für die Ausgabe: ${name}`);
  return path;
}

export async function exportSession(
  store: ProjectStore,
  sessionId: Id,
  outDir: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const { signal } = opts;
  signal?.throwIfAborted();
  const sc = buildScaffold(store, sessionId, { mode: opts.mode, episodes: opts.episodes });
  if (sc.plan.durationMs <= 0) throw new Error("Nichts zu exportieren: keine Quelle hat eine Uhrzeit");
  const base = baseName(sc);
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "feldspur-export-"));
  try {
    const sources = new Map(sc.input.sources.map((s) => [s.id, s]));
    const withImages = sc.entries.filter((e) => e.images.length);
    const stills = new Map<ScaffoldEntry, (Still | null)[]>();
    let n = 0;
    for (const [i, e] of withImages.entries()) {
      signal?.throwIfAborted();
      opts.onProgress?.("Standbilder", i, withImages.length);
      const list: (Still | null)[] = [];
      for (const ref of e.images) {
        const src = sources.get(ref.sourceId);
        list.push(src ? await stillOf(src, ref, work, `still-${++n}`, opts) : null);
      }
      stills.set(e, list);
    }

    const files: string[] = [];
    const media = `${base}.mp4`;
    const levels = await sessionLevels(store, sessionId, {
      measureMissing: opts.video !== false,
      signal,
      onProgress: (done, total) => opts.onProgress?.("Lautstärke messen", done, total),
    });
    if (opts.video !== false) {
      await renderMontage(sc, outPath(outDir, media), {
        workDir: work,
        overlay: opts.overlay,
        cacheDir: opts.cacheDir,
        audioMix: opts.audioMix,
        levels,
        signal,
        onProgress: (done, total) => opts.onProgress?.("Montagevideo", done, total),
      });
      files.push(media);
    }

    if (opts.resolve) {
      const xml = montageFcpxml(sc, planPieces(sc), { projectName: base, audioMix: opts.audioMix });
      await writeFile(outPath(outDir, `${base}_Resolve.fcpxml`), xml, "utf8");
      files.push(`${base}_Resolve.fcpxml`);
    }

    signal?.throwIfAborted();
    opts.onProgress?.("Zeitgerüst", 0, 1);
    const docx = await scaffoldDocx(sc, { mediaFileName: media, stills });
    await writeFile(outPath(outDir, `${base}.docx`), docx);
    files.push(`${base}.docx`);
    await writeFile(outPath(outDir, `${base}_Variablen.xlsx`), xlsx(documentVariables(sc, base), "Dokumentvariablen"));
    files.push(`${base}_Variablen.xlsx`);
    await writeFile(outPath(outDir, `${base}_Begleitprotokoll.csv`), protocolCsv(store, sc, levels), "utf8");
    files.push(`${base}_Begleitprotokoll.csv`);
    opts.onProgress?.("Fertig", 1, 1);
    return { dir: outDir, files, durationMs: sc.plan.durationMs };
  } finally {
    // Nach einem Abbruch hält ffmpeg unter Windows Dateien im Arbeitsordner noch kurz offen (EBUSY). Mehrmals
    // versuchen; scheitert das Aufräumen trotzdem, bleibt der Ordner im Temp-Verzeichnis, statt den eigentlichen
    // Fehler oder Abbruch zu verdecken.
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  }
}
