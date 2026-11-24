/**
 * Uhrzeiten aus Dateinamen lesen (`packages/core/src/filename.ts`): eingebaute Muster gängiger Geräte und eigene
 * Muster je Gerät. Gehört zum Einsammeln.
 */
import { describe, expect, it } from "vite-plus/test";
import { compileFilenamePattern, timeFromFilename } from "../src/filename.ts";
import { formatLocal } from "../src/time.ts";

const at = (name: string, pattern?: string) => {
  const r = timeFromFilename(name, pattern);
  return r && { time: formatLocal(r.localMs), unc: r.uncertaintyMs };
};

describe("Uhrzeit aus Dateinamen", () => {
  it.each`
    datei                                      | uhrzeit                      | unsicherheitMs
    ${"IMG_20260914_104050.jpg"}               | ${"2026-09-14T10:40:50.500"} | ${500}
    ${"VID_20260914_103200.mp4"}               | ${"2026-09-14T10:32:00.500"} | ${500}
    ${"PXL_20260914_103215123.mp4"}            | ${"2026-09-14T10:32:15.123"} | ${250}
    ${"PXL_20260914_103215123.MP.jpg"}         | ${"2026-09-14T10:32:15.123"} | ${250}
    ${"2026-09-14 10.32.15.jpg"}               | ${"2026-09-14T10:32:15.500"} | ${500}
    ${"signal-2026-09-14-103215.m4a"}          | ${"2026-09-14T10:32:15.500"} | ${500}
    ${"Screenshot 2026-09-14 at 10.32.15.png"} | ${"2026-09-14T10:32:15.500"} | ${500}
    ${"DJI_20260914103215_0001.MP4"}           | ${"2026-09-14T10:32:15.500"} | ${500}
    ${"REC_20260914_1032.m4a"}                 | ${"2026-09-14T10:32:30"}     | ${30_000}
  `("$datei ergibt $uhrzeit ± $unsicherheitMs ms", ({ datei, uhrzeit, unsicherheitMs }) => {
    expect(at(datei)).toEqual({ time: uhrzeit, unc: unsicherheitMs });
  });

  it.each`
    datei                            | zeitart
    ${"PXL_20260907_151441849.mp4"}  | ${"UTC"}
    ${"IMG_20260914_104050.jpg"}     | ${"Ortszeit"}
    ${"XPXL_20260914_103215123.mp4"} | ${"Ortszeit"}
  `("$datei trägt $zeitart (nur echte Pixel-Namen tragen UTC)", ({ datei, zeitart }) => {
    expect(timeFromFilename(datei)?.utc ?? false).toBe(zeitart === "UTC");
  });

  it.each`
    datei                         | grund
    ${"C0012.MP4"}                | ${"nur Zählnummer"}
    ${"ZOOM0004.m4a"}             | ${"nur Zählnummer"}
    ${"IMG_0231.jpg"}             | ${"nur Zählnummer"}
    ${"PTT-20260914-WA0001.opus"} | ${"Datum ohne Uhrzeit"}
    ${"IMG_20261340_256199.jpg"}  | ${"Monat 13, Stunde 25"}
  `("$datei liefert keine Uhrzeit ($grund)", ({ datei }) => {
    expect(at(datei)).toBeNull();
  });

  it("ein eigenes Muster am Gerät hat Vorrang", () => {
    expect(at("Interview_14.09.2026_1032.wav", "*DD.MM.YYYY_hhmm")).toEqual({
      time: "2026-09-14T10:32:30",
      unc: 30_000,
    });
  });

  it("ein Muster ohne Jahr wird abgelehnt", () => {
    expect(() => compileFilenamePattern("REC_hhmm")).toThrow(/YYYY/);
  });
});
