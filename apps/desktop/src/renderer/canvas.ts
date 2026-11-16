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
