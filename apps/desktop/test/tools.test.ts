import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveToolPaths } from "../src/main/tools.ts";

describe("resolveToolPaths", () => {
  const res = join("/app", "resources");
  it("nimmt die mitgelieferten Programme, wenn es sie gibt", () => {
    const has = new Set([join(res, "bin", "ffmpeg.exe"), join(res, "bin", "ffprobe.exe")]);
    expect(resolveToolPaths({}, res, ".exe", (p) => has.has(p))).toEqual({
      ffmpeg: join(res, "bin", "ffmpeg.exe"),
      ffprobe: join(res, "bin", "ffprobe.exe"),
    });
  });
  it("fällt auf den PATH zurück", () => {
    expect(resolveToolPaths({}, res, "", () => false)).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
    expect(resolveToolPaths({}, null, "", () => true)).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
  });
  it("Umgebungsvariablen gehen vor", () => {
    const r = resolveToolPaths({ FELDSPUR_FFMPEG: "/x/ffmpeg" }, res, "", () => true);
    expect(r.ffmpeg).toBe("/x/ffmpeg");
    expect(r.ffprobe).toBe(join(res, "bin", "ffprobe"));
  });
});
