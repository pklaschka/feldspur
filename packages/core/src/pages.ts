/**
 * Seitenzählung von Tagebuch-Scans. Ein Bild (oder eine PDF-Seite) kann eine einzelne Seite oder
 * eine Doppelseite zeigen; die Seitenzahl im Notizbuch beginnt, wo man sie einträgt. Rahmen auf
 * einer Doppelseite gehören je nach Lage zur linken, rechten oder zu beiden Seiten.
 */

export interface PagedSource {
  label: string;
  fileName: string;
  firstPage: number | null;
  pageSpread: boolean;
}

export interface PageRegion {
  /** PDF-Seite ab 0; bei Bildern 0 oder weggelassen. */
  page?: number;
  x: number;
  w: number;
}

export type PageSide = "left" | "right" | "both";

/** Etwas Spielraum über die Mitte hinaus: ein Rahmen darf den Falz leicht überragen. */
const FOLD_SLACK = 0.05;

export function isPdfName(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

/** Auf welcher Hälfte einer Doppelseite liegt der Rahmen? */
export function pageSide(region: { x: number; w: number }): PageSide {
  if (region.x + region.w <= 0.5 + FOLD_SLACK) return "left";
  if (region.x >= 0.5 - FOLD_SLACK) return "right";
  return "both";
}

/** Seiten im Notizbuch je Bild bzw. PDF-Seite. */
export function pagesPerScan(src: Pick<PagedSource, "pageSpread">): number {
  return src.pageSpread ? 2 : 1;
}

/** Erste und letzte Seitenzahl eines Bilds bzw. einer PDF-Seite (ab 0); null = nicht gezählt. */
export function scanPages(src: PagedSource, pdfPage = 0): { from: number; to: number } | null {
  if (src.firstPage === null) return null;
  const from = src.firstPage + pdfPage * pagesPerScan(src);
  return { from, to: from + pagesPerScan(src) - 1 };
}

/** „S. 3“, „S. 3–4“ */
export function pageRangeText(from: number, to: number): string {
  return from === to ? `S. ${from}` : `S. ${from}–${to}`;
}

/**
 * Bezeichnung einer Stelle im Tagebuch für Quellennachweis und Anzeige:
 * „T-01“, „T-03 S. 2“ (PDF-Seite), „T-01 links“, „T-01 · S. 7“, „T-01 · S. 7–8“.
 */
export function diaryPageLabel(src: PagedSource, region?: PageRegion): string {
  const pdfPage = region?.page ?? 0;
  const side = src.pageSpread && region ? pageSide(region) : "both";
  const pages = scanPages(src, pdfPage);
  if (pages) {
    if (!src.pageSpread || side === "both") return `${src.label} · ${pageRangeText(pages.from, pages.to)}`;
    return `${src.label} · S. ${side === "left" ? pages.from : pages.to}`;
  }
  const pdf = isPdfName(src.fileName) ? ` S. ${pdfPage + 1}` : "";
  const half = src.pageSpread && region && side !== "both" ? (side === "left" ? " links" : " rechts") : "";
  return `${src.label}${pdf}${half}`;
}

/** Reihenfolge auf einem Bild: auf Doppelseiten erst die linke Seite, dann die rechte. */
export function sideOrder(src: Pick<PagedSource, "pageSpread">, region: { x: number; w: number }): number {
  return src.pageSpread && pageSide(region) === "right" ? 1 : 0;
}

/**
 * Zählung über mehrere Scans fortsetzen: Jeder folgende Scan beginnt nach dem letzten des vorigen.
 * pdfPages = Seitenzahl des PDFs (1 bei Bildern).
 */
export function continuePages(
  start: { firstPage: number; pageSpread: boolean; pdfPages: number },
  following: { id: string; pdfPages: number }[],
): { id: string; firstPage: number }[] {
  const per = pagesPerScan(start);
  let next = start.firstPage + start.pdfPages * per;
  return following.map((f) => {
    const firstPage = next;
    next += Math.max(1, f.pdfPages) * per;
    return { id: f.id, firstPage };
  });
}
