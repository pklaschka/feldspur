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
  montagePreview,
  type MontagePreview,
  type OverlayFrame,
  type OverlayRenderer,
  type OverlayTimeline,
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

export function registerOverlayBridge(): void {
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
  const ask = (tl: OverlayTimeline, frames: OverlayFrame[]) =>
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

export function montagePlan(s: ProjectStore, sessionId: string): MontagePreview {
  return montagePreview(buildScaffold(s, sessionId));
}

export function previewExport(s: ProjectStore, sessionId: string): ScaffoldPreview {
  const sc = buildScaffold(s, sessionId);
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
  opts: { video: boolean; resolve?: boolean },
): Promise<ExportOutcome> {
  // Eine Ausgabe nach der anderen: ffmpeg und die Einblendungen brauchen die ganze Maschine.
  if (running) throw new Error("Es läuft schon eine Ausgabe. Bitte warten, bis sie fertig ist.");
  running = sessionId;
  try {
    const dir = join(parent, baseName(buildScaffold(s, sessionId)));
    const r = await exportSession(s, sessionId, dir, {
      video: opts.video,
      resolve: opts.resolve,
      overlay: overlayVia(wc),
      cacheDir: join(app.getPath("userData"), "Montage-Zwischenspeicher", sessionId),
      onProgress: (step, done, total) => wc.send(IPC.exportProgress, { sessionId, step, done, total }),
    });
    return { dir: r.dir, files: r.files.map((f) => join(r.dir, f)), durationMs: r.durationMs };
  } finally {
    running = null;
  }
}
