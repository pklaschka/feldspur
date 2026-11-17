/**
 * PDF-Scans mit pdf.js anzeigen: Seiten als Canvas, Seitenzahl für die Abtipp-Ansicht.
 * Die Datei kommt über das eigene Medien-Protokoll, nur lesend.
 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useLoaded } from "./hooks.ts";
import { mediaUrl } from "../shared/api.ts";

GlobalWorkerOptions.workerSrc = workerUrl;

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(sourceId: string): Promise<PDFDocumentProxy> {
  let p = docs.get(sourceId);
  if (!p) {
    p = getDocument({ url: mediaUrl(sourceId) }).promise;
    p.catch(() => docs.delete(sourceId));
    docs.set(sourceId, p);
  }
  return p;
}

/** Seitenzahl eines PDF; null, solange es lädt oder wenn es nicht lesbar ist. */
export function usePdfPageCount(sourceId: string | null): number | null {
  const n = useLoaded(sourceId, async (id) => (await loadPdf(id)).numPages);
  return n.state === "done" ? n.value : n.state === "failed" ? 0 : null;
}

/** Obergrenze für die Bildpunkte einer gerenderten PDF-Seite (etwa 4096 × 4096). */
const MAX_PIXELS = 16_777_216;

/**
 * Eine PDF-Seite als Canvas in voller Breite des Elternelements.
 * onSize meldet das Seitenverhältnis, sobald die Seite gerendert ist.
 */
export function PdfPageCanvas({
  sourceId,
  page,
  className,
  maxWidth = 1400,
}: {
  sourceId: string;
  /** ab 0 */
  page: number;
  className?: string;
  maxWidth?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const drawn = useRef(false);
  useEffect(() => {
    let alive = true;
    let task: { cancel(): void } | null = null;
    // Beim Zoomen ändert sich maxWidth in schneller Folge: erst rendern, wenn es kurz ruhig ist.
    const timer = setTimeout(
      () =>
        void (async () => {
          try {
            const doc = await loadPdf(sourceId);
            const p = await doc.getPage(page + 1);
            const c = ref.current;
            if (!alive || !c) return;
            const base = p.getViewport({ scale: 1 });
            const cssW = Math.min(maxWidth, c.parentElement?.clientWidth || base.width);
            // Höchstens MAX_PIXELS Bildpunkte: Größere Leinwände kosten viel Speicher und bleiben im Zweifel weiß.
            // Darüber wird das Bild nur noch hochskaliert, was beim Abtippen reicht.
            const wanted = (cssW / base.width) * (window.devicePixelRatio || 1);
            const scale = Math.min(wanted, Math.sqrt(MAX_PIXELS / (base.width * base.height)));
            const vp = p.getViewport({ scale });
            // In eine eigene Leinwand rendern und erst fertig übernehmen: sonst ist die Seite währenddessen leer.
            const off = document.createElement("canvas");
            off.width = Math.round(vp.width);
            off.height = Math.round(vp.height);
            const t = p.render({ canvas: off, viewport: vp });
            task = t;
            await t.promise;
            if (!alive) return;
            c.width = off.width;
            c.height = off.height;
            c.style.aspectRatio = `${base.width} / ${base.height}`;
            c.getContext("2d")!.drawImage(off, 0, 0);
            drawn.current = true;
          } catch (e) {
            if (alive && (e as Error).name !== "RenderingCancelledException") {
              console.error("PDF-Seite", page + 1, e);
              setFailed(true);
            }
          }
        })(),
      drawn.current ? 150 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [sourceId, page, maxWidth]);
  if (failed) return <p className="p-4 text-muted">Diese PDF-Seite lässt sich nicht anzeigen.</p>;
  return <canvas ref={ref} className={className} style={{ width: "100%", height: "auto" }} />;
}

/** Alle Seiten untereinander. */
export function PdfPages({ sourceId, className }: { sourceId: string; className?: string }) {
  const n = usePdfPageCount(sourceId);
  if (n === null) return <p className="p-4 text-muted">PDF wird geladen…</p>;
  if (n === 0) return <p className="p-4 text-muted">Dieses PDF lässt sich nicht öffnen.</p>;
  return (
    <div className={className}>
      {Array.from({ length: n }, (_, i) => (
        <figure key={i} className="rounded border border-line bg-white shadow-sm">
          <PdfPageCanvas sourceId={sourceId} page={i} className="block" />
          <figcaption className="border-t border-line px-2 py-1 text-[0.8rem] text-muted">Seite {i + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}
