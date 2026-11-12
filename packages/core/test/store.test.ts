import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ProjectStore, SCHEMA_VERSION } from "../src/db/store.ts";
import { resolveTimeline } from "../src/resolve.ts";
import { formatClock } from "../src/time.ts";
import { T } from "./scenario.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha = (n: number) => n.toString(16).padStart(64, "0");

function seed(store: ProjectStore) {
  const session = store.addSession({ title: "Testmarkt", date: "2026-09-14", place: "Testmarkt", extra: { doi: "" } });
  const person = store.addPerson({ name: "Testperson A" });
  const zoom = store.addDevice({
    sessionId: session.id,
    label: "Diktiergerät",
    personId: person.id,
    isReference: true,
    offsetBasis: "reference",
  });
  const cam = store.addDevice({ sessionId: session.id, label: "Kamera A", personId: person.id });
  const base = { sessionId: session.id, originalPath: "/x", sizeBytes: 1, metadata: {} };
  const audio = store.addSource({
    ...base,
    deviceId: zoom.id,
    kind: "audio",
    fileName: "ZOOM0004.m4a",
    sha256: sha(1),
    durationMs: 1_590_000,
  });
  const video = store.addSource({
    ...base,
    deviceId: cam.id,
    kind: "video",
    fileName: "C0012.MP4",
    sha256: sha(2),
    durationMs: 60_000,
  });
  store.addEvidence({
    sourceId: audio.id,
    kind: "metadata",
    clock: "device",
    localMs: T(10, 15),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  store.addEvidence({
    sourceId: video.id,
    kind: "metadata",
    clock: "device",
    localMs: T(10, 18, 47),
    uncertaintyMs: 1000,
    detail: "Metadaten",
  });
  store.addAnchor({
    sessionId: session.id,
    kind: "clap",
    a: { sourceId: audio.id, atMediaMs: 80_000 },
    b: { sourceId: video.id, atMediaMs: 20_000 },
  });
  const page = store.addSource({
    ...base,
    deviceId: null,
    kind: "diary",
    fileName: "Tagebuch_S01.jpg",
    sha256: sha(3),
    durationMs: null,
  });
  store.addDiaryEntry({
    sessionId: session.id,
    regions: [{ sourceId: page.id }],
    notedAtMs: T(10, 12),
    lookbackMs: 7 * 60_000,
    mode: "short",
    shortText: "Ankunft",
  });
  return { session, zoom, cam, audio, video, page };
}

describe("Projektdatei", () => {
  it("speichert alles und liest es nach dem Wiederöffnen gleich zurück", () => {
    const file = join(dir, "test.feldspur");
    const store = ProjectStore.create(file, { name: "Markt" });
    const { session, audio, video, page } = seed(store);
    store.close();

    const again = ProjectStore.open(file);
    expect(again.getMeta("name")).toBe("Markt");
    expect(again.getMeta("format")).toBe("feldspur-project");
    const input = again.loadResolveInput(session.id);
    expect(input.sources.map((s) => s.label)).toEqual(["A-01", "T-01", "V-01"]);
    expect(input.session.extra).toEqual({ doi: "" });
    expect(input.diaryEntries[0]!.regions[0]).toEqual({ sourceId: page.id, x: 0, y: 0, w: 1, h: 1 });
    const res = resolveTimeline(input);
    expect(formatClock(res.placements.get(video.id)!.startMs)).toBe("10:16:00");
    expect(formatClock(res.placements.get(audio.id)!.startMs)).toBe("10:15:00");
    expect(formatClock(res.placements.get(page.id)!.startMs)).toBe("10:05:00");
    again.close();
  });

  it("vergibt Kurzzeichen fortlaufend pro Art", () => {
    const store = ProjectStore.open(":memory:");
    const { session } = seed(store);
    expect(store.nextLabel(session.id, "video")).toBe("V-02");
    expect(store.nextLabel(session.id, "photo")).toBe("F-001");
    store.close();
  });

  it("lehnt dieselbe Datei zweimal im Einsatz ab", () => {
    const store = ProjectStore.open(":memory:");
    const { session } = seed(store);
    expect(() =>
      store.addSource({
        sessionId: session.id,
        deviceId: null,
        kind: "audio",
        fileName: "kopie.m4a",
        originalPath: "/y",
        sizeBytes: 1,
        sha256: sha(1),
        durationMs: 1,
      }),
    ).toThrow();
    store.close();
  });

  it("es gibt höchstens eine Referenzuhr pro Einsatz", () => {
    const store = ProjectStore.open(":memory:");
    const { session, zoom, cam } = seed(store);
    store.setReferenceDevice(cam.id);
    const devs = store.listDevices(session.id);
    expect(devs.find((d) => d.id === cam.id)!.isReference).toBe(true);
    expect(devs.find((d) => d.id === zoom.id)!.isReference).toBe(false);
    store.close();
  });

  it("prüft Eingaben mit dem Schema", () => {
    const store = ProjectStore.open(":memory:");
    expect(() => store.addSession({ title: "", date: "2026-09-14" })).toThrow();
    expect(() => store.addSession({ title: "x", date: "14.09.2026" })).toThrow();
    store.close();
  });

  it("öffnet keine Datei aus einer neueren Version", () => {
    const file = join(dir, "neu.feldspur");
    const db = new Database(file);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => ProjectStore.open(file)).toThrow(/neueren Feldspur-Version/);
  });

  it("create überschreibt kein bestehendes Projekt", () => {
    const file = join(dir, "a.feldspur");
    ProjectStore.create(file, { name: "A" }).close();
    expect(() => ProjectStore.create(file, { name: "B" })).toThrow(/schon ein Feldspur-Projekt/);
  });
});
