import { describe, expect, it } from "vite-plus/test";
import { pickEncoder } from "../src/montage-video.ts";

/** Ausgabe von `ffmpeg -encoders` mit diesen Video-Encodern. */
const liste = (...namen: string[]) =>
  ["Encoders:", " ------", ...namen.map((n) => ` V....D ${n}              ${n} (codec h264)`)].join("\n");
/** Ein Rechner, auf dem die Encoder alles annehmen außer Argumentlisten mit einem dieser Wörter. */
const ohne =
  (...woerter: string[]) =>
  (enc: string[]) =>
    Promise.resolve(!woerter.some((w) => enc.includes(w)));

describe("Encoder für das Montagevideo wählen (Issue #252)", () => {
  it("rechnet mit VideoToolbox auf Qualität statt auf eine feste Bitrate", async () => {
    // Angenommen: ein Mac mit Apple Silicon, ausgeliefertes ffmpeg (VideoToolbox, sonst nur MPEG-4)
    const enc = await pickEncoder(liste("h264_videotoolbox", "mpeg4"), ohne());
    // Dann: gleichbleibende Qualität, keine Bitrate
    expect(enc).toEqual(["-c:v", "h264_videotoolbox", "-q:v", "55"]);
  });

  it("fällt auf die Bitrate zurück, wo VideoToolbox keine Qualitätsstufe kennt", async () => {
    // Angenommen: ein Intel-Mac, ffmpeg lehnt -q:v für VideoToolbox ab
    const enc = await pickEncoder(liste("h264_videotoolbox", "mpeg4"), ohne("-q:v"));
    // Dann: derselbe Encoder mit einer Bitrate, die auch unruhiges Bild trägt
    expect(enc).toEqual(["-c:v", "h264_videotoolbox", "-b:v", "8000k"]);
  });

  it("nimmt unter Windows den Qualitätsmodus nur, wenn der Encoder des Rechners ihn kann", async () => {
    expect(await pickEncoder(liste("h264_mf", "mpeg4"), ohne())).toEqual([
      "-c:v",
      "h264_mf",
      "-rate_control",
      "quality",
      "-quality",
      "40",
    ]);
    expect(await pickEncoder(liste("h264_mf", "mpeg4"), ohne("-rate_control"))).toEqual([
      "-c:v",
      "h264_mf",
      "-b:v",
      "8000k",
    ]);
  });

  it("deckelt OpenH264 bei der Bitrate und hält es bei ruhigem Bild davon ab, sie auszuschöpfen", async () => {
    // Angenommen: das ausgelieferte ffmpeg unter Linux
    const enc = await pickEncoder(liste("libopenh264", "mpeg4"), ohne());
    expect(enc).toEqual(["-c:v", "libopenh264", "-b:v", "8000k", "-qmin", "26"]);
  });

  it("zieht libx264 vor, wo es ihn gibt, und weicht ohne H.264 auf MPEG-4 aus", async () => {
    expect(await pickEncoder(liste("libx264", "h264_videotoolbox", "mpeg4"), ohne())).toEqual([
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
    ]);
    expect(await pickEncoder(liste("mpeg4"), ohne())).toEqual(["-c:v", "mpeg4", "-q:v", "4"]);
  });

  it("bleibt beim letzten bekannten Encoder, wenn kein Probebild gelingt", async () => {
    // Angenommen: ein ffmpeg, das gar nichts rechnet
    const enc = await pickEncoder(liste("h264_videotoolbox", "mpeg4"), () => Promise.resolve(false));
    // Dann: scheitert erst der Abschnitt und meldet den eigentlichen Fehler
    expect(enc).toEqual(["-c:v", "mpeg4", "-q:v", "4"]);
  });
});
