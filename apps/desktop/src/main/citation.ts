/**
 * Hauptprozess für „Feldspur zitieren“ (Issue #163). Fragt Zenodo nur auf Knopfdruck ab und merkt sich die gefundene
 * DOI je Version im Benutzerordner der App (nicht in der Projektdatei). Aus dem Projekt wird nichts übertragen.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, net } from "electron";
import { log } from "@feldspur/media";
import type { CitationInfo, CitationLookup } from "../shared/api.ts";
import { pickVersionDoi, zenodoVersionUrl, type VersionDoi } from "../shared/citation.ts";

/** Erscheinungsdatum der Version; setzt der Build ein (`apps/desktop/vite.config.ts`, aus CITATION.cff). */
declare const __FELDSPUR_RELEASED__: string;

/** Wie lange Feldspur auf Zenodo wartet. */
const LOOKUP_TIMEOUT_MS = 20_000;

type Stored = Record<string, VersionDoi & { checkedAt: string }>;
const file = () => join(app.getPath("userData"), "zitieren.json");

function readStored(): Stored {
  try {
    const data = JSON.parse(readFileSync(file(), "utf8")) as unknown;
    return data && typeof data === "object" ? (data as Stored) : {};
  } catch {
    return {};
  }
}

/** Version, Erscheinungsdatum und die schon gemerkte DOI; liest nur die Datei im Benutzerordner, kein Netz. */
export function citationInfo(): CitationInfo {
  const version = app.getVersion();
  const known = readStored()[version];
  return {
    version,
    released: __FELDSPUR_RELEASED__,
    versionDoi: known && typeof known.doi === "string" ? known : null,
  };
}

/** Laufende Abfrage bei Zenodo, zum Abbrechen; höchstens eine. */
let running: AbortController | null = null;

/** Schlägt die DOI der laufenden Version bei Zenodo nach; nur nach Knopfdruck im Dialog. */
export async function lookupCitationDoi(): Promise<CitationLookup> {
  const version = app.getVersion();
  running?.abort();
  const ctrl = new AbortController();
  running = ctrl;
  const signal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)]);
  const url = zenodoVersionUrl(version);
  log("zitieren", `fragt Zenodo nach Version ${version}: ${url}`);
  try {
    const res = await net.fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Zenodo antwortet mit ${res.status}`);
    const found = pickVersionDoi(await res.json(), version);
    if (!found) {
      log("zitieren", `Version ${version} steht noch nicht auf Zenodo`);
      return { state: "missing" };
    }
    const entry = { ...found, checkedAt: new Date().toISOString() };
    try {
      mkdirSync(dirname(file()), { recursive: true });
      writeFileSync(file(), JSON.stringify({ ...readStored(), [version]: entry }, null, 2));
    } catch {
      // Merken ist eine Bequemlichkeit; ohne Datei wird beim nächsten Mal wieder gefragt.
    }
    log("zitieren", `DOI von Version ${version}: ${found.doi}`);
    return { state: "found", versionDoi: entry };
  } catch (e) {
    if (ctrl.signal.aborted) return { state: "cancelled" };
    log("zitieren", `Zenodo nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`);
    return { state: "offline" };
  } finally {
    if (running === ctrl) running = null;
  }
}

export function cancelCitationLookup(): void {
  running?.abort();
}
