/**
 * Tagebuch abtippen: Scan groß, Einträge als Rahmen aufziehen, daneben
 * Notierzeit, Kurzform und Volltext. Läuft als Vollbild-Dialog (Radix Dialog).
 */
import { suggestPageNo } from "@feldspur/core/pages";
import { Dialog } from "radix-ui";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { DiaryEntryRow, DiaryPatch, Region, SessionView } from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { loadPdf } from "./pdf.tsx";
import { Button, cx, ErrorBanner, Notice } from "./ui.tsx";
import { useLatest } from "./hooks.ts";
import { type NavPage, type Surface, ZOOM_MAX, fitBox, navPages, sKey } from "./diary/pages.ts";
import { PageCanvas, Thumb } from "./diary/PageCanvas.tsx";
import { EntryCard } from "./diary/EntryCard.tsx";
import { useElementSize } from "./diary/useElementSize.ts";

const api = window.feldspur;

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
  // Seitenzahlen der PDF-Scans; nachgeladen, sobald ein neues PDF dazukommt.
  const pdfKey = view.rows
    .filter((r) => r.kind === "diary" && r.isPdf)
    .map((r) => r.id)
    .join(",");
  const [pdfPages, setPdfPages] = useState(new Map<string, number>());
  const knownPdf = useEffectEvent((id: string) => pdfPages.has(id));
  useEffect(() => {
    let alive = true;
    for (const id of pdfKey ? pdfKey.split(",") : []) {
      if (knownPdf(id)) continue;
      loadPdf(id).then(
        (d) => alive && setPdfPages((m) => new Map(m).set(id, d.numPages)),
        () => alive && setPdfPages((m) => new Map(m).set(id, 1)),
      );
    }
    return () => {
      alive = false;
    };
  }, [pdfKey]);

  const pages = navPages(view.rows, pdfPages);
  // Von außen geöffnete Quelle: ihre (erste) Seite zeigen. Blättern ändert nur navKey, nicht pageId.
  const firstPageOf = (id: string | null) =>
    id ? (pages.find((p) => p.surfaces.some((sf) => sf.sourceId === id))?.key ?? null) : null;
  const [navKey, setNavKey] = useState<string | null>(() => firstPageOf(pageId));
  const [openedId, setOpenedId] = useState(pageId);
  if (openedId !== pageId) {
    setOpenedId(pageId);
    setNavKey(firstPageOf(pageId));
  }
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

  // Felder speichern beim Verlassen. Blättern und Schließen nehmen das fokussierte Feld aus dem DOM, ohne dass
  // Chromium dabei verlässlich ein blur meldet; deshalb vorher gezielt verlassen und warten, bis gespeichert ist.
  const content = useRef<HTMLDivElement>(null);
  const saving = useRef(new Set<Promise<unknown>>());
  const track = <T,>(p: Promise<T>) => {
    saving.current.add(p);
    void p.finally(() => saving.current.delete(p));
    return p;
  };
  const afterSave = (then: () => void) => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && content.current?.contains(el) && el.matches("input, textarea")) el.blur();
    if (saving.current.size === 0) return then();
    void Promise.allSettled(saving.current).then(then);
  };
  const goto = (p: NavPage) =>
    afterSave(() => {
      setNavKey(p.key);
      onPage(p.mainId);
    });

  // Zoom: 1 = Seite passt ganz in die Fläche (kleine Scans werden dafür auch vergrößert), darüber hineingezoomt.
  const area = useRef<HTMLDivElement>(null);
  const [areaSize, observeArea] = useElementSize();
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
  const pageKey = page?.key;
  const [zoomedPage, setZoomedPage] = useState(pageKey);
  if (zoomedPage !== pageKey) {
    setZoomedPage(pageKey);
    setZoomState(1);
  }
  useEffect(() => {
    area.current?.scrollTo({ top: 0, left: 0 });
  }, [pageKey]);
  // Strg/⌘ + Mausrad zoomt an der Maus (auch Touchpad-Spreizen), ohne Strg wird wie gewohnt gescrollt.
  const wheel = useLatest((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = area.current!.getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.004)), {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  });

  const areaRef = (el: HTMLDivElement | null) => {
    area.current = el;
    observeArea(el);
    if (!el || el.dataset.wheel) return;
    el.dataset.wheel = "1";
    el.addEventListener("wheel", (e) => wheel.current(e), { passive: false });
  };

  // Tastenkürzel: Bild auf/ab blättert (auch beim Tippen), +/−/0 zoomen außerhalb von Textfeldern.
  const pageIndex = page ? pages.findIndex((p) => p.key === page.key) : -1;
  const onKey = useEffectEvent((e: KeyboardEvent) => {
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
  });
  const hasPage = !!page;
  useEffect(() => {
    if (!hasPage) return;
    const on = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [hasPage]);

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
  const patch = (id: string, p: DiaryPatch) =>
    void track(guard(() => api.patchDiaryEntry(id, p)).then((v) => v && onView(v)));

  return (
    <Dialog.Root open={!!page} onOpenChange={(o) => !o && afterSave(onClose)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          ref={content}
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
                  <span className="text-muted" title="Einträge auf dieser Seite (K: Kontext)">
                    {pageCount(entriesOn(p))}
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
                    onMove={(id, i, box) =>
                      track(guard(() => api.moveDiaryRegion(id, i, box)).then((v) => v && onView(v)))
                    }
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
                context={view.context}
                onRole={(on) => void track(guard(() => api.setContext(`entry:${e.id}`, on)).then((v) => v && onView(v)))}
                onDetails={(d) =>
                  void track(guard(() => api.setContextDetails(`entry:${e.id}`, d)).then((v) => v && onView(v)))
                }
                onRefs={(refs) => void track(guard(() => api.setEntryRefs(e.id, refs)).then((v) => v && onView(v)))}
                isHere={(r) => !!page?.surfaces.some((sf) => sKey(sf) === sKey(r))}
                defaultLookback={view.diaryLookbackMin}
                suggestPage={(i) => suggestions.get(`${e.id}#${i}`) ?? null}
                onPage={(i, n) =>
                  void track(guard(() => api.setDiaryRegionPage(e.id, i, n)).then((v) => v && onView(v)))
                }
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
          <ErrorBanner dialog floating />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Zählung in der Seitenliste: „2, davon 1 K“, „ganz K“ oder „–“. */
function pageCount(list: DiaryEntryRow[]): string {
  if (!list.length) return "–";
  const k = list.filter((e) => e.role === "context").length;
  if (!k) return String(list.length);
  return k === list.length ? "Kontext" : `${list.length}, davon ${k} K`;
}
