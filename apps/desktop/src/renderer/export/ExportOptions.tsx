/** Die Schalter des Schritts „Ausgeben“: was zusätzlich in den Ordner kommt. */
import type { ReactNode } from "react";
import type { SessionTranscriptPreview } from "../../shared/api.ts";
import { aboutSize } from "../format.ts";
import { cx, Toggle } from "../ui.tsx";
import type { Options } from "./options.ts";

export function ExportOptions({
  opts,
  set,
  withEpisodes,
  preview,
}: {
  opts: Options;
  set: (patch: Partial<Options>) => void;
  /** Sind unter „Durchsehen“ Episoden eingeschaltet? Nur dann lässt sich nach Episoden schneiden. */
  withEpisodes: boolean;
  /** Für die geschätzte Größe des Videos; null, solange die Montage berechnet wird. */
  preview: SessionTranscriptPreview | null;
}) {
  const { video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, byEpisodes } = opts;
  const empty = !preview || preview.durationMs <= 0;
  return (
    <>
      <OptionGroup title="Montagevideo">
        <Option
          checked={video}
          onChange={(v) => set({ video: v })}
          disabled={viewer}
          label="Montagevideo mit ausgeben"
          size={
            preview && !empty
              ? aboutSize(preview.videoBytes.video + (deviceTracks ? preview.videoBytes.deviceTracks : 0))
              : undefined
          }
          hint={
            viewer
              ? "Bleibt an, weil der Viewer dieses Video abspielt. Zum Ausschalten zuerst den Viewer abwählen."
              : "Dauert einige Minuten. Aus: nur Einsatztranskript, Dokumentvariablen und Begleitprotokoll."
          }
        />
        {withEpisodes && (
          <Option
            checked={byEpisodes}
            onChange={(v) => set({ byEpisodes: v })}
            label="Nach Episoden schneiden"
            hint="Kürzer, aber Videozeit ≠ Uhrzeit. Aus: der ganze Einsatz in Echtzeit."
          />
        )}
        {!withEpisodes && (
          <p className="pl-[2.625rem] text-[0.85rem] text-muted">
            Nach Episoden schneiden geht, wenn unter „Durchsehen“ Episoden eingeschaltet sind.
          </p>
        )}
        <Option
          checked={mixAudio}
          onChange={(v) => set({ mixAudio: v })}
          label="Ton aller Geräte mischen"
          hint="Aus: nur der Ton der Hauptquelle."
        />
        <Option
          checked={deviceTracks}
          onChange={(v) => set({ deviceTracks: v })}
          label="Zusätzlich eine Tonspur je Gerät"
          hint="Die Mischung bleibt Spur 1. VLC und Schnittprogramme spielen die Geräte auch einzeln."
        />
        <Option
          checked={viewer}
          onChange={(v) => set(v ? { viewer: true, video: true } : { viewer: false })}
          label="Viewer zum Ansehen im Browser (.html)"
          hint="Eine Datei neben dem Video: Das Einsatztranskript läuft mit, ein Klick auf eine Zeile springt dorthin. Enthält die Bilder und schaltet das Montagevideo mit ein."
        />
      </OptionGroup>
      <OptionGroup title="Nachweise im Ordner">
        <Option
          checked={readme}
          onChange={(v) => set({ readme: v })}
          label="LIESMICH mit Tabelle für den Methodenteil (.html)"
          hint="Erklärt, was im Ordner liegt und wie daraus zitiert wird; nennt Eingang, Ausgabe und Montage-ID."
        />
        <Option
          checked={changeLog}
          onChange={(v) => set({ changeLog: v })}
          label="Änderungsprotokoll (.csv)"
          hint="Jede Änderung an diesem Einsatz mit Zeit und den Werten vorher und nachher."
        />
        <Option
          checked={manifest}
          onChange={(v) => set({ manifest: v })}
          label="Prüfsummenliste (manifest-sha256.txt)"
          hint="SHA-256 jeder Datei im Ordner. Damit lässt sich später zeigen, dass nichts verändert wurde."
        />
      </OptionGroup>
      <OptionGroup title="Für den Schnitt">
        <Option
          checked={resolve}
          onChange={(v) => set({ resolve: v })}
          label="Schnittliste für DaVinci Resolve"
          hint="Dieselbe Montage als FCPXML, ohne Einblendungen."
        />
      </OptionGroup>
    </>
  );
}

/** Zusammengehörige Schalter unter einer kleinen Überschrift. */
function OptionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-sans text-[0.82rem] font-semibold tracking-normal text-muted">{title}</h3>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Option({
  checked,
  onChange,
  disabled,
  label,
  size,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Festgehalten, weil eine andere Wahl davon abhängt; der Grund steht dann im Hinweis. */
  disabled?: boolean;
  label: string;
  /** Geschätzte Größe hinter der Beschriftung, z. B. „ca. 2,1 GB“. */
  size?: string;
  hint: string;
}) {
  return (
    <label
      className={cx(
        "grid grid-cols-[auto_1fr] items-center gap-x-2.5 text-[0.95rem]",
        disabled && "cursor-not-allowed",
      )}
    >
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <span>
        {label}
        {size && <span className="ml-1.5 text-[0.85rem] text-muted tabular-nums">{size}</span>}
        {disabled && <span className="ml-1.5 text-[0.8rem] text-muted">(gesperrt)</span>}
      </span>
      <span className="col-start-2 text-[0.85rem] text-muted">{hint}</span>
    </label>
  );
}
