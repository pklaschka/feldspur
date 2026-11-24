/**
 * Montagevideo, wenn die Hardware-Dekodierung versagt (`renderMontage` in `packages/media/src/montage-video.ts`): ein
 * nachgestelltes ffmpeg scheitert, sobald Hardware-Dekodierung verlangt wird. Nicht unter Windows.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths } from "../src/import.ts";
import { renderMontage } from "../src/montage-video.ts";
import { buildSessionTranscript } from "../src/session-transcript.ts";
import { setToolPaths, toolPaths } from "../src/tools.ts";
import { hasFfmpeg, makeSyncVideo } from "./fixtures.ts";

/** Für die Shell in einfache Anführungszeichen gesetzt (Pfade mit Leerzeichen). */
const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const hwCalls = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0);

/**
 * Dem statischen ffmpeg unter Linux fehlen ohne Grafiktreiber-Bibliotheken (libva, CUDA) die Geräte für
 * `-hwaccel auto`; es bricht dann mit einer Assertion ab. Das Montagevideo entsteht trotzdem, ohne Hardware-Dekodierung.
 */
describe.skipIf(!hasFfmpeg() || process.platform === "win32")("Montagevideo ohne Hardware-Dekodierung", () => {
  let dir: string;
  let store: ProjectStore;
  let sessionId: string;
  let calls: string;
  /** Gibt es diese Datei, scheitert jeder Bildabschnitt, auch ohne Hardware-Dekodierung. */
  let broken: string;
  const before = toolPaths();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "feldspur-hwaccel-"));
    const raw = join(dir, "roh");
    mkdirSync(raw);
    makeSyncVideo(join(raw, "C0001.MP4"), { seconds: 4, creationTime: "2026-09-14T08:18:47.000000Z" });
    store = ProjectStore.open(":memory:");
    sessionId = store.addSession({ title: "Ohne Treiber", date: "2026-09-14" }).id;
    applyImport(store, sessionId, await scanPaths([raw]));
    // Ein ffmpeg, das bei -hwaccel abstürzt wie das statische auf einem Rechner ohne libva, sonst das echte.
    const fake = join(dir, "ffmpeg");
    calls = join(dir, "aufrufe.txt");
    broken = join(dir, "kaputt");
    writeFileSync(
      fake,
      `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "-hwaccel" ]; then
    echo hwaccel >> ${sh(calls)}
    echo "ffmpeg: libva-drm.so.2.init.c:122: load_library: Assertion failed." >&2
    kill -ABRT $$
    exit 134
  fi
done
for a in "$@"; do
  if [ "$a" = "-frames:v" ] && [ -e ${sh(broken)} ]; then
    echo "Abschnitt kaputt" >&2
    exit 1
  fi
done
exec ${sh(before.ffmpeg)} "$@"
`,
    );
    chmodSync(fake, 0o755);
    setToolPaths({ ffmpeg: fake });
  });
  afterAll(() => {
    setToolPaths(before);
    store?.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("meldet den eigentlichen Fehler und behält die Hardware-Dekodierung bei", { timeout: 120_000 }, async () => {
    // Angenommen: Der Abschnitt scheitert mit und ohne Hardware-Dekodierung
    const transcript = buildSessionTranscript(store, sessionId);
    writeFileSync(broken, "");
    // Wenn: das Montagevideo gerechnet wird, dann kommt der Fehler des Laufs ohne Hardware-Dekodierung zurück
    await expect(
      renderMontage(transcript, join(dir, "kaputt.mp4"), { workDir: join(dir, "a0"), cacheDir: join(dir, "c0") }),
    ).rejects.toThrow("Abschnitt kaputt");
    rmSync(broken);
    // Dann: Es blieb bei einem Versuch mit Hardware-Dekodierung; der nächste Test zeigt, dass sie eingeschaltet blieb
    expect(hwCalls(calls)).toBe(1);
    rmSync(calls);
  });

  it("rechnet den Abschnitt ohne Hardware-Dekodierung neu und danach gleich ohne", { timeout: 120_000 }, async () => {
    // Angenommen: ein ffmpeg, das an -hwaccel abstürzt, und noch kein gelungener Lauf ohne
    const transcript = buildSessionTranscript(store, sessionId);
    const out = join(dir, "montage.mp4");
    const progress: number[] = [];
    // Wenn: das Montagevideo zweimal gerechnet wird (das zweite Mal ohne Zwischenspeicher)
    await renderMontage(transcript, out, {
      workDir: join(dir, "a1"),
      cacheDir: join(dir, "c1"),
      onProgress: (done) => progress.push(done),
    });
    const first = hwCalls(calls);
    await renderMontage(transcript, join(dir, "noch-einmal.mp4"), {
      workDir: join(dir, "a2"),
      cacheDir: join(dir, "c2"),
    });
    // Dann: entstehen beide Videos vollständig, und nur der erste Lauf hat es mit Hardware-Dekodierung versucht
    expect(first).toBe(1);
    expect(hwCalls(calls)).toBe(first);
    expect(progress.at(-1)).toBeGreaterThanOrEqual(4);
    for (const f of [out, join(dir, "noch-einmal.mp4")]) {
      const seconds = Number(
        execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString(),
      );
      expect(seconds).toBeGreaterThan(3.5);
    }
  });
});
