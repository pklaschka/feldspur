import { useEffect, useState, type RefObject } from "react";

/**
 * Gemeinsame Hilfen fürs Zeichnen auf Canvas.
 *
 * Wer `canvas.width` setzt, verwirft den Inhalt und lässt den Browser einen neuen Speicher anlegen, auch wenn sich
 * die Größe gar nicht ändert. Bei jedem Mausrücken oder jeder Abspielposition führte das auf macOS zu Flackern und
 * zu Fehlern wie „Failed to allocate IOSurface“. Deshalb nur bei echter Größenänderung neu anlegen.
 */
export function prepareCanvas(el: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (el.width !== w) el.width = w;
  if (el.height !== h) el.height = h;
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Breite eines Elements in CSS-Pixeln, aktuell gehalten über einen ResizeObserver (0, solange nicht gemessen). */
export function useElementWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
