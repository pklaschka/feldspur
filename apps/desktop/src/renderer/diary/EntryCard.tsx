/** Ein Eintrag im Tagebuch: Notierzeit, Kurzform, Volltext und Seitenzahl. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ContextDetails, ContextRow, DiaryEntryRow, DiaryMode, DiaryPatch } from "../../shared/api.ts";
import { hm } from "../format.ts";
import { ClockField } from "../ClockField.tsx";
import { Button, Choice, ContextMark, cx } from "../ui.tsx";
import { useDraft } from "../hooks.ts";
import { isEnter } from "../keys.js";

const MODE_OPTIONS: { value: DiaryMode; label: string; title: string }[] = [
  { value: "scan", label: "Nur Scan", title: "Nicht abtippen, der Scan steht für sich" },
  { value: "short", label: "Kurzform", title: "Stichworte oder Zusammenfassung" },
  { value: "full", label: "Volltext", title: "Wortgetreu abgetippt" },
];

/**
 * Seitenzahl im Notizbuch am Eintrag. Leer zeigt die Zählung des Scans oder einen Vorschlag
 * (vom vorigen Eintrag weitergezählt); beim Hineinklicken steht der Vorschlag schon drin.
 */
export function PageField({
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
  const [text, setText] = useDraft(own && pageNo !== null ? String(pageNo) : "");
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
        onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
      />
    </label>
  );
}

const ROLE_OPTIONS: { value: "timeline" | "context"; label: string; title: string }[] = [
  { value: "timeline", label: "Chronologie", title: "Mit Notierzeit, steht an ihrer Stelle im Ablauf" },
  { value: "context", label: "Kontext", title: "Bewusst ohne Uhrzeit, steht vor der Chronologie" },
];

export function EntryCard({
  entry,
  context,
  onRole,
  onDetails,
  onRefs,
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
  /** Alle Kontextstücke des Einsatzes (für Verweise und für Titel und Stelle dieses Eintrags). */
  context: ContextRow[];
  /** „Gehört zu“: Kontext (true) oder Chronologie. */
  onRole: (context: boolean) => void;
  onDetails: (d: ContextDetails) => void;
  onRefs: (refs: string[]) => void;
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
  const [noted, setNoted] = useDraft(entry.notedAt ?? "");
  const [back, setBack] = useDraft(entry.lookbackMin === null ? "" : String(entry.lookbackMin));
  const [short, setShort] = useDraft(entry.shortText);
  const [full, setFull] = useDraft(entry.fullText);
  const [title, setTitle] = useDraft(entry.title);
  const [made, setMade] = useDraft(entry.contextMade);
  const isContext = entry.role === "context";
  const mine = context.find((c) => c.entryId === entry.id);
  /** Taste K im leeren Zeitfeld: den Eintrag als Kontext führen. */
  const onTimeKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== "k" || e.ctrlKey || e.metaKey || e.altKey || noted.trim() !== "") return;
    e.preventDefault();
    e.stopPropagation();
    onRole(true);
  };
  const card = useRef<HTMLDivElement>(null);
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
      <div className="flex flex-wrap items-center gap-2 text-[0.9rem]">
        <span className="text-muted" id={`role-${entry.id}`}>
          Gehört zu
        </span>
        <Choice
          label={`Gehört zu, ${label}`}
          value={entry.role}
          onChange={(v) => onRole(v === "context")}
          options={ROLE_OPTIONS}
        />
        {isContext && mine && (
          <span className="text-[0.85rem] text-muted">
            Stelle {mine.position} von {context.length} im Kontext
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-[0.9rem]">
        {isContext ? (
          <>
            <label className="grid min-w-48 flex-1 gap-0.5">
              <span className="text-muted">Titel</span>
              <input
                value={title}
                autoFocus={fresh}
                placeholder={mine?.find ?? "z. B. Karte 2: Standplan"}
                aria-label={`Titel ${label}`}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() !== entry.title && onDetails({ title })}
                onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
              />
            </label>
            <label className="grid min-w-40 flex-1 gap-0.5">
              <span className="text-muted">Entstanden (optional)</span>
              <input
                value={made}
                placeholder="z. B. vor dem Einsatz"
                aria-label={`Entstanden ${label}`}
                onChange={(e) => setMade(e.target.value)}
                onBlur={() => made.trim() !== entry.contextMade && onDetails({ made })}
                onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
              />
            </label>
          </>
        ) : (
          <>
            <div onKeyDownCapture={onTimeKey}>
              <ClockField
                label="Notiert um"
                ariaLabel={`Notierzeit ${label}`}
                value={noted}
                autoFocus={fresh}
                onChange={setNoted}
                onCommit={(v) => v !== (entry.notedAt ?? "") && onPatch({ notedAt: v })}
              />
            </div>
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
                  onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
                />
                <span className="text-muted">Min. davor</span>
              </span>
            </label>
          </>
        )}
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
      {!isContext && !noted.trim() && (
        <p className="-mt-1 text-[0.82rem] text-muted">Keine Uhrzeit? Taste K führt den Eintrag als Kontext.</p>
      )}
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
      <Refs entry={entry} context={context} onRefs={onRefs} />
      <div className="flex gap-3 text-[0.85rem]">
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

/** „Verweist auf“: Abzeichen je Kontextstück mit ×, dazu „+ Kontext“ mit Suche. */
function Refs({
  entry,
  context,
  onRefs,
}: {
  entry: DiaryEntryRow;
  context: ContextRow[];
  onRefs: (refs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byKey = new Map(context.map((c) => [c.key, c]));
  const own = `entry:${entry.id}`;
  const choices = context.filter(
    (c) =>
      c.key !== own &&
      !entry.refs.includes(c.key) &&
      `${c.name} ${c.find}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const add = (key: string) => {
    onRefs([...entry.refs, key]);
    setOpen(false);
    setQ("");
  };
  if (!entry.refs.length && !open && !context.some((c) => c.key !== own)) return null;
  return (
    <div className="text-[0.86rem]" data-testid="entry-refs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted">Verweist auf:</span>
        {entry.refs.map((k) => {
          const c = byKey.get(k);
          return (
            <span
              key={k}
              className={cx(
                "inline-flex items-center gap-1 rounded-full border py-px pr-1 pl-1.5",
                c ? "border-line-2" : "border-dashed border-line-2 text-muted",
              )}
              title={c ? c.find : "Verweis ruht: Das Stück ist kein Kontext mehr."}
            >
              <ContextMark decorative />
              {c ? c.name : "ruht"}
              <button
                type="button"
                className="cursor-pointer px-0.5 text-muted hover:text-bad"
                aria-label={`Verweis auf ${c?.name ?? "ruhendes Stück"} entfernen`}
                onClick={() => onRefs(entry.refs.filter((x) => x !== k))}
              >
                ×
              </button>
            </span>
          );
        })}
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          + Kontext
        </Button>
      </div>
      {open && (
        <div className="mt-1.5 rounded-lg border border-line bg-panel p-2 shadow-sm">
          <input
            autoFocus
            className="w-full"
            placeholder="Kontext suchen …"
            aria-label="Kontext suchen"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (isEnter(e) && choices[0]) add(choices[0].key);
            }}
          />
          <ul className="mt-1.5 grid max-h-48 gap-0.5 overflow-y-auto">
            {choices.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-accent-soft"
                  onClick={() => add(c.key)}
                >
                  <b className="font-mono text-ink-2">{c.position}</b>
                  <span className="truncate">{c.name}</span>
                  <span className="truncate text-[0.8rem] text-muted">{c.find}</span>
                </button>
              </li>
            ))}
            {!choices.length && (
              <li className="px-1.5 py-1 text-muted">
                {context.length ? "Nichts gefunden." : "Noch kein Kontext in diesem Einsatz."}
              </li>
            )}
          </ul>
          <p className="mt-1 border-t border-line pt-1 text-[0.8rem] text-muted">Fehlt etwas? Erst als Kontext führen.</p>
        </div>
      )}
    </div>
  );
}
