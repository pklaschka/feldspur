/** Kleine Bausteine der Zeitachse: Zoom-Zeichen, Legende, Hover-Karte und die Ablage „Ohne Uhrzeit“. */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SourceRow, TranscriptRow } from "../../shared/api.ts";
import { clock, hm, lage, STATUS_TEXT } from "../format.ts";
import { diaryPreview, type Item } from "../timeline.ts";
import { cx, Glyph } from "../ui.tsx";
import { kindHolds, kindName, signed } from "../../shared/conflict-text.ts";
import { startText } from "../inspector/ConflictPanel.tsx";

export function ZoomGlyph({ minus = false }: { minus?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14M5 7h4" />
      {!minus && <path d="M7 5v4" />}
    </svg>
  );
}

export function Legend({ swatch, children }: { swatch: string | ReactNode; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {typeof swatch === "string" ? <i className={cx("inline-block", swatch)} /> : swatch}
      {children}
    </span>
  );
}

export function HoverCard({
  item,
  line,
  x,
  y,
}: {
  item: Item;
  /** Zeile der Mitschrift unter dem Zeiger. */
  line: TranscriptRow | null;
  /** Mauszeiger im Fenster. */
  x: number;
  y: number;
}) {
  const card = useRef<HTMLDivElement>(null);
  // Die Karte liegt über allem (Portal, fest positioniert), damit Achse und Rahmen sie nicht abschneiden. Passt
  // sie rechts oder unten nicht mehr ins Fenster, klappt sie auf die andere Seite des Zeigers.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const gap = 14;
    const left = x + gap + w > window.innerWidth - 8 ? Math.max(8, x - gap - w) : x + gap;
    const top = y + gap + h > window.innerHeight - 8 ? Math.max(8, y - gap - h) : y + gap;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  });
  let title: string;
  let lines: string[];
  if (item.type === "episode") {
    title = `Episode E${item.ep.index}`;
    lines = [
      `${clock(item.ep.startMs)} – ${clock(item.ep.endMs)}`,
      item.ep.sourceLabels.join(", "),
      "Ränder ziehen, um die Episode zu ändern",
    ];
  } else if (item.type === "gap") {
    title = "Zwischenzeit";
    lines = [`${clock(item.gap.startMs)} – ${clock(item.gap.endMs)}`];
    if (item.gap.itemLabels.length) lines.push(item.gap.itemLabels.join(", "));
    if (item.gap.loudAtMs.length) {
      lines.push(`laut: ${item.gap.loudAtMs.slice(0, 4).map(clock).join(", ")}`);
      lines.push("Klick auf eine laute Stelle macht sie zur Mini-Episode");
    }
  } else if (item.type === "diary") {
    const e = item.entry;
    title = `Tagebuch ${item.row.label} · Eintrag ${e.number}`;
    lines = [`notiert ${e.notedAt ?? "?"}, bezieht sich auf ${hm(item.t0)}–${hm(item.t1)}`];
    const text = diaryPreview(e);
    if (text) lines.push(text.length > 120 ? `${text.slice(0, 117)}…` : text);
  } else {
    const r = item.row;
    title = `${r.label} · ${r.fileName}`;
    const notes = r.notes.filter((n) => !n.startsWith("Widerspruch") && n !== "Entscheidung neu prüfen");
    lines = [lage(r.startMs, r.endMs), [STATUS_TEXT[r.status], ...notes].join(" · ")];
    lines.push(...conflictLines(r));
    if (r.status === "check") lines.push("Anklicken und rechts prüfen");
    if (line) {
      const t = (line.speaker ? `${line.speaker}: ` : "") + line.text;
      lines.push(`${line.clockMs !== null ? clock(line.clockMs) : ""} „${t.length > 140 ? `${t.slice(0, 137)}…` : t}“`);
    }
  }
  return createPortal(
    <div
      ref={card}
      data-testid="timeline-hover"
      className="pointer-events-none fixed z-50 w-max max-w-72 rounded-md bg-ink px-2.5 py-1.5 text-[0.82rem] text-panel shadow-lg dark:border dark:border-line-2 dark:bg-panel-2 dark:text-ink"
      style={{ left: x + 14, top: y + 14, visibility: "hidden" }}
    >
      <b className="block font-semibold">{title}</b>
      {lines.map((l) => (
        <div key={l} className="opacity-85">
          {l}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Widerspruch in Worten für die Hover-Karte. */
function conflictLines(r: SourceRow): string[] {
  const c = r.conflict;
  if (c.state === "none") return [];
  if (c.state === "decided")
    return [
      r.decision?.basisKind ? `Widerspruch entschieden: ${kindHolds(r.decision.basisKind)}` : "Widerspruch geprüft",
    ];
  const worst = r.evidence.find((e) => e.compare && e.enabled && e.compare.differenceMs === c.worstMs);
  const what = worst?.compare
    ? `${kindName(worst.kind)} sagt ${startText(worst.compare)} (${signed(worst.compare.differenceMs)})`
    : signed(c.worstMs);
  return [c.state === "stale" ? "Entscheidung neu prüfen" : `Zeitbelege widersprechen sich: ${what}`];
}

export function Tray({
  rows,
  selected,
  onSelect,
}: {
  rows: SourceRow[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-bad/6 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-[0.95rem] font-semibold text-bad">Ohne Uhrzeit ({rows.length})</h3>
        <span className="text-[0.85rem] text-muted">
          Diese Quellen liegen noch nicht auf der Achse. Wähle eine aus und trage rechts eine Zeit ein. Gehört etwas
          nicht in die Chronologie, führe es als Kontext.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <button
            key={r.id}
            data-testid="tray-item"
            className={cx(
              "inline-flex cursor-pointer items-center gap-2 rounded-lg border py-1 pr-2.5 pl-1",
              selected === r.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-2",
            )}
            onClick={() => onSelect(r.id)}
          >
            <Glyph kind={r.kind} size="sm" />
            <b className="font-mono">{r.label}</b> {r.fileName}
          </button>
        ))}
      </div>
    </section>
  );
}
