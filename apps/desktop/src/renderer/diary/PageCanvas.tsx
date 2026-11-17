/** Scan einer Seite mit Rahmen der Einträge. */
import { useRef, useState, type PointerEvent } from "react";
import { mediaUrl, type DiaryEntryRow, type Region } from "../../shared/api.ts";
import { loadPdf, PdfPageCanvas } from "../pdf.tsx";
import { cx } from "../ui.tsx";
import { useLoaded } from "../hooks.ts";
import { type Surface, sKey } from "./pages.ts";

export function Thumb({ surface }: { surface: Surface }) {
  if (surface.isPdf) {
    return (
      <div className="mb-1 max-h-28 overflow-hidden rounded bg-white">
        <PdfPageCanvas sourceId={surface.sourceId} page={surface.page} maxWidth={140} className="block" />
      </div>
    );
  }
  return <img src={mediaUrl(surface.sourceId)} alt="" className="mb-1 max-h-28 w-full rounded object-contain" />;
}

/** Scan (Bild oder PDF-Seite) mit Rahmen; Ziehen mit der Maus legt einen neuen Rahmen an. */
export function PageCanvas({
  surface,
  label,
  fit,
  zoom,
  entries,
  selected,
  onSelect,
  onDraw,
}: {
  surface: Surface;
  label: string | null;
  /** Platz, in den die Seite bei Zoom 1 ganz passt. */
  fit: { w: number; h: number };
  zoom: number;
  entries: DiaryEntryRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onDraw: (r: Region) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const natural = useNaturalSize(surface);
  // Ganz zeigen heißt: so groß wie möglich, ohne über Breite oder Höhe hinauszugehen. Kleine Scans werden dafür
  // vergrößert; PDF-Seiten höchstens 900 px breit, damit Text in der Breite lesbar bleibt.
  const fitScale = natural ? Math.min(fit.w / natural.w, fit.h / natural.h) : 0;
  const cssW = natural && fitScale > 0 ? Math.max(120, Math.round(natural.w * fitScale * zoom)) : null;
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const rel = (e: PointerEvent) => {
    const b = box.current!.getBoundingClientRect();
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height };
  };
  const rect = drag && {
    x: Math.min(drag.x0, drag.x1),
    y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0),
    h: Math.abs(drag.y1 - drag.y0),
  };
  const pct = (r: Region) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });
  return (
    <figure className="mx-auto" style={{ width: cssW ?? undefined, visibility: cssW ? undefined : "hidden" }}>
      {label && <figcaption className="mb-1 font-mono text-[0.82rem] text-muted">{label}</figcaption>}
      <div
        ref={box}
        data-testid="diary-page"
        className="relative cursor-crosshair touch-none select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-region]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = rel(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = rel(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (rect && rect.w > 0.01 && rect.h > 0.01) onDraw(rect);
          setDrag(null);
        }}
      >
        {surface.spread && (
          <span
            className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] border-l border-dashed border-k-diary/60"
            data-testid="diary-fold"
            aria-hidden
          />
        )}
        {surface.isPdf ? (
          <PdfPageCanvas
            sourceId={surface.sourceId}
            page={surface.page}
            maxWidth={cssW ?? 900}
            className="block rounded bg-white shadow"
          />
        ) : (
          <img
            src={mediaUrl(surface.sourceId)}
            alt="Tagebuchseite"
            draggable={false}
            className="block w-full rounded shadow"
          />
        )}
        {entries.flatMap((e) =>
          e.regions
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => sKey(r) === sKey(surface))
            .map(({ r, i }) => (
              <div
                key={`${e.id}-${i}`}
                style={pct(r)}
                className={cx(
                  "pointer-events-none absolute rounded-sm border-2",
                  selected === e.id ? "border-accent bg-accent/15" : "border-k-diary bg-k-diary/10",
                )}
              >
                <button
                  data-region
                  onClick={() => onSelect(e.id)}
                  aria-label={`Eintrag ${e.number}`}
                  className={cx(
                    "pointer-events-auto absolute -top-px -left-px cursor-pointer rounded-br px-1.5 text-[0.8rem] font-semibold text-white",
                    selected === e.id ? "bg-accent" : "bg-k-diary",
                  )}
                >
                  {e.number}
                  {e.notedAt ? ` · ${e.notedAt}` : ""}
                </button>
              </div>
            )),
        )}
        {rect && (
          <div style={pct(rect)} className="pointer-events-none absolute border-2 border-dashed border-accent" />
        )}
      </div>
    </figure>
  );
}

/** Natürliche Größe eines Scans (Bild in Pixeln, PDF-Seite in Punkten, beim PDF höchstens 900 px breit). */
/** Schon bekannte Größen: Beim Blättern zurück steht die Seite sofort in der richtigen Größe da. */
export const naturalSizes = new Map<string, { w: number; h: number }>();

export function useNaturalSize(surface: Surface): { w: number; h: number } | null {
  const key = `${surface.sourceId}#${surface.page}`;
  const known = naturalSizes.get(key);
  const loaded = useLoaded(known ? null : key, async () => {
    const size = await measureSurface(surface);
    naturalSizes.set(key, size);
    return size;
  });
  return known ?? (loaded.state === "done" ? loaded.value : null);
}

async function measureSurface(surface: Surface): Promise<{ w: number; h: number }> {
  if (surface.isPdf) {
    try {
      const p = await (await loadPdf(surface.sourceId)).getPage(surface.page + 1);
      const v = p.getViewport({ scale: 1 });
      // Breite Seiten nicht über 900 px aufblasen: daran misst sich „ganz zeigen“ bei PDF.
      const k = Math.min(1, 900 / v.width) * 4;
      return { w: v.width * k, h: v.height * k };
    } catch {
      return { w: 900, h: 1270 };
    }
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 800, h: 1100 });
    img.src = mediaUrl(surface.sourceId);
  });
}
