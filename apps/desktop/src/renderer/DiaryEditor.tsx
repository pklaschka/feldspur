/**
 * Tagebuch abtippen: Scan groß, Einträge als Rahmen aufziehen, daneben
 * Notierzeit, Kurzform und Volltext. Läuft als Vollbild-Dialog (Radix Dialog).
 */
import { diaryPageLabel, suggestPageNo } from "@feldspur/core/pages";
import { Dialog } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  mediaUrl,
  type DiaryEntryRow,
  type DiaryMode,
  type DiaryPatch,
  type Region,
  type SessionView,
  type SourceRow,
} from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { hm, maskClockAt, normalizeClock, stepClock } from "./format.ts";
import { loadPdf, PdfPageCanvas } from "./pdf.tsx";
import { Button, Choice, ConfirmButton, cx, Notice } from "./ui.tsx";

const api = window.feldspur;

const MODE_OPTIONS: { value: DiaryMode; label: string; title: string }[] = [
  { value: "scan", label: "Nur Scan", title: "Nicht abtippen, der Scan steht für sich" },
  { value: "short", label: "Kurzform", title: "Stichworte oder Zusammenfassung" },
  { value: "full", label: "Volltext", title: "Wortgetreu abgetippt" },
];

interface Surface {
  sourceId: string;
  /** PDF-Seite ab 0; bei Bildern 0. */
  page: number;
  isPdf: boolean;
  /** Doppelseite: Falz in der Mitte andeuten. */
  spread: boolean;
}
interface NavPage {
  key: string;
  /** Hauptquelle der Seite. */
  mainId: string;
  label: string;
  surfaces: Surface[];
}
const sKey = (x: { sourceId: string; page?: number }) => `${x.sourceId}#${x.page ?? 0}`;

/** Seiten für die Abtipp-Ansicht: Bild samt weiteren Bildern als eine Seite, PDF je Seite einzeln. */
function navPages(rows: SourceRow[], pdfPages: Map<string, number>): NavPage[] {
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

export function DiaryEditor({
  view,
  pageId,
  onPage,
  onClose,
  guard,
  onView,
}: {
  view: SessionView;
  /** Offene Seite (Quelle); null = Dialog geschlossen. */
  pageId: string | null;
  onPage: (id: string) => void;
  onClose: () => void;
  guard: Guard;
  onView: (v: SessionView) => void;
}) {
  const pdfIds = view.rows.filter((r) => r.kind === "diary" && r.isPdf).map((r) => r.id);
  const [pdfPages, setPdfPages] = useState(new Map<string, number>());
  useEffect(() => {
    let alive = true;
    for (const id of pdfIds) {
      if (pdfPages.has(id)) continue;
      loadPdf(id).then(
        (d) => alive && setPdfPages((m) => new Map(m).set(id, d.numPages)),
        () => alive && setPdfPages((m) => new Map(m).set(id, 1)),
      );
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfIds.join(",")]);

  const pages = navPages(view.rows, pdfPages);
  const [navKey, setNavKey] = useState<string | null>(null);
  // Von außen geöffnete Quelle: ihre (erste) Seite zeigen.
  useEffect(() => {
    if (!pageId) return setNavKey(null);
    const hit = pages.find((p) => p.surfaces.some((sf) => sf.sourceId === pageId));
    setNavKey(hit?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  const page = pageId ? (pages.find((p) => p.key === navKey) ?? pages.find((p) => p.mainId === pageId) ?? null) : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [continuing, setContinuing] = useState<string | null>(null);

  const onSurface = (sf: { sourceId: string; page?: number }) =>
    view.diary.filter((e) => e.regions.some((r) => sKey(r) === sKey(sf)));
  const entriesOn = (p: NavPage) =>
    view.diary.filter((e) => e.regions.some((r) => p.surfaces.some((sf) => sKey(sf) === sKey(r))));
  const here = page ? entriesOn(page) : [];
  // Vorschläge für die Seitenzahl je Rahmen: aus dem vorigen Rahmen in Lesereihenfolge weitergezählt.
  const suggestions = new Map<string, number>();
  {
    const spread = new Map(view.rows.map((r) => [r.id, r.pageSpread]));
    let prev: Parameters<typeof suggestPageNo>[0] = null;
    for (const e of view.diary)
      e.regions.forEach((r, i) => {
        const cur = { region: r, spread: spread.get(r.sourceId) ?? false };
        const n = r.pageNo ?? suggestPageNo(prev, cur);
        if (n !== null) {
          suggestions.set(`${e.id}#${i}`, n);
          prev = { ...cur, pageNo: n };
        }
      });
  }
  const contEntry = view.diary.find((e) => e.id === continuing) ?? null;
  const goto = (p: NavPage) => {
    setNavKey(p.key);
    onPage(p.mainId);
  };

  // Zoom: 1 = Seite passt ganz in die Fläche (kleine Scans werden dafür auch vergrößert), darüber hineingezoomt.
  const area = useRef<HTMLDivElement>(null);
  const areaSize = useElementSize(area);
  const [zoom, setZoomState] = useState(1);
  // Beim Zoomen bleibt die Stelle unter der Maus (oder die Mitte) stehen; die Scrollposition folgt nach dem Rendern.
  const pendingScroll = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null);
  const setZoom = (next: number, at?: { x: number; y: number }) => {
    const el = area.current;
    const z = Math.min(ZOOM_MAX, Math.max(1, Math.round(next * 100) / 100));
    if (el && z !== zoom) {
      const px = at?.x ?? el.clientWidth / 2;
      const py = at?.y ?? el.clientHeight / 2;
      pendingScroll.current = {
        fx: (el.scrollLeft + px) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + py) / Math.max(1, el.scrollHeight),
        px,
        py,
      };
    }
    setZoomState(z);
  };
  useLayoutEffect(() => {
    const el = area.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    pendingScroll.current = null;
    el.scrollLeft = p.fx * el.scrollWidth - p.px;
    el.scrollTop = p.fy * el.scrollHeight - p.py;
  });
  // Neue Seite: wieder ganz zeigen und oben anfangen.
  useEffect(() => {
    setZoomState(1);
    area.current?.scrollTo({ top: 0, left: 0 });
  }, [page?.key]);
  // Strg/⌘ + Mausrad zoomt an der Maus (auch Touchpad-Spreizen), ohne Strg wird wie gewohnt gescrollt.
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  wheel.current = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = area.current!.getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.004)), {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  };
  const areaRef = (el: HTMLDivElement | null) => {
    area.current = el;
    if (!el || el.dataset.wheel) return;
    el.dataset.wheel = "1";
    el.addEventListener("wheel", (e) => wheel.current(e), { passive: false });
  };

  // Tastenkürzel: Bild auf/ab blättert (auch beim Tippen), +/−/0 zoomen außerhalb von Textfeldern.
  const pageIndex = page ? pages.findIndex((p) => p.key === page.key) : -1;
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!page || e.altKey) return;
    if (e.key === "PageDown" || e.key === "PageUp") {
      const next = pages[pageIndex + (e.key === "PageDown" ? 1 : -1)];
      e.preventDefault();
      if (next) goto(next);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || t?.closest("input, textarea, [contenteditable=true]")) return;
    if (e.key === "+" || e.key === "=") setZoom(zoom * 1.25);
    else if (e.key === "-") setZoom(zoom / 1.25);
    else if (e.key === "0") setZoom(1);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    if (!page) return;
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [!!page]);

  const draw = async (sf: Surface, region: Region) => {
    const r = { ...region, page: sf.page };
    if (contEntry) {
      const v = await guard(() => api.addDiaryRegion(contEntry.id, sf.sourceId, r));
      if (v) {
        onView(v);
        setSelected(contEntry.id);
      }
      setContinuing(null);
      return;
    }
    const res = await guard(() => api.createDiaryEntry(sf.sourceId, r));
    if (res) {
      onView(res.view);
      setSelected(res.entryId);
      // Neue Box: gleich die Uhrzeit eintippen können.
      setFresh(res.entryId);
    }
  };
  const patch = (id: string, p: DiaryPatch) => void guard(() => api.patchDiaryEntry(id, p)).then((v) => v && onView(v));

  return (
    <Dialog.Root open={!!page} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          className="fixed inset-3 z-50 grid grid-cols-[150px_minmax(0,1fr)_380px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
          aria-describedby={undefined}
          data-testid="diary-editor"
        >
          <header className="col-span-3 flex items-center gap-3 border-b border-line px-4 py-2.5">
            <Dialog.Title className="text-base font-semibold">Tagebuch abtippen</Dialog.Title>
            {page && page.surfaces.length > 1 && (
              <span className="text-[0.85rem] text-muted">{page.surfaces.length} Bilder auf dieser Seite</span>
            )}
            <span className="flex-1" />
            <span className="flex items-center gap-1" role="group" aria-label="Blättern">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Vorige Seite"
                title="Vorige Seite (Bild ↑)"
                disabled={pageIndex <= 0}
                onClick={() => goto(pages[pageIndex - 1]!)}
              >
                ‹
              </Button>
              <span className="min-w-14 text-center font-mono text-[0.85rem] text-muted" data-testid="diary-page-of">
                {pageIndex + 1} / {pages.length}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Nächste Seite"
                title="Nächste Seite (Bild ↓)"
                disabled={pageIndex >= pages.length - 1}
                onClick={() => goto(pages[pageIndex + 1]!)}
              >
                ›
              </Button>
            </span>
            <span className="flex items-center gap-1" role="group" aria-label="Zoom">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Verkleinern"
                title="Verkleinern (−)"
                disabled={zoom <= 1}
                onClick={() => setZoom(zoom / 1.25)}
              >
                −
              </Button>
              <button
                className="min-w-14 cursor-pointer rounded px-1 text-center font-mono text-[0.85rem] text-muted hover:text-ink disabled:cursor-default"
                title="Ganze Seite zeigen (0)"
                data-testid="diary-zoom"
                disabled={zoom === 1}
                onClick={() => setZoom(1)}
              >
                {zoom === 1 ? "ganz" : `${Math.round(zoom * 100)} %`}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Vergrößern"
                title="Vergrößern (+, Strg/⌘ + Mausrad)"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom(zoom * 1.25)}
              >
                +
              </Button>
            </span>
            <Dialog.Close asChild>
              <Button size="sm">Fertig</Button>
            </Dialog.Close>
          </header>

          <nav className="overflow-y-auto border-r border-line bg-panel-2 p-2" aria-label="Seiten">
            {pages.map((p) => (
              <button
                key={p.key}
                onClick={() => goto(p)}
                className={cx(
                  "mb-2 block w-full cursor-pointer rounded-lg border p-1.5 text-left",
                  p.key === page?.key ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-2",
                )}
              >
                <Thumb surface={p.surfaces[0]!} />
                {/* Seitenangabe und Zählung je auf eine eigene Zeile, damit „S. 3–4“ nicht mitten im Bereich bricht. */}
                <div className="flex items-baseline justify-between gap-2 text-[0.82rem]">
                  <b className="font-mono whitespace-nowrap">{p.label}</b>
                  <span className="text-muted" title="Einträge auf dieser Seite">
                    {entriesOn(p).length || "–"}
                  </span>
                </div>
                {p.surfaces.length > 1 && <div className="text-[0.78rem] text-muted">{p.surfaces.length} Bilder</div>}
              </button>
            ))}
          </nav>

          <div ref={areaRef} className="relative overflow-auto bg-sunken p-4" data-testid="diary-area">
            {contEntry && (
              <div className="sticky top-0 z-10 mb-2">
                <Notice>
                  Fortsetzung von Eintrag {contEntry.number}: Seite wählen und den Rahmen für den weiteren Text ziehen.{" "}
                  <Button variant="link" onClick={() => setContinuing(null)}>
                    abbrechen
                  </Button>
                </Notice>
              </div>
            )}
            {here.length === 0 && !contEntry && (
              <p className="mb-2 text-center text-[0.9rem] text-muted">
                Zieh mit der Maus einen Rahmen um den ersten Eintrag. Für eine ganze Seite reicht ein Rahmen über alles.
              </p>
            )}
            <div className="grid gap-4">
              {page?.surfaces.map((sf) => {
                const row = view.rows.find((r) => r.id === sf.sourceId);
                if (!row) return null;
                if (!row.previewable && !row.isPdf) {
                  return (
                    <p key={sKey(sf)} className="text-muted">
                      {row.fileName}: Dieses Format lässt sich nicht anzeigen.
                    </p>
                  );
                }
                return (
                  <PageCanvas
                    key={sKey(sf)}
                    surface={sf}
                    label={page.surfaces.length > 1 ? `${row.label} · ${row.fileName}` : null}
                    fit={fitBox(areaSize, page.surfaces.length > 1)}
                    zoom={zoom}
                    entries={onSurface(sf)}
                    selected={selected}
                    onSelect={setSelected}
                    onDraw={(r) => void draw(sf, r)}
                  />
                );
              })}
            </div>
          </div>

          <aside className="overflow-y-auto border-l border-line p-3" aria-label="Einträge">
            {here.length === 0 && <p className="text-[0.9rem] text-muted">Noch keine Einträge auf dieser Seite.</p>}
            {here.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                isHere={(r) => !!page?.surfaces.some((sf) => sKey(sf) === sKey(r))}
                defaultLookback={view.diaryLookbackMin}
                suggestPage={(i) => suggestions.get(`${e.id}#${i}`) ?? null}
                onPage={(i, n) => void guard(() => api.setDiaryRegionPage(e.id, i, n)).then((v) => v && onView(v))}
                active={selected === e.id}
                fresh={fresh === e.id}
                onFocus={() => setSelected(e.id)}
                onPatch={(p) => patch(e.id, p)}
                onContinue={() => setContinuing(e.id)}
                onRemoveRegion={(i) => void guard(() => api.removeDiaryRegion(e.id, i)).then((v) => v && onView(v))}
                onDelete={() => void guard(() => api.deleteDiaryEntry(e.id)).then((v) => v && onView(v))}
                onGoto={(r) => {
                  const target = pages.find((p) => p.surfaces.some((sf) => sKey(sf) === sKey(r)));
                  if (target) goto(target);
                }}
              />
            ))}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Thumb({ surface }: { surface: Surface }) {
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
function PageCanvas({
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
  const cssW = natural ? Math.max(120, Math.round(natural.w * fitScale * zoom)) : null;
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

/**
 * Seitenzahl im Notizbuch am Eintrag. Leer zeigt die Zählung des Scans oder einen Vorschlag
 * (vom vorigen Eintrag weitergezählt); beim Hineinklicken steht der Vorschlag schon drin.
 */
function PageField({
  label,
  ariaLabel,
  pageNo,
  own,
  suggestion,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  pageNo: number | null;
  own: boolean;
  suggestion: number | null;
  onCommit: (pageNo: number | null) => void;
}) {
  const [text, setText] = useState(own && pageNo !== null ? String(pageNo) : "");
  useEffect(() => setText(own && pageNo !== null ? String(pageNo) : ""), [own, pageNo]);
  const hint = pageNo ?? suggestion;
  const commit = () => {
    const t = text.trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && !Number.isInteger(n)) return setText(own && pageNo !== null ? String(pageNo) : "");
    if (n === null) {
      if (own) onCommit(null);
    } else if (n !== pageNo) onCommit(n); // was die Zählung des Scans ohnehin ergibt, nicht eigens speichern
  };
  return (
    <label className="grid gap-0.5" title="Seitenzahl im Notizbuch. Leer: aus der Seitenzählung des Scans.">
      <span className="text-muted">{label}</span>
      <input
        className="w-16 font-mono"
        inputMode="numeric"
        placeholder={hint === null ? "–" : String(hint)}
        value={text}
        aria-label={ariaLabel}
        onFocus={(e) => {
          if (text === "" && hint !== null) {
            setText(String(hint));
            const el = e.currentTarget;
            requestAnimationFrame(() => el.select());
          }
        }}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function EntryCard({
  entry,
  isHere,
  defaultLookback,
  suggestPage,
  onPage,
  active,
  fresh,
  onFocus,
  onPatch,
  onContinue,
  onRemoveRegion,
  onDelete,
  onGoto,
}: {
  entry: DiaryEntryRow;
  isHere: (r: { sourceId: string; page?: number }) => boolean;
  defaultLookback: number;
  suggestPage: (index: number) => number | null;
  onPage: (index: number, pageNo: number | null) => void;
  active: boolean;
  /** Gerade aufgezogen: Fokus ins Feld „Notiert um“. */
  fresh: boolean;
  onFocus: () => void;
  onPatch: (p: DiaryPatch) => void;
  onContinue: () => void;
  onRemoveRegion: (index: number) => void;
  onDelete: () => void;
  onGoto: (r: { sourceId: string; page?: number }) => void;
}) {
  const [noted, setNoted] = useState(entry.notedAt ?? "");
  const [back, setBack] = useState(entry.lookbackMin === null ? "" : String(entry.lookbackMin));
  const [short, setShort] = useState(entry.shortText);
  const [full, setFull] = useState(entry.fullText);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => setNoted(entry.notedAt ?? ""), [entry.notedAt]);
  useEffect(() => setBack(entry.lookbackMin === null ? "" : String(entry.lookbackMin)), [entry.lookbackMin]);
  useEffect(() => setShort(entry.shortText), [entry.shortText]);
  useEffect(() => setFull(entry.fullText), [entry.fullText]);
  useEffect(() => {
    if (active) card.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const label = `Eintrag ${entry.number}`;
  return (
    <div
      ref={card}
      data-testid="diary-entry"
      onFocusCapture={onFocus}
      onClick={onFocus}
      className={cx("mb-3 grid gap-2 rounded-lg border p-3", active ? "border-accent" : "border-line")}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded bg-k-diary text-[0.82rem] font-semibold text-white">
          {entry.number}
        </span>
        <span className="text-[0.85rem] text-muted">
          {entry.regions.map((r, i) => (
            <span key={i} className="mr-1.5 inline-flex items-center gap-0.5">
              <button
                className={cx("cursor-pointer font-mono", isHere(r) ? "text-ink" : "text-accent underline")}
                onClick={() => !isHere(r) && onGoto(r)}
              >
                {r.pageLabel}
              </button>
              {entry.regions.length > 1 && (
                <button
                  className="cursor-pointer text-muted hover:text-bad"
                  aria-label={`Rahmen auf ${r.pageLabel} entfernen`}
                  onClick={() => onRemoveRegion(i)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </span>
        <span className="flex-1" />
        {entry.window && (
          <span className="font-mono text-[0.82rem] text-ink-2">
            {hm(entry.window.fromMs)}–{hm(entry.window.toMs)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-[0.9rem]">
        <ClockField
          label="Notiert um"
          ariaLabel={`Notierzeit ${label}`}
          value={noted}
          autoFocus={fresh}
          onChange={setNoted}
          onCommit={(v) => v !== (entry.notedAt ?? "") && onPatch({ notedAt: v })}
        />
        <label className="grid gap-0.5">
          <span className="text-muted">bezieht sich auf</span>
          <span className="flex items-center gap-1">
            <input
              className="w-14 text-right font-mono"
              placeholder={String(defaultLookback)}
              value={back}
              aria-label={`Bezugszeitraum ${label}`}
              onChange={(e) => setBack(e.target.value)}
              onBlur={() => {
                const v = back.trim() === "" ? null : Number(back.replace(",", "."));
                if (v !== entry.lookbackMin && (v === null || Number.isFinite(v))) onPatch({ lookbackMin: v });
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <span className="text-muted">Min. davor</span>
          </span>
        </label>
        {entry.regions.map((r, i) => (
          <PageField
            key={i}
            label={entry.regions.length > 1 ? `Seite (${i + 1}. Teil)` : "Seite"}
            ariaLabel={`Seite ${label}${entry.regions.length > 1 ? `, ${i + 1}. Teil` : ""}`}
            pageNo={r.pageNo}
            own={r.pageNoOwn}
            suggestion={suggestPage(i)}
            onCommit={(n) => onPage(i, n)}
          />
        ))}
      </div>
      <Choice
        label={`Form ${label}`}
        value={entry.mode}
        onChange={(m) => onPatch({ mode: m })}
        options={MODE_OPTIONS}
      />
      {entry.mode !== "scan" && (
        <textarea
          className="min-h-14 rounded-md border border-line-2 bg-panel px-2 py-1"
          placeholder="Kurzform: Stichworte, worum es geht"
          aria-label={`Kurzform ${label}`}
          value={short}
          onChange={(e) => setShort(e.target.value)}
          onBlur={() => short !== entry.shortText && onPatch({ shortText: short })}
        />
      )}
      {entry.mode === "full" && (
        <textarea
          className="min-h-40 rounded-md border border-line-2 bg-panel px-2 py-1 leading-relaxed"
          placeholder="Volltext, wortgetreu abgetippt"
          aria-label={`Volltext ${label}`}
          value={full}
          onChange={(e) => setFull(e.target.value)}
          onBlur={() => full !== entry.fullText && onPatch({ fullText: full })}
        />
      )}
      <div className="flex gap-3 text-[0.85rem]">
        <Button variant="link" onClick={onContinue}>
          auf anderer Seite fortsetzen
        </Button>
        <span className="flex-1" />
        <ConfirmButton variant="link" className="text-bad" onConfirm={onDelete}>
          Eintrag löschen
        </ConfirmButton>
      </div>
    </div>
  );
}

const ZOOM_MAX = 6;

/** Platz für eine Seite bei Zoom 1: Fläche ohne Innenabstand; mehrere Bilder einer Seite teilen sich nicht die Höhe. */
function fitBox(area: { w: number; h: number }, several: boolean): { w: number; h: number } {
  const w = Math.max(200, area.w - 32);
  const h = Math.max(200, area.h - 32 - (several ? 24 : 0));
  return { w, h };
}

function useElementSize(ref: { current: HTMLElement | null }): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observed = useRef<{ el: HTMLElement; ro: ResizeObserver } | null>(null);
  // Das Element erscheint erst, wenn der Dialog aufgeht: nach jedem Rendern prüfen, ob es neu ist.
  useLayoutEffect(() => {
    const el = ref.current;
    if (observed.current?.el === el) return;
    observed.current?.ro.disconnect();
    observed.current = null;
    if (!el) return;
    const measure = () =>
      setSize((s) =>
        s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight },
      );
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observed.current = { el, ro };
    measure();
  });
  useEffect(() => () => observed.current?.ro.disconnect(), []);
  return size;
}

/** Natürliche Größe eines Scans (Bild in Pixeln, PDF-Seite in Punkten, beim PDF höchstens 900 px breit). */
function useNaturalSize(surface: Surface): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setSize(null);
    if (surface.isPdf) {
      loadPdf(surface.sourceId)
        .then((d) => d.getPage(surface.page + 1))
        .then(
          (p) => {
            const v = p.getViewport({ scale: 1 });
            // Breite Seiten nicht über 900 px aufblasen: daran misst sich „ganz zeigen“ bei PDF.
            const k = Math.min(1, 900 / v.width) * 4;
            if (alive) setSize({ w: v.width * k, h: v.height * k });
          },
          () => alive && setSize({ w: 900, h: 1270 }),
        );
    } else {
      const img = new Image();
      img.onload = () => alive && setSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => alive && setSize({ w: 800, h: 1100 });
      img.src = mediaUrl(surface.sourceId);
    }
    return () => {
      alive = false;
    };
  }, [surface.sourceId, surface.page, surface.isPdf]);
  return size;
}

/** Uhrzeit „hh:mm“ als Maskenfeld: nur Ziffern, Doppelpunkt von selbst, ↑/↓ verschieben um eine Minute. */
function ClockField({
  label,
  ariaLabel,
  value,
  onChange,
  onCommit,
  autoFocus = false,
}: {
  label: ReactNode;
  ariaLabel: string;
  autoFocus?: boolean;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const valid = normalizeClock(value) !== null;
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  // Nach der Maske die Schreibmarke dorthin setzen, wo getippt wurde, statt ans Ende.
  useLayoutEffect(() => {
    if (caret.current === null || document.activeElement !== input.current) return;
    input.current!.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  return (
    <label className="grid gap-0.5">
      <span className="text-muted">{label}</span>
      <input
        className={cx("w-20 font-mono", !valid && "border-bad text-bad")}
        placeholder="hh:mm"
        inputMode="numeric"
        maxLength={6}
        ref={input}
        value={value}
        aria-label={ariaLabel}
        aria-invalid={!valid}
        title={valid ? "Uhrzeit, z. B. 1030 für 10:30. ↑/↓: eine Minute, mit Umschalt zehn." : "Keine gültige Uhrzeit"}
        onChange={(e) => {
          const m = maskClockAt(e.target.value, e.target.selectionStart ?? e.target.value.length);
          caret.current = m.caret;
          onChange(m.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(stepClock(value, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)));
          }
        }}
        onBlur={() => {
          const n = normalizeClock(value);
          if (n === null) return; // ungültig: stehen lassen und rot zeigen, nichts speichern
          onChange(n);
          onCommit(n);
        }}
      />
    </label>
  );
}
