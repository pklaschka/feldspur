import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths } from "../src/import.ts";
import { renderMontage, type OverlayRenderer } from "../src/montage-video.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { hasFfmpeg, makeSyncVideo } from "./fixtures.ts";

/** Läuft noch ein Prozess, dessen Aufruf den Ordner nennt? (pgrep gibt es auf Linux und macOS.) */
function running(dir: string): string[] {
  try {
    return execFileSync("pgrep", ["-f", dir]).toString().trim().split("\n").filter(Boolean);
  } catch {
    return []; // pgrep endet mit 1, wenn nichts passt
  }
}

// Issue #136: Scheitert ein Abschnitt, werden die übrigen und der Ton beendet, bevor renderMontage zurückkehrt.
describe.skipIf(!hasFfmpeg() || process.platform === "win32")("Montagevideo bei einem Fehler", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  let png: Buffer;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-montage-fehler-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    // Drei Abschnitte à 60 s.
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 150, creationTime: "2026-09-14T08:18:47.000000Z" });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Fehler", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    const p = join(dir, "leer.png");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black@0:s=1280x720,format=rgba",
      "-frames:v",
      "1",
      p,
    ]);
    png = readFileSync(p);
  });
  afterAll(() => {
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("bricht den laufenden Abschnitt ab und meldet den ersten Fehler", { timeout: 120_000 }, async () => {
    const transcript = buildSessionTranscript(store, sessionId);
    // Der erste Abschnitt rechnet; der zweite scheitert kurz danach an seinen Einblendungen.
    const overlay: OverlayRenderer = async (_h, frames) => {
      if (frames[0]!.montageMs >= 60_000) {
        await new Promise((r) => setTimeout(r, 800));
        throw new Error("Einblendung kaputt");
      }
      return frames.map(() => png);
    };
    const cacheDir = join(dir, "zwischenspeicher");
    await expect(
      renderMontage(transcript, join(dir, "montage.mp4"), {
        workDir: join(dir, "arbeit"),
        cacheDir,
        overlay,
        parallel: 2,
      }),
    ).rejects.toThrow("Einblendung kaputt");
    // Kein ffmpeg mehr für dieses Video (Bild oder Ton), und der erste Abschnitt wurde nicht zu Ende gerechnet.
    expect(running(dir)).toEqual([]);
    expect(readdirSync(cacheDir).filter((f) => f.endsWith(".mp4"))).toEqual([]);
  });
});
