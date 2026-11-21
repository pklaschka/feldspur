/**
 * Ausgeben: Einsatztranskript (.docx), Dokumentvariablen (.xlsx), Begleitprotokoll (.csv) und Montagevideo in einen Ordner.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { formatClock, formatDuration, type Id, type MontageMode, type ProjectStore, type Source } from "@feldspur/core";
import { levelText, sessionLevels } from "./analyze.ts";
import { unpackEnvelope, type AudioLevel } from "./audio.ts";
import { sessionTranscriptDocx } from "./docx.ts";
import { montageFcpxml } from "./fcpxml.ts";
import { planPieces, renderMontage, type MontageResult, type OverlayRenderer } from "./montage-video.ts";
import {
  buildSessionTranscript,
  type ImageRef,
  type SessionTranscript,
  type SessionTranscriptContext,
  type SessionTranscriptEntry,
} from "./session-transcript.ts";
import { canRenderStill, jpegSize, renderStill, type Still } from "./stills.ts";
import { excelCsv } from "./csv.ts";
import { log, logSince, logSize } from "./log.ts";
import { sessionTranscriptHtml } from "./viewer/html.ts";
import { xlsx, type Cell } from "./xlsx.ts";
import { ensureWritable, ExportPrecheckError, friendlyWriteError, friendlyWriteErrorIn } from "./write-check.ts";

export interface ExportOptions {
  /** Ohne Video geht es schnell; nützlich zum Prüfen des Einsatztranskripts. */
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
  /** Episoden auch in Echtzeit benennen (siehe SessionTranscriptOptions.episodes). */
  episodes?: boolean;
  /** Ton aller laufenden Geräte übereinander (Standard) oder nur die Hauptquelle. */
  audioMix?: "all" | "main";
  /** Nach der Mischung je Gerät eine eigene Tonspur ins Montagevideo (ab zwei Geräten mit Ton). */
  deviceTracks?: boolean;
  /** Viewer (.html) neben dem Montagevideo: Einsatztranskript synchron zum Video im Browser (nur mit Video). */
  viewer?: boolean;
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
 * Einsatztranskripts vergibt (Dateiname ohne Endung); die Gruppe bleibt leer und lässt sich in Excel nachtragen.
 */
export function documentVariables(transcript: SessionTranscript, documentName: string): Cell[][] {
  const h = transcript.header;
  const placed = new Set(
    transcript.input.sources.filter((s) => transcript.resolved.placements.has(s.id)).map((s) => s.deviceId),
  );
  const devices = transcript.input.devices.filter((d) => placed.has(d.id)).map((d) => d.label);
  const first = transcript.plan.segments[0];
  const last = transcript.plan.segments.at(-1);
  const vars: [string, Cell][] = [
    ["Einsatz", h.title],
    ["Datum", h.date],
    ["Ort", h.place],
    ["Zeitzone", transcript.input.session.timeZone],
    ["Forschende", h.researchers.join(", ")],
    ["Geräte", devices.join(", ")],
    ["Referenzuhr", h.reference ?? ""],
    ["Quellen", h.sources.length],
    // Nur mit Kontext: So bleiben Ausgaben ohne Kontext Zeichen für Zeichen wie vor Issue #108.
    ...(h.contextCount ? [["Kontextstücke", h.contextCount] as [string, Cell]] : []),
    ["Beginn", first ? formatClock(first.fromMs) : ""],
    ["Ende", last ? formatClock(last.toMs) : ""],
    ["Videolänge (Min.)", Math.round(transcript.plan.durationMs / 6000) / 10],
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

export function baseName(transcript: SessionTranscript): string {
  const base = `Feldtag_${transcript.header.date}_${safeName(transcript.header.title)}`;
  return transcript.plan.mode === "episodes" ? `${base}_Episoden` : base;
}

/** Begleitprotokoll: Nachweis je Quelle (Semikolon, UTF-8 mit BOM für Excel). */
export function protocolCsv(
  store: ProjectStore,
  transcript: SessionTranscript,
  levels: Map<Id, AudioLevel | null> = new Map(),
): string {
  const { input, resolved } = transcript;
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
  // Kontext (Issue #108): eigene Spalten nur, wenn es Kontext gibt.
  const withContext = transcript.context.length > 0;
  const pieces = new Map(transcript.context.map((c) => [c.key, c]));
  const entriesOf = (s: Source) => {
    const parts = new Set([s.id, ...input.sources.filter((x) => x.partOf === s.id).map((x) => x.id)]);
    return input.diaryEntries.filter((e) => e.regions.some((r) => parts.has(r.sourceId)));
  };
  const roleOf = (s: Source): string => {
    const main = s.partOf ? input.sources.find((x) => x.id === s.partOf) : s;
    if (!main) return "";
    if (main.kind !== "diary") return main.role === "context" ? "Kontext" : "Chronologie";
    const roles = new Set(entriesOf(main).map((e) => e.role));
    if (roles.has("context") && roles.has("timeline")) return "Chronologie und Kontext";
    return roles.has("context") ? "Kontext" : "Chronologie";
  };
  const contextOf = (s: Source): { names: string; made: string } => {
    if (s.partOf) return { names: "", made: "" };
    const keys = s.kind === "diary" ? entriesOf(s).map((e) => `entry:${e.id}`) : [`source:${s.id}`];
    const found = keys.flatMap((k) => (pieces.has(k) ? [pieces.get(k)!] : []));
    const made = [
      ...new Set(
        found.map((c) =>
          c.key.startsWith("source:")
            ? s.contextMade
            : (input.diaryEntries.find((e) => `entry:${e.id}` === c.key)?.contextMade ?? ""),
        ),
      ),
    ].filter(Boolean);
    return {
      names: found.map((c) => `${c.position}: ${c.head.replace(/^Kontext · /, "")}`).join("; "),
      made: made.join("; "),
    };
  };
  const contextResting = new Map(transcript.resolved.context.map((c) => [c.sourceId ?? "", c.wouldStartMs]));
  if (withContext) head.push("Rolle", "Kontext", "Kontext entstanden");
  const label = (id: Id | null) => (id ? (input.sources.find((s) => s.id === id)?.label ?? "") : "");
  const rows = input.sources.map((s) => {
    const p = resolved.placements.get(s.id);
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    const at = p ? transcript.plan.toMontage(p.startMs, s.id) : null;
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
      p?.basis.detail ??
        (withContext && roleOf(s) === "Kontext"
          ? `Kontext, bewusst ohne Uhrzeit${contextResting.get(s.id) != null ? ` (Lage ${formatClock(contextResting.get(s.id)!)} ruht)` : ""}`
          : "keine Zeit"),
      p && p.deviceCorrectionMs ? formatDuration(p.deviceCorrectionMs, { sign: true }) : "",
      at === null ? "" : formatDuration(at),
      label(s.partOf),
      label(s.follows),
      s.kind === "audio" || s.kind === "video" ? levelText(levels.get(s.id)) : "",
      ...(withContext ? [roleOf(s), contextOf(s).names, contextOf(s).made] : []),
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
  if (canRenderStill(src)) {
    log("ausgabe", `Standbild ${name} aus ${src.originalPath}`);
    return renderStill(src, ref, work, { name, signal: opts.signal });
  }
  if (!opts.renderImage) {
    log("ausgabe", `kein Standbild für ${src.originalPath} (Format ohne Vorschau)`);
    return null;
  }
  log("ausgabe", `Standbild ${name} aus ${src.originalPath} über die Oberfläche`);
  const data = await opts.renderImage(src, ref).catch(() => null);
  const size = data && jpegSize(data);
  if (!data || !size) log("ausgabe", `  Standbild ${name} fehlgeschlagen`);
  return data && size ? { data, ...size } : null;
}

/** Schreibt eine Ausgabedatei und vermerkt sie im Protokoll. */
async function writeOut(path: string, data: string | Uint8Array, what: string): Promise<void> {
  await writeFile(path, data, typeof data === "string" ? "utf8" : undefined);
  log(
    "ausgabe",
    `schreibt ${what} ${path} (${logSize(typeof data === "string" ? Buffer.byteLength(data) : data.byteLength)})`,
  );
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
  const transcript = buildSessionTranscript(store, sessionId, { mode: opts.mode, episodes: opts.episodes });
  if (transcript.plan.durationMs <= 0)
    throw new Error(
      transcript.context.length
        ? "Nichts auszugeben: Keine Quelle liegt auf der Zeitachse. Kontext allein ergibt kein Einsatztranskript."
        : "Nichts zu exportieren: keine Quelle hat eine Uhrzeit",
    );
  const base = baseName(transcript);
  const started = performance.now();
  log(
    "ausgabe",
    `beginnt ${base} nach ${outDir} (Montagevideo ${opts.video !== false ? "ja" : "nein"}, Viewer ${opts.viewer ? "ja" : "nein"}, Schnittliste ${opts.resolve ? "ja" : "nein"}, ${transcript.entries.length} Einträge, ${formatDuration(transcript.plan.durationMs)})`,
  );
  try {
    await mkdir(outDir, { recursive: true });
    // Gesperrte oder schreibgeschützte Dateien (z. B. noch in Word offen) sofort melden, nicht erst nach dem Video.
    await ensureWritable(
      [
        ...(opts.video !== false ? [`${base}.mp4`] : []),
        ...(opts.video !== false && opts.viewer ? [`${base}.html`] : []),
        ...(opts.resolve ? [`${base}_Resolve.fcpxml`] : []),
        `${base}.docx`,
        `${base}_Variablen.xlsx`,
        `${base}_Begleitprotokoll.csv`,
      ].map((name) => outPath(outDir, name)),
    );
  } catch (e) {
    // Noch nichts geschrieben: eigene Klasse, damit die App den Stand einer früheren Ausgabe behält.
    const friendly = friendlyWriteError(e, outDir);
    log("ausgabe", `Vorprüfung gescheitert: ${friendly instanceof Error ? friendly.message : String(friendly)}`);
    throw new ExportPrecheckError(friendly instanceof Error ? friendly.message : String(friendly), { cause: e });
  }
  const work = await mkdtemp(join(tmpdir(), "feldspur-export-"));
  log("ausgabe", `Zielordner beschreibbar; Arbeitsordner ${work}`);
  try {
    const sources = new Map(transcript.input.sources.map((s) => [s.id, s]));
    const withImages = transcript.entries.filter((e) => e.images.length);
    const stills = new Map<SessionTranscriptEntry, (Still | null)[]>();
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
    const contextStills = new Map<SessionTranscriptContext, (Still | null)[]>();
    for (const c of transcript.context) {
      signal?.throwIfAborted();
      const list: (Still | null)[] = [];
      for (const ref of c.images) {
        const src = sources.get(ref.sourceId);
        list.push(src ? await stillOf(src, ref, work, `still-${++n}`, opts) : null);
      }
      contextStills.set(c, list);
    }

    const files: string[] = [];
    const media = `${base}.mp4`;
    const levels = await sessionLevels(store, sessionId, {
      measureMissing: opts.video !== false,
      signal,
      onProgress: (done, total) => opts.onProgress?.("Lautstärke messen", done, total),
    });
    let montage: MontageResult | null = null;
    if (opts.video !== false) {
      montage = await renderMontage(transcript, outPath(outDir, media), {
        workDir: work,
        overlay: opts.overlay,
        cacheDir: opts.cacheDir,
        audioMix: opts.audioMix,
        deviceTracks: opts.deviceTracks,
        levels,
        signal,
        onProgress: (done, total) => opts.onProgress?.("Montagevideo", done, total),
      });
      files.push(media);
    }

    if (opts.resolve) {
      const xml = montageFcpxml(transcript, planPieces(transcript), { projectName: base, audioMix: opts.audioMix });
      await writeOut(outPath(outDir, `${base}_Resolve.fcpxml`), xml, "Schnittliste");
      files.push(`${base}_Resolve.fcpxml`);
    }

    signal?.throwIfAborted();
    opts.onProgress?.("Einsatztranskript", 0, 1);
    const docx = await sessionTranscriptDocx(transcript, { mediaFileName: media, stills, contextStills });
    await writeOut(outPath(outDir, `${base}.docx`), docx, "Einsatztranskript");
    files.push(`${base}.docx`);
    if (montage && opts.viewer) {
      opts.onProgress?.("Viewer", 0, 1);
      const html = sessionTranscriptHtml(transcript, {
        mediaFileName: media,
        stills,
        contextStills,
        audioTracks: montage.audioTracks,
        // Wellenform der Gerätespuren aus der Tonspur-Analyse; ohne Analyse bleibt die Aufnahme ein glatter Balken.
        envelopes: new Map(
          store.listAudioAnalyses(sessionId).map((a) => [a.sourceId, unpackEnvelope(a.envelope, a.envelopeRate)]),
        ),
      });
      await writeOut(outPath(outDir, `${base}.html`), html, "Viewer");
      files.push(`${base}.html`);
    }
    await writeOut(
      outPath(outDir, `${base}_Variablen.xlsx`),
      xlsx(documentVariables(transcript, base), "Dokumentvariablen"),
      "Dokumentvariablen",
    );
    files.push(`${base}_Variablen.xlsx`);
    await writeOut(
      outPath(outDir, `${base}_Begleitprotokoll.csv`),
      protocolCsv(store, transcript, levels),
      "Begleitprotokoll",
    );
    files.push(`${base}_Begleitprotokoll.csv`);
    opts.onProgress?.("Fertig", 1, 1);
    log("ausgabe", `fertig nach ${logSince(started)}: ${files.join(", ")}`);
    return { dir: outDir, files, durationMs: transcript.plan.durationMs };
  } catch (e) {
    log("ausgabe", `abgebrochen nach ${logSince(started)}: ${e instanceof Error ? e.message : String(e)}`);
    throw friendlyWriteErrorIn(e, outDir);
  } finally {
    // Nach einem Abbruch hält ffmpeg unter Windows Dateien im Arbeitsordner noch kurz offen (EBUSY). Mehrmals
    // versuchen; scheitert das Aufräumen trotzdem, bleibt der Ordner im Temp-Verzeichnis, statt den eigentlichen
    // Fehler oder Abbruch zu verdecken.
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).then(
      () => log("ausgabe", `Arbeitsordner entfernt`),
      (e: unknown) => log("ausgabe", `Arbeitsordner bleibt liegen (${e instanceof Error ? e.message : String(e)})`),
    );
  }
}
