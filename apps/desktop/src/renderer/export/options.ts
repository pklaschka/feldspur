/**
 * Ausgabe-Einstellungen: welche Schalter es gibt und wie sie die Sitzung überdauern (localStorage, über
 * `apps/desktop/src/renderer/stored.ts`). `apps/desktop/src/renderer/ExportStep.tsx` macht daraus die Anfrage an den
 * Hauptprozess (`ExportRequestOptions` in `apps/desktop/src/shared/api.ts`).
 */
import { useState } from "react";
import { readStoredObject, writeStored } from "../stored.ts";

/** Ausgabe-Einstellungen gelten für alle Einsätze und bleiben bis zur nächsten Sitzung erhalten. */
export interface Options {
  video: boolean;
  /** Schnittliste (FCPXML) für DaVinci Resolve. */
  resolve: boolean;
  mixAudio: boolean;
  deviceTracks: boolean;
  /** Viewer (.html); geht nur zusammen mit `video`. */
  viewer: boolean;
  readme: boolean;
  changeLog: boolean;
  manifest: boolean;
  /** Metadaten als RO-Crate (ro-crate-metadata.json); auf Wunsch, daher aus. */
  roCrate: boolean;
  /** Kopien der Originale unter Originale/; Standard aus, weil sie schnell viele Gigabyte groß sind. */
  originals: boolean;
  /** Nach Episoden schneiden statt Echtzeit; wirkt nur, wenn der Einsatz Episoden hat (wird dort zu `realtime`). */
  byEpisodes: boolean;
}
const DEFAULTS: Options = {
  video: true,
  resolve: false,
  mixAudio: true,
  deviceTracks: true,
  viewer: true,
  readme: true,
  changeLog: true,
  manifest: true,
  roCrate: false,
  originals: false,
  byEpisodes: false,
};
const KEY = "feldspur.export-options";
function loadOptions(): Options {
  const stored = readStoredObject(KEY);
  // Nur bekannte Schalter mit passendem Typ übernehmen; ältere oder beschädigte Werte fallen auf den Standard zurück.
  const o = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS) as (keyof Options)[])
    if (typeof stored[k] === typeof DEFAULTS[k]) (o as Record<string, unknown>)[k] = stored[k];
  // Früher ließ sich der Viewer ohne Video wählen (und fiel dann still weg); jetzt hält er das Video fest.
  return o.viewer && !o.video ? { ...o, viewer: false } : o;
}

/** Die Einstellungen und ein Setzer, der jede Änderung gleich merkt. */
export function useExportOptions(): [Options, (patch: Partial<Options>) => void] {
  const [opts, setOpts] = useState(loadOptions);
  const set = (patch: Partial<Options>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      writeStored(KEY, JSON.stringify(next));
      return next;
    });
  return [opts, set];
}
