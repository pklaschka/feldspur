// Vite: Datei-URL statt Modul (z. B. für den pdf.js-Worker).
declare module "*?url" {
  const src: string;
  export default src;
}
