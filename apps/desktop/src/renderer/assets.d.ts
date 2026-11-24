/**
 * Typ für Vite-Importe mit „?url“: Der Import liefert die URL der Datei statt ihres Inhalts. Gebraucht für den
 * pdf.js-Worker (`apps/desktop/src/renderer/pdf.tsx`) und das App-Symbol (`apps/desktop/src/renderer/app/start.tsx`).
 */
declare module "*?url" {
  const src: string;
  export default src;
}
