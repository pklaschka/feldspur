// @vitest-environment happy-dom
/**
 * Einsammeln endet, während ein anderer Schritt offen ist (Issue #258): Der Einsatz
 * (`apps/desktop/src/renderer/app/SessionPane.tsx`) übernimmt die neue Ansicht in jedem Schritt, nicht nur in
 * „Einsammeln“. Die Ansichten baut der echte Hauptprozess-Code aus einer Projektdatei im Wegwerf-Ordner; die Brücke
 * zum Hauptprozess ist nachgestellt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildSessionView } from "../src/main/view.ts";
import type { HistoryState } from "../src/renderer/app/history.tsx";
import type { ImportResult } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dir: string;
let store: ProjectStore;
let unmount = () => {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-import-step-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Zähler am Reiter „Einsammeln“ (Zahl der Quellen) und Beschriftung des Rückgängig-Knopfs. */
const collectTab = () => document.querySelector("[role=tab]")?.textContent ?? "";
const undoTitle = () => document.querySelector("[data-testid=undo]")?.getAttribute("title") ?? "";

describe("Einsammeln endet, während ein anderer Schritt offen ist", () => {
  it("zeigt die neuen Quellen und den geleerten Verlauf, ohne dass der Einsatz neu geöffnet wird", async () => {
    // Angenommen: ein Einsatz ohne Quellen, im Verlauf steht ein Schritt
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
    let history: HistoryState = { undo: "Einsatzdaten geändert", redo: null, serial: 1 };
    let finishImport!: (r: ImportResult) => void;
    const known: Record<string, unknown> = {
      getSession: async () => buildSessionView(store, session.id),
      historyState: async () => history,
      importPaths: () => new Promise<ImportResult>((done) => (finishImport = done)),
    };
    // Alles Übrige (Anmeldungen für Meldungen, Abfragen der Schritte) antwortet nicht; der Test braucht es nicht.
    (window as unknown as { feldspur: object }).feldspur = new Proxy(known, {
      get: (target, name: string) =>
        target[name] ?? (name.startsWith("on") ? () => () => {} : () => new Promise(() => {})),
    });
    const { SessionPane } = await import("../src/renderer/app/SessionPane.tsx");
    const { ExportProvider } = await import("../src/renderer/exportState.tsx");
    const { startImport } = await import("../src/renderer/importState.ts");
    const { TooltipProvider } = await import("../src/renderer/ui.tsx");
    const guard = <T,>(fn: () => Promise<T>) => fn();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    unmount = () => root.unmount();
    // … und der Schritt „Ausgeben“ ist offen, während das Einsammeln läuft
    await act(async () =>
      root.render(
        <ExportProvider>
          <TooltipProvider>
            <SessionPane
              sessionId={session.id}
              initialStep="export"
              guard={guard}
              strayDrop={0}
              onProject={() => {}}
              onDeleted={() => {}}
            />
          </TooltipProvider>
        </ExportProvider>,
      ),
    );
    let importing!: Promise<void>;
    act(() => void (importing = startImport(session.id, ["/x/IMG_0001.jpg"], guard)));
    expect(collectTab()).toBe("1Einsammelnläuft");
    expect(undoTitle()).toContain("Rückgängig: Einsatzdaten geändert");

    // Wenn: der Hauptprozess ein Foto übernommen hat (das leert den Verlauf) und die neue Ansicht liefert
    const device = store.addDevice({ sessionId: session.id, label: "Handy" });
    store.addSource({
      sessionId: session.id,
      deviceId: device.id,
      kind: "photo",
      fileName: "IMG_0001.jpg",
      originalPath: "/x/IMG_0001.jpg",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      metadata: {},
      durationMs: null,
    });
    history = { undo: null, redo: null, serial: 2 };
    await act(async () => {
      finishImport({
        added: 1,
        duplicates: 0,
        relinked: 0,
        warnings: [],
        view: buildSessionView(store, session.id),
      } as ImportResult);
      await importing;
    });

    // Dann: zählt der Reiter „Einsammeln“ die Quelle, und Rückgängig bietet den alten Schritt nicht mehr an
    expect(collectTab()).toBe("1Einsammeln1");
    expect(undoTitle()).toBe("Nichts rückgängig zu machen");
  });
});
