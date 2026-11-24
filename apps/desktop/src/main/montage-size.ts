/**
 * Größenschätzung des Montagevideos, an diesem Rechner nachgeschärft. Wie groß die Datei wirklich wird, hängt am
 * Encoder (VideoToolbox, Media Foundation, libx264 …) und am Bild. Nach jeder Ausgabe merkt sich die App, um welchen
 * Faktor die Schätzung danebenlag, im Benutzerordner (nicht in der Projektdatei), und rechnet ihn künftig ein.
 *
 * Gehört zum Schritt „Ausgeben“: `export.ts` zeigt die Schätzung in der Vorschau (`montageSize`) und lernt nach
 * jeder Ausgabe mit Video dazu (`learnMontageSize`). Die Grundschätzung kommt aus `packages/media`.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { buildSessionTranscript, estimateMontageBytes, log } from "@feldspur/media";
import type { ProjectStore } from "@feldspur/core";

/** So viele Ausgaben fließen in den Faktor ein (die jüngsten). */
const KEEP = 5;

const file = () => join(app.getPath("userData"), "groessenschaetzung.json");

function readRatios(): number[] {
  try {
    const data = JSON.parse(readFileSync(file(), "utf8")) as { ratios?: unknown };
    return Array.isArray(data.ratios) ? data.ratios.filter((r): r is number => typeof r === "number" && r > 0) : [];
  } catch {
    return [];
  }
}

/** Mittlerer Faktor echt/geschätzt (geometrisch, damit 0,5 und 2 sich aufheben); ohne Ausgabe 1. */
export function sizeFactor(ratios: number[] = readRatios()): number {
  if (!ratios.length) return 1;
  return Math.exp(ratios.reduce((a, r) => a + Math.log(r), 0) / ratios.length);
}

/** Schätzung für die Vorschau, mit dem gelernten Faktor. */
export function montageSize(transcript: Parameters<typeof estimateMontageBytes>[0]): {
  video: number;
  deviceTracks: number;
} {
  const raw = estimateMontageBytes(transcript);
  const f = sizeFactor();
  return { video: Math.round(raw.video * f), deviceTracks: Math.round(raw.deviceTracks * f) };
}

/** Nach einer Ausgabe: echte Größe des Videos gegen die Schätzung halten und den Faktor fortschreiben. */
export function learnMontageSize(
  s: ProjectStore,
  sessionId: string,
  mode: Parameters<typeof buildSessionTranscript>[2],
  videoPath: string,
  deviceTracks: boolean,
): void {
  try {
    const raw = estimateMontageBytes(buildSessionTranscript(s, sessionId, mode));
    const estimated = raw.video + (deviceTracks ? raw.deviceTracks : 0);
    const actual = statSync(videoPath).size;
    if (estimated <= 0 || actual <= 0) return;
    const ratios = [...readRatios(), actual / estimated].slice(-KEEP);
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify({ ratios }, null, 2));
    log(
      "ausgabe",
      `Größe Montagevideo: geschätzt ${estimated} B, echt ${actual} B, Faktor jetzt ${sizeFactor(ratios).toFixed(2)}`,
    );
  } catch {
    // Nur eine Schätzung: Scheitert das Lernen, bleibt der alte Faktor.
  }
}
