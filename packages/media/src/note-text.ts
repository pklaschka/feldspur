/**
 * Inhalt von Notizdateien (.txt, .md), damit sie als Kontext im Einsatztranskript stehen können. Gelesen wird die
 * Originaldatei (Originale werden nie verändert); ein kleiner Zwischenspeicher vermeidet erneutes Lesen.
 *
 * Einordnung: Aufgerufen von `packages/media/src/context.ts`, das die Kontextstücke zusammenstellt. Der Text wird
 * nicht in die Projektdatei übernommen: Ändert sich die Notizdatei, ändert sich das nächste Einsatztranskript mit.
 */
import { readFileSync, statSync } from "node:fs";
import type { Source } from "@feldspur/core";

/** Größer wird nichts eingelesen: Eine Notiz für den Kontext ist ein paar Seiten Text, kein Buch. */
const MAX_BYTES = 512 * 1024;
/** Je Pfad der zuletzt gelesene Text; `stamp` (Größe und Änderungszeit) zeigt, ob die Datei noch dieselbe ist. */
const cache = new Map<string, { stamp: string; text: string | null }>();

/** Lässt sich der Inhalt dieser Quelle als Text lesen? */
export function isPlainText(src: Pick<Source, "kind" | "fileName">): boolean {
  return src.kind === "note" && /\.(txt|md|markdown)$/i.test(src.fileName);
}

/** Text einer Notizdatei; null, wenn sie fehlt, zu groß ist oder kein reiner Text. */
export function noteText(src: Pick<Source, "kind" | "fileName" | "originalPath">): string | null {
  if (!isPlainText(src)) return null;
  let stamp: string;
  try {
    const st = statSync(src.originalPath);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    stamp = `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
  const hit = cache.get(src.originalPath);
  if (hit?.stamp === stamp) return hit.text;
  let text: string | null;
  try {
    // BOM (etwa von Windows-Editoren) entfernen und Zeilenenden auf \n vereinheitlichen.
    text = readFileSync(src.originalPath, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n").trimEnd();
  } catch {
    text = null;
  }
  cache.set(src.originalPath, { stamp, text });
  return text;
}
