/**
 * Prüfliste unter der Zeitachse: alles, was „prüfen“ ist, nach Schweregrad sortiert und filterbar.
 * Gleichartige Widersprüche eines Geräts stehen als eine Gruppenzeile da; „Entschieden“ zeigt die
 * bewussten Entscheidungen des Einsatzes mit Begründung.
 */
import { useState } from "react";
import type { ConflictGroupRow, SessionView, SourceRow } from "../../shared/api.ts";
import { kindHolds, kindName, plain, signed } from "../../shared/conflict-text.ts";
import { ConflictMark, startText } from "../inspector/ConflictPanel.tsx";
import { asPlaces, checkQueue, checkReason, openConflict } from "../inspector/status.ts";
import { cx, StatusDot } from "../ui.tsx";

type Filter = "all" | "strong" | "clear" | "uncertain" | "decided";
type Sort = "severity" | "time";

const CAUSE_HINT = { utc: "Lesart UTC/Ortszeit?", hours: "Zeitzone oder Sommerzeit?", clock: "Geräteuhr?" } as const;

/** Die zwei Werte, um die es geht: verwendeter Beleg und der am weitesten abweichende. */
function pair(r: SourceRow): string {
  const used = r.evidence.find((e) => e.compare?.verdict === "chosen");
  const worst = r.evidence.find((e) => e.compare && e.enabled && e.compare.differenceMs === r.conflict.worstMs);
  const t = (e: typeof used) => (e?.compare ? `${kindName(e.kind)} ${startText(e.compare)}` : "");
  return [t(used), t(worst)].filter(Boolean).join(" · ");
}

const rowStart = (r: SourceRow) => r.startMs ?? r.diaryWindow?.toMs ?? 0;

export function CheckList({
  view,
  selected,
  onSelect,
}: {
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("severity");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const queue = checkQueue(view.rows);
  const decided = view.rows
    .filter((r) => r.conflict.state === "decided" && !r.partOf)
    .sort((a, b) => (b.decision?.at ?? "").localeCompare(a.decision?.at ?? ""));
  if (!queue.length && !decided.length) return null;

  const isStrong = (r: SourceRow) => openConflict(r) && r.conflict.severity === "strong";
  const isClear = (r: SourceRow) => openConflict(r) && r.conflict.severity === "clear";
  // Gezählt wird wie im Stand des Einsatzes: eine Gruppe ist eine Stelle.
  const places = asPlaces(queue, view.conflictGroups);
  const counts: Record<Filter, number> = {
    all: places.length,
    strong: places.filter(isStrong).length,
    clear: places.filter(isClear).length,
    uncertain: places.filter((r) => !openConflict(r)).length,
    decided: decided.length,
  };
  const shown =
    filter === "decided"
      ? decided
      : queue.filter((r) =>
          filter === "strong"
            ? isStrong(r)
            : filter === "clear"
              ? isClear(r)
              : filter === "uncertain"
                ? !openConflict(r)
                : true,
        );
  const ordered = sort === "time" ? shown.toSorted((a, b) => rowStart(a) - rowStart(b)) : shown;
  // Gruppen nur in der Ansicht offener Widersprüche; die Gruppe steht dort, wo ihre erste Datei stünde.
  const groups =
    filter === "decided" ? [] : view.conflictGroups.filter((g) => ordered.some((r) => r.id === g.sourceIds[0]));
  const groupOf = new Map(groups.flatMap((g) => g.sourceIds.map((id) => [id, g] as const)));
  const byId = new Map(view.rows.map((r) => [r.id, r]));

  const FILTERS: [Filter, string][] = [
    ["all", "Alle"],
    ["strong", "Widerspruch stark"],
    ["clear", "Widerspruch deutlich"],
    ["uncertain", "Unsichere Lage"],
    ["decided", "Entschieden"],
  ];
  const lines: React.ReactNode[] = [];
  const seenGroups = new Set<string>();
  for (const r of ordered) {
    const g = groupOf.get(r.id);
    if (g) {
      if (seenGroups.has(g.key)) continue;
      seenGroups.add(g.key);
      lines.push(
        <GroupRow
          key={g.key}
          g={g}
          rows={g.sourceIds.map((id) => byId.get(id)!).filter(Boolean)}
          expanded={open.has(g.key)}
          onToggle={() =>
            setOpen((s) => {
              const n = new Set(s);
              if (n.has(g.key)) n.delete(g.key);
              else n.add(g.key);
              return n;
            })
          }
          selected={selected}
          onSelect={onSelect}
        />,
      );
      continue;
    }
    lines.push(<Row key={r.id} r={r} view={view} selected={selected} onSelect={onSelect} />);
  }

  return (
    <section className="mt-4" aria-label="Zu prüfen" data-testid="check-list">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          {filter === "decided" ? `Entschieden (${decided.length})` : `Zu prüfen (${places.length})`}
        </h3>
        <span className="flex-1" />
        <span className="text-[0.85rem] text-muted">
          Sortiert:{" "}
          {(["severity", "time"] as const).map((s, i) => (
            <span key={s}>
              {i > 0 && " · "}
              <button
                className={cx(
                  "inline-flex min-h-7 cursor-pointer items-center",
                  sort === s ? "font-semibold text-ink" : "text-accent hover:underline",
                )}
                aria-pressed={sort === s}
                onClick={() => setSort(s)}
              >
                {s === "severity" ? "stärkste zuerst" : "nach Uhrzeit"}
              </button>
            </span>
          ))}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            role="radio"
            aria-checked={filter === f}
            data-testid={`filter-${f}`}
            onClick={() => setFilter(f)}
            disabled={f !== "all" && counts[f] === 0}
            className={cx(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-0.5 text-[0.86rem] disabled:cursor-default disabled:opacity-45",
              filter === f ? "border-ink bg-ink text-panel" : "border-line-2 bg-panel hover:enabled:border-muted",
            )}
          >
            {label} <b className="font-semibold tabular-nums">{counts[f]}</b>
          </button>
        ))}
      </div>
      {lines.length ? (
        <ul className="mt-2 max-h-[22rem] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-panel">
          {lines}
        </ul>
      ) : (
        <p className="mt-2 text-[0.9rem] text-muted">
          {filter === "decided" ? "Noch nichts entschieden." : "Hier ist nichts zu prüfen."}
        </p>
      )}
    </section>
  );
}

function Row({
  r,
  view,
  selected,
  onSelect,
  inset,
}: {
  r: SourceRow;
  view: SessionView;
  selected: string | null;
  onSelect: (id: string) => void;
  inset?: boolean;
}) {
  const c = r.conflict;
  const dec = c.state === "decided";
  const conflict = openConflict(r);
  const device = view.devices.find((d) => d.id === r.deviceId);
  const text = dec ? (
    <>
      <b className="font-medium">{r.decision?.basisKind ? `${kindHolds(r.decision.basisKind)}.` : "Lage geprüft."}</b>{" "}
      {r.decision?.reason ? `„${r.decision.reason}“` : <span className="text-muted">ohne Begründung</span>}
    </>
  ) : conflict ? (
    <>
      {pair(r)}
      {c.state === "stale" && <span className="ml-1.5 text-warn">· neu prüfen</span>}
    </>
  ) : (
    checkReason(r.notes[0] ?? "", device?.label)
  );
  return (
    <li>
      <button
        data-testid="check-row"
        data-source={r.label}
        onClick={() => onSelect(r.id)}
        className={cx(
          "grid w-full cursor-pointer grid-cols-[22px_minmax(8rem,14rem)_1fr_auto] items-baseline gap-x-3 px-3 py-2 text-left text-[0.9rem] hover:bg-panel-2",
          selected === r.id && "bg-accent-soft/60 hover:bg-accent-soft/60",
          inset && "pl-8",
        )}
      >
        <span className="self-center">
          {conflict || dec ? (
            <ConflictMark severity={c.severity} decided={dec} />
          ) : (
            <StatusDot status="check" className="ml-1" />
          )}
        </span>
        <span className="truncate">
          <b className="font-mono font-semibold">{r.label}</b> <span className="text-muted">{r.deviceLabel}</span>
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
        <span
          className={cx(
            "font-mono font-semibold whitespace-nowrap tabular-nums",
            conflict ? "text-warn" : dec ? "text-ink-2" : "font-sans font-normal text-accent",
          )}
        >
          {dec && r.decision?.at && (
            <span className="mr-3 font-sans font-normal text-muted">
              {new Date(r.decision.at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
            </span>
          )}
          {conflict || dec ? signed(c.worstMs) : "Ansehen →"}
        </span>
      </button>
    </li>
  );
}

function GroupRow({
  g,
  rows,
  expanded,
  onToggle,
  selected,
  onSelect,
}: {
  g: ConflictGroupRow;
  rows: SourceRow[];
  expanded: boolean;
  onToggle: () => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const same = rows.every((r) => Math.abs(Math.abs(r.conflict.worstMs) - Math.abs(g.differenceMs)) <= 60_000);
  return (
    <li data-testid="check-group" className="bg-panel-2/60">
      <div className="grid grid-cols-[22px_1fr_auto] items-baseline gap-x-3 px-3 py-2 text-[0.9rem]">
        <span className="self-center">
          <ConflictMark severity={g.severity} />
        </span>
        <span>
          <b className="font-semibold">{g.deviceLabel}</b> <span className="text-muted">{rows.length} Dateien · </span>
          {kindName(g.usedKind)} und {kindName(g.otherKind)} liegen {same ? "überall" : "jeweils etwa"}{" "}
          <b className="font-mono font-semibold">{plain(g.differenceMs)}</b> auseinander
          {g.cause && <span className="text-muted"> · {CAUSE_HINT[g.cause]}</span>}
        </span>
        <span className="-my-1 flex gap-3 whitespace-nowrap">
          <button
            className="inline-flex min-h-7 cursor-pointer items-center text-accent hover:underline"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? "zuklappen" : `${rows.length} zeigen`}
          </button>
          <button
            className="inline-flex min-h-7 cursor-pointer items-center text-accent hover:underline"
            onClick={() => onSelect(rows[0]!.id)}
          >
            {g.cause ? "Ursache klären →" : "Entscheiden →"}
          </button>
        </span>
      </div>
      {expanded && (
        <ul className="divide-y divide-line border-t border-line bg-panel">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onSelect(r.id)}
                data-testid="check-row"
                data-source={r.label}
                className={cx(
                  "grid w-full cursor-pointer grid-cols-[22px_minmax(6rem,10rem)_1fr_auto] items-baseline gap-x-3 py-1.5 pr-3 pl-10 text-left text-[0.88rem] hover:bg-panel-2",
                  selected === r.id && "bg-accent-soft/60",
                )}
              >
                <ConflictMark severity={r.conflict.severity} className="self-center" />
                <b className="font-mono font-semibold">{r.label}</b>
                <span>{pair(r)}</span>
                <span className="font-mono font-semibold text-warn tabular-nums">{signed(r.conflict.worstMs)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
