import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runTool, setToolPaths, toolPaths, ToolError } from "../src/index.ts";
import { hasFfmpeg } from "./fixtures.ts";

const original = { ...toolPaths() };
afterEach(() => setToolPaths(original));

describe.skipIf(!hasFfmpeg())("runTool", () => {
  it("liefert die Ausgabe des Programms", async () => {
    const out = await runTool("ffprobe", ["-version"]);
    expect(out).toMatch(/ffprobe version/);
  });

  it("meldet Fehler einheitlich mit der ersten stderr-Zeile", async () => {
    // Wenn: ffmpeg eine Datei öffnen soll, die es nicht gibt
    const e = await runTool("ffmpeg", ["-v", "error", "-i", "/gibt/es/nicht.wav", "-f", "null", "-"]).catch((x) => x);
    // Dann: ein ToolError mit Programm, Exit-Code und erster stderr-Zeile
    expect(e).toBeInstanceOf(ToolError);
    expect(e.tool).toBe("ffmpeg");
    expect(e.exitCode).not.toBe(0);
    expect(e.message).toMatch(/^ffmpeg \(\d+\): .*nicht\.wav/);
  });

  it("meldet ein fehlendes Programm", async () => {
    // Angenommen: der Pfad zu ffmpeg zeigt ins Leere
    setToolPaths({ ffmpeg: join(tmpdir(), "feldspur-kein-ffmpeg") });
    await expect(runTool("ffmpeg", ["-version"])).rejects.toThrow(/lässt sich nicht starten/);
  });

  it("bricht ab, wenn das Signal abbricht", async () => {
    // Angenommen: ein ffmpeg, das endlos Stille rechnet
    const ctrl = new AbortController();
    const run = runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc", "-f", "null", "-"], {
      signal: ctrl.signal,
    });
    // Wenn: nach 200 ms abgebrochen wird
    setTimeout(() => ctrl.abort(), 200);
    // Dann: endet der Aufruf mit einem Abbruch
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lehnt sofort ab, wenn das Signal schon abgebrochen ist", async () => {
    await expect(runTool("ffprobe", ["-version"], { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("beendet einen Prozess ohne Ausgabe nach dem Stillstands-Zeitlimit", async () => {
    // -re liest in Echtzeit und gibt mit -v error nichts aus: sieht aus wie ein hängender Prozess.
    // Angenommen: ein Stillstands-Zeitlimit von 0,3 s
    const e = await runTool("ffmpeg", ["-v", "error", "-re", "-f", "lavfi", "-i", "anullsrc", "-f", "null", "-"], {
      idleTimeoutMs: 300,
    }).catch((x) => x);
    // Dann: wird er beendet und der Fehler nennt den Stillstand
    expect(e).toBeInstanceOf(ToolError);
    expect(e.message).toMatch(/kommt seit 0\.3 s nicht weiter/);
  });

  it("beendet einen Prozess nach dem Gesamt-Zeitlimit", async () => {
    // Angenommen: ein Gesamt-Zeitlimit von 0,3 s für einen endlosen Prozess
    const e = await runTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "anullsrc", "-f", "null", "-"], {
      timeoutMs: 300,
    }).catch((x) => x);
    // Dann: wird er beendet und der Fehler nennt das Zeitlimit
    expect(e).toBeInstanceOf(ToolError);
    expect(e.message).toMatch(/nach 0\.3 s nicht geantwortet/);
  });
});

// Kleines Ersatzprogramm, das sich beim Beenden Zeit lässt; braucht eine POSIX-Shell.
describe.skipIf(process.platform === "win32")("runTool beim Abbrechen", () => {
  it("lehnt erst ab, wenn der Prozess wirklich beendet ist", async () => {
    // Angenommen: ein Ersatz-ffmpeg, das sich beim Beenden 0,3 s Zeit lässt und dann eine Marke schreibt
    const dir = mkdtempSync(join(tmpdir(), "feldspur-prozess-"));
    const marker = join(dir, "beendet");
    const fake = join(dir, "langsam.sh");
    writeFileSync(
      fake,
      `#!/bin/sh\ntrap 'sleep 0.3; echo x > "${marker}"; exit 143' TERM\nwhile :; do sleep 0.05; done\n`,
    );
    chmodSync(fake, 0o755);
    setToolPaths({ ffmpeg: fake });
    // Wenn: nach 200 ms abgebrochen wird
    const ctrl = new AbortController();
    const run = runTool("ffmpeg", [], { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 200);
    // Dann: kommt der Abbruch erst, wenn die Marke geschrieben ist
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(existsSync(marker)).toBe(true);
  });
});
