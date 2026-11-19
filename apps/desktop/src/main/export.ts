/**
 * Ausgeben aus der App: Ordner wählen, Export anstoßen, Einblendungen von der Oberfläche zeichnen lassen.
 */
import { join } from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import type { ExportSettings, ProjectStore } from "@feldspur/core";
import {
  baseName,
  buildSessionTranscript,
  compareExport,
  exportFingerprint,
  type ExportStatus,
  entryText,
  exportSession,
  ExportPrecheckError,
  type ImageRef,
  montagePreview,
  type MontagePreview,
  type OverlayFrame,
  type OverlayRenderer,
  type OverlayHeader,
  timestamp,
} from "@feldspur/media";
import { IPC, type ExportRunResult, type SessionTranscriptPreview } from "../shared/api.ts";
import { exportBlocker } from "./originals.ts";

const CHUNK = 60;
let running: string | null = null;
let controller: AbortController | null = null;

/** Läuft gerade eine Ausgabe? Dann nicht schließen, ohne zu fragen. */
export function exportRunning(): boolean {
  return running !== null;
}

/** Einsatz, für den gerade ausgegeben wird (null = keine Ausgabe). */
export function exportingSession(): string | null {
  return running;
}
let nextId = 1;
const pending = new Map<number, { resolve: (b: Buffer[]) => void; reject: (e: Error) => void }>();

const pendingStills = new Map<number, (b: Buffer | null) => void>();

/** Lässt die Oberfläche einen Bildausschnitt als JPEG zeichnen (PDF-Seiten kann ffmpeg nicht lesen). */
function stillVia(wc: WebContents) {
  return (src: { id: string; fileName: string }, ref: ImageRef) =>
    new Promise<Buffer | null>((resolve) => {
      const id = nextId++;
      pendingStills.set(id, resolve);
      wc.send(IPC.stillRequest, id, ref, /\.pdf$/i.test(src.fileName));
    });
}

export function registerOverlayBridge(): void {
  ipcMain.on(IPC.stillReply, (_e, id: number, jpeg: Uint8Array | null) => {
    const done = pendingStills.get(id);
    pendingStills.delete(id);
    done?.(jpeg ? Buffer.from(jpeg) : null);
  });
  ipcMain.on(IPC.overlayReply, (_e, id: number, pngs: Uint8Array[], err: string | null) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (err) p.reject(new Error(`Einblendungen: ${err}`));
    else p.resolve(pngs.map((b) => Buffer.from(b)));
  });
}

/** Lässt die Oberfläche die Einblendungen zeichnen, in Häppchen, damit die IPC-Nachrichten klein bleiben. */
function overlayVia(wc: WebContents): OverlayRenderer {
  const ask = (tl: OverlayHeader, frames: OverlayFrame[]) =>
    new Promise<Buffer[]>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      wc.send(IPC.overlayRequest, id, tl, frames);
    });
  return async (tl, frames) => {
    const out: Buffer[] = [];
    for (let i = 0; i < frames.length; i += CHUNK) out.push(...(await ask(tl, frames.slice(i, i + CHUNK))));
    return out;
  };
}

/**
 * Echtzeit ist der Standard. Nach Episoden geschnitten wird nur, wenn der Einsatz Episoden bildet
 * und ausdrücklich realtime === false verlangt ist.
 */
function modeOf(s: ProjectStore, sessionId: string, realtime?: boolean) {
  const episodes = s.getSession(sessionId).episodes;
  return { mode: episodes && realtime === false ? ("episodes" as const) : ("realtime" as const), episodes };
}

export function montagePlan(s: ProjectStore, sessionId: string, realtime?: boolean): MontagePreview {
  return montagePreview(buildSessionTranscript(s, sessionId, modeOf(s, sessionId, realtime)));
}

export function previewExport(s: ProjectStore, sessionId: string, realtime?: boolean): SessionTranscriptPreview {
  const transcript = buildSessionTranscript(s, sessionId, modeOf(s, sessionId, realtime));
  return {
    base: baseName(transcript),
    durationMs: transcript.plan.durationMs,
    episodes: transcript.episodes ? transcript.plan.segments.filter((x) => x.kind === "episode").length : 0,
    cards: transcript.episodes ? transcript.plan.segments.filter((x) => x.kind === "card").length : 0,
    lines: transcript.entries.map(entryText),
    entries: transcript.entries.map((e) => ({
      kind: e.kind,
      stamp: timestamp(e.montageMs),
      clock: e.clock,
      head: e.head,
      body: e.body,
    })),
    context: transcript.context.map((c) => ({ key: c.key, head: c.head, details: c.details, body: c.body })),
  };
}

/** Einstellungen so, wie sie das Ergebnis bestimmen (Episodenschnitt nur, wenn der Einsatz Episoden bildet). */
export function exportSettings(
  s: ProjectStore,
  sessionId: string,
  opts: { video: boolean; resolve?: boolean; mixAudio?: boolean; realtime?: boolean },
): ExportSettings {
  return {
    video: opts.video,
    resolve: opts.resolve === true,
    mixAudio: opts.mixAudio !== false,
    realtime: modeOf(s, sessionId, opts.realtime).mode === "realtime",
  };
}

/** Letzte Ausgabe des Einsatzes im Vergleich zum jetzigen Stand; null, wenn er noch nie ausgegeben wurde. */
export function exportStatus(
  s: ProjectStore,
  sessionId: string,
  opts: { video: boolean; resolve?: boolean; mixAudio?: boolean; realtime?: boolean },
): ExportStatus | null {
  const record = s.getExportRecord(sessionId);
  return record ? compareExport(s, record, exportSettings(s, sessionId, opts)) : null;
}

/** Laufende Ausgabe dieses Einsatzes abbrechen (sonst nichts). */
export function cancelExport(sessionId: string): void {
  if (running === sessionId) controller?.abort();
}

export async function runExport(
  s: ProjectStore,
  wc: WebContents,
  sessionId: string,
  parent: string,
  opts: { video: boolean; resolve?: boolean; mixAudio?: boolean; realtime?: boolean },
): Promise<ExportRunResult> {
  // Eine Ausgabe nach der anderen: ffmpeg und die Einblendungen brauchen die ganze Maschine.
  if (running) throw new Error("Es läuft schon eine Ausgabe. Bitte warten, bis sie fertig ist.");
  const blocked = exportBlocker(s, sessionId, opts.video);
  if (blocked) throw new Error(blocked);
  running = sessionId;
  const ctrl = new AbortController();
  controller = ctrl;
  try {
    // Stand beim Start: Was sich während der Ausgabe ändert, kommt in die nächste (und macht diese veraltet).
    const settings = exportSettings(s, sessionId, opts);
    const fingerprint = exportFingerprint(s, sessionId, settings);
    const dir = join(parent, baseName(buildSessionTranscript(s, sessionId, modeOf(s, sessionId, opts.realtime))));
    // Schlägt die Ausgabe in denselben Ordner fehl oder wird abgebrochen, liegen dort womöglich halbe Dateien:
    // dann gilt der alte Stand nicht. Scheitert schon die Vorabprüfung, ist noch nichts geschrieben: Stand behalten.
    const r = await exportSession(s, sessionId, dir, {
      signal: ctrl.signal,
      video: opts.video,
      resolve: opts.resolve,
      overlay: overlayVia(wc),
      renderImage: stillVia(wc),
      audioMix: opts.mixAudio === false ? "main" : "all",
      ...modeOf(s, sessionId, opts.realtime),
      cacheDir: join(app.getPath("userData"), "Montage-Zwischenspeicher", sessionId),
      onProgress: (step, done, total) => wc.send(IPC.exportProgress, { sessionId, step, done, total }),
    }).catch((e: unknown) => {
      if (!(e instanceof ExportPrecheckError) && s.getExportRecord(sessionId)?.dir === dir)
        s.deleteExportRecord(sessionId);
      if (ctrl.signal.aborted) return null;
      throw e;
    });
    if (!r) return { cancelled: true };
    // Nicht rückgängig zu machen und kein Forschungsdatum: steht außerhalb des Verlaufs in der Projektdatei.
    s.saveExportRecord({
      sessionId,
      exportedAt: new Date().toISOString(),
      dir: r.dir,
      files: r.files,
      durationMs: r.durationMs,
      options: settings,
      fingerprint,
    });
    return { dir: r.dir, files: r.files.map((f) => join(r.dir, f)), durationMs: r.durationMs };
  } finally {
    running = null;
    controller = null;
  }
}
