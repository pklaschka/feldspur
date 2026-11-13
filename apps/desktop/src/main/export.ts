/**
 * Ausgeben aus der App: Ordner wählen, Export anstoßen, Einblendungen von der Oberfläche zeichnen lassen.
 */
import { join } from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import type { ProjectStore } from "@feldspur/core";
import {
  baseName,
  buildScaffold,
  entryText,
  exportSession,
  type ImageRef,
  montagePreview,
  type MontagePreview,
  type OverlayFrame,
  type OverlayRenderer,
  type OverlayHeader,
} from "@feldspur/media";
import { IPC, type ExportOutcome, type ScaffoldPreview } from "../shared/api.ts";

const CHUNK = 60;
let running: string | null = null;

/** Läuft gerade eine Ausgabe? Dann nicht schließen, ohne zu fragen. */
export function exportRunning(): boolean {
  return running !== null;
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

const modeOf = (realtime?: boolean) => ({ mode: realtime ? ("realtime" as const) : ("episodes" as const) });

export function montagePlan(s: ProjectStore, sessionId: string, realtime?: boolean): MontagePreview {
  return montagePreview(buildScaffold(s, sessionId, modeOf(realtime)));
}

export function previewExport(s: ProjectStore, sessionId: string, realtime?: boolean): ScaffoldPreview {
  const sc = buildScaffold(s, sessionId, modeOf(realtime));
  return {
    base: baseName(sc),
    durationMs: sc.plan.durationMs,
    episodes: sc.plan.segments.filter((x) => x.kind === "episode").length,
    cards: sc.plan.segments.filter((x) => x.kind === "card").length,
    lines: sc.entries.map(entryText),
  };
}

export async function runExport(
  s: ProjectStore,
  wc: WebContents,
  sessionId: string,
  parent: string,
  opts: { video: boolean; resolve?: boolean; mixAudio?: boolean; realtime?: boolean },
): Promise<ExportOutcome> {
  // Eine Ausgabe nach der anderen: ffmpeg und die Einblendungen brauchen die ganze Maschine.
  if (running) throw new Error("Es läuft schon eine Ausgabe. Bitte warten, bis sie fertig ist.");
  running = sessionId;
  try {
    const dir = join(parent, baseName(buildScaffold(s, sessionId, modeOf(opts.realtime))));
    const r = await exportSession(s, sessionId, dir, {
      video: opts.video,
      resolve: opts.resolve,
      overlay: overlayVia(wc),
      renderImage: stillVia(wc),
      audioMix: opts.mixAudio === false ? "main" : "all",
      ...modeOf(opts.realtime),
      cacheDir: join(app.getPath("userData"), "Montage-Zwischenspeicher", sessionId),
      onProgress: (step, done, total) => wc.send(IPC.exportProgress, { sessionId, step, done, total }),
    });
    return { dir: r.dir, files: r.files.map((f) => join(r.dir, f)), durationMs: r.durationMs };
  } finally {
    running = null;
  }
}
