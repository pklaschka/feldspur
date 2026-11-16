import { describe, expect, it } from "vite-plus/test";
import { computeEpisodes } from "../src/episodes.ts";
import type { Source } from "../src/model.ts";
import type { ResolveResult } from "../src/resolve.ts";

const MIN = 60_000;
const audio = { id: "a", kind: "audio" } as Source;
// Aufnahme 10:00–11:00 (hier 0–60 Min.), Stille von Minute 10 bis 50.
const resolved = {
  placements: new Map([["a", { startMs: 0, endMs: 60 * MIN }]]),
  diary: new Map(),
} as unknown as ResolveResult;
const idle = new Map([["a", [{ startMs: 10 * MIN, endMs: 50 * MIN }]]]);
const spans = (r: ReturnType<typeof computeEpisodes>) => r.episodes.map((e) => [e.startMs / MIN, e.endMs / MIN]);

describe("Episoden von Hand", () => {
  it("ohne Anpassung zwei Episoden um die Stille", () => {
    const r = computeEpisodes([audio], resolved, idle, { padMs: 0 });
    expect(spans(r)).toEqual([
      [0, 10],
      [50, 60],
    ]);
  });

  it("Mini-Episode in der Stille", () => {
    const r = computeEpisodes([audio], resolved, idle, {
      padMs: 0,
      edits: [{ sourceId: "a", fromMs: 30 * MIN, toMs: 31 * MIN, mode: "include" }],
    });
    expect(spans(r)).toEqual([
      [0, 10],
      [30, 31],
      [50, 60],
    ]);
  });

  it("Grenze nach innen und nach außen", () => {
    const r = computeEpisodes([audio], resolved, idle, {
      padMs: 0,
      edits: [
        { sourceId: "a", fromMs: 8 * MIN, toMs: 10 * MIN, mode: "exclude" },
        { sourceId: "a", fromMs: 48 * MIN, toMs: 50 * MIN, mode: "include" },
      ],
    });
    expect(spans(r)).toEqual([
      [0, 8],
      [48, 60],
    ]);
  });

  it("spätere Anpassung gilt: erst heraus, dann wieder hinein", () => {
    const r = computeEpisodes([audio], resolved, idle, {
      padMs: 0,
      edits: [
        { sourceId: "a", fromMs: 5 * MIN, toMs: 10 * MIN, mode: "exclude" },
        { sourceId: "a", fromMs: 5 * MIN, toMs: 7 * MIN, mode: "include" },
      ],
    });
    expect(spans(r)[0]).toEqual([0, 7]);
  });
});
