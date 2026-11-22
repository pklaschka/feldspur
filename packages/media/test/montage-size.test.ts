import { describe, expect, it } from "vite-plus/test";
import { estimateMontageBytes, type Piece } from "../src/montage-video.ts";
import type { SessionTranscript } from "../src/session-transcript.ts";

/** Stück von `min` Minuten mit laufenden Videos und Tonquellen (Geräte-IDs). */
function stueck(min: number, { videos = 0, audios = [] as string[] } = {}): Piece {
  const ref = (deviceId?: string) => ({ source: { deviceId } }) as unknown as Piece["videos"][number];
  return {
    f0: 0,
    f1: min * 60 * 25,
    kind: "episode",
    clock0: 0,
    title: "",
    body: "",
    videos: Array.from({ length: videos }, () => ref()),
    audios: audios.map((d) => ref(d)),
  } as Piece;
}
const schaetze = (pieces: Piece[]) => estimateMontageBytes({} as SessionTranscript, pieces);

describe("Größe des Montagevideos schätzen", () => {
  it("rechnet eine Stunde laufendes Video mit Ton zu gut 1,4 GB", () => {
    // 3000 kbit/s Bild + 160 kbit/s Ton, 3600 s
    expect(schaetze([stueck(60, { videos: 1, audios: ["rec"] })]).video).toBe(1_422_000_000);
  });

  it("zählt Strecken ohne Video und ohne Ton kaum mit", () => {
    // Angenommen: eine Stunde nur Tafel und Uhrzeit (Echtzeit-Lücke)
    // Dann: 600 kbit/s, 270 MB statt 1,4 GB
    expect(schaetze([stueck(60)]).video).toBe(270_000_000);
  });

  it("legt je Gerät nur die Zeit drauf, in der es Ton hat, und erst ab zwei Geräten", () => {
    expect(schaetze([stueck(60, { audios: ["rec"] })]).deviceTracks).toBe(0);
    // Angenommen: Rekorder eine Stunde, Handy eine halbe
    const teile = [stueck(30, { audios: ["rec", "handy"] }), stueck(30, { audios: ["rec"] })];
    // Dann: 1,5 Stunden zu 128 kbit/s
    expect(schaetze(teile).deviceTracks).toBe(86_400_000);
  });
});
