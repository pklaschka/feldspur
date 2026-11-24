/**
 * Anmelden von IPC-Aufrufen, die Daten ändern: jeder Aufruf ist ein Schritt für Rückgängig und eine Zeile im
 * Änderungsprotokoll (`packages/core/src/db/history.ts`). Die Dateien in diesem Ordner nutzen das statt
 * `ipcMain.handle`, sobald ein Aufruf ins Projekt schreibt.
 */
import { ipcMain } from "electron";
import type { ProjectStore } from "@feldspur/core";
import { requireStore } from "../state.ts";
import { buildSessionView } from "../view.ts";

/**
 * IPC-Aufruf, der Daten ändert, als ein Schritt für Rückgängig. Die Ansicht wird im selben Schritt gebaut; das
 * stört nicht, weil sie nichts schreibt.
 */
export function undoable<A extends unknown[], R>(
  channel: string,
  /** Beschriftung im Verlauf; als Funktion, wenn sie die betroffene Quelle nennen soll (vor der Änderung gelesen). */
  label: string | ((s: ProjectStore, ...args: A) => string),
  handler: (e: Electron.IpcMainInvokeEvent, ...args: A) => R,
): void {
  ipcMain.handle(channel, (e, ...args) => {
    const s = requireStore();
    const text = typeof label === "string" ? label : label(s, ...(args as A));
    return s.history.record(text, () => handler(e, ...(args as A)));
  });
}

/** Wie `undoable`, für die häufigste Form: Die Änderung nennt ihren Einsatz, die Antwort ist dessen neue Ansicht. */
export function undoableView<A extends unknown[]>(
  channel: string,
  label: string | ((s: ProjectStore, ...args: A) => string),
  change: (s: ProjectStore, ...args: A) => string,
): void {
  undoable(channel, label, (_e, ...args: A) => {
    const s = requireStore();
    return buildSessionView(s, change(s, ...args));
  });
}
