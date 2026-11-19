/** Ein Eintrag im Tagebuch: Notierzeit, Kurzform, Volltext und Seitenzahl. */
import { useEffect, useRef } from "react";
import type { DiaryEntryRow, DiaryMode, DiaryPatch } from "../../shared/api.ts";
import { hm } from "../format.ts";
import { ClockField } from "../ClockField.tsx";
import { Button, Choice, cx } from "../ui.tsx";
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

export function EntryCard({
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
  const [noted, setNoted] = useDraft(entry.notedAt ?? "");
  const [back, setBack] = useDraft(entry.lookbackMin === null ? "" : String(entry.lookbackMin));
  const [short, setShort] = useDraft(entry.shortText);
  const [full, setFull] = useDraft(entry.fullText);
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
              onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
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
        <Button variant="link" className="text-bad" onClick={onDelete}>
          Eintrag löschen
        </Button>
      </div>
    </div>
  );
}
