/**
 * Lautstärke einer Ton- oder Videoquelle in der Detailleiste (`apps/desktop/src/renderer/Inspector.tsx`). Wie die
 * Verstärkung zustande kommt, steht in `packages/core/src/level.ts`; beim Abhören wendet sie
 * `apps/desktop/src/renderer/level.ts` an.
 */
import { dbText } from "../format.ts";
import { useState } from "react";
import type { LevelInput, LevelRow, SourceRow } from "../../shared/api.ts";
import { Button, Choice, Toggle } from "../ui.tsx";
import { LEVEL_MANUAL_RANGE_DB } from "@feldspur/core/level";
import { useDraft } from "../hooks.ts";
import type { InspectorActions } from "./actions.ts";

/**
 * Lautstärke angleichen: automatisch auf gleichen Sprachpegel, von Hand oder unverändert, dazu
 * auf Wunsch ein Kompressor für leise Stellen. Gilt beim Abhören und im Montagevideo.
 */
export function LevelPanel({ row, level, actions }: { row: SourceRow; level: LevelRow; actions: InspectorActions }) {
  const [measuring, setMeasuring] = useState(false);
  // Der Regler führt nur einen Entwurf; gespeichert wird beim Loslassen, nicht bei jedem Zwischenwert.
  const [manual, setManual] = useDraft(level.manualGainDb);
  const set = (patch: Partial<LevelInput>) =>
    actions.setLevel(row.id, { mode: level.mode, manualGainDb: manual, compress: level.compress, ...patch });
  const [lo, hi] = LEVEL_MANUAL_RANGE_DB;
  return (
    <section className="mt-3.5 rounded-lg border border-line p-2.5" data-testid="level">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[0.9rem] font-semibold">Lautstärke</h4>
        <span className="font-mono text-[0.85rem] text-ink-2" data-testid="level-gain">
          {level.mode === "off" ? "unverändert" : dbText(level.gainDb)}
          {level.mode !== "off" && level.compress && " · Kompressor"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Choice
          label="Lautstärke angleichen"
          value={level.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "auto", label: "automatisch", title: "Sprache auf gleichen Pegel wie die anderen Quellen" },
            { value: "manual", label: "von Hand" },
            { value: "off", label: "aus", title: "Ton genau wie in der Datei" },
          ]}
        />
      </div>
      {level.mode === "manual" && (
        <label className="mt-2 flex items-center gap-2 text-[0.85rem]">
          <input
            type="range"
            min={lo}
            max={hi}
            step={0.5}
            value={manual}
            aria-label="Verstärkung in dB"
            className="flex-1"
            onChange={(e) => setManual(Number(e.target.value))}
            onPointerUp={() => set({ manualGainDb: manual })}
            onKeyUp={() => set({ manualGainDb: manual })}
          />
          <span className="w-16 text-right font-mono">{dbText(manual)}</span>
        </label>
      )}
      {level.mode !== "off" && (
        <label className="mt-2 flex items-center gap-2 text-[0.85rem]">
          <Toggle checked={level.compress} onChange={(compress) => set({ compress })} label="Leise Stellen anheben" />
          Leise Stellen anheben (Kompressor)
        </label>
      )}
      <p className="mt-2 text-[0.82rem] text-muted">
        {level.measured ? (
          level.measuredDb === null ? (
            "Kein hörbarer Ton gefunden."
          ) : (
            <>
              Sprachpegel gemessen: <span className="font-mono">{dbText(level.measuredDb).replace("+", "")}FS</span>
              .{" "}
            </>
          )
        ) : (
          <>
            Noch nicht gemessen{level.mode === "auto" ? ", deshalb noch ohne Verstärkung" : ""}.{" "}
            <Button
              variant="link"
              className="text-[0.82rem]"
              disabled={measuring}
              onClick={() => {
                setMeasuring(true);
                void actions.measureLevel(row.id).finally(() => setMeasuring(false));
              }}
            >
              {measuring ? "Misst…" : "Jetzt messen"}
            </Button>{" "}
          </>
        )}
        Gilt beim Abhören und im Montagevideo, die Datei bleibt unverändert.
      </p>
    </section>
  );
}
