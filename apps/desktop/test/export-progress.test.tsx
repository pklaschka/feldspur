// @vitest-environment happy-dom
/**
 * Fortschritt der laufenden Ausgabe (`apps/desktop/src/renderer/exportState.tsx`, Issue #257): Jeder Schritt, den der
 * Hauptprozess meldet, hat einen Anteil am Balken, und der gezeigte Wert fällt nie zurück. Die Brücke zum Hauptprozess
 * ist nachgestellt.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import {
  EXPORT_CHECK_STEP,
  EXPORT_LEVELS_STEP,
  type ExportProgress,
  type ExportRequestOptions,
} from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Was die Oberfläche beim Hauptprozess anmeldet: Hier landen die Meldungen des Tests. */
let report: (p: ExportProgress) => void = () => {};
(window as unknown as { feldspur: object }).feldspur = {
  onExportProgress: (cb: (p: ExportProgress) => void) => {
    report = cb;
    return () => {};
  },
  // Die Ausgabe läuft während des ganzen Tests.
  exportSession: () => new Promise(() => {}),
};
const { ExportProvider, percent, useExport } = await import("../src/renderer/exportState.tsx");

const withVideo: ExportRequestOptions = {
  video: true,
  resolve: false,
  mixAudio: true,
  realtime: false,
  deviceTracks: true,
  viewer: true,
  readme: true,
  changeLog: true,
  manifest: true,
  videoHeight: 720,
  videoFps: 25,
};

/** Eine Ausgabe mit Montagevideo starten; `shown` meldet einen Stand und liefert die danach gezeigten Prozent. */
function startExport() {
  let state!: ReturnType<typeof useExport>;
  function Probe() {
    state = useExport();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      <ExportProvider>
        <Probe />
      </ExportProvider>,
    ),
  );
  return {
    start: () => act(() => state.start("e1", withVideo)),
    shown: (step: string, done: number, total: number) => {
      act(() => report({ sessionId: "e1", step, done, total }));
      return state.job!.percent;
    },
  };
}

describe("Fortschritt der Ausgabe", () => {
  it("„Lautstärke messen“ hat mit Montagevideo einen eigenen Anteil nach der Prüfung der Originale", () => {
    const at = (step: string, done: number) => percent({ sessionId: "e1", step, done, total: 2 }, true);
    expect(at(EXPORT_CHECK_STEP, 2)).toBe(8);
    expect(at(EXPORT_LEVELS_STEP, 0)).toBe(8);
    expect(at(EXPORT_LEVELS_STEP, 1)).toBe(9);
    expect(at(EXPORT_LEVELS_STEP, 2)).toBe(10);
    expect(at("Standbilder", 0)).toBe(10);
  });

  it("der Balken fällt über die ganze Schrittfolge nie zurück, auch wenn die Lautstärke zweimal gemessen wird", () => {
    // Angenommen: eine Ausgabe mit Montagevideo läuft
    const run = startExport();
    run.start();
    // Wenn: der Hauptprozess die Schritte meldet, die Lautstärke ein zweites Mal nach den Standbildern
    const steps: [string, number, number][] = [
      [EXPORT_CHECK_STEP, 0, 100],
      [EXPORT_CHECK_STEP, 100, 100],
      [EXPORT_LEVELS_STEP, 0, 2],
      [EXPORT_LEVELS_STEP, 1, 2],
      [EXPORT_LEVELS_STEP, 2, 2],
      ["Standbilder", 0, 4],
      ["Standbilder", 3, 4],
      [EXPORT_LEVELS_STEP, 0, 1],
      [EXPORT_LEVELS_STEP, 1, 1],
      ["Montagevideo", 0, 60],
      ["Montagevideo", 60, 60],
      ["Einsatztranskript", 0, 1],
      ["Fertig", 1, 1],
    ];
    const shown = steps.map(([step, done, total]) => run.shown(step, done, total));
    // Dann: wächst der gezeigte Anteil nur, und während der ersten Messung steht er nicht auf 0
    expect(shown).toEqual(shown.toSorted((a, b) => a - b));
    expect(shown[2]).toBe(8);
    expect(shown.at(-1)).toBe(100);
  });
});
