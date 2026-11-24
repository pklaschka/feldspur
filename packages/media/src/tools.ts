/**
 * Pfade der mitgelieferten Programme. In der fertigen App liegen ffprobe und
 * ffmpeg im Ressourcenordner; in der Entwicklung reicht die Installation im PATH.
 * Über FELDSPUR_FFPROBE / FELDSPUR_FFMPEG lassen sich die Pfade überschreiben.
 *
 * Einordnung: Beim Start setzt der Hauptprozess die Pfade (`setToolPaths` in `apps/desktop/src/main/main.ts`,
 * ermittelt von `apps/desktop/src/main/tools.ts`); gelesen werden sie nur von `runTool`
 * (`packages/media/src/process.ts`).
 */
export interface ToolPaths {
  ffprobe: string;
  ffmpeg: string;
}

let paths: ToolPaths = {
  ffprobe: process.env.FELDSPUR_FFPROBE ?? "ffprobe",
  ffmpeg: process.env.FELDSPUR_FFMPEG ?? "ffmpeg",
};

/** Ersetzt die genannten Pfade, die übrigen bleiben. */
export function setToolPaths(next: Partial<ToolPaths>): void {
  paths = { ...paths, ...next };
}

export function toolPaths(): ToolPaths {
  return paths;
}
