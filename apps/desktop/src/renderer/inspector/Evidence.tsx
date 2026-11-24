/**
 * Zeitbelege einer Quelle und Uhrzeit von Hand: der Abschnitt „Zeitbelege“ der Detailleiste
 * (`apps/desktop/src/renderer/Inspector.tsx`). Wie jeder Beleg zur verwendeten Lage steht (`compare`), rechnet
 * `packages/core/src/resolve.ts`; hier wird nur gezeigt und ab- oder eingeschaltet.
 */
import { useState } from "react";
import type { Precision, SourceRow, TimeInput } from "../../shared/api.ts";
import { EVIDENCE_LABEL, normalizeClock } from "../format.ts";
import { ClockField } from "../ClockField.tsx";
import { digitsDurationText } from "../../shared/duration-digits.ts";
import { positionText, usePlayback } from "../playback.tsx";
import { Button, Choice, cx, Pill, PRECISION_OPTIONS, Toggle } from "../ui.tsx";
import type { InspectorActions } from "./actions.ts";
import { precisionText } from "@feldspur/core/resolve";
import { formatDuration } from "@feldspur/core/time";
import { verdictBadge, verdictHelp } from "../../shared/conflict-text.ts";
import { startText } from "./ConflictPanel.tsx";

/**
 * Alle Zeitbelege (`TimeEvidence`) einer Quelle: welcher verwendet wird und wie die anderen dazu stehen. Abgeschaltete
 * Belege zählen bei der Lage nicht mit; löschen lassen sich nur von Hand eingetragene (`own`), und aus Ankern
 * abgeleitete (`derived`) haben keinen Schalter.
 */
export function EvidenceList({ row, actions }: { row: SourceRow; actions: InspectorActions }) {
  const decided = row.conflict.state === "decided";
  if (!row.evidence.length) {
    return (
      <p className="text-[0.85rem] text-muted">
        {row.kind === "diary" && row.diaryNote
          ? "Zeit aus der Randnotiz."
          : "Keine Zeit in Metadaten oder Dateiname gefunden."}
      </p>
    );
  }
  // Echte Zeit gegen unabgeglichene Geräteuhr: kein Widerspruch, aber ein Angebot, die Uhr danach zu richten.
  const unsynced = row.evidence.find((e) => e.enabled && e.compare?.verdict === "unsynced");
  const deviceSide = (k: string) => k === "metadata" || k === "filename";
  // Vorgeschlagene Abweichung der Geräteuhr (positiv = geht vor): Stammt der unabgeglichene Beleg selbst von der
  // Geräteuhr (Metadaten, Dateiname), gilt sein Abstand zur verwendeten Lage direkt, sonst mit umgekehrtem Vorzeichen.
  const offset = unsynced?.compare
    ? deviceSide(unsynced.kind)
      ? unsynced.compare.differenceMs
      : -unsynced.compare.differenceMs
    : 0;
  return (
    <>
      <ul className="grid gap-1.5" data-testid="evidence-list">
        {row.evidence.map((e) => (
          <li
            key={e.id}
            className={cx(
              "grid grid-cols-[1fr_auto] items-center gap-x-2 rounded-lg border px-2.5 py-1.5",
              e.chosen ? "border-accent/40 bg-accent-soft/40" : "border-line",
            )}
          >
            <span className="flex flex-wrap items-center gap-1.5 text-[0.78rem] font-semibold text-muted">
              {EVIDENCE_LABEL[e.kind] ?? e.kind}
              {e.compare && !e.chosen ? (
                <span
                  className={cx(
                    "rounded-full px-2 text-[0.8rem] font-normal whitespace-nowrap",
                    e.compare.enabled && e.compare.verdict === "conflict" && !decided
                      ? "border border-warn/50 text-warn"
                      : "bg-sunken text-ink-2",
                  )}
                  title={verdictHelp(e.compare)}
                >
                  {verdictBadge(e.compare, decided)}
                </span>
              ) : (
                e.chosen && <Pill tone="accent">verwendet</Pill>
              )}
            </span>
            <span className="flex items-center gap-2">
              {e.own && (
                <Button variant="link" className="text-[0.8rem]" onClick={() => actions.removeEvidence(e.id)}>
                  löschen
                </Button>
              )}
              {!e.derived && (
                <Toggle
                  checked={e.enabled}
                  onChange={(v) => actions.toggleEvidence(e.id, v)}
                  label={`${e.detail} ${e.enabled ? "abschalten" : "einschalten"}`}
                />
              )}
            </span>
            {e.compare && (
              <span className={cx("col-span-2", !e.enabled && "text-muted")}>
                Beginn <b className="font-mono font-semibold tabular-nums">{startText(e.compare)}</b>
                <span className="text-muted"> · {precisionText(e.compare.uncertaintyMs)}</span>
              </span>
            )}
            <span className={cx("col-span-2 [overflow-wrap:anywhere]", !e.enabled && "text-muted line-through")}>
              {e.detail}
            </span>
            {e.raw && (
              <span className="col-span-2 font-mono text-[0.85rem] [overflow-wrap:anywhere] text-muted">{e.raw}</span>
            )}
          </li>
        ))}
      </ul>
      {unsynced && row.deviceId && (
        <div className="mt-2 rounded-lg bg-panel-2 px-3 py-2 text-[0.86rem]" data-testid="unsynced-hint">
          <p>
            Die Uhr von {row.deviceLabel || "diesem Gerät"} ist noch nicht abgeglichen. Sie ginge demnach{" "}
            <b className="font-mono">{formatDuration(Math.abs(offset))}</b> {offset >= 0 ? "vor" : "nach"}.
          </p>
          <Button size="sm" className="mt-1.5" onClick={() => actions.setDeviceOffset(row.deviceId!, offset)}>
            Uhr danach richten
          </Button>
        </div>
      )}
    </>
  );
}

/** Uhrzeit von Hand eintragen oder angesagte Uhrzeit markieren. */
export function TimeForm({
  row,
  onAdd,
  initialOpen,
}: {
  row: SourceRow;
  onAdd: (input: TimeInput) => Promise<boolean>;
  /** Gleich offen zeigen (aus „Keine der beiden: Uhrzeit von Hand eintragen“). */
  initialOpen?: boolean;
}) {
  const av = row.kind === "audio" || row.kind === "video";
  const { position } = usePlayback();
  const here = position?.sourceId === row.id ? position.atMs : null;
  const [open, setOpen] = useState(initialOpen || row.status === "unplaced");
  const [kind, setKind] = useState<"manual" | "spoken">("manual");
  const [time, setTime] = useState("");
  const [at, setAt] = useState("");
  const [precision, setPrecision] = useState<Precision>(row.status === "unplaced" && !av ? "approx" : "exact");
  const [note, setNote] = useState("");
  const [syncDevice, setSyncDevice] = useState(false);
  // Die Geräteuhr lässt sich nur an einer Quelle richten, die selbst eine Zeit dieser Uhr hat.
  const canSync = kind === "manual" && !!row.deviceId && row.hasDeviceClock;
  if (!open) {
    return (
      <Button variant="link" className="mt-2 text-[0.85rem]" onClick={() => setOpen(true)}>
        + Uhrzeit eintragen{av ? " oder Ansage markieren" : ""}
      </Button>
    );
  }
  const submit = async () => {
    const ok = await onAdd({
      sourceId: row.id,
      kind,
      clock: normalizeClock(time, { seconds: true }) || time,
      atMedia: av ? at : "",
      precision,
      note,
      syncDevice: canSync && syncDevice,
    });
    if (ok) {
      setSyncDevice(false);
      setTime("");
      setAt("");
      setNote("");
      setOpen(false);
    }
  };
  return (
    <form
      className="mt-2.5 grid gap-2 rounded-lg border border-line bg-panel-2 p-3"
      data-testid="time-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {av && (
        <Choice
          label="Art der Zeitangabe"
          value={kind}
          onChange={setKind}
          options={[
            { value: "manual", label: "Von Hand" },
            { value: "spoken", label: "Angesagt" },
          ]}
        />
      )}
      <div className="grid gap-2 text-[0.9rem]">
        <div className="flex flex-wrap items-end gap-3">
          <ClockField label="Uhrzeit" ariaLabel="Uhrzeit" seconds value={time} onChange={setTime} />
          {av && (
            <label className="grid gap-0.5">
              <span className="text-muted">an Stelle</span>
              <input
                className="w-24 font-mono"
                placeholder="m:ss"
                title="Stelle in der Aufnahme, auch ohne Doppelpunkt: 320 für 3:20, 10320 für 1:03:20"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                onBlur={() => setAt(digitsDurationText(at))}
                aria-label="Stelle in der Aufnahme"
              />
            </label>
          )}
        </div>
        {av && here !== null && (
          <Button
            variant="link"
            type="button"
            className="justify-self-start text-[0.8rem]"
            onClick={() => setAt(positionText(here))}
          >
            ↳ Wiedergabestelle {positionText(here)} übernehmen
          </Button>
        )}
        <div className="grid gap-0.5">
          <span className="text-muted">Genauigkeit</span>
          <Choice label="Genauigkeit" value={precision} onChange={setPrecision} options={PRECISION_OPTIONS} />
        </div>
        <input
          className="w-full min-w-0"
          placeholder="Notiz (optional), z. B. „Kirchturmuhr“"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Notiz"
        />
      </div>
      {canSync && (
        <label className="flex items-start gap-2 text-[0.9rem]">
          <input
            type="checkbox"
            className="mt-1"
            checked={syncDevice}
            onChange={(e) => setSyncDevice(e.target.checked)}
            aria-label={`Uhr von ${row.deviceLabel} danach richten`}
          />
          <span>
            Uhr von „{row.deviceLabel}“ danach richten
            <span className="block text-[0.8rem] text-muted">
              Aus dieser Angabe wird die Abweichung der Geräteuhr berechnet. Alle anderen Dateien des Geräts rücken mit.
            </span>
          </span>
        </label>
      )}
      <p className="text-[0.8rem] text-muted">
        {kind === "spoken"
          ? "Die angesagte Zeit gleicht die Uhr des ganzen Geräts ab, sofern die Aufnahme auch eine Zeit der Geräteuhr hat."
          : "Gilt nur für diese Quelle und hat Vorrang vor gelesenen Zeiten."}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" type="submit" disabled={!time.trim()}>
          Eintragen
        </Button>
        <Button size="sm" type="button" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
    </form>
  );
}
