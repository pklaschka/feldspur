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
  it.each`
    datei                 | typ
    ${"C0001.MP4"}        | ${"video/mp4"}
    ${"ZOOM0001.m4a"}     | ${"audio/mp4"}
    ${"Tagebuch.jpg"}     | ${"image/jpeg"}
    ${"projekt.feldspur"} | ${null}
  `("$datei wird als $typ ausgeliefert", ({ datei, typ }) => {
    expect(mediaType(datei)).toBe(typ);
  });

  it("liefert unbekannte Typen nicht aus (415)", () => {
    expect(fileResponse(file, "notizen.txt", null).status).toBe(415);
  });

  it.each`
    kopf            | bereich      | fall
    ${null}         | ${null}      | ${"ohne Range: ganze Datei"}
    ${"bytes=2-5"}  | ${[2, 5]}    | ${"von–bis"}
    ${"bytes=7-"}   | ${[7, 9]}    | ${"ab Stelle bis Ende"}
    ${"bytes=-3"}   | ${[7, 9]}    | ${"die letzten 3 Bytes"}
    ${"bytes=5-99"} | ${[5, 9]}    | ${"über das Ende hinaus, gekürzt"}
    ${"bytes=12-"}  | ${"invalid"} | ${"Beginn hinter dem Ende"}
    ${"items=1-2"}  | ${"invalid"} | ${"andere Einheit"}
  `("Range $kopf bei 10 Bytes: $fall", ({ kopf, bereich }) => {
    expect(parseRange(kopf, 10)).toEqual(bereich);
  });

  it("liefert Teilbereiche mit 206", async () => {
    // Wenn: Bytes 2–5 angefragt werden, dann 206 mit genau diesem Ausschnitt
    const r = fileResponse(file, "x.m4a", "bytes=2-5");
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await r.text()).toBe("2345");
    // Wenn: ohne Range, dann 200 und die ganze Datei
    const all = fileResponse(file, "x.m4a", null);
    expect(all.status).toBe(200);
    expect(all.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await all.text()).toBe("0123456789");
    // Wenn: hinter dem Ende, dann 416
    expect(fileResponse(file, "x.m4a", "bytes=20-").status).toBe(416);
  });
});
