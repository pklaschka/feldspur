/**
 * Abgleich mit dem erfundenen Testpaket (Markttag 14.09.2026), das außerhalb
 * des Repositorys liegt. Läuft nur, wenn FELDSPUR_TESTPAKET auf den Ordner
 * `1_Rohquellen` zeigt:
 *
 *   FELDSPUR_TESTPAKET=/pfad/1_Rohquellen pnpm test
 *
 * Erwartete Werte stammen aus dem Begleitprotokoll des Pakets.
 */
import { existsSync } from "node:fs";
import { formatClock, localMs, ProjectStore, resolveTimeline } from "@feldspur/core";
import { describe, expect, it } from "vite-plus/test";
import { applyImport, scanPaths } from "../src/import.ts";

const dir = process.env.FELDSPUR_TESTPAKET;

describe.skipIf(!dir || !existsSync(dir))("Testpaket Markttag", () => {
  it("ordnet alle Quellen wie im Begleitprotokoll ein", async () => {
    const plan = await scanPaths([dir!]);
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Testmarkt", date: "2026-09-14" });
    const { sources } = applyImport(store, session.id, plan);
    const src = (n: string) => sources.find((s) => s.fileName === n)!;

    expect(src("ZOOM0004.m4a").sha256).toBe("1d4aa2011a2e5b54774409ea1c1bd432e4d366a2a848d52749a1a8074b64ed8f");
    expect(src("C0012.MP4").sha256).toBe("7f5b5af0b4b034c1e0821b60ca049d0dcfc298654479f53b71b6aad4c2e82bdb");

    store.setReferenceDevice(src("ZOOM0004.m4a").deviceId!);
    store.updateDevice(src("IMG_0231.jpg").deviceId!, {
      clockOffsetMs: 4_000,
      clockOffsetUncertaintyMs: 1_000,
      offsetBasis: "manual",
    });
    // Klatschen um 10:16:20: Audio bei 1:20, Clip 1 bei 0:20.
    store.addAnchor({
      sessionId: session.id,
      kind: "clap",
      a: { sourceId: src("ZOOM0004.m4a").id, atMediaMs: 80_000 },
      b: { sourceId: src("C0012.MP4").id, atMediaMs: 20_000 },
    });
    const T = (h: number, m: number) => localMs(2026, 9, 14, h, m);
    store.addDiaryEntry({
      sessionId: session.id,
      regions: [{ sourceId: src("Tagebuch_S01.jpg").id }],
      notedAtMs: T(10, 12),
      lookbackMs: 7 * 60_000,
    });
    store.addDiaryEntry({
      sessionId: session.id,
      regions: [{ sourceId: src("Tagebuch_S02.jpg").id }],
      notedAtMs: T(10, 25),
      lookbackMs: 8 * 60_000,
    });

    const tl = resolveTimeline(store.loadResolveInput(session.id));
    const at = (n: string) => formatClock(tl.placements.get(src(n).id)!.startMs);
    expect({
      "T-01": at("Tagebuch_S01.jpg"),
      "F-001": at("IMG_0231.jpg"),
      "A-01": at("ZOOM0004.m4a"),
      "V-01": at("C0012.MP4"),
      "F-002": at("IMG_0232.jpg"),
      "T-02": at("Tagebuch_S02.jpg"),
      "V-02": at("C0013.MP4"),
      "F-003": at("IMG_20260914_104050.jpg"),
    }).toEqual({
      "T-01": "10:05:00",
      "F-001": "10:12:30",
      "A-01": "10:15:00",
      "V-01": "10:16:00",
      "F-002": "10:16:45",
      "T-02": "10:17:00",
      "V-02": "10:40:10",
      "F-003": "10:40:50",
    });
    store.close();
  });
});
