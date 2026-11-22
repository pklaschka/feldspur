// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import type { SessionView } from "../src/shared/api.ts";
import { settledMoves } from "../src/renderer/Sync.tsx";

/** Nur, was `settledMoves` liest: Geräte mit Abweichung, Quellen mit Gerät, Anker mit beiden Enden. */
function stand(
  offsets: Record<string, number | null>,
  anchors: { id: string; a: string; b: string }[] = [],
): SessionView {
  return {
    devices: Object.entries(offsets).map(([id, offsetMs]) => ({ id, offsetMs, isReference: id === "zoom" })),
    rows: [
      { id: "a01", deviceId: "zoom" },
      { id: "v01", deviceId: "kamera" },
      { id: "f01", deviceId: "handy" },
    ],
    anchors: anchors.map((x) => ({ id: x.id, a: { sourceId: x.a, atMs: 0 }, b: { sourceId: x.b, atMs: 0 } })),
  } as unknown as SessionView;
}

describe("Uhren, die an ihren Platz rücken", () => {
  it("ein übernommener Vorschlag rückt die Uhr von „unbekannt“ an ihren Platz, mit seinem Anker als Beleg", () => {
    const vorher = stand({ zoom: 0, kamera: null, handy: 4000 });
    const nachher = stand({ zoom: 0, kamera: 167_000, handy: 4000 }, [{ id: "k1", a: "a01", b: "v01" }]);
    expect([...settledMoves(vorher, nachher)]).toEqual([["kamera", { fromMs: null, anchorId: "k1" }]]);
  });

  it("beim gesammelten Übernehmen rücken alle Uhren zugleich", () => {
    const vorher = stand({ zoom: 0, kamera: null, handy: null });
    const nachher = stand({ zoom: 0, kamera: 167_000, handy: 4000 }, [
      { id: "k1", a: "a01", b: "v01" },
      { id: "k2", a: "a01", b: "f01" },
    ]);
    expect(settledMoves(vorher, nachher).get("handy")).toEqual({ fromMs: null, anchorId: "k2" });
    expect(settledMoves(vorher, nachher).size).toBe(2);
  });

  it("eine schon abgeglichene Uhr rückt von ihrer bisherigen Abweichung aus", () => {
    const vorher = stand({ zoom: 0, kamera: 160_000, handy: 4000 }, [{ id: "k1", a: "a01", b: "v01" }]);
    const nachher = stand({ zoom: 0, kamera: 167_000, handy: 4000 }, [{ id: "k1", a: "a01", b: "v01" }]);
    // Kein neuer Anker: Die Uhr rückt, aber ohne Beleg darunter.
    expect([...settledMoves(vorher, nachher)]).toEqual([["kamera", { fromMs: 160_000, anchorId: null }]]);
  });

  it("Uhren, die stehen bleiben oder unbekannt werden, rücken nicht", () => {
    const vorher = stand({ zoom: 0, kamera: 167_000, handy: 4000 });
    const nachher = stand({ zoom: 0, kamera: null, handy: 4000 });
    expect(settledMoves(vorher, nachher).size).toBe(0);
  });
});
