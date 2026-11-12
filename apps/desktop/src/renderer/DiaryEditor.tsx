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
} from "../shared/api.ts";
import type { Guard } from "./App.tsx";
import { hm } from "./format.ts";
import { Button, Choice, cx, Notice } from "./ui.tsx";

const api = window.feldspur;

const MODE_OPTIONS: { value: DiaryMode; label: string; title: string }[] = [
  { value: "scan", label: "Nur Scan", title: "Nicht abtippen, der Scan steht für sich" },
  { value: "short", label: "Kurzform", title: "Stichworte oder Zusammenfassung" },
  { value: "full", label: "Volltext", title: "Wortgetreu abgetippt" },
];

export function DiaryEditor({
  view,
  pageId,
  onPage,
  onClose,
  guard,
  onView,
}: {
  view: SessionView;
  /** Offene Seite; null = Dialog geschlossen. */
  pageId: string | null;
  onPage: (id: string) => void;
  onClose: () => void;
  guard: Guard;
  onView: (v: SessionView) => void;
}) {
  const pages = view.rows.filter((r) => r.kind === "diary").sort((a, b) => a.label.localeCompare(b.label));
  const page = pages.find((p) => p.id === pageId) ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const [continuing, setContinuing] = useState<string | null>(null);

  const onPage_ = (id: string) => onPage(id);
  const entriesOn = (id: string) => view.diary.filter((e) => e.regions.some((r) => r.sourceId === id));
  const here = page ? entriesOn(page.id) : [];
  const contEntry = view.diary.find((e) => e.id === continuing) ?? null;

  const draw = async (region: Region) => {
    if (!page) return;
    if (contEntry) {
      const v = await guard(() => api.addDiaryRegion(contEntry.id, page.id, region));
      if (v) {
        onView(v);
        setSelected(contEntry.id);
      }
      setContinuing(null);
      return;
    }
    const r = await guard(() => api.createDiaryEntry(page.id, region));
    if (r) {
      onView(r.view);
      setSelected(r.entryId);
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
            <span className="text-[0.8rem] text-muted">
              Rahmen um einen Eintrag ziehen, rechts Notierzeit und Text eintragen.
            </span>
            <span className="flex-1" />
            <Dialog.Close asChild>
              <Button size="sm">Fertig</Button>
            </Dialog.Close>
          </header>

          <nav className="overflow-y-auto border-r border-line bg-panel-2 p-2" aria-label="Seiten">
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => onPage_(p.id)}
                className={cx(
                  "mb-2 block w-full cursor-pointer rounded-lg border p-1.5 text-left",
                  p.id === page?.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-2",
                )}
              >
                {p.previewable ? (
                  <img src={mediaUrl(p.id)} alt="" className="mb-1 max-h-28 w-full rounded object-contain" />
                ) : (
                  <div className="mb-1 grid h-16 place-items-center rounded bg-sunken text-[0.75rem] text-muted">
                    PDF
                  </div>
                )}
                <div className="flex justify-between text-[0.78rem]">
                  <b className="font-mono">{p.label}</b>
                  <span className="text-muted">{entriesOn(p.id).length || "–"}</span>
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
            {page &&
              (page.previewable ? (
                <PageCanvas
                  key={page.id}
                  pageId={page.id}
                  entries={here}
                  selected={selected}
                  onSelect={setSelected}
                  onDraw={(r) => void draw(r)}
                />
              ) : (
                <p className="text-muted">
                  PDF-Scans lassen sich noch nicht anzeigen. Bitte als JPG oder PNG einsammeln; Einträge ohne Rahmen
                  gehen über die Randnotiz in der Detailleiste.
                </p>
              ))}
          </div>

          <aside className="overflow-y-auto border-l border-line p-3" aria-label="Einträge">
            {here.length === 0 && (
              <p className="text-[0.85rem] text-muted">
                Noch keine Einträge auf dieser Seite. Zieh mit der Maus einen Rahmen um den ersten Eintrag. Für eine
                ganze Seite reicht ein Rahmen über alles.
              </p>
            )}
            {here.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                pageId={page?.id ?? ""}
                defaultLookback={view.diaryLookbackMin}
                active={selected === e.id}
                onFocus={() => setSelected(e.id)}
                onPatch={(p) => patch(e.id, p)}
                onContinue={() => setContinuing(e.id)}
                onRemoveRegion={(i) => void guard(() => api.removeDiaryRegion(e.id, i)).then((v) => v && onView(v))}
                onDelete={() => void guard(() => api.deleteDiaryEntry(e.id)).then((v) => v && onView(v))}
                onGoto={(id) => onPage_(id)}
              />
            ))}
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Scan mit Rahmen; Ziehen mit der Maus legt einen neuen Rahmen an. */
function PageCanvas({
  pageId,
  entries,
  selected,
  onSelect,
  onDraw,
}: {
  pageId: string;
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
    <div
      ref={box}
      data-testid="diary-page"
      className="relative mx-auto w-fit cursor-crosshair touch-none select-none"
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
      <img
        src={mediaUrl(pageId)}
        alt="Tagebuchseite"
        draggable={false}
        className="block max-h-[calc(100vh-9rem)] max-w-full rounded shadow"
      />
      {entries.flatMap((e) =>
        e.regions
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.sourceId === pageId)
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
      {rect && <div style={pct(rect)} className="pointer-events-none absolute border-2 border-dashed border-accent" />}
    </div>
  );
}

function EntryCard({
  entry,
  pageId,
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
  pageId: string;
  defaultLookback: number;
  active: boolean;
  onFocus: () => void;
  onPatch: (p: DiaryPatch) => void;
  onContinue: () => void;
  onRemoveRegion: (index: number) => void;
  onDelete: () => void;
  onGoto: (pageId: string) => void;
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
                className={cx("cursor-pointer font-mono", r.sourceId === pageId ? "text-ink" : "text-accent underline")}
                onClick={() => r.sourceId !== pageId && onGoto(r.sourceId)}
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
