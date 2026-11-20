/**
 * Ein Weg, ffmpeg und ffprobe zu starten (ADR-001, Issue #134). Alle Kindprozesse in Feldspur
 * laufen hierüber, damit Abbruch, Zeitlimit und Fehlertext überall gleich funktionieren:
 *
 * - Abbrechen beendet den Prozess. Das Promise wird erst abgelehnt, wenn der Prozess wirklich
 *   beendet ist, damit danach aufgeräumt werden kann, ohne dass noch jemand in den Ordner schreibt.
 * - Zeitlimits: `timeoutMs` für die ganze Laufzeit, `idleTimeoutMs`, wenn der Prozess so lange
 *   nichts mehr ausgibt (nur sinnvoll, wo er laufend schreibt, etwa Rohdaten oder Fortschritt).
 * - Fehler sind ein ToolError mit einheitlicher Meldung und dem Ende von stderr.
 *
 * Direkte Importe von node:child_process sind außerhalb dieser Datei per Lint-Regel gesperrt.
 */
import { spawn } from "node:child_process";
import { toolPaths } from "./tools.ts";

export type Tool = "ffmpeg" | "ffprobe";

export interface RunToolOptions {
  signal?: AbortSignal | undefined;
  /** Höchstdauer insgesamt. */
  timeoutMs?: number | undefined;
  /** Höchstdauer ohne jede Ausgabe auf stdout oder stderr. */
  idleTimeoutMs?: number | undefined;
  /** Rohdaten laufend verarbeiten statt sammeln; runTool liefert dann "". */
  onStdout?: ((chunk: Buffer) => void) | undefined;
  /** Grenze fürs Sammeln von stdout (Standard 16 MB). */
  maxStdoutBytes?: number | undefined;
}

/** ffmpeg oder ffprobe ist gescheitert oder hat ein Zeitlimit überschritten. */
export class ToolError extends Error {
  override name = "ToolError";
  constructor(
    message: string,
    readonly tool: Tool,
    /** Rückgabewert des Prozesses; null bei Zeitlimit oder Startfehler. */
    readonly exitCode: number | null,
    /** Ende der Fehlerausgabe (höchstens 4000 Zeichen). */
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** Zeitlimit für ffprobe: liest nur Kopfdaten, braucht auch auf langsamen Laufwerken selten Sekunden. */
export const PROBE_TIMEOUT_MS = 120_000;
/** Zeitlimit für ein Standbild aus einem Foto oder Scan. */
export const STILL_TIMEOUT_MS = 120_000;
/** Stillstand bei Prozessen, die laufend Daten oder Fortschritt ausgeben. */
export const STALL_MS = 120_000;

const STDERR_KEEP = 4000;
/** So lange darf ein Prozess nach dem Beenden-Signal brauchen, bevor er hart beendet wird. */
const KILL_GRACE_MS = 5000;
/** So lange nach dem Prozessende auf das Schließen von stdout/stderr warten, wenn wir ihn selbst beendet haben. */
const PIPE_GRACE_MS = 1000;

/** Startet ffmpeg/ffprobe und liefert stdout als Text, sobald der Prozess erfolgreich endet. */
export function runTool(tool: Tool, args: readonly string[], opts: RunToolOptions = {}): Promise<string> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const maxStdout = opts.maxStdoutBytes ?? 16 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    // stdin wie bei execFile als Leitung, gleich geschlossen: ffmpeg liest dort Tastenbefehle und sieht so sofort das Ende.
    const child = spawn(toolPaths()[tool], args, { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    child.stdin.end();
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    // Grund, aus dem wir den Prozess selbst beenden; wird beim Schließen gemeldet.
    let stopReason: unknown = null;
    let settled = false;
    let hardKill: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const stop = (reason: unknown) => {
      if (stopReason !== null || child.exitCode !== null) return;
      stopReason = reason;
      // Unter Windows mit allen Unterprozessen beenden: Ein Starter (etwa Chocolateys ffmpeg.exe) ließe sonst das
      // eigentliche ffmpeg weiterlaufen.
      if (process.platform === "win32" && child.pid !== undefined) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
          "error",
          () => {},
        );
      }
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    const onAbort = () => stop(abortReason(signal!));
    signal?.addEventListener("abort", onAbort, { once: true });

    const totalTimer =
      opts.timeoutMs !== undefined
        ? setTimeout(
            () =>
              stop(new ToolError(`${tool} hat nach ${seconds(opts.timeoutMs!)} nicht geantwortet`, tool, null, err)),
            opts.timeoutMs,
          )
        : undefined;
    const touch = () => {
      if (opts.idleTimeoutMs === undefined) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => stop(new ToolError(`${tool} kommt seit ${seconds(opts.idleTimeoutMs!)} nicht weiter`, tool, null, err)),
        opts.idleTimeoutMs,
      );
    };
    touch();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      clearTimeout(hardKill);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    child.stdout.on("data", (chunk: Buffer) => {
      touch();
      if (opts.onStdout) {
        try {
          opts.onStdout(chunk);
        } catch (e) {
          stop(e);
        }
        return;
      }
      outBytes += chunk.length;
      if (outBytes > maxStdout) {
        stop(new ToolError(`${tool}: Ausgabe größer als ${Math.round(maxStdout / 1024 / 1024)} MB`, tool, null, err));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (d: Buffer) => {
      touch();
      err = (err + d.toString()).slice(-STDERR_KEEP);
    });
    child.on("error", (e) => {
      // Startfehler (Programm fehlt) oder Fehler beim Beenden; ohne Prozess kommt kein close.
      if (child.pid === undefined) {
        finish(() =>
          reject(new ToolError(`${tool} lässt sich nicht starten: ${e.message}`, tool, null, err, { cause: e })),
        );
      }
    });
    child.on("exit", () => {
      // Selbst beendet: Hält noch ein Enkelprozess die Ausgabe offen (unter Windows etwa ein Starter-Programm, das
      // das eigentliche ffmpeg aufruft), käme close nie. Dann die Leitungen nach kurzer Frist selbst schließen.
      if (stopReason === null) return;
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, PIPE_GRACE_MS).unref();
    });
    child.on("close", (code) => {
      finish(() => {
        if (stopReason !== null) return reject(stopReason);
        if (code !== 0) return reject(new ToolError(failMessage(tool, code, err), tool, code, err));
        resolve(opts.onStdout ? "" : Buffer.concat(out).toString());
      });
    });
  });
}

/** Die ersten Zeilen von stderr, ohne ffmpegs Kennungen wie „[in#0 @ 0x55…]“; reicht meist für Datei und Grund. */
function failMessage(tool: Tool, code: number | null, stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.replace(/^\[[^\]]* @ 0x[0-9a-f]+\]\s*/i, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 3);
  const text = lines.join(" / ");
  return `${tool} (${code ?? "beendet"}): ${text ? (text.length > 400 ? `${text.slice(0, 399)}…` : text) : "ohne Fehlermeldung"}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Abgebrochen", "AbortError");
}

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`;
}
