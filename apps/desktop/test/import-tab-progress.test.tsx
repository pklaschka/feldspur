// @vitest-environment happy-dom
/**
 * Fortschritt des Einsammelns am Reiter „Einsammeln“ (Issue #258): Wie bei „Ausgeben“ steht dort „läuft 42 %“, auch
 * während ein anderer Schritt offen ist (`apps/desktop/src/renderer/app/SessionPane.tsx`, Text aus `importTabText` in
 * `importState.ts`). Die Ansicht baut der echte Hauptprozess-Code aus einer Projektdatei im Wegwerf-Ordner; die
 * Brücke zum Hauptprozess ist nachgestellt.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildSessionView } from "../src/main/view.ts";
import type { ImportProgress, ImportResult } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dir: string;
let store: ProjectStore;
let unmount = () => {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-import-tab-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  act(() => unmount());
  document.body.innerHTML = "";
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Reiter „Einsammeln“: sein Text (Nummer, Name, Hinweis) und der Tooltip. */
const collectTab = () => document.querySelector("[role=tab]");
const tabText = () => collectTab()?.textContent ?? "";

/** Eine Meldung des Hauptprozesses; nicht genannte Zähler stehen auf 0. */
const progress = (sessionId: string, p: Partial<ImportProgress>): ImportProgress => ({
  sessionId,
  phase: "reading",
  done: 0,
  total: 0,
  bytesDone: 0,
  bytesTotal: 0,
  path: "",
  reused: 0,
  bytesReused: 0,
  ...p,
});

describe("Fortschritt des Einsammelns am Reiter", () => {
  it("zeigt „läuft“ beim Suchen, Prozent beim Lesen und danach wieder die Zahl der Quellen", async () => {
    // Angenommen: ein Einsatz ohne Quellen, der Schritt „Ausgeben“ ist offen
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "", extra: {} });
    let report!: (p: ImportProgress) => void;
    let finishImport!: (r: ImportResult) => void;
    const known: Record<string, unknown> = {
      getSession: async () => buildSessionView(store, session.id),
      historyState: async () => ({ undo: null, redo: null, serial: 1 }),
      onImportProgress: (cb: (p: ImportProgress) => void) => {
        report = cb;
        return () => {};
      },
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
    expect(tabText()).toBe("1Einsammeln");

    // Wenn: das Einsammeln beginnt und noch Dateien sucht, dann steht „läuft“ ohne Prozent da (Gesamtzahl unbekannt)
    let importing!: Promise<void>;
    act(() => void (importing = startImport(session.id, ["/x"], guard)));
    expect(tabText()).toBe("1Einsammelnläuft");
    act(() => report(progress(session.id, { phase: "listing", total: 12 })));
    expect(tabText()).toBe("1Einsammelnläuft");

    // Wenn: gelesen wird, dann folgt der Reiter den gelesenen Bytes, auch im Tooltip (für das schmale Fenster)
    act(() => report(progress(session.id, { done: 5, total: 12, bytesDone: 420, bytesTotal: 1000 })));
    expect(tabText()).toBe("1Einsammelnläuft 42 %");
    expect(collectTab()?.getAttribute("title")).toBe("Einsammeln: läuft 42 %");

    // Wenn: Meldungen eines anderen Einsatzes kommen, dann ändert sich nichts
    act(() => report(progress("anderer-einsatz", { done: 12, total: 12, bytesDone: 1000, bytesTotal: 1000 })));
    expect(tabText()).toBe("1Einsammelnläuft 42 %");

    // Wenn: das Einsammeln fertig ist (hier: nichts Neues dabei), dann verschwindet der Hinweis
    await act(async () => {
      finishImport({
        added: 0,
        duplicates: 0,
        relinked: 0,
        warnings: [],
        view: buildSessionView(store, session.id),
      } as ImportResult);
      await importing;
    });
    expect(tabText()).toBe("1Einsammeln");
  });
});
