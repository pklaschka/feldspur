/**
 * Auflösung und Bildrate des Montagevideos je Projekt (Issue #250). Stehen in der Projektdatei (`project_meta`), damit
 * sie mit dem Projekt wandern und auf jedem Rechner gleich ausgegeben wird.
 *
 * Gelesen von `export.ts` (Vorschau, Größenschätzung, Einstellungen der Ausgabe) und `view.ts` (`montageFormat` in der
 * Ansicht); geschrieben über `ipc/export.ts` als Schritt für Rückgängig. Die wählbaren Werte stehen in
 * `packages/media/src/layout.ts`.
 */
import type { ProjectStore } from "@feldspur/core";
import { montageFormat, type MontageFormat } from "@feldspur/media";

/** Schlüssel in `project_meta`, unter dem das Format steht. */
const FORMAT_KEY = "montage_format";

/** Format des Montagevideos für dieses Projekt; ohne (gültigen) Eintrag der Standard, 1280 × 720 bei 25 Bildern/s. */
export function projectFormat(s: ProjectStore): MontageFormat {
  const raw = s.getMeta(FORMAT_KEY);
  try {
    return montageFormat(raw ? JSON.parse(raw) : null);
  } catch {
    return montageFormat(null);
  }
}

/** Format für das Projekt merken; Ungültiges wird je Teil zum Standard. */
export function setProjectFormat(s: ProjectStore, format: MontageFormat): void {
  const f = montageFormat(format);
  s.setMeta(FORMAT_KEY, JSON.stringify({ height: f.height, fps: f.fps }));
}
