/**
 * Einmaliger Tastenhinweis in Durchsehen (Issue #195): Nach drei Bestätigungen mit der Maus erscheint „Schneller geht
 * es mit der Tastatur…“. Nach „Verstanden“ kommt er nie wieder, auch nicht nach einem Neustart. Gezählt wird nur,
 * bis der Hinweis einmal da war; die Zahl bleibt über Neustarts erhalten.
 *
 * Gezählt wird im Prüfkasten (`apps/desktop/src/renderer/inspector/CheckPanel.tsx`), gezeigt wird der Hinweis in
 * `apps/desktop/src/renderer/Review.tsx`. Der Stand liegt im localStorage und gilt für alle Projekte.
 */
import { useSyncExternalStore } from "react";
import { readStoredObject, writeStored } from "../stored.ts";

const KEY = "feldspur.hinweis.tasten-durchsehen";
/** So viele Bestätigungen mit der Maus, dann kommt der Hinweis. */
export const MOUSE_CONFIRMS = 3;

type State = { mouse: number; dismissed: boolean };
const listeners = new Set<() => void>();
let cached: State | null = null;

function read(): State {
  if (cached) return cached;
  const s = readStoredObject(KEY);
  cached = { mouse: Number(s.mouse) || 0, dismissed: s.dismissed === true };
  return cached;
}

function write(next: State) {
  cached = next;
  writeStored(KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

/** Eine Lage wurde mit der Maus bestätigt (nicht per Tastatur). */
export function noteMouseConfirm(): void {
  const s = read();
  if (s.dismissed || s.mouse >= MOUSE_CONFIRMS) return;
  write({ ...s, mouse: s.mouse + 1 });
}

/** „Verstanden“: nie wieder zeigen. */
export function dismissKeyHint(): void {
  write({ ...read(), dismissed: true });
}

/** Für Tests: Zwischenstand vergessen (der Speicher bleibt). */
export function resetKeyHintCache(): void {
  cached = null;
}

/** Soll der Hinweis gerade stehen? */
export function useKeyHint(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      const s = read();
      return !s.dismissed && s.mouse >= MOUSE_CONFIRMS;
    },
  );
}
