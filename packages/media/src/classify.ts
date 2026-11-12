import type { SourceKind } from "@feldspur/core";

const EXT: Record<string, SourceKind> = {
  // Video
  mp4: "video",
  mov: "video",
  m4v: "video",
  mts: "video",
  m2ts: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
  "3gp": "video",
  // Audio
  wav: "audio",
  mp3: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  ogg: "audio",
  opus: "audio",
  wma: "audio",
  amr: "audio",
  // Fotos
  jpg: "photo",
  jpeg: "photo",
  heic: "photo",
  heif: "photo",
  png: "photo",
  tif: "photo",
  tiff: "photo",
  dng: "photo",
  webp: "photo",
  // Notizen
  txt: "note",
  md: "note",
  rtf: "note",
  docx: "note",
  odt: "note",
  // GPS
  gpx: "gps",
  kml: "gps",
  geojson: "gps",
  // Scans
  pdf: "diary",
};

const DIARY_HINT = /tagebuch|diary|feldnotiz|fieldnote|notizbuch|scan|seite[\s_-]?\d|s\d{2,3}(?!\d)/i;

export function extensionOf(fileName: string): string {
  const m = /\.([^.\\/]+)$/.exec(fileName);
  return m ? m[1]!.toLowerCase() : "";
}

/** Dateien, die beim Einsammeln übersprungen werden (Systemdateien, Begleitdateien). */
export function isIgnored(fileName: string): boolean {
  return (
    /^(\.|~\$|Thumbs\.db$|desktop\.ini$)/i.test(fileName) || /\.(xml|thm|lrv|ctg|bdm|cpi|ds_store)$/i.test(fileName)
  );
}

/**
 * Erste Einschätzung der Quellenart aus dem Dateinamen. Ein Bild gilt als
 * Tagebuchseite, wenn der Name danach klingt und es keine Kamera-EXIF-Daten hat;
 * alles lässt sich nach dem Import umstellen.
 */
export function classify(fileName: string, opts: { hasCameraExif?: boolean } = {}): SourceKind {
  const kind = EXT[extensionOf(fileName)] ?? "other";
  if (kind === "photo" && !opts.hasCameraExif && DIARY_HINT.test(fileName)) return "diary";
  return kind;
}

/**
 * Dateinamen-Familie: Ziffernfolgen werden zu #. "C0012.MP4" → "C####.mp4".
 * Dient als Gerätevermutung, wenn die Metadaten kein Modell nennen.
 */
export function filenameFamily(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return stem.replace(/\d/g, "#") + ext;
}
