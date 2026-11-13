/**
 * Tagebuch abtippen: Scan groß, Einträge als Rahmen aufziehen, daneben
 * Notierzeit, Kurzform und Volltext. Läuft als Vollbild-Dialog (Radix Dialog).
 */
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState, type PointerEvent } from "react";
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
import { hm } from "./format.ts";
import { loadPdf, PdfPageCanvas } from "./pdf.tsx";
import { Button, Choice, cx, Notice } from "./ui.tsx";

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
      ? Array.from({ length: pdfPages.get(r.id) ?? 1 }, (_, page) => ({ sourceId: r.id, page, isPdf: true }))
      : [{ sourceId: r.id, page: 0, isPdf: false }];
  return mains.flatMap((m) => {
    const parts = rows.filter((r) => r.partOf === m.id).sort((a, b) => a.label.localeCompare(b.label));
    if (m.isPdf) {
      const own = surfacesOf(m);
      return own.map((sf, i) => ({
        key: sKey(sf),
        mainId: m.id,
        label: own.length > 1 ? `${m.label} S. ${i + 1}` : m.label,
        // Weitere Bilder hängen an der letzten Seite des PDF.
        surfaces: i === own.length - 1 ? [sf, ...parts.flatMap(surfacesOf)] : [sf],
      }));
    }
    return [
      {
        key: sKey({ sourceId: m.id }),
        mainId: m.id,
        label: m.label,
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
  const [continuing, setContinuing] = useState<string | null>(null);

  const onSurface = (sf: { sourceId: string; page?: number }) =>
    view.diary.filter((e) => e.regions.some((r) => sKey(r) === sKey(sf)));
  const entriesOn = (p: NavPage) =>
    view.diary.filter((e) => e.regions.some((r) => p.surfaces.some((sf) => sKey(sf) === sKey(r))));
  const here = page ? entriesOn(page) : [];
  const contEntry = view.diary.find((e) => e.id === continuing) ?? null;
  const goto = (p: NavPage) => {
    setNavKey(p.key);
    onPage(p.mainId);
  };

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
              <span className="text-[0.8rem] text-muted">{page.surfaces.length} Bilder auf dieser Seite</span>
            )}
            <span className="flex-1" />
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
                <div className="flex justify-between text-[0.78rem]">
                  <b className="font-mono">{p.label}</b>
                  <span className="text-muted">
                    {p.surfaces.length > 1 && `${p.surfaces.length} Bilder · `}
                    {entriesOn(p).length || "–"}
                  </span>
                </div>
              </button>
            ))}
          </nav>

          <div className="relative overflow-auto bg-sunken p-4">
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
              <p className="mb-2 text-center text-[0.85rem] text-muted">
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
            {here.length === 0 && <p className="text-[0.85rem] text-muted">Noch keine Einträge auf dieser Seite.</p>}
            {here.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                isHere={(r) => !!page?.surfaces.some((sf) => sKey(sf) === sKey(r))}
                defaultLookback={view.diaryLookbackMin}
                active={selected === e.id}
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
  entries,
  selected,
  onSelect,
  onDraw,
}: {
  surface: Surface;
  label: string | null;
  entries: DiaryEntryRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onDraw: (r: Region) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
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
    <figure className={cx("mx-auto max-w-full", surface.isPdf ? "w-[min(900px,100%)]" : "w-fit")}>
      {label && <figcaption className="mb-1 font-mono text-[0.78rem] text-muted">{label}</figcaption>}
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
        {surface.isPdf ? (
          <PdfPageCanvas sourceId={surface.sourceId} page={surface.page} className="block rounded bg-white shadow" />
        ) : (
          <img
            src={mediaUrl(surface.sourceId)}
            alt="Tagebuchseite"
            draggable={false}
            className="block max-h-[calc(100vh-9rem)] max-w-full rounded shadow"
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
                    "pointer-events-auto absolute -top-px -left-px cursor-pointer rounded-br px-1.5 text-[0.75rem] font-semibold text-white",
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

function EntryCard({
  entry,
  isHere,
  defaultLookback,
  active,
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
  active: boolean;
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
        <span className="grid size-6 place-items-center rounded bg-k-diary text-[0.78rem] font-semibold text-white">
          {entry.number}
        </span>
        <span className="text-[0.8rem] text-muted">
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
          <span className="font-mono text-[0.78rem] text-ink-2">
            {hm(entry.window.fromMs)}–{hm(entry.window.toMs)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-[0.85rem]">
        <label className="grid gap-0.5">
          <span className="text-muted">Notiert um</span>
          <input
            className="w-20 font-mono"
            placeholder="hh:mm"
            value={noted}
            aria-label={`Notierzeit ${label}`}
            onChange={(e) => setNoted(e.target.value)}
            onBlur={() => noted !== (entry.notedAt ?? "") && onPatch({ notedAt: noted })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
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
      <div className="flex gap-3 text-[0.8rem]">
        <Button variant="link" onClick={onContinue}>
          auf anderer Seite fortsetzen
        </Button>
        <span className="flex-1" />
        <Button variant="link" className="text-bad" onClick={onDelete}>
          Eintrag löschen
        </Button>
      </div>
    </div>
  );
}
