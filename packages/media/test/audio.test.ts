/**
 * Rechenkern der Tonspur-Analyse (`packages/media/src/audio.ts`): Leerlauf, Klatscher und Versatz zweier Aufnahmen, an
 * von Hand gebauten Hüllkurven, ohne Dateien und ohne ffmpeg.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  DB_FLOOR,
  detectIdle,
  detectTransients,
  estimateOffset,
  packEnvelope,
  unpackEnvelope,
  type Envelope,
} from "../src/audio.ts";

/** Hüllkurve aus Abschnitten bauen: [Sekunden, dB]. */
function env(parts: [number, number][]): Envelope {
  const db: number[] = [];
  for (const [sec, level] of parts) for (let i = 0; i < sec * 100; i++) db.push(level + ((i * 7919) % 13) / 13 - 0.5);
  return { rate: 100, db: Float32Array.from(db) };
}

function withClap(e: Envelope, atSec: number): Envelope {
  const db = Float32Array.from(e.db);
  const i = Math.round(atSec * 100);
  [-10, -14, -22, -30, -38, -44].forEach((v, k) => (db[i + k] = v));
  return { rate: e.rate, db };
}

/** Pseudozufälliges Sprechmuster, damit die Korrelation eine eindeutige Spitze hat. */
function talk(seconds: number, seed: number): Envelope {
  const db: number[] = [];
  let x = seed;
  let level = -55;
  for (let i = 0; i < seconds * 100; i++) {
    if (i % 25 === 0) {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      level = x % 3 === 0 ? -55 : -30 + (x % 10);
    }
    db.push(level);
  }
  return { rate: 100, db: Float32Array.from(db) };
}

describe("Leerlauf", () => {
  it("findet lange Stille und meldet laute Stellen darin", () => {
    // Angenommen: 1 Min. Gespräch, 10 Min. Stille mit einem Klatschen bei 5:00, 1 Min. Gespräch
    const e = withClap(
      env([
        [60, -25],
        [600, -55],
        [60, -25],
      ]),
      300,
    );
    // Wenn: Leerlauf gesucht wird
    const r = detectIdle(e);
    // Dann: ein Leerlauf von etwa 1:00 bis 11:00, das Klatschen darin wird gemeldet
    expect(r.idle).toHaveLength(1);
    expect(r.idle[0]!.startMs).toBeGreaterThanOrEqual(60_000);
    expect(r.idle[0]!.startMs).toBeLessThanOrEqual(65_000);
    expect(r.idle[0]!.endMs).toBeGreaterThanOrEqual(655_000);
    expect(r.idle[0]!.endMs).toBeLessThanOrEqual(660_000);
    expect(r.loudInIdle.map((l) => l.atMs)).toEqual([300_000]);
  });

  it("kurze Stille ist kein Leerlauf", () => {
    // Zwei Minuten Stille zwischen Gesprächen sind zu kurz
    expect(
      detectIdle(
        env([
          [60, -25],
          [120, -55],
          [60, -25],
        ]),
      ).idle,
    ).toEqual([]);
  });
});

describe("Sync-Signale", () => {
  it("erkennt Klatschen, aber nicht gleichmäßiges Sprechen", () => {
    // Angenommen: 30 s Stille mit Klatschen bei 0:10, danach 30 s gleichmäßiges Sprechen
    const e = withClap(
      env([
        [30, -55],
        [30, -25],
      ]),
      10,
    );
    // Dann: nur das Klatschen gilt als Sync-Signal
    expect(detectTransients(e).map((t) => t.atMs)).toEqual([10_000]);
  });
});

describe("Tonspur-Vergleich", () => {
  it("findet den Versatz zweier Aufnahmen desselben Gesprächs", () => {
    // Angenommen: ein 5-Min.-Gespräch auf Gerät A
    const a = talk(300, 42);
    // B beginnt 73,4 s nach A und ist 60 s lang, etwas leiser.
    const b: Envelope = { rate: 100, db: a.db.slice(7340, 13340).map((v) => v - 6) };
    // Wenn: B gegen A verglichen wird
    const r = estimateOffset(a, b)!;
    // Dann: 73,4 s Versatz auf 10 ms genau, mit deutlicher Spitze
    expect(r.lagMs).toBeGreaterThanOrEqual(73_390);
    expect(r.lagMs).toBeLessThanOrEqual(73_410);
    expect(r.distinctness).toBeGreaterThan(1.5);
  });

  it("sucht bei bekannter Erwartung nur im Fenster", () => {
    // Angenommen: B beginnt 200 s nach A
    const a = talk(300, 7);
    const b: Envelope = { rate: 100, db: a.db.slice(20_000, 26_000) };
    // Dann: mit Erwartung 190 s ± 30 s findet der Vergleich 200 s
    expect(estimateOffset(a, b, { expectedLagMs: 190_000, searchMs: 30_000 })!.lagMs).toBe(200_000);
  });
});

it("Hüllkurve packen und entpacken verliert höchstens 0,2 dB, Stille bleibt Stille", () => {
  const e = env([[2, -37.3]]);
  const back = unpackEnvelope(packEnvelope(e));
  for (let i = 0; i < e.db.length; i++) expect(Math.abs(back.db[i]! - e.db[i]!)).toBeLessThanOrEqual(0.21);
  expect(unpackEnvelope(packEnvelope({ rate: 100, db: Float32Array.of(DB_FLOOR) })).db[0]).toBe(DB_FLOOR);
});
