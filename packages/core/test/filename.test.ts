import { describe, expect, it } from "vite-plus/test";
import { compileFilenamePattern, timeFromFilename } from "../src/filename.ts";
import { formatLocal } from "../src/time.ts";

const at = (name: string, pattern?: string) => {
  const r = timeFromFilename(name, pattern);
  return r && { time: formatLocal(r.localMs), unc: r.uncertaintyMs };
};

describe("Uhrzeit aus Dateinamen", () => {
  it.each([
    ["IMG_20260914_104050.jpg", "2026-09-14T10:40:50.500", 500],
    ["VID_20260914_103200.mp4", "2026-09-14T10:32:00.500", 500],
    ["PXL_20260914_103215123.mp4", "2026-09-14T10:32:15.500", 500],
    ["2026-09-14 10.32.15.jpg", "2026-09-14T10:32:15.500", 500],
    ["signal-2026-09-14-103215.m4a", "2026-09-14T10:32:15.500", 500],
    ["Screenshot 2026-09-14 at 10.32.15.png", "2026-09-14T10:32:15.500", 500],
    ["DJI_20260914103215_0001.MP4", "2026-09-14T10:32:15.500", 500],
  ])("%s", (name, time, unc) => {
    expect(at(name)).toEqual({ time, unc });
  });

  it("nur Minute: Mitte der Minute mit ± 30 s", () => {
    expect(at("REC_20260914_1032.m4a")).toEqual({ time: "2026-09-14T10:32:30", unc: 30_000 });
  });

  it("ignoriert Namen ohne Uhrzeit oder mit unmöglichen Werten", () => {
    expect(at("C0012.MP4")).toBeNull();
    expect(at("ZOOM0004.m4a")).toBeNull();
    expect(at("IMG_0231.jpg")).toBeNull();
    expect(at("PTT-20260914-WA0001.opus")).toBeNull();
    expect(at("IMG_20261340_256199.jpg")).toBeNull();
  });

  it("eigenes Muster pro Gerät hat Vorrang", () => {
    expect(at("Interview_14.09.2026_1032.wav", "*DD.MM.YYYY_hhmm")).toEqual({
      time: "2026-09-14T10:32:30",
      unc: 30_000,
    });
    expect(() => compileFilenamePattern("REC_hhmm")).toThrow(/YYYY/);
  });
});
