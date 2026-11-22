import { describe, expect, it } from "vite-plus/test";
import { estimateMontageBytes } from "../src/montage-video.ts";

describe("Größe des Montagevideos schätzen", () => {
  const hour = 60 * 60 * 1000;

  it("rechnet eine Stunde Video mit Tonspur 1 zu gut 1,4 GB", () => {
    // 3000 kbit/s Bild + 160 kbit/s Ton, 3600 s
    expect(estimateMontageBytes(hour, 1).video).toBe(1_422_000_000);
  });

  it("legt für jede Tonspur je Gerät etwas drauf, aber erst ab zwei Geräten mit Ton", () => {
    expect(estimateMontageBytes(hour, 1).deviceTracks).toBe(0);
    expect(estimateMontageBytes(hour, 3).deviceTracks).toBe(3 * 57_600_000);
  });
});
