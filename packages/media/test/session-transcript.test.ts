import { ProjectStore } from "@feldspur/core";
import { describe, expect, it } from "vite-plus/test";
import { buildSessionTranscript } from "../src/session-transcript.ts";

const sha = (n: number) => n.toString(16).padStart(64, "0");
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 8, 14, h, m, s);

describe("Einsatztranskript nach Episoden", () => {
  it("ordnet Zeilen an derselben Stelle (Zwischentafel) nach Uhrzeit, nicht nach Art (Issue #153)", () => {
    // Angenommen: ein Tagebucheintrag um 10:05 und ein Foto um 10:10, beide vor der ersten Aufnahme um 10:15
    const store = ProjectStore.open(":memory:");
    const sessionId = store.addSession({ title: "Test", date: "2026-09-14" }).id;
    const device = store.addDevice({ sessionId, label: "Rekorder" });
    const base = { sessionId, deviceId: device.id, originalPath: "/x", sizeBytes: 1, metadata: {} };
    const audio = store.addSource({ ...base, kind: "audio", fileName: "REC.m4a", sha256: sha(1), durationMs: 600_000 });
    const photo = store.addSource({ ...base, kind: "photo", fileName: "IMG.jpg", sha256: sha(2), durationMs: null });
    const page = store.addSource({ ...base, kind: "diary", fileName: "S01.jpg", sha256: sha(3), durationMs: null });
    const ev = { kind: "metadata" as const, clock: "device" as const, uncertaintyMs: 1000, detail: "Metadaten" };
    store.addEvidence({ ...ev, sourceId: audio.id, localMs: at(10, 15) });
    store.addEvidence({ ...ev, sourceId: photo.id, localMs: at(10, 10) });
    // Notiert vor dem Foto: Beides fällt auf die Zwischentafel vor der ersten Aufnahme.
    store.addDiaryEntry({
      sessionId,
      regions: [{ sourceId: page.id, page: 0, x: 0, y: 0, w: 1, h: 1 }],
      notedAtMs: at(10, 5),
      mode: "short",
      shortText: "Ankunft",
    });
    // Wenn: das Einsatztranskript nach Episoden gebaut wird
    const t = buildSessionTranscript(store, sessionId, { mode: "episodes" });
    // Dann: stehen beide auf der Zwischentafel, der frühere Eintrag zuerst
    const kinds = t.entries.filter((e) => e.montageMs === 0).map((e) => e.kind);
    expect(kinds[0]).toBe("card");
    expect(kinds.indexOf("diary")).toBeLessThan(kinds.indexOf("photo"));
    store.close();
  });
});
