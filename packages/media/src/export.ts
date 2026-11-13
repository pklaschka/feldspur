/**
 * Ausgeben: Zeitgerüst (.docx), Begleitprotokoll (.csv) und Montagevideo in einen Ordner.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, formatDuration, type Id, type ProjectStore } from "@feldspur/core";
import { scaffoldDocx } from "./docx.ts";
import { renderMontage, type OverlayRenderer } from "./montage-video.ts";
import { buildScaffold, type Scaffold, type ScaffoldEntry } from "./scaffold.ts";
import { renderStill, type Still } from "./stills.ts";

export interface ExportOptions {
  /** Ohne Video geht es schnell; nützlich zum Prüfen des Gerüsts. */
  video?: boolean;
  /** Zeichnet Uhrzeit, Leisten und Tafeltexte ins Video (in der App über die Oberfläche). */
  overlay?: OverlayRenderer;
  onProgress?: (step: string, done: number, total: number) => void;
}

export interface ExportResult {
  dir: string;
  files: string[];
  durationMs: number;
}

/** Dateiname ohne Zeichen, die Windows oder macOS stören. */
export function safeName(s: string): string {
  return (
    s
      .normalize("NFC")
      // eslint-disable-next-line no-control-regex -- Steuerzeichen sind in Dateinamen unzulässig
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 80) || "Einsatz"
  );
}

export function baseName(sc: Scaffold): string {
  return `Feldtag_${sc.header.date}_${safeName(sc.header.title)}`;
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Begleitprotokoll: Nachweis je Quelle (Semikolon, UTF-8 mit BOM für Excel). */
export function protocolCsv(store: ProjectStore, sc: Scaffold): string {
  const { input, resolved } = sc;
  const devices = new Map(input.devices.map((d) => [d.id, d]));
  const persons = new Map(store.listPersons().map((p) => [p.id, p.name]));
  const head = [
    "Kurzzeichen",
    "Art",
    "Datei",
    "Originalpfad",
    "SHA-256",
    "Gerät",
    "Person",
    "Beginn (Uhrzeit)",
    "Ende (Uhrzeit)",
    "Unsicherheit",
    "Zeit stammt aus",
    "Uhrkorrektur",
    "Im Montagevideo ab",
    "Teil von",
    "setzt fort",
  ];
  const label = (id: Id | null) => (id ? (input.sources.find((s) => s.id === id)?.label ?? "") : "");
  const rows = input.sources.map((s) => {
    const p = resolved.placements.get(s.id);
    const d = s.deviceId ? devices.get(s.deviceId) : undefined;
    const at = p ? sc.plan.toMontage(p.startMs, s.id) : null;
    return [
      s.label,
      s.kind,
      s.fileName,
      s.originalPath,
      s.sha256,
      d?.label ?? "",
      d?.personId ? (persons.get(d.personId) ?? "") : "",
      p ? formatClock(p.startMs) : "",
      p && p.endMs !== p.startMs ? formatClock(p.endMs) : "",
      p ? `± ${formatDuration(p.uncertaintyMs)}` : "",
      p?.basis.detail ?? "keine Zeit",
      p && p.deviceCorrectionMs ? formatDuration(p.deviceCorrectionMs, { sign: true }) : "",
      at === null ? "" : formatDuration(at),
      label(s.partOf),
      label(s.follows),
    ];
  });
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export async function exportSession(
  store: ProjectStore,
  sessionId: Id,
  outDir: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const sc = buildScaffold(store, sessionId);
  if (sc.plan.durationMs <= 0) throw new Error("Nichts zu exportieren: keine Quelle hat eine Uhrzeit");
  const base = baseName(sc);
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "feldspur-export-"));
  try {
    const sources = new Map(sc.input.sources.map((s) => [s.id, s]));
    const withImages = sc.entries.filter((e) => e.images.length);
    const stills = new Map<ScaffoldEntry, (Still | null)[]>();
    let n = 0;
    for (const [i, e] of withImages.entries()) {
      opts.onProgress?.("Standbilder", i, withImages.length);
      const list: (Still | null)[] = [];
      for (const ref of e.images) {
        const src = sources.get(ref.sourceId);
        list.push(src ? await renderStill(src, ref, work, { name: `still-${++n}` }) : null);
      }
      stills.set(e, list);
    }

    const files: string[] = [];
    const media = `${base}.mp4`;
    if (opts.video !== false) {
      await renderMontage(sc, stills, join(outDir, media), {
        workDir: work,
        overlay: opts.overlay,
        onProgress: (done, total) => opts.onProgress?.("Montagevideo", done, total),
      });
      files.push(media);
    }

    opts.onProgress?.("Zeitgerüst", 0, 1);
    const docx = await scaffoldDocx(sc, { mediaFileName: media, stills });
    await writeFile(join(outDir, `${base}.docx`), docx);
    files.push(`${base}.docx`);
    await writeFile(join(outDir, `${base}_Begleitprotokoll.csv`), protocolCsv(store, sc), "utf8");
    files.push(`${base}_Begleitprotokoll.csv`);
    opts.onProgress?.("Fertig", 1, 1);
    return { dir: outDir, files, durationMs: sc.plan.durationMs };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
