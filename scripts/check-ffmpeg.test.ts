import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { checkFfmpeg, missing, parseList, REQUIRED } from "./check-ffmpeg.mjs";

const decoders = `Decoders:
 V..... = Video
 A..... = Audio
 ------
 V....D mjpeg                Motion JPEG
 VFS..D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 A....D aac                  AAC (Advanced Audio Coding)
`;

describe("ffmpeg-Prüfung", () => {
  it("liest Namen aus den Listen, auch mehrere Namen je Zeile", () => {
    expect([...parseList(decoders)]).toEqual(expect.arrayContaining(["mjpeg", "h264", "aac"]));
    const demuxers = parseList(" D. = Demuxing supported\n --\n D  mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV\n");
    expect(demuxers.has("mov")).toBe(true);
    expect(demuxers.has("mp4")).toBe(true);
    const filters = parseList(" ... overlay           VV->V      Overlay a video source on top of the input.\n");
    expect(filters.has("overlay")).toBe(true);
  });

  it("meldet einen Build ohne PNG-Decoder (macOS-Build ohne zlib)", () => {
    const gone = missing({ decoders: parseList(decoders) }, { decoders: ["png", "mjpeg"] });
    expect(gone).toEqual({ decoders: ["png"] });
  });

  it("verlangt PNG, weil die Einblendungen des Montagevideos PNG-Folgen sind", () => {
    expect(REQUIRED.decoders).toContain("png");
    expect(REQUIRED.demuxers).toContain("image2");
    expect(REQUIRED.filters).toContain("overlay");
  });

  const ffmpeg = process.env.FELDSPUR_FFMPEG ?? "ffmpeg";
  let available = true;
  try {
    execFileSync(ffmpeg, ["-version"], { stdio: "ignore" });
  } catch {
    available = false;
  }
  it.skipIf(!available)("das installierte ffmpeg besteht die Prüfung samt Probelauf", () => {
    expect(checkFfmpeg(ffmpeg)).toEqual([]);
  });

  it.skipIf(!available || process.platform === "win32")("fällt bei einem ffmpeg ohne PNG-Decoder durch", () => {
    // Stellt den macOS-Build ohne zlib nach: Die Liste kennt kein png.
    const dir = mkdtempSync(join(tmpdir(), "feldspur-ohne-png-"));
    const fake = join(dir, "ffmpeg");
    writeFileSync(
      fake,
      `#!/bin/sh\nif [ "$2" = "-decoders" ]; then "${ffmpeg}" "$@" | grep -v ' png '; else exec "${ffmpeg}" "$@"; fi\n`,
    );
    chmodSync(fake, 0o755);
    expect(checkFfmpeg(fake)).toEqual(["decoders: png"]);
  });
});
