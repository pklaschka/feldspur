/**
 * Zahlen für die „Tabelle für den Methodenteil“ (Issue #149): was in einen Einsatz hineingeflossen ist und was
 * Feldspur daraus ausgibt. Nur Gezähltes und Gemessenes, keine Bewertung. Das Begleitprotokoll bleibt der
 * vollständige Nachweis je Datei; hier steht dasselbe verdichtet, je Art und Gerät.
 */
import type { ExportSettings, Id, PlacementBasis, ProjectStore, Source, SourceKind } from "@feldspur/core";
import { baseName } from "./export.ts";
import { compareExport } from "./export-state.ts";
import { buildSessionTranscript, type SessionTranscript } from "./session-transcript.ts";

/** Worauf die Lage einer Datei beruht; „context“ = bewusst ohne Uhrzeit, „none“ = (noch) ohne Uhrzeit. */
export type MethodsBasis = PlacementBasis["kind"] | "context" | "none";

/** Eine Zeile „Eingang“: alle Dateien einer Art von einem Gerät. */
export interface MethodsMaterialRow {
  kind: SourceKind;
  /** Bezeichnung des Geräts; leer ohne Gerät und beim Tagebuch (Einträge hängen nicht an einem Gerät). */
  device: string;
  /** Anzahl der Dateien. */
  files: number;
  /** Nur Tagebuch: Anzahl der Einträge (auch abgetippte ohne Scan). */
  entries?: number;
  /** Summe der Längen bei Ton und Video, sonst 0. */
  durationMs: number;
  /** Zeitbeleg → Anzahl der Dateien, deren Lage darauf beruht. */
  basis: Partial<Record<MethodsBasis, number>>;
  /** Angewandte Korrekturen der Geräteuhr (ohne 0), jede einmal. */
  correctionsMs: number[];
}

export interface MethodsSessionSummary {
  sessionId: Id;
  title: string;
  date: string;
  material: MethodsMaterialRow[];
  /** Eingesammelte Dateien (Seiten eines Tagebuchs zählen einzeln, Teile einer Seite nicht). */
  sources: number;
  /** Geräte, deren Uhr noch nicht abgeglichen ist (ohne das Referenzgerät). */
  unsynced: number;
  /** Was die Ausgabe mit den gewählten Einstellungen jetzt ergäbe. */
  output: {
    /** Dateiname ohne Endung. */
    base: string;
    /** Zeilen des Einsatztranskripts (Chronologie). */
    lines: number;
    /** Kontextstücke vor der Chronologie. */
    context: number;
    /** Länge des Montagevideos. */
    durationMs: number;
    /** „Echtzeit“ oder „Episoden“. */
    mode: string;
    montageId: string;
    montageVideoId: string;
    /** Wird das Montagevideo mit ausgegeben? */
    video: boolean;
  };
  /**
   * Stand der letzten Ausgabe: „current“ = liegt genau so vor, „stale“ = seitdem geändert (oder andere
   * Einstellungen), „none“ = noch nie ausgegeben oder nichts auszugeben.
   */
  exported: "current" | "stale" | "none";
  exportedAt: string | null;
}

const KIND_ORDER: SourceKind[] = ["video", "audio", "photo", "diary", "note", "gps", "other"];

/** Zahlen aus einem fertigen Einsatztranskript: was hineingeflossen ist und was die Ausgabe damit ergibt. */
export function methodsNumbers(
  transcript: SessionTranscript,
  video: boolean,
): Pick<MethodsSessionSummary, "title" | "date" | "material" | "sources" | "unsynced" | "output"> {
  const { input, resolved } = transcript;
  const devices = new Map(input.devices.map((d) => [d.id, d.label]));
  const rows = new Map<string, MethodsMaterialRow>();
  /** Kontext ist eine Quelle in dieser Rolle oder eine Tagebuchseite, deren Einträge alle Kontext sind. */
  const isContext = (main: Source): boolean => {
    if (main.kind !== "diary") return main.role === "context";
    const parts = new Set([main.id, ...input.sources.filter((x) => x.partOf === main.id).map((x) => x.id)]);
    const entries = input.diaryEntries.filter((e) => e.regions.some((r) => parts.has(r.sourceId)));
    return entries.length > 0 && entries.every((e) => e.role === "context");
  };
  for (const s of input.sources) {
    const diary = s.kind === "diary";
    const device = diary ? "" : ((s.deviceId && devices.get(s.deviceId)) ?? "");
    const key = `${s.kind}\n${device}`;
    let row = rows.get(key);
    if (!row) {
      row = { kind: s.kind, device, files: 0, durationMs: 0, basis: {}, correctionsMs: [] };
      rows.set(key, row);
    }
    row.files++;
    if (s.kind === "audio" || s.kind === "video") row.durationMs += s.durationMs ?? 0;
    const p = resolved.placements.get(s.id);
    const main = s.partOf ? input.sources.find((x) => x.id === s.partOf) : s;
    const basis: MethodsBasis = p ? p.basis.kind : main && isContext(main) ? "context" : "none";
    row.basis[basis] = (row.basis[basis] ?? 0) + 1;
    if (p?.deviceCorrectionMs && !row.correctionsMs.includes(p.deviceCorrectionMs))
      row.correctionsMs.push(p.deviceCorrectionMs);
  }
  // Tagebucheinträge zählen auch ohne Scan („Text ohne Scan“): dann gibt es eine Zeile ohne Dateien.
  if (input.diaryEntries.length) {
    const key = "diary\n";
    const row = rows.get(key) ?? { kind: "diary", device: "", files: 0, durationMs: 0, basis: {}, correctionsMs: [] };
    row.entries = input.diaryEntries.length;
    rows.set(key, row);
  }
  const material = [...rows.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.device.localeCompare(b.device, "de"),
  );
  for (const r of material) r.correctionsMs.sort((a, b) => a - b);
  return {
    title: transcript.input.session.title,
    date: transcript.input.session.date,
    material,
    sources: input.sources.filter((s) => !s.partOf).length,
    unsynced: input.devices.filter(
      (d) => !d.isReference && (resolved.deviceClocks.get(d.id)?.offsetMs ?? null) === null,
    ).length,
    output: {
      base: baseName(transcript),
      lines: transcript.entries.length,
      context: transcript.context.length,
      durationMs: transcript.plan.durationMs,
      mode: transcript.header.modeLabel,
      montageId: transcript.header.montageId,
      montageVideoId: transcript.header.montageVideoId,
      video,
    },
  };
}

/** Zahlen eines Einsatzes für die Einstellungen `settings` (so, wie die Ausgabe sie verwenden würde). */
export function methodsSummary(store: ProjectStore, sessionId: Id, settings: ExportSettings): MethodsSessionSummary {
  const session = store.getSession(sessionId);
  const transcript = buildSessionTranscript(store, sessionId, {
    mode: session.episodes && !settings.realtime ? "episodes" : "realtime",
    episodes: session.episodes,
  });
  const record = store.getExportRecord(sessionId);
  const empty = transcript.plan.durationMs <= 0;
  const exported =
    !record || empty ? "none" : compareExport(store, record, settings).differences.length ? "stale" : "current";
  return {
    sessionId,
    ...methodsNumbers(transcript, settings.video),
    exported,
    exportedAt: record && !empty ? record.exportedAt : null,
  };
}
