import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { fileResponse, mediaType, parseRange } from "../src/main/media-response.ts";

const dir = mkdtempSync(join(tmpdir(), "feldspur-media-"));
const file = join(dir, "x.m4a");
writeFileSync(file, Buffer.from("0123456789"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Originale ausliefern", () => {
  it("nur bekannte Medientypen", () => {
    expect(mediaType("C0001.MP4")).toBe("video/mp4");
    expect(mediaType("ZOOM0001.m4a")).toBe("audio/mp4");
    expect(mediaType("Tagebuch.jpg")).toBe("image/jpeg");
    expect(mediaType("projekt.feldspur")).toBeNull();
    expect(fileResponse(file, "notizen.txt", null).status).toBe(415);
  });

  it("Range-Anfragen", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=2-5", 10)).toEqual([2, 5]);
    expect(parseRange("bytes=7-", 10)).toEqual([7, 9]);
    expect(parseRange("bytes=-3", 10)).toEqual([7, 9]);
    expect(parseRange("bytes=5-99", 10)).toEqual([5, 9]);
    expect(parseRange("bytes=12-", 10)).toBe("invalid");
    expect(parseRange("items=1-2", 10)).toBe("invalid");
  });

  it("liefert Teilbereiche mit 206", async () => {
    const r = fileResponse(file, "x.m4a", "bytes=2-5");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await r.text()).toBe("2345");
    const all = fileResponse(file, "x.m4a", null);
    expect(all.status).toBe(200);
    expect(all.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await all.text()).toBe("0123456789");
    expect(fileResponse(file, "x.m4a", "bytes=20-").status).toBe(416);
  });
});
