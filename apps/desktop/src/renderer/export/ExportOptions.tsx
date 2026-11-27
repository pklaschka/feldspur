/**
 * Die Schalter des Schritts „Ausgeben“: was zusätzlich in den Ordner kommt. Eingebunden in
 * `apps/desktop/src/renderer/ExportStep.tsx`; die Werte hält und merkt `apps/desktop/src/renderer/export/options.ts`.
 */
import type { ReactNode } from "react";
import { FRAME_RATES, RESOLUTIONS, widthOf, type MontageFormat } from "@feldspur/media/layout";
import type { SessionTranscriptPreview } from "../../shared/api.ts";
import { aboutSize } from "../format.ts";
import { Choice, cx, Toggle } from "../ui.tsx";
import type { Options } from "./options.ts";

/**
 * Drei Gruppen von Schaltern: Montagevideo, Nachweise im Ordner, Schnitt. Der Viewer hält das Montagevideo fest,
 * weil er genau dieses Video abspielt.
 */
export function ExportOptions({
  opts,
  set,
  format,
  onFormat,
  withEpisodes,
  videoBytes,
}: {
  opts: Options;
  set: (patch: Partial<Options>) => void;
  /** Auflösung und Bildrate des Montagevideos, für das ganze Projekt (Issue #250). */
  format: MontageFormat;
  onFormat: (f: MontageFormat) => void;
  /** Sind unter „Durchsehen“ Episoden eingeschaltet? Nur dann lässt sich nach Episoden schneiden. */
  withEpisodes: boolean;
  /** Geschätzte Größe des Videos; null, solange die Montage berechnet wird oder leer ist. */
  videoBytes: SessionTranscriptPreview["videoBytes"] | null;
}) {
  const { video, resolve, mixAudio, deviceTracks, viewer, readme, changeLog, manifest, byEpisodes } = opts;
  return (
    <>
      <OptionGroup title="Montagevideo">
        <Option
          checked={video}
          onChange={(v) => set({ video: v })}
          disabled={viewer}
          label="Montagevideo mit ausgeben"
          size={videoBytes ? aboutSize(videoBytes.video + (deviceTracks ? videoBytes.deviceTracks : 0)) : undefined}
          hint={
            viewer
              ? "Bleibt an, weil der Viewer dieses Video abspielt. Zum Ausschalten zuerst den Viewer abwählen."
              : "Dauert einige Minuten. Aus: nur Einsatztranskript, Dokumentvariablen und Begleitprotokoll."
          }
        />
        <VideoFormat format={format} onFormat={onFormat} disabled={!video} />
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

/**
 * Auflösung und Bildrate des Montagevideos als zwei Knopfreihen, eingerückt wie die Hinweise unter den Schaltern.
 * Kleiner rechnet schneller und braucht weniger Platz; Uhrzeit, Herkunft und Montage-ID bleiben in jedem Format lesbar.
 */
function VideoFormat({
  format,
  onFormat,
  disabled,
}: {
  format: MontageFormat;
  onFormat: (f: MontageFormat) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 pl-[2.625rem] text-[0.95rem]" data-testid="video-format">
      <div className="grid grid-cols-[8.5rem_auto] items-center gap-x-2 gap-y-2">
        <span>Auflösung</span>
        <Choice
          label="Auflösung des Montagevideos"
          value={String(format.height)}
          onChange={(v) => onFormat({ ...format, height: Number(v) })}
          options={RESOLUTIONS.map((h) => ({
            value: String(h),
            label: `${h}p`,
            title: `${widthOf(h)} × ${h} Pixel`,
            disabled,
          }))}
        />
        <span>Bilder je Sekunde</span>
        <Choice
          label="Bilder je Sekunde im Montagevideo"
          value={String(format.fps)}
          onChange={(v) => onFormat({ ...format, fps: Number(v) })}
          options={FRAME_RATES.map((fps) => ({ value: String(fps), label: String(fps), disabled }))}
        />
      </div>
      <span className="text-[0.85rem] text-muted">
        {widthOf(format.height)} × {format.height} Pixel, {format.fps} Bilder je Sekunde. Gilt für alle Einsätze dieses
        Projekts. Kleiner geht schneller und braucht weniger Platz; Uhrzeit und Montage-ID bleiben lesbar.
      </span>
    </div>
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

/** Ein Schalter mit Beschriftung, Hinweiszeile und auf Wunsch geschätzter Größe. */
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
