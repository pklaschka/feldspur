/**
 * Seiten der Abtipp-Ansicht (`DiaryEditor.tsx`) und ihr Platz. Ohne React, damit es sich direkt testen lässt
 * (`apps/desktop/test/diary-pages.test.ts`).
 */
import { diaryPageLabel } from "@feldspur/core/pages";
import type { SourceRow } from "../../shared/api.ts";

/** Eine Bildfläche, auf der Rahmen liegen können: ein Bild oder eine einzelne PDF-Seite. */
export interface Surface {
  sourceId: string;
  /** PDF-Seite ab 0; bei Bildern 0. */
  page: number;
  isPdf: boolean;
  /** Doppelseite: Falz in der Mitte andeuten. */
  spread: boolean;
}
/** Eine Seite zum Blättern: meist eine Fläche, mit angehängten weiteren Bildern (`partOf`) mehrere. */
export interface NavPage {
  key: string;
  /** Hauptquelle der Seite. */
  mainId: string;
  label: string;
  surfaces: Surface[];
}
/** Schlüssel einer Fläche („Quelle#Seite“); passt auch auf Rahmen (`Region`), um sie ihrer Fläche zuzuordnen. */
export const sKey = (x: { sourceId: string; page?: number }) => `${x.sourceId}#${x.page ?? 0}`;

/** Seiten für die Abtipp-Ansicht: Bild samt weiteren Bildern als eine Seite, PDF je Seite einzeln. */
export function navPages(rows: SourceRow[], pdfPages: Map<string, number>): NavPage[] {
  const mains = rows.filter((r) => r.kind === "diary" && !r.partOf).sort((a, b) => a.label.localeCompare(b.label));
  const surfacesOf = (r: SourceRow): Surface[] =>
    r.isPdf
      ? Array.from({ length: pdfPages.get(r.id) ?? 1 }, (_, page) => ({
          sourceId: r.id,
          page,
          isPdf: true,
          spread: r.pageSpread,
        }))
      : [{ sourceId: r.id, page: 0, isPdf: false, spread: r.pageSpread }];
  // Mit Seitenzahl aus dem Notizbuch: „T-01 · S. 7–8“; sonst wie gehabt nach Scan und PDF-Seite.
  const navLabel = (m: SourceRow, page: number, ofPages: number) =>
    m.firstPage !== null
      ? diaryPageLabel(m, { page, x: 0, w: 1 })
      : ofPages > 1
        ? `${m.label} S. ${page + 1}`
        : m.label;
  return mains.flatMap((m) => {
    const parts = rows.filter((r) => r.partOf === m.id).sort((a, b) => a.label.localeCompare(b.label));
    if (m.isPdf) {
      const own = surfacesOf(m);
      return own.map((sf, i) => ({
        key: sKey(sf),
        mainId: m.id,
        label: navLabel(m, i, own.length),
        // Weitere Bilder hängen an der letzten Seite des PDF.
        surfaces: i === own.length - 1 ? [sf, ...parts.flatMap(surfacesOf)] : [sf],
      }));
    }
    return [
      {
        key: sKey({ sourceId: m.id }),
        mainId: m.id,
        label: navLabel(m, 0, 1),
        surfaces: [...surfacesOf(m), ...parts.flatMap(surfacesOf)],
      },
    ];
  });
}

/** Größter Zoom im Editor; 1 heißt: Die Seite passt ganz in die Fläche. */
export const ZOOM_MAX = 6;

/** Platz für eine Seite bei Zoom 1: Fläche ohne Innenabstand; mehrere Bilder einer Seite teilen sich nicht die Höhe. */
export function fitBox(area: { w: number; h: number }, several: boolean): { w: number; h: number } {
  // Noch nicht gemessen: nichts zeigen statt einer winzigen Seite.
  if (!area.w || !area.h) return { w: 0, h: 0 };
  const w = Math.max(200, area.w - 32);
  const h = Math.max(200, area.h - 32 - (several ? 24 : 0));
  return { w, h };
}
