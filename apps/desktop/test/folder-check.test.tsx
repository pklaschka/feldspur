// @vitest-environment happy-dom
/**
 * „Ordner prüfen…“ unter der letzten Ausgabe (`apps/desktop/src/renderer/export/FolderCheck.tsx`, Issue #208). Die
 * Brücke zum Hauptprozess ist nachgestellt; geprüft wird, was die Oberfläche aus dem Ergebnis macht.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import type { FolderCheck } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let answer: () => Promise<FolderCheck | null> = async () => null;
const checkFolder = vi.fn((_dir?: string) => answer());
(window as unknown as { feldspur: object }).feldspur = {
  checkFolder,
  cancelFolderCheck: async () => {},
  onFolderCheckProgress: () => () => {},
};
const { FolderCheckButton } = await import("../src/renderer/export/FolderCheck.tsx");

// Erfundenes Beispiel, keine Forschungsdaten.
const DIR = "/Archiv/Testmarkt_2026-09-14";

async function run(result: FolderCheck | Error) {
  answer = async () => {
    if (result instanceof Error) throw result;
    return result;
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<FolderCheckButton dir={DIR} />));
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ordner prüfen…")!;
  await act(async () => button.click());
  return host;
}

describe("Ordner prüfen", () => {
  it("schlägt den Ordner der letzten Ausgabe vor und meldet einen heilen Ordner in einem Satz", async () => {
    const host = await run({ dir: DIR, listed: 7, ok: 7, missing: [], changed: [], extra: [] });
    expect(checkFolder).toHaveBeenLastCalledWith(DIR);
    const r = host.querySelector("[data-testid=folder-check-result]")!;
    expect(r.getAttribute("data-state")).toBe("ok");
    expect(r.textContent).toContain("„Testmarkt_2026-09-14“: alle 7 Dateien unverändert.");
  });

  it("nennt fehlende und veränderte Dateien und, getrennt davon, dazugekommene", async () => {
    const host = await run({
      dir: DIR,
      listed: 7,
      ok: 5,
      missing: ["Originale/Kamera/V1_C0001.MP4"],
      changed: ["Testmarkt.docx"],
      extra: ["notiz.txt"],
    });
    const r = host.querySelector("[data-testid=folder-check-result]")!;
    expect(r.getAttribute("data-state")).toBe("bad");
    expect(r.textContent).toContain("5 von 7 Dateien unverändert");
    expect(r.textContent).toContain("Fehlen: Originale/Kamera/V1_C0001.MP4");
    expect(r.textContent).toContain("Verändert: Testmarkt.docx");
    expect(r.textContent).toContain("später dazugelegt?): notiz.txt");
  });

  it("zeigt die Meldung des Hauptprozesses ohne Electrons Vorspann", async () => {
    const host = await run(
      new Error(
        "Error invoking remote method 'export:check-folder': Error: In diesem Ordner liegt keine manifest-sha256.txt.",
      ),
    );
    expect(host.querySelector("[role=alert]")!.textContent).toBe("In diesem Ordner liegt keine manifest-sha256.txt.");
  });
});
