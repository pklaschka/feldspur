import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IPC } from "../src/shared/api.ts";
import { fakeWebContents } from "./fake-webcontents.ts";

/**
 * Issue #244: Wird das Projekt gewechselt, während ein Dateidialog offen ist (Doppelklick auf eine andere Datei,
 * „Öffnen mit“), arbeitet der Aufruf danach nicht mit dem geschlossenen Projekt weiter, sondern sagt, was los ist.
 * Dasselbe gilt für Aufrufe, die erst lange rechnen und dann speichern.
 */
const dir = mkdtempSync(join(tmpdir(), "feldspur-wechsel-"));
const e = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dialog: null as null | ((r: { canceled: boolean; filePath?: string; filePaths: string[] }) => void),
}));
const waitForDialog = () =>
  new Promise<{ canceled: boolean; filePath?: string; filePaths: string[] }>((res) => (e.dialog = res));
vi.mock("electron", () => ({
  app: {
    getPath: () => dir,
    getVersion: () => "0.0.0",
    isPackaged: false,
    getAppPath: () => dir,
    addRecentDocument: () => {},
  },
  ipcMain: {
    on: () => {},
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => e.handlers.set(channel, fn),
  },
  dialog: { showSaveDialog: waitForDialog, showOpenDialog: waitForDialog },
  clipboard: {},
  ClipboardItem: class {},
  shell: {},
  powerSaveBlocker: { start: () => 0, stop: () => {}, isStarted: () => false },
}));
const { registerIpc } = await import("../src/main/ipc/index.ts");
const { closeStore, openStore, requireStore } = await import("../src/main/state.ts");
registerIpc();
// Setzt sonst der Build ein (vite.config.ts); die Ausgabe nennt das Erscheinungsdatum in der LIESMICH.
vi.stubGlobal("__FELDSPUR_RELEASED__", "2026-01-01");

const call = (channel: string, ...args: unknown[]) =>
  e.handlers.get(channel)!({ sender: fakeWebContents() }, ...args) as Promise<unknown>;

/** Den offenen Dialog mit dieser Wahl schließen, sobald er sich geöffnet hat. */
async function answerDialog(path: string): Promise<void> {
  await vi.waitFor(() => expect(e.dialog).not.toBeNull());
  e.dialog!({ canceled: false, filePath: path, filePaths: [path] });
  e.dialog = null;
}

let n = 0;
beforeEach(() => {
  e.dialog = null;
  openStore(join(dir, `Erstes-${++n}.feldspur`), true);
});
afterAll(() => {
  closeStore();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const SWITCHED = "Das Projekt wurde inzwischen gewechselt";

describe("Projektwechsel während eines Dateidialogs", () => {
  it.each`
    aufruf                            | channel                | args                        | gewählt
    ${"Sicherung erstellen"}          | ${IPC.createBackup}    | ${[]}                       | ${"Sicherung.feldspur"}
    ${"Änderungsprotokoll speichern"} | ${IPC.exportChangeLog} | ${[]}                       | ${"Protokoll.csv"}
    ${"Ausgeben"}                     | ${IPC.exportSession}   | ${["s1", { video: false }]} | ${"Ausgabe"}
  `("$aufruf endet mit einer verständlichen Meldung und schreibt nichts", async ({ channel, args, gewählt }) => {
    const chosen = join(dir, `${n}-${gewählt}`);
    // Angenommen: der Dialog ist offen
    const pending = call(channel, ...args);
    await vi.waitFor(() => expect(e.dialog).not.toBeNull());
    // Wenn: inzwischen ein anderes Projekt geöffnet und dann im Dialog etwas gewählt wird
    openStore(join(dir, `Zweites-${n}.feldspur`), true);
    await answerDialog(chosen);
    // Dann: arbeitet der Aufruf nicht im alten, geschlossenen Projekt weiter
    await expect(pending).rejects.toThrow(SWITCHED);
    expect(existsSync(chosen)).toBe(false);
  });

  it("ohne Wechsel entsteht die Sicherung am gewählten Ort", async () => {
    const chosen = join(dir, "Sicherung-ohne-Wechsel.feldspur");
    // Wenn: im Dialog ein Ort gewählt wird und das Projekt offen bleibt
    const pending = call(IPC.createBackup);
    await answerDialog(chosen);
    // Dann: liegt die Sicherung dort
    expect(await pending).toBe(chosen);
    expect(existsSync(chosen)).toBe(true);
  });
});

describe("Projektwechsel, während ein Aufruf rechnet", () => {
  it("Lautstärke messen nennt den Wechsel statt eines Fehlers aus dem geschlossenen Projekt", async () => {
    // Angenommen: eine Tonaufnahme, deren Pegel gerade gemessen wird (die Datei ist erfunden, das Messen scheitert)
    const s = requireStore();
    const source = s.addSource({
      sessionId: s.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} }).id,
      deviceId: null,
      kind: "audio",
      fileName: "ZOOM0001.WAV",
      originalPath: join(dir, "gibt-es-nicht", "ZOOM0001.WAV"),
      sizeBytes: 3,
      sha256: "0".repeat(64),
      durationMs: 1000,
      metadata: {},
    });
    const pending = call(IPC.measureLevel, source.id);
    // Wenn: inzwischen ein anderes Projekt geöffnet wird
    openStore(join(dir, `Zweites-${n}.feldspur`), true);
    // Dann: zählt der Wechsel, nicht was im alten Projekt danach schiefgeht
    await expect(pending).rejects.toThrow(SWITCHED);
  });
});
