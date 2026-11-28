// @vitest-environment happy-dom
/**
 * Wiedergabe der Montage aus den Originalen im Schritt „Ansehen“ (`apps/desktop/src/renderer/watch/player.ts`,
 * Issue #131): Der Viewer steuert sie wie ein `<video>`, die Originale werden an die Stelle der Montage gelegt.
 */
import { DEFAULT_FORMAT } from "@feldspur/media/layout";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPlayer } from "../src/renderer/watch/player.ts";
import type { MontagePreview } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten: 60 s Tafel, dann 5 min Episode mit Kamera (ab 0:20 im Original) und
// zwei Rekordern, dann eine Minute nur Rekorder B.
const media = (sourceId: string, fromMs: number, kind: "video" | "audio") => ({
  sourceId,
  fromMs,
  label: sourceId,
  fileName: `${sourceId}.dat`,
  kind,
});
const plan = {
  durationMs: 420_000,
  format: DEFAULT_FORMAT,
  header: { title: "Testmarkt", date: "2026-09-14", montageId: "FS-TEST-TEST" },
  pieces: [
    { fromMs: 0, toMs: 60_000, kind: "card", clock0: 0, title: "Testmarkt", body: "", videos: [], audios: [] },
    {
      fromMs: 60_000,
      toMs: 360_000,
      kind: "play",
      clock0: 36_000_000,
      title: "",
      body: "",
      videos: [media("kamera", 20_000, "video")],
      audios: [media("kamera", 20_000, "video"), media("rekorder-a", 0, "audio"), media("rekorder-b", 90_000, "audio")],
    },
    {
      fromMs: 360_000,
      toMs: 420_000,
      kind: "play",
      clock0: 36_300_000,
      title: "",
      body: "",
      videos: [],
      audios: [media("rekorder-b", 390_000, "audio")],
    },
  ],
} as unknown as MontagePreview;

/** Was gerade läuft oder bereitliegt: Quelle → Stelle im Original (s), nur sichtbare bzw. belegte Elemente. */
const placed = (stage: HTMLElement, tag: "video" | "audio") =>
  Object.fromEntries(
    [...stage.querySelectorAll<HTMLMediaElement>(tag)]
      .filter((el) => el.getAttribute("src") && (tag === "audio" || el.style.visibility === "visible"))
      .map((el) => [decodeURIComponent(el.getAttribute("src")!).split("/").pop(), el.currentTime]),
  );
const heard = (stage: HTMLElement) =>
  [...stage.querySelectorAll<HTMLMediaElement>("video, audio")]
    .filter(
      (el) => el.getAttribute("src") && !el.muted && (el.tagName === "AUDIO" || el.style.visibility === "visible"),
    )
    .map((el) => decodeURIComponent(el.getAttribute("src")!).split("/").pop())
    .sort();

function setup() {
  const stage = document.createElement("div");
  document.body.append(stage);
  const player = createPlayer(stage, plan, {
    levels: new Map(),
    tracks: { kamera: 1, "rekorder-a": 2, "rekorder-b": 3 },
  });
  return { stage, player, video: player.video };
}

beforeEach(() => {
  document.body.innerHTML = "";
  // happy-dom spielt nichts ab: `play` und `pause` führen nur den Zustand.
  const paused = new WeakMap<object, boolean>();
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get() {
      return paused.get(this) ?? true;
    },
  });
  HTMLMediaElement.prototype.play = function () {
    paused.set(this, false);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    paused.set(this, true);
  };
});

describe("Wiedergabe aus den Originalen", () => {
  it("gibt sich dem Viewer als Video mit der Länge der Montage", () => {
    const { video } = setup();
    expect(video.duration).toBe(420);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(0);
    expect(video.readyState).toBe(4);
  });

  it.each`
    stelle | bild              | ton
    ${30}  | ${{}}             | ${{}}
    ${90}  | ${{ kamera: 50 }} | ${{ "rekorder-a": 30, "rekorder-b": 120 }}
    ${380} | ${{}}             | ${{ "rekorder-b": 410 }}
  `("legt bei $stelle s die Originale an ihre Stelle", ({ stelle, bild, ton }) => {
    const { stage, video } = setup();
    // Wenn: der Viewer an die Stelle springt
    const seen: string[] = [];
    for (const n of ["seeking", "seeked", "timeupdate"]) video.addEventListener(n, () => seen.push(n));
    video.currentTime = stelle as number;
    // Dann: stehen Bild und Ton der Originale dort, wo sie im Montagevideo stünden
    expect(placed(stage, "video")).toEqual(bild);
    expect(placed(stage, "audio")).toEqual(ton);
    // Dann: Der Viewer erfährt den Sprung wie bei einem Video
    expect(seen).toEqual(["seeking", "seeked", "timeupdate"]);
  });

  it("spielt und hält die Originale zusammen mit der Montage an", async () => {
    const { stage, video, player } = setup();
    video.currentTime = 90;
    const running = () =>
      [...stage.querySelectorAll<HTMLMediaElement>("video, audio")].filter((el) => !el.paused).length;
    // Wenn: abgespielt wird, dann laufen Kamera und beide Rekorder
    const events: string[] = [];
    for (const n of ["play", "playing", "pause"]) video.addEventListener(n, () => events.push(n));
    await video.play();
    expect(video.paused).toBe(false);
    expect(running()).toBe(3);
    // Wenn: der Schritt verlassen wird (Rahmen ruft `pause`), dann steht alles
    player.pause();
    expect(video.paused).toBe(true);
    expect(running()).toBe(0);
    expect(events).toEqual(["play", "playing", "pause"]);
  });

  it("lässt bei „nur diese Spur“ die anderen Geräte verstummen", () => {
    const { stage, video, player } = setup();
    video.currentTime = 90;
    expect(heard(stage)).toEqual(["kamera", "rekorder-a", "rekorder-b"]);
    // Wenn: nur Spur 2 (Rekorder A) gewählt ist
    player.mix([2]);
    expect(heard(stage)).toEqual(["rekorder-a"]);
    // Wenn: wieder die Mischung, dann sind alle zu hören; „Ton aus“ gilt für alle
    player.mix(null);
    expect(heard(stage)).toEqual(["kamera", "rekorder-a", "rekorder-b"]);
    video.muted = true;
    expect(heard(stage)).toEqual([]);
  });

  it("gibt Tempo und Lautstärke an die Originale weiter", () => {
    const { stage, video } = setup();
    video.currentTime = 90;
    const changed = vi.fn();
    video.addEventListener("ratechange", changed);
    video.playbackRate = 1.5;
    video.volume = 0.4;
    const kamera = stage.querySelector<HTMLVideoElement>("video")!;
    expect(kamera.playbackRate).toBe(1.5);
    expect(kamera.volume).toBe(0.4);
    expect(changed).toHaveBeenCalledOnce();
  });
});
