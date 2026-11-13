import { join } from "node:path";
import type { ToolPaths } from "@feldspur/media";

/**
 * Welche ffmpeg/ffprobe die App benutzt, in dieser Reihenfolge:
 * 1. FELDSPUR_FFMPEG / FELDSPUR_FFPROBE aus der Umgebung,
 * 2. die mitgelieferten Programme im Ressourcenordner (resources/bin),
 * 3. was im PATH liegt (Entwicklung).
 */
export function resolveToolPaths(
  env: Record<string, string | undefined>,
  resourcesPath: string | null,
  exe: string,
  exists: (p: string) => boolean,
): ToolPaths {
  const bundled = (name: string) => {
    if (!resourcesPath) return null;
    const p = join(resourcesPath, "bin", `${name}${exe}`);
    return exists(p) ? p : null;
  };
  return {
    ffmpeg: env.FELDSPUR_FFMPEG || bundled("ffmpeg") || "ffmpeg",
    ffprobe: env.FELDSPUR_FFPROBE || bundled("ffprobe") || "ffprobe",
  };
}
