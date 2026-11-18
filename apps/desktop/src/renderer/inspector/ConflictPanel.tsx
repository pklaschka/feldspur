/**
 * Widersprüchliche Zeitbelege: vergleichen und bewusst entscheiden, welche Zeit gilt.
 * Ein Kasten in drei Zuständen: offen, entschieden, neu prüfen (siehe Konzept zu Issue #75).
 */
import { useId, useState } from "react";
import type { EvidenceComparison } from "@feldspur/core/resolve";
import { precisionText } from "@feldspur/core/resolve";
import type { ConflictGroupRow, DeviceRow, EvidenceRow, SessionView, SourceRow } from "../../shared/api.ts";
import {
  hoursText,
  kindHolds,
  kindName,
  kindVerb,
  plain,
  SEVERITY_TEXT,
  signed,
  verdictBadge,
  verdictHelp,
} from "../../shared/conflict-text.ts";
import { clock, hm, offsetText } from "../format.ts";
import { Button, cx } from "../ui.tsx";
import type { InspectorActions } from "./actions.ts";

type Compared = EvidenceRow & { compare: EvidenceComparison };

/** Zeit eines Belegs, wie man sie spricht: minutengenaue Angaben ohne erfundene Sekunden. */
export const startText = (c: EvidenceComparison) => (c.uncertaintyMs === 30_000 ? hm(c.startMs) : clock(c.startMs));

/** Zeichen ≠ für Widersprüche: Umriss = deutlich, gefüllt = stark, grünes ✓ = entschieden. */
export function ConflictMark({
  severity,
  decided,
  className,
}: {
  severity: "clear" | "strong" | null;
  decided?: boolean;
  className?: string;
}) {
  if (decided)
    return (
      <span aria-label="Widerspruch entschieden" className={cx("text-good", className)}>
        ✓
      </span>
    );
  const strong = severity === "strong";
  return (
    <span
      role="img"
      aria-label={`Zeitbelege widersprechen sich, ${strong ? "stark" : "deutlich"}`}
      className={cx(
        "inline-grid size-[17px] flex-none place-items-center rounded-full border-[1.5px] border-warn text-[0.72rem] leading-none font-bold",
        strong ? "bg-warn text-panel" : "text-warn",
        className,
      )}
    >
      ≠
    </span>
  );
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString("de-DE");

/** Abstand UTC → Ortszeit am Einsatztag in ms (z. B. +2 Std. im September in Berlin). */
function utcOffsetMs(timeZone: string, date: string): number {
  const at = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000) : 0;
}

export function compared(row: SourceRow): Compared[] {
  return row.evidence.filter((e): e is Compared => e.compare !== null);
}

/** Belegstrahl: ein Punkt je Beleg, Unsicherheit als Balken, Abstand als Klammer; große Lücken unterbrochen. */
export function EvidenceStrip({ items }: { items: Compared[] }) {
  const pts = items.filter((e) => e.enabled).toSorted((a, b) => a.compare.startMs - b.compare.startMs);
  if (pts.length < 2) return null;
  const W = 240;
  const PAD = 30;
  const ts = pts.map((p) => p.compare.startMs);
  const lo = ts[0]!;
  const hi = ts.at(-1)!;
  const range = Math.max(1, hi - lo);
  // Größte Lücke zwischen zwei Nachbarn: ab 60 % der Spanne (und mindestens 10 Min.) wird unterbrochen.
  let gapAt = -1;
  let gap = 0;
  for (let i = 1; i < ts.length; i++)
    if (ts[i]! - ts[i - 1]! > gap) {
      gap = ts[i]! - ts[i - 1]!;
      gapAt = i;
    }
  const broken = range >= 10 * 60_000 && gap >= 0.6 * range && ts.length > 2;
  const usable = W - 2 * PAD;
  const x = (t: number): number => {
    if (!broken) return PAD + ((t - lo) / range) * usable;
    // Zwei Abschnitte mit je 40 % der Breite, dazwischen die Unterbrechung.
    const left = ts.slice(0, gapAt);
    const right = ts.slice(gapAt);
    const seg = usable * 0.4;
    const inSeg = (arr: number[], t0: number) =>
      arr.length > 1 ? ((t - arr[0]!) / Math.max(1, arr.at(-1)! - arr[0]!)) * seg + t0 : t0 + seg / 2;
    return t < right[0]! ? inSeg(left, PAD) : inSeg(right, W - PAD - seg);
  };
  const scaleOf = broken ? 0 : usable / range;
  const chosen = pts.find((p) => p.compare.verdict === "chosen");
  const far = pts.reduce((w, p) => (Math.abs(p.compare.differenceMs) > Math.abs(w.compare.differenceMs) ? p : w));
  const xa = x(Math.min(chosen?.compare.startMs ?? lo, far.compare.startMs));
  const xb = x(Math.max(chosen?.compare.startMs ?? hi, far.compare.startMs));
  const twoLevel = pts.some((p, i) => i > 0 && x(p.compare.startMs) - x(pts[i - 1]!.compare.startMs) < 64);
  const y = 40;
  const midGap = broken ? (x(ts[gapAt - 1]!) + x(ts[gapAt]!)) / 2 : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${twoLevel ? 98 : 78}`}
      className="mt-2 w-full text-warn"
      aria-hidden
      data-testid="evidence-strip"
    >
      <line x1={8} x2={W - 8} y1={y} y2={y} className="stroke-line-2" strokeWidth={1.5} />
      {midGap !== null && (
        <g className="stroke-muted" strokeWidth={1.5}>
          <rect x={midGap - 8} y={y - 4} width={16} height={8} className="fill-warn-soft stroke-none" />
          <line x1={midGap - 7} x2={midGap - 3} y1={y + 5} y2={y - 5} />
          <line x1={midGap + 3} x2={midGap + 7} y1={y + 5} y2={y - 5} />
        </g>
      )}
      {Math.abs(far.compare.differenceMs) > 0 && (
        <g>
          <path d={`M${xa} 21 V15 H${xb} V21`} fill="none" stroke="currentColor" strokeWidth={1.2} />
          <rect
            x={(xa + xb) / 2 - 30}
            y={5}
            width={60}
            height={18}
            rx={9}
            className="fill-panel stroke-warn"
            strokeWidth={1}
          />
          <text x={(xa + xb) / 2} y={18} textAnchor="middle" className="fill-warn font-mono text-[12px] font-semibold">
            {plain(far.compare.differenceMs)}
          </text>
        </g>
      )}
      {pts.map((p, i) => {
        const px = x(p.compare.startMs);
        const unc = Math.min(40, p.compare.uncertaintyMs * scaleOf);
        const used = p.compare.verdict === "chosen";
        const ly = y + 18 + (twoLevel && i % 2 ? 20 : 0);
        const anchor = px < 40 ? "start" : px > W - 40 ? "end" : "middle";
        return (
          <g key={p.id}>
            {unc > 2 && <rect x={px - unc} y={y - 3} width={2 * unc} height={6} rx={3} className="fill-warn/25" />}
            <circle
              cx={px}
              cy={y}
              r={5.5}
              className={used ? "fill-accent stroke-panel" : "fill-panel stroke-warn"}
              strokeWidth={used ? 2 : 2}
            />
            <text x={px} y={ly} textAnchor={anchor} className="fill-ink font-mono text-[12px] font-semibold">
              {startText(p.compare)}
            </text>
            <text x={px} y={ly + 13} textAnchor={anchor} className="fill-muted text-[11px]">
              {kindName(p.kind)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ein Beleg als Zeile: Art, Abzeichen, Beginn mit Genauigkeit, Wert wie gelesen, Umrechnung, ggf. Grund. */
export function EvidenceFacts({ e, reason, decided }: { e: Compared; reason?: string; decided?: boolean }) {
  const c = e.compare;
  const tone =
    !c.enabled || c.verdict === "agrees" || c.verdict === "rounding" || c.verdict === "unsynced"
      ? "bg-sunken text-ink-2"
      : c.verdict === "chosen"
        ? "bg-accent-soft text-accent font-medium"
        : decided
          ? "bg-sunken text-ink-2"
          : "border border-warn/50 bg-panel text-warn font-medium";
  return (
    <span className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <b className="font-semibold">{kindName(e.kind)}</b>
        <span className={cx("rounded-full px-2 text-[0.8rem] whitespace-nowrap", tone)} title={verdictHelp(c)}>
          {verdictBadge(c, decided)}
        </span>
      </span>
      <span>
        Beginn <b className="font-mono font-semibold tabular-nums">{startText(c)}</b>
        <span className="text-muted"> · {precisionText(c.uncertaintyMs)}</span>
      </span>
      {(e.raw || e.detail) && (
        <span className="text-[0.82rem] [overflow-wrap:anywhere] text-muted">
          gelesen: <span className="font-mono">{e.raw || e.detail}</span>
        </span>
      )}
      {c.convertedFromUtc && <span className="text-[0.82rem] text-muted">aus UTC in Ortszeit umgerechnet</span>}
      {c.correctionMs !== 0 && (
        <span className="text-[0.82rem] text-muted">Uhr korrigiert {offsetText(c.correctionMs)}</span>
      )}
      {reason && (
        <span className="text-[0.82rem] text-ink-2">Warum dieser? {reason[0]!.toUpperCase() + reason.slice(1)}.</span>
      )}
    </span>
  );
}

/** Wahrscheinliche Ursache mit dem passenden Weg (Lesart umstellen, Uhr ansehen). */
function Cause({
  worst,
  row,
  device,
  view,
  actions,
}: {
  worst: Compared;
  row: SourceRow;
  device: DeviceRow | undefined;
  view: SessionView;
  actions: InspectorActions;
}) {
  const c = worst.compare;
  if (!c.cause) return null;
  const name = device?.label ?? "diesem Gerät";
  const files = device?.sourceCount ?? 1;
  let text: string;
  let action: React.ReactNode = null;
  if (c.cause === "utc" && device) {
    const toLocal = device.timestampsAreUtc;
    text = toLocal
      ? `${name} markiert die Zeitstempel als UTC, schreibt aber offenbar Ortszeit. Liest man sie als Ortszeit, passen beide Angaben zusammen.`
      : `Die Zeitstempel von ${name} sind als UTC markiert, werden aber als Ortszeit gelesen. Liest man sie als UTC, passen beide Angaben zusammen.`;
    action = (
      <>
        <Button size="sm" variant="primary" onClick={() => actions.setDeviceUtc(device.id, !toLocal)}>
          Als {toLocal ? "Ortszeit" : "UTC"} lesen ({files} {files === 1 ? "Datei" : "Dateien"})
        </Button>
        <p className="mt-1 text-[0.82rem] text-ink-2">
          Gilt für alle Dateien des Geräts. Lässt sich rückgängig machen.
        </p>
      </>
    );
  } else if (c.cause === "hours") {
    const d = Math.abs(c.differenceMs);
    const utcGap = Math.abs(utcOffsetMs(view.session.timeZone, view.session.date));
    const why =
      Math.abs(d - 3_600_000) <= 60_000
        ? `Sommerzeit an der Uhr von ${name} nicht umgestellt?`
        : utcGap && Math.abs(d - utcGap) <= 60_000
          ? "So groß ist am Einsatztag der Abstand zwischen UTC und Ortszeit."
          : "Glatter Versatz: Zeitzone der Geräteuhr?";
    text = `Der Abstand ist fast genau ${hoursText(d)}. ${why}`;
    action = (
      <Button size="sm" onClick={actions.goSync}>
        Uhr in Abgleichen ansehen →
      </Button>
    );
  } else {
    text = `Die Uhr von ${name} ist auf ${offsetText(device?.offsetMs ?? 0)} abgeglichen. Dazu passt diese Angabe nicht.`;
    action = (
      <Button size="sm" onClick={actions.goSync}>
        Uhr in Abgleichen ansehen →
      </Button>
    );
  }
  void row;
  return (
    <div className="mt-2.5 border-t border-warn/30 pt-2.5" data-testid="conflict-cause">
      <b className="block font-semibold">Wahrscheinliche Ursache</b>
      <p className="mt-0.5">{text}</p>
      <div className="mt-1.5">{action}</div>
    </div>
  );
}

export function ConflictPanel({
  row,
  view,
  actions,
  onManual,
}: {
  row: SourceRow;
  view: SessionView;
  actions: InspectorActions;
  /** „Keine der beiden“: Formular für eine Uhrzeit von Hand öffnen. */
  onManual: () => void;
}) {
  const { conflict } = row;
  const list = compared(row);
  const [showCompare, setShowCompare] = useState(false);
  if (conflict.state === "none" || row.startMs === null) return null;
  if (conflict.state === "decided" && !showCompare)
    return <Decided row={row} list={list} onShow={() => setShowCompare(true)} actions={actions} />;
  return (
    <Open
      key={`${row.id}:${row.startMs}:${conflict.state}`}
      row={row}
      view={view}
      list={list}
      actions={actions}
      onManual={onManual}
      onHide={conflict.state === "decided" ? () => setShowCompare(false) : undefined}
    />
  );
}

function Decided({
  row,
  list,
  onShow,
  actions,
}: {
  row: SourceRow;
  list: Compared[];
  onShow: () => void;
  actions: InspectorActions;
}) {
  const d = row.decision;
  const against = list.filter((e) => e.enabled && e.compare.verdict === "conflict");
  return (
    <section
      className="mt-3.5 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[0.88rem]"
      aria-label="Widerspruch entschieden"
      data-testid="conflict-decided"
    >
      <p>
        <span className="mr-1 text-good" aria-hidden>
          ✓
        </span>
        <b className="font-semibold">{d?.at ? `Entschieden am ${dateText(d.at)}:` : "Von Hand geprüft:"}</b>{" "}
        {d?.basisKind
          ? `${kindHolds(d.basisKind)} (${clock(row.startMs!)}).`
          : `Die Lage ${clock(row.startMs!)} passt.`}{" "}
        {against
          .map(
            (e) =>
              `${kindName(e.kind)} ${kindVerb(e.kind, "widerspricht", "widersprechen")} um ${signed(e.compare.differenceMs)}.`,
          )
          .join(" ")}
      </p>
      {d?.reason && <p className="mt-1">Begründung: „{d.reason}“</p>}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        <Button variant="link" className="inline-flex min-h-7 items-center text-[0.86rem]" onClick={onShow}>
          Vergleich zeigen
        </Button>
        {d && (
          <Button
            variant="link"
            className="inline-flex min-h-7 items-center text-[0.86rem]"
            onClick={() => actions.removeEvidence(d.evidenceId)}
          >
            Zurücknehmen
          </Button>
        )}
      </div>
    </section>
  );
}

function Open({
  row,
  view,
  list,
  actions,
  onManual,
  onHide,
}: {
  row: SourceRow;
  view: SessionView;
  list: Compared[];
  actions: InspectorActions;
  onManual: () => void;
  onHide?: () => void;
}) {
  const { conflict } = row;
  const stale = conflict.state === "stale";
  const decided = conflict.state === "decided";
  const device = view.devices.find((d) => d.id === row.deviceId);
  const group: ConflictGroupRow | undefined = view.conflictGroups.find((g) => g.sourceIds.includes(row.id));
  // Zur Wahl stehen alle eingeschalteten Belege; eine alte Entscheidung nur, wenn sie neu zu prüfen ist.
  const options = list
    .filter((e) => e.enabled && (e.kind !== "checked" || stale))
    .toSorted(
      (a, b) =>
        Number(b.compare.verdict === "chosen") - Number(a.compare.verdict === "chosen") ||
        Math.abs(a.compare.differenceMs) - Math.abs(b.compare.differenceMs),
    );
  const initial =
    (stale && options.find((o) => o.id === row.decision?.basisId)?.id) ||
    options.find((o) => o.compare.verdict === "chosen")?.id ||
    options[0]?.id ||
    "";
  const [pick, setPick] = useState(initial);
  const [reason, setReason] = useState(stale ? (row.decision?.reason ?? "") : "");
  const name = useId();
  const conflicts = list.filter((e) => e.enabled && e.compare.verdict === "conflict");
  const worst = conflicts.reduce<Compared | undefined>(
    (w, e) => (!w || Math.abs(e.compare.differenceMs) > Math.abs(w.compare.differenceMs) ? e : w),
    undefined,
  );
  const picked = options.find((o) => o.id === pick);
  const moves = picked && picked.compare.startMs !== row.startMs;
  const others = group ? group.sourceIds.length - 1 : 0;
  const decide = () => {
    if (!picked) return;
    actions.decide({
      sourceId: row.id,
      evidenceId: picked.id,
      expectedStartMs: row.startMs!,
      reason,
    });
  };
  const sentence =
    conflicts.length <= 1 ? (
      <>
        Die Angaben liegen <b className="font-mono font-semibold">{plain(conflict.worstMs)}</b> auseinander.
      </>
    ) : (
      <>
        {conflicts.length} Angaben weichen von der verwendeten ab, am weitesten um{" "}
        <b className="font-mono font-semibold">{plain(conflict.worstMs)}</b>.
      </>
    );
  return (
    <section
      className={cx(
        "mt-3.5 rounded-lg border px-3 py-2.5 text-[0.88rem]",
        decided ? "border-line bg-panel-2" : "border-warn/40 bg-warn-soft",
      )}
      data-testid="conflict-panel"
      aria-label="Zeitbelege widersprechen sich"
    >
      <div className="flex items-center gap-2">
        <ConflictMark severity={conflict.severity} decided={decided} />
        <b className={cx("flex-1 font-semibold", !decided && "text-warn")}>
          {stale ? "Entscheidung neu prüfen" : decided ? "Entschieden: Vergleich" : "Zeitbelege widersprechen sich"}
        </b>
        {conflict.severity && !decided && (
          <span className="text-[0.82rem] font-semibold text-warn">{SEVERITY_TEXT[conflict.severity]}</span>
        )}
        {onHide && (
          <Button variant="link" className="inline-flex min-h-7 items-center text-[0.82rem]" onClick={onHide}>
            schließen
          </Button>
        )}
      </div>
      {stale ? (
        <div className="mt-1">
          <p>
            Seit deiner Entscheidung{row.decision?.at ? ` vom ${dateText(row.decision.at)}` : ""} hat sich etwas
            geändert:
          </p>
          <ul className="mt-0.5 list-disc pl-4.5">
            {conflict.staleBecause.map((s) => {
              const e = list.find((x) => x.id === s.evidenceId);
              const what = e ? kindName(e.kind) : "Ein Beleg";
              return (
                <li key={s.evidenceId}>
                  {s.wasMs === null
                    ? `Neu: ${what} ergibt Beginn ${e ? startText(e.compare) : "?"} (${signed(s.nowMs)}).`
                    : `${what} weicht jetzt um ${signed(s.nowMs)} ab statt um ${signed(s.wasMs)}.`}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-1">
          {sentence}
          {others > 0 && (
            <>
              {" "}
              Dasselbe bei {others} weiteren {others === 1 ? "Datei" : "Dateien"} von {group!.deviceLabel}.
            </>
          )}
        </p>
      )}
      <EvidenceStrip items={list} />
      {worst && !decided && <Cause worst={worst} row={row} device={device} view={view} actions={actions} />}
      {group && others > 0 && !decided && (
        <div className="mt-2.5 border-t border-warn/30 pt-2.5" data-testid="group-decide">
          <b className="block font-semibold">
            Alle {group.sourceIds.length} Dateien von {group.deviceLabel} auf einmal
          </b>
          <p className="mt-0.5 text-ink-2">Je Datei gilt dann ihr eigener Beleg dieser Art.</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {[group.usedKind, group.otherKind].map((k) => (
              <Button key={k} size="sm" onClick={() => actions.decideMany(group.sourceIds, k, reason)}>
                Für alle {group.sourceIds.length}: {kindHolds(k)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <fieldset className="mt-2.5 border-t border-warn/30 pt-2" disabled={decided}>
        <legend className="sr-only">Welche Zeit gilt?</legend>
        <b className="block pt-2 font-semibold" aria-hidden>
          Welche Zeit gilt?
        </b>
        <ul className="mt-1 divide-y divide-warn/25">
          {options.map((e) => (
            <li key={e.id}>
              <label className="flex cursor-pointer items-start gap-2.5 py-2">
                <input
                  type="radio"
                  name={name}
                  className="mt-1 accent-[var(--accent)]"
                  checked={pick === e.id}
                  onChange={() => setPick(e.id)}
                />
                {e.kind === "checked" ? (
                  <span>
                    <b className="font-semibold">Deine bisherige Entscheidung</b>
                    <span className="block">
                      Beginn <b className="font-mono font-semibold">{startText(e.compare)}</b>
                    </span>
                  </span>
                ) : (
                  <EvidenceFacts
                    e={e}
                    decided={decided}
                    reason={e.compare.verdict === "chosen" ? row.basisReason : undefined}
                  />
                )}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {!decided && (
        <>
          {moves && picked && (
            <p className="mt-1 border-t border-warn/30 pt-2 font-medium" data-testid="decision-consequence">
              Die Quelle rückt von <b className="font-mono">{clock(row.startMs!)}</b> auf{" "}
              <b className="font-mono">{startText(picked.compare)}</b>.
              {picked.compare.uncertaintyMs > 2_000 &&
                ` Die Lage gilt dann als geprüft, bleibt aber ${precisionText(picked.compare.uncertaintyMs).replace("nur Minute", "nur auf die Minute genau")}.`}
            </p>
          )}
          <input
            className="mt-2 w-full min-w-0"
            placeholder="Begründung (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && decide()}
            aria-label="Begründung"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={decide} disabled={!picked} data-testid="decide">
              {group && others > 0 ? "Nur für diese Datei festhalten" : "Entscheidung festhalten"}
            </Button>
          </div>
          <p className="mt-2 text-[0.84rem]">
            <Button variant="link" className="min-h-7 !whitespace-normal text-left text-[0.84rem]" onClick={onManual}>
              {options.length === 2 ? "Keine der beiden" : "Keine davon"}: Uhrzeit von Hand eintragen
            </Button>
          </p>
          <p className="mt-0.5 text-[0.82rem] text-ink-2">
            Ist ein Beleg schlicht falsch (z. B. Dateiname vom Kopieren), schalte ihn unten bei Zeitbelege ab.
          </p>
        </>
      )}
    </section>
  );
}
