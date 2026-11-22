/**
 * Ausgeben aus der App: Ordner wählen, Export anstoßen, Einblendungen von der Oberfläche zeichnen lassen.
 */
import { join } from "node:path";
import { app, ipcMain, powerSaveBlocker, type WebContents } from "electron";
import type { ExportSettings, ProjectStore } from "@feldspur/core";
import {
  baseName,
  buildSessionTranscript,
  compareExport,
  exportFingerprint,
  type ExportStatus,
  entryText,
  exportSession,
  methodsSummary,
  type MethodsSessionSummary,
  ExportPrecheckError,
  type ImageRef,
  montagePreview,
  type MontagePreview,
  type OverlayFrame,
  type OverlayRenderer,
  type OverlayHeader,
  timestamp,
} from "@feldspur/media";
import { EXPORT_CHECK_STEP, IPC, type ExportRunResult, type SessionTranscriptPreview } from "../shared/api.ts";
import { checkOriginals } from "./originals.ts";

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

/** Fortschritt höchstens alle 100 ms senden (die Prüfsumme meldet jedes gelesene MB), Anfang und Ende immer. */
function throttled(send: (done: number, total: number) => void): (done: number, total: number) => void {
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (done !== 0 && done !== total && now - last < 100) return;
    last = now;
    send(done, total);
  };
}
/**
 * Anfragen an die Oberfläche (Einblendungen, Standbilder), die noch auf Antwort warten. Jede endet spätestens
 * mit Abbruch, Zeitlimit oder wenn die Oberfläche neu lädt oder abstürzt (Issue #137); sonst hinge die Ausgabe
 * und sperrte jede weitere bis zum Neustart.
 */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
/** So lange darf die Oberfläche für ein Häppchen Einblendungen oder ein Standbild brauchen. */
export const BRIDGE_TIMEOUT_MS = 120_000;
const RENDERER_EVENTS = ["render-process-gone", "did-start-loading", "destroyed"] as const;

function askRenderer<T>(wc: WebContents, signal: AbortSignal, what: string, send: (id: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    if (wc.isDestroyed()) return reject(rendererGone());
    const id = nextId++;
    const cleanup = () => {
      pending.delete(id);
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      for (const ev of RENDERER_EVENTS) wc.off(ev as "destroyed", onGone);
    };
    const fail = (e: unknown) => {
      cleanup();
      reject(e);
    };
    const onAbort = () => fail(signal.reason);
    const onGone = () => fail(rendererGone());
    const timer = setTimeout(
      () =>
        fail(
          new Error(`Die Oberfläche hat ${what} nicht innerhalb von ${BRIDGE_TIMEOUT_MS / 60_000} Minuten geliefert.`),
        ),
      BRIDGE_TIMEOUT_MS,
    );
    pending.set(id, {
      resolve: (v) => {
        cleanup();
        resolve(v as T);
      },
      reject: fail,
    });
    signal.addEventListener("abort", onAbort, { once: true });
    for (const ev of RENDERER_EVENTS) wc.on(ev as "destroyed", onGone);
    send(id);
  });
}

function rendererGone(): Error {
  return new Error("Die Oberfläche wurde während der Ausgabe neu geladen oder beendet. Bitte erneut ausgeben.");
}

/** Lässt die Oberfläche einen Bildausschnitt als JPEG zeichnen (PDF-Seiten kann ffmpeg nicht lesen). */
function stillVia(wc: WebContents, signal: AbortSignal) {
  return (src: { id: string; fileName: string }, ref: ImageRef) =>
    askRenderer<Buffer | null>(wc, signal, "ein Standbild", (id) =>
      wc.send(IPC.stillRequest, id, ref, /\.pdf$/i.test(src.fileName)),
    );
}

export function registerOverlayBridge(): void {
  ipcMain.on(IPC.stillReply, (_e, id: number, jpeg: Uint8Array | null) => {
    pending.get(id)?.resolve(jpeg ? Buffer.from(jpeg) : null);
  });
  ipcMain.on(IPC.overlayReply, (_e, id: number, pngs: Uint8Array[], err: string | null) => {
    const p = pending.get(id);
    if (!p) return;
    if (err) p.reject(new Error(`Einblendungen: ${err}`));
    else p.resolve(pngs.map((b) => Buffer.from(b)));
  });
}

/** Lässt die Oberfläche die Einblendungen zeichnen, in Häppchen, damit die IPC-Nachrichten klein bleiben. */
function overlayVia(wc: WebContents, signal: AbortSignal): OverlayRenderer {
  const ask = (tl: OverlayHeader, frames: OverlayFrame[]) =>
    askRenderer<Buffer[]>(wc, signal, "die Einblendungen", (id) => wc.send(IPC.overlayRequest, id, tl, frames));
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
  opts: {
    video: boolean;
    resolve?: boolean;
    mixAudio?: boolean;
    realtime?: boolean;
    deviceTracks?: boolean;
    viewer?: boolean;
  },
): ExportSettings {
  return {
    video: opts.video,
    resolve: opts.resolve === true,
    mixAudio: opts.mixAudio !== false,
    realtime: modeOf(s, sessionId, opts.realtime).mode === "realtime",
    // Ohne Video gibt es keine Tonspuren: dann zählt die Einstellung nicht.
    deviceTracks: opts.video && opts.deviceTracks !== false,
    // Der Viewer gehört zum Video.
    viewer: opts.video && opts.viewer !== false,
  };
}

/** Letzte Ausgabe des Einsatzes im Vergleich zum jetzigen Stand; null, wenn er noch nie ausgegeben wurde. */
export function exportStatus(
  s: ProjectStore,
  sessionId: string,
  opts: {
    video: boolean;
    resolve?: boolean;
    mixAudio?: boolean;
    realtime?: boolean;
    deviceTracks?: boolean;
    viewer?: boolean;
  },
): ExportStatus | null {
  const record = s.getExportRecord(sessionId);
  return record ? compareExport(s, record, exportSettings(s, sessionId, opts)) : null;
}

/** Zahlen aller Einsätze für die Tabelle zum Methodenteil (Issue #149), mit den gewählten Einstellungen. */
export function methodsOverview(
  s: ProjectStore,
  opts: {
    video: boolean;
    resolve?: boolean;
    mixAudio?: boolean;
    realtime?: boolean;
    deviceTracks?: boolean;
    viewer?: boolean;
  },
): MethodsSessionSummary[] {
  return s.listSessions().map((x) => methodsSummary(s, x.id, exportSettings(s, x.id, opts)));
}

/**
 * Während der Ausgabe wach bleiben (Issue #142): Der Rechner geht nicht in den Ruhezustand, der Bildschirm darf
 * aber aus. Die Oberfläche zeichnet die Einblendungen und wird sonst gedrosselt, wenn ihr Fenster verdeckt ist oder
 * der Bildschirm aus ist; auch das wird für die Dauer der Ausgabe abgeschaltet. Gibt das Aufräumen zurück.
 */
function keepAwake(wc: WebContents): () => void {
  const blocker = powerSaveBlocker.start("prevent-app-suspension");
  const throttled = wc.isDestroyed() ? null : wc.getBackgroundThrottling();
  if (throttled) wc.setBackgroundThrottling(false);
  return () => {
    if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    if (throttled && !wc.isDestroyed()) wc.setBackgroundThrottling(true);
  };
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
  opts: {
    video: boolean;
    resolve?: boolean;
    mixAudio?: boolean;
    realtime?: boolean;
    deviceTracks?: boolean;
    viewer?: boolean;
    /** Auffälligkeiten der Prüfung bewusst übergehen (fehlende Pflichtdateien halten die Ausgabe trotzdem an). */
    acceptOriginals?: boolean;
  },
): Promise<ExportRunResult> {
  // Eine Ausgabe nach der anderen: ffmpeg und die Einblendungen brauchen die ganze Maschine.
  if (running) throw new Error("Es läuft schon eine Ausgabe. Bitte warten, bis sie fertig ist.");
  running = sessionId;
  const ctrl = new AbortController();
  controller = ctrl;
  const sleepAgain = keepAwake(wc);
  try {
    // Erster Schritt der Ausgabe, erst nach der Ordnerwahl (Issue #116): Originale mit Prüfsumme prüfen. Das dauert
    // bei großen Einsätzen Minuten, schon geprüfte Dateien merkt sich die App. Findet die Prüfung etwas, entscheidet
    // die Person; der gewählte Ordner kommt mit zurück, damit „Trotzdem ausgeben“ nicht noch einmal fragt.
    const send = throttled((done: number, total: number) =>
      wc.send(IPC.exportProgress, { sessionId, step: EXPORT_CHECK_STEP, done, total }),
    );
    let check;
    try {
      check = await checkOriginals(s, sessionId, { video: opts.video, signal: ctrl.signal, onBytes: send });
    } catch (e) {
      if (ctrl.signal.aborted) return { cancelled: true };
      throw e;
    }
    if (check.blocking.length || (check.warnings.length && !opts.acceptOriginals)) {
      return { originals: check, parent };
    }
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
      overlay: overlayVia(wc, ctrl.signal),
      renderImage: stillVia(wc, ctrl.signal),
      audioMix: opts.mixAudio === false ? "main" : "all",
      deviceTracks: opts.deviceTracks !== false,
      viewer: opts.viewer !== false,
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
    sleepAgain();
    running = null;
    controller = null;
  }
}
