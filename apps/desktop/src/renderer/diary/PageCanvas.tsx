/** Scan einer Seite mit Rahmen der Einträge. */
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { mediaUrl, type DiaryEntryRow, type Region } from "../../shared/api.ts";
import { loadPdf, PdfPageCanvas } from "../pdf.tsx";
import { cx } from "../ui.tsx";
import { useLoaded } from "../hooks.ts";
import { type Surface, sKey } from "./pages.ts";
import { type Box, CURSOR, type EditMode, HANDLES, MIN_SIZE, editBox, nudgeBox, sameBox } from "./regionEdit.ts";

const pct = (r: Box): CSSProperties => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.w * 100}%`,
  height: `${r.h * 100}%`,
});

/** Griff an Kante oder Ecke: mittig auf der Linie. */
const handleStyle = (h: EditMode): CSSProperties => ({
  left: h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
  top: h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%",
  cursor: CURSOR[h],
});

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

/**
 * Scan (Bild oder PDF-Seite) mit Rahmen; Ziehen mit der Maus legt einen neuen Rahmen an. Die Rahmen des gewählten
 * Eintrags lassen sich verschieben (am Nummernschild oben links ziehen) und an Kanten und Ecken in der Größe ändern,
 * auch mit den Pfeiltasten. Ein Klick in einen Rahmen wählt seinen Eintrag.
 */
export function PageCanvas({
  surface,
  label,
  fit,
  zoom,
  entries,
  selected,
  onSelect,
  onDraw,
  onMove,
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
  /** Rahmen Nummer `index` des Eintrags verschoben oder in der Größe geändert. */
  onMove: (entryId: string, index: number, box: Box) => Promise<unknown>;
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
  // Rahmen, der gerade gezogen wird, und der zuletzt geänderte, bis die gespeicherte Fassung zurück ist.
  const [edit, setEdit] = useState<{
    key: string;
    entryId: string;
    index: number;
    mode: EditMode;
    start: { x: number; y: number };
    orig: Box;
    box: Box;
  } | null>(null);
  const [pending, setPending] = useState<{ key: string; box: Box; token: number } | null>(null);
  const token = useRef(0);
  const shown = (key: string, r: Box): Box =>
    edit?.key === key ? edit.box : pending?.key === key ? pending.box : { x: r.x, y: r.y, w: r.w, h: r.h };
  const hold = (key: string, box: Box) => {
    const t = ++token.current;
    setPending({ key, box, token: t });
    return t;
  };
  const commit = (key: string, entryId: string, index: number, orig: Box, box: Box) => {
    if (sameBox(orig, box)) return setPending(null);
    const t = hold(key, box);
    void onMove(entryId, index, box).finally(() => setPending((p) => (p?.token === t ? null : p)));
  };

  const here = entries.flatMap((e) =>
    e.regions.map((r, i) => ({ e, r, i, key: `${e.id}-${i}` })).filter(({ r }) => sKey(r) === sKey(surface)),
  );
  // Klick ohne Ziehen: den kleinsten Rahmen unter der Maus wählen (bei verschachtelten Rahmen den inneren).
  const pick = (p: { x: number; y: number }) => {
    const hit = here
      .filter(({ r }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
      .sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h)[0];
    if (hit) onSelect(hit.e.id);
  };
  const onRegionKey = (e: KeyboardEvent, key: string, orig: Box) => {
    const box = nudgeBox(shown(key, orig), e.key, { shift: e.shiftKey, alt: e.altKey });
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    hold(key, box);
  };
  const onRegionKeyUp = (e: KeyboardEvent, key: string, entryId: string, index: number, orig: Box) => {
    if (!e.key.startsWith("Arrow") || pending?.key !== key) return;
    commit(key, entryId, index, orig, pending.box);
  };
  return (
    <figure className="mx-auto" style={{ width: cssW ?? undefined, visibility: cssW ? undefined : "hidden" }}>
      {label && <figcaption className="mb-1 font-mono text-[0.82rem] text-muted">{label}</figcaption>}
      <div
        ref={box}
        data-testid="diary-page"
        className="relative cursor-crosshair touch-none select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const t = e.target as HTMLElement;
          const p = rel(e);
          const handle = t.closest<HTMLElement>("[data-edit]");
          const hit = handle && here.find((h) => h.key === handle.dataset.key);
          if (!hit && t.closest("[data-region]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (hit) {
            // Am Nummernschild gefasst: der Eintrag ist damit auch gewählt (das Klick-Ereignis geht an die Fläche).
            onSelect(hit.e.id);
            const orig = shown(hit.key, hit.r);
            setEdit({
              key: hit.key,
              entryId: hit.e.id,
              index: hit.i,
              mode: handle.dataset.edit as EditMode,
              start: p,
              orig,
              box: orig,
            });
            return;
          }
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (edit) {
            const p = rel(e);
            setEdit({ ...edit, box: editBox(edit.orig, edit.mode, p.x - edit.start.x, p.y - edit.start.y) });
            return;
          }
          if (!drag) return;
          const p = rel(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (edit) {
            commit(edit.key, edit.entryId, edit.index, edit.orig, edit.box);
            setEdit(null);
            return;
          }
          if (rect && rect.w > MIN_SIZE && rect.h > MIN_SIZE) onDraw(rect);
          else if (drag) pick({ x: drag.x0, y: drag.y0 });
          setDrag(null);
        }}
        onPointerCancel={() => {
          setEdit(null);
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
        {here.map(({ e, r, i, key }) => {
          const active = selected === e.id;
          const box = shown(key, r);
          const name = `Eintrag ${e.number}${e.regions.length > 1 ? `, ${i + 1}. Teil` : ""}`;
          return (
            <div
              key={key}
              style={pct(box)}
              data-testid="diary-region"
              {...(active && { role: "group", "aria-label": `Rahmen ${name}` })}
              // Die Fläche selbst fängt keine Maus: Darin lassen sich weitere (überlappende) Rahmen aufziehen.
              // Verschoben wird nur am Nummernschild oben links.
              className={cx(
                "pointer-events-none absolute rounded-sm border-2",
                // Kontext: gestrichelt und neutral, denn er hat bewusst keine Uhrzeit.
                e.role === "context" && "border-dashed",
                active
                  ? "border-accent bg-accent/15"
                  : e.role === "context"
                    ? "border-ink-2 bg-ink-2/8"
                    : "border-k-diary bg-k-diary/10",
              )}
            >
              <button
                data-region
                data-edit="move"
                data-key={key}
                onClick={() => onSelect(e.id)}
                onKeyDown={(ev) => active && onRegionKey(ev, key, r)}
                onKeyUp={(ev) => active && onRegionKeyUp(ev, key, e.id, i, r)}
                aria-label={`Eintrag ${e.number}${e.role === "context" ? ", Kontext" : ""}`}
                title="Am Nummernschild ziehen verschiebt den Rahmen, die Griffe an Kanten und Ecken ändern die Größe. Gewählt: Pfeiltasten verschieben, mit Alt ändern sie die Größe, mit Umschalt in großen Schritten."
                className={cx(
                  "pointer-events-auto absolute -top-px -left-px cursor-move rounded-br px-1.5 text-[0.8rem] font-semibold text-white",
                  active ? "bg-accent" : e.role === "context" ? "bg-ink-2" : "bg-k-diary",
                )}
              >
                {e.number}
                {e.role === "context" ? " · K" : e.notedAt ? ` · ${e.notedAt}` : ""}
              </button>
              {active &&
                HANDLES.map((h) => (
                  <span
                    key={h}
                    data-edit={h}
                    data-key={key}
                    data-testid={`diary-handle-${h}`}
                    aria-hidden
                    style={handleStyle(h)}
                    className="pointer-events-auto absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-accent bg-panel"
                  />
                ))}
            </div>
          );
        })}
        {rect && (
          <div style={pct(rect)} className="pointer-events-none absolute border-2 border-dashed border-accent" />
        )}
      </div>
    </figure>
  );
}

/** Natürliche Größe eines Scans (Bild in Pixeln, PDF-Seite in Punkten, beim PDF höchstens 900 px breit). */
/** Schon bekannte Größen: Beim Blättern zurück steht die Seite sofort in der richtigen Größe da. */
const naturalSizes = new Map<string, { w: number; h: number }>();

function useNaturalSize(surface: Surface): { w: number; h: number } | null {
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
