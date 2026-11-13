import { describe, expect, it } from "vite-plus/test";
import { pieceAt, previewFrame } from "../src/renderer/montage.ts";
import type { PreviewPiece } from "../src/shared/api.ts";

const piece = (fromMs: number, toMs: number, kind: PreviewPiece["kind"], clock0: number): PreviewPiece => ({
  fromMs,
  toMs,
  kind,
  clock0,
  title: kind,
  body: "",
  videos: [],
  audios: [],
});

describe("Montage in der App", () => {
  const pieces = [piece(0, 3000, "card", 1_000_000), piece(3000, 63_000, "episode", 2_000_000)];

  it("findet das Stück an einer Stelle", () => {
    expect(pieceAt(pieces, 0)).toBe(0);
    expect(pieceAt(pieces, 2999)).toBe(0);
    expect(pieceAt(pieces, 3000)).toBe(1);
    expect(pieceAt(pieces, 70_000)).toBe(1);
  });

  it("lässt die Uhr nur in Episoden sekundenweise mitlaufen", () => {
    expect(previewFrame(pieces[0]!, 2500).clockMs).toBe(1_000_000);
    expect(previewFrame(pieces[1]!, 3000 + 12_400).clockMs).toBe(2_012_000);
  });

  it("zeigt je Datei die Stelle im Original und trennt Ton ohne Bild ab", () => {
    const p: PreviewPiece = {
      ...piece(10_000, 70_000, "episode", 2_000_000),
      videos: [{ sourceId: "v", fromMs: 5_000, label: "V-01 Kamera", fileName: "C0001.MP4", kind: "video" }],
      audios: [
        { sourceId: "a", fromMs: 65_000, label: "A-01 Rekorder", fileName: "ZOOM0001.WAV", kind: "audio" },
        { sourceId: "v", fromMs: 5_000, label: "V-01 Kamera", fileName: "C0001.MP4", kind: "video" },
      ],
    };
    const f = previewFrame(p, 10_000 + 7_400);
    expect(f.tiles).toEqual([{ label: "V-01 Kamera", fileName: "C0001.MP4", atMs: 12_000 }]);
    expect(f.sounds).toEqual([{ label: "A-01 Rekorder", fileName: "ZOOM0001.WAV", atMs: 72_000 }]);
    expect(f.clockMs).toBe(2_007_000);
  });
});
