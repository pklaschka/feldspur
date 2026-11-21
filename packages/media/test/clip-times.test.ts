import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLocal, localMs, ProjectStore, resolveTimeline } from "@feldspur/core";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  creationTimeMeans,
  deviceWritesEnd,
  END_STAMP_UNCERTAINTY_MS,
  refineClipTimes,
  formatOffset,
  timecodeFrames,
  timecodeGroups,
  timecodeOffset,
} from "../src/clip-times.ts";
import { evidenceFromFilename, evidenceFromMediaTags } from "../src/evidence.ts";
import { applyImport, applyReread, scanPaths, stampsLookLocal, type ImportCandidate } from "../src/import.ts";
import type { MediaProbe } from "../src/probe.ts";
import { ff, hasFfmpeg } from "./fixtures.ts";

// Erfundene Aufnahmen nach dem Muster eines Pixel-Handys: Name = Beginn in UTC, creation_time = Ende (+ ~2 s).
const probe = (durationMs: number, tags: Record<string, string>, extra: Partial<MediaProbe> = {}): MediaProbe => ({
  durationMs,
  hasVideo: true,
  hasAudio: true,
  tags,
  formatName: "mov,mp4",
  ...extra,
});

function cand(fileName: string, p: MediaProbe, deviceKey = "model:pixel"): ImportCandidate {
  return {
    path: `/feld/${fileName}`,
    fileName,
    sizeBytes: 1,
    sha256: createHash("sha256").update(fileName).digest("hex"),
    kind: "video",
    durationMs: p.durationMs,
    metadata: { media: p },
    deviceKey,
    deviceLabel: "Testhandy",
    evidence: [...evidenceFromMediaTags(p), ...evidenceFromFilename(fileName)],
    warnings: [],
  };
}

const pixel = () => [
  cand("PXL_20260914_081441849.mp4", probe(177_040, { creation_time: "2026-09-14T08:17:41.000000Z" })),
  cand("PXL_20260914_081905477.mp4", probe(46_642, { creation_time: "2026-09-14T08:19:55.000000Z" })),
  cand("PXL_20260914_082301120.mp4", probe(8_200, { creation_time: "2026-09-14T08:23:11.000000Z" })),
];

const ct = (c: ImportCandidate) => c.evidence.find((e) => e.raw.startsWith("creation_time="))!;

describe("creation_time: Beginn oder Ende?", () => {
  it("erkennt das Ende, wenn Dateiname + Länge zum Stempel passen", () => {
    const [a, b, short] = pixel();
    expect(creationTimeMeans(a!)).toBe("end");
    expect(creationTimeMeans(b!)).toBe("end");
    // Kurz, aber Name und Stempel tragen UTC: Die enge Probe entscheidet (Issue #151).
    expect(creationTimeMeans(short!)).toBe("end");
  });

  it("liest alle Clips des Geräts als Ende, auch die kurzen", () => {
    const out = refineClipTimes(pixel());
    for (const c of out) {
      expect(ct(c).atMediaMs).toBe(c.durationMs);
      expect(ct(c).uncertaintyMs).toBe(END_STAMP_UNCERTAINTY_MS);
      expect(ct(c).detail).toMatch(/Aufnahmeende/);
    }
  });

  it("lässt Geräte, die den Beginn schreiben, unverändert", () => {
    const cs = [
      cand("VID_20260914_101441.mp4", probe(177_000, { creation_time: "2026-09-14T08:14:42.000000Z" }), "x"),
      cand("VID_20260914_101905.mp4", probe(46_000, { creation_time: "2026-09-14T08:19:05.000000Z" }), "x"),
    ];
    // Name in Ortszeit, Stempel in UTC: zwei Stunden dazwischen, trotzdem als Beginn erkannt.
    expect(creationTimeMeans(cs[0]!)).toBe("start");
    expect(refineClipTimes(cs).map((c) => ct(c).atMediaMs)).toEqual([0, 0]);
  });

  it("ohne Uhrzeit im Namen: Überlappung verrät das Ende", () => {
    const cs = [
      cand("CLIP0001.mp4", probe(177_000, { creation_time: "2026-09-14T08:17:41.000000Z" }), "y"),
      cand("CLIP0002.mp4", probe(46_000, { creation_time: "2026-09-14T08:19:55.000000Z" }), "y"),
    ];
    expect(deviceWritesEnd(cs)).toBe(true);
    // Ohne Überlappung bleibt es beim Beginn: kein Anlass, etwas anderes anzunehmen.
    const apart = [
      cand("CLIP0003.mp4", probe(60_000, { creation_time: "2026-09-14T08:00:00.000000Z" }), "z"),
      cand("CLIP0004.mp4", probe(60_000, { creation_time: "2026-09-14T08:05:00.000000Z" }), "z"),
    ];
    expect(deviceWritesEnd(apart)).toBe(false);
  });

  it("Pixel: Name in UTC, kein Ortszeit-Gerät, keine Überlappung, kein Widerspruch", () => {
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "Europe/Berlin" });
    const plan = pixel();
    expect(stampsLookLocal(refineClipTimes(plan), "Europe/Berlin")).toBe(false);
    const res = applyImport(store, session.id, plan);
    expect(res.devicesCreated[0]!.timestampsAreUtc).toBe(true);
    const r = resolveTimeline(store.loadResolveInput(session.id));
    const [a, b, c] = res.sources.map((s) => r.placements.get(s.id)!);
    // Sommerzeit: 08:14:41 UTC = 10:14:41 Ortszeit, auf die Millisekunde aus dem Namen.
    expect(formatLocal(a!.startMs)).toBe("2026-09-14T10:14:41.849");
    expect(a!.endMs!).toBeLessThan(b!.startMs);
    expect(b!.endMs!).toBeLessThan(c!.startMs);
    for (const p of [a, b, c]) {
      expect(p!.basis.kind).toBe("filename");
      expect(p!.conflicts).toEqual([]);
    }
    store.close();
  });
});

describe("Kamera-XML", () => {
  it("liest den Aufnahmebeginn mit Zeitzone der Kamera", () => {
    const xml =
      '<?xml version="1.0"?>\n<ClipMain><ClipContent><ClipMetadata><Access><CreationDate>2026-09-14T10:18:27+01:00</CreationDate></Access>' +
      "<Shoot><StartDate>2026-09-14T10:18:27+01:00</StartDate><EndDate>2026-09-14T10:19:26+01:00</EndDate></Shoot></ClipMetadata></ClipContent></ClipMain>";
    const ev = evidenceFromMediaTags(
      probe(59_040, { "com.panasonic.semi-pro.metadata.xml": xml, creation_time: "2026-09-14T09:18:27.000000Z" }),
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toBe("Metadaten (Aufnahmebeginn, Kamera-XML, Zeitzone der Kamera +01:00)");
    expect(formatLocal(ev[0]!.localMs)).toBe("2026-09-14T10:18:27");
    expect(new Date(ev[0]!.utcMs!).toISOString()).toBe("2026-09-14T09:18:27.000Z");
  });
});

describe("Kamera-Timecode", () => {
  it("rechnet Timecode in Bilder um, auch bei 29,97", () => {
    expect(timecodeFrames("10:34:39:08", 50)).toBe((10 * 3600 + 34 * 60 + 39) * 50 + 8);
    expect(timecodeFrames("10:34:39:50", 50)).toBeNull();
    expect(timecodeFrames("10:34:39;08", 30)).toBeNull(); // Drop-Frame: nicht unterstützt
  });

  it("schätzt den Abstand zur Uhr aus mehreren Clips enger als eine Sekunde", () => {
    // Echter Abstand 0:16:12.37; die Uhr schneidet auf ganze Sekunden ab.
    const true_ = -(16 * 60 + 12) * 1000 - 370;
    const clip = (tcMs: number) => ({ clockMs: Math.floor((tcMs + true_) / 1000) * 1000, tcMs, frameMs: 20 });
    const one = timecodeOffset([clip(38_079_160)]);
    expect(one).toBeNull();
    const off = timecodeOffset([clip(38_079_160), clip(38_200_540), clip(38_350_900), clip(39_000_020)])!;
    expect(Math.abs(off.offsetMs - true_)).toBeLessThanOrEqual(off.uncertaintyMs);
    expect(off.uncertaintyMs).toBeLessThan(250);
  });

  it("verträgt Uhren, die etwas mehr als eine Sekunde streuen, und einen neu gesetzten Timecode", () => {
    // Erfundene Werte nach dem Muster einer echten Kamera: Abstand ≈ −1:16:12, Streuung gut 1,1 s.
    const at = (tc: string, clock: string) => {
      const [h, m, s, f] = tc.split(":").map(Number) as [number, number, number, number];
      const [H, M, S] = clock.split(":").map(Number) as [number, number, number];
      return { tcMs: ((h * 60 + m) * 60 + s) * 1000 + f * 20, clockMs: ((H * 60 + M) * 60 + S) * 1000, frameMs: 20 };
    };
    const day = [
      at("10:34:39:08", "09:18:27"),
      at("10:36:05:28", "09:19:53"),
      at("10:38:37:46", "09:22:26"),
      at("12:41:48:04", "11:25:36"),
      at("12:44:10:38", "11:27:58"),
      at("12:48:55:40", "11:32:43"),
      at("13:57:13:02", "12:41:00"),
      // Danach neu gesetzt: eigener Abschnitt.
      at("00:00:10:00", "13:00:00"),
      at("00:05:10:10", "13:05:00"),
      // Einzelner Ausreißer ohne Partner.
      at("05:00:00:00", "14:00:00"),
    ];
    const groups = timecodeGroups(day);
    expect(groups).toEqual([
      [0, 1, 2, 3, 4, 5, 6],
      [7, 8],
    ]);
    const off = timecodeOffset(groups[0]!.map((i) => day[i]!))!;
    expect(off.uncertaintyMs).toBeLessThanOrEqual(150);
    expect(Math.abs(off.offsetMs - -4_572_000)).toBeLessThan(200);
  });

  it("verwirft Timecode, der nur während der Aufnahme läuft", () => {
    // Rec Run: jeder Clip setzt den Zähler dort fort, wo der letzte aufhörte; der Abstand wächst mit jeder Pause.
    expect(
      timecodeOffset([
        { clockMs: 1_000_000, tcMs: 0, frameMs: 20 },
        { clockMs: 1_300_000, tcMs: 60_000, frameMs: 20 },
      ]),
    ).toBeNull();
  });

  const dir = mkdtempSync(join(tmpdir(), "feldspur-timecode-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!hasFfmpeg())("ordnet Clips einer Kamera mit freilaufendem Timecode bildgenau ein", async () => {
    // Uhr 10:18:27,4 / 10:25:03,9 / 10:40:12,62; Timecode läuft 0:16:12,16 vor.
    const clips = [
      ["P001C001.MOV", "2026-09-14T09:18:27Z", "10:34:39:28"],
      ["P001C002.MOV", "2026-09-14T09:25:03Z", "10:41:16:03"],
      ["P001C003.MOV", "2026-09-14T09:40:12Z", "10:56:24:39"],
    ] as const;
    for (const [name, created, tc] of clips) {
      const xml = `<ClipMain><Device><Manufacturer>Test</Manufacturer><ModelName>X-1</ModelName></Device><Shoot><StartDate>${created.replace("Z", "+00:00")}</StartDate></Shoot></ClipMain>`;
      ff(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x36:rate=50:duration=1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-timecode",
        tc,
        "-metadata",
        `creation_time=${created}`,
        "-movflags",
        "use_metadata_tags",
        "-metadata",
        `com.panasonic.Semi-Pro.metadata.xml=${xml}`,
        join(dir, name),
      );
    }
    const plan = await scanPaths([dir]);
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "UTC" });
    const res = applyImport(store, session.id, plan);
    const r = resolveTimeline(store.loadResolveInput(session.id));
    const starts = res.sources
      .toSorted((a, b) => a.fileName.localeCompare(b.fileName))
      .map((s) => r.placements.get(s.id)!);
    for (const p of starts) expect(p.basis.detail).toMatch(/^Kamera-Timecode/);
    const expected = ["09:18:27.400", "09:25:03.900", "09:40:12.620"].map((t) => {
      const [h, m, s] = t.split(":").map(Number) as [number, number, number];
      return localMs(2026, 9, 14, h, m, Math.floor(s), Math.round((s % 1) * 1000));
    });
    starts.forEach((p, i) => expect(Math.abs(p.startMs - expected[i]!)).toBeLessThanOrEqual(200));
    // Untereinander stimmt der Abstand bildgenau.
    expect(starts[1]!.startMs - starts[0]!.startMs).toBe(expected[1]! - expected[0]!);
    store.close();
  });
});

describe("Zeitzone der Kamera", () => {
  it("liest die Uhr wie geschrieben, wenn die Kamera-Zone nicht zum Einsatz passt", () => {
    const xml = (zone: string) =>
      `<ClipMain><Shoot><StartDate>2026-09-14T10:18:27${zone}</StartDate></Shoot></ClipMain>`;
    const at = (zone: string, key: string) =>
      cand(`P012C00${key}.MOV`, probe(59_040, { "x.metadata.xml": xml(zone) }), `cam${key}`);
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "Europe/Berlin" });
    const res = applyImport(store, session.id, [at("+01:00", "1"), at("+02:00", "2")]);
    const utc = Object.fromEntries(res.devicesCreated.map((d) => [d.matchKey, d.timestampsAreUtc]));
    expect(utc).toEqual({ cam1: false, cam2: true });
    const r = resolveTimeline(store.loadResolveInput(session.id));
    // Beide liegen bei 10:18:27, wie die Kameras es anzeigten.
    for (const s of res.sources) expect(formatLocal(r.placements.get(s.id)!.startMs)).toBe("2026-09-14T10:18:27");
    store.close();
  });
});

describe("Zeitbelege neu lesen", () => {
  it("ergänzt Timecode-Belege, lässt Handeingaben und unveränderte Belege in Ruhe", () => {
    const tcProbe = (created: string, tc: string) =>
      probe(1_000, { creation_time: created, timecode: tc }, { frameRate: { num: 50, den: 1 } });
    const fresh = [
      cand("P001C001.MOV", tcProbe("2026-09-14T09:18:27.000000Z", "10:34:39:28"), "cam"),
      cand("P001C002.MOV", tcProbe("2026-09-14T09:25:03.000000Z", "10:41:16:03"), "cam"),
    ];
    // Stand einer älteren Fassung: nur creation_time, keine Bildrate in den Metadaten.
    const old = fresh.map((c) => ({
      ...c,
      metadata: { media: { ...(c.metadata.media as MediaProbe), frameRate: undefined } },
    }));
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "UTC" });
    const res = applyImport(
      store,
      session.id,
      old.map((c) => ({ ...c, metadata: JSON.parse(JSON.stringify(c.metadata)) })),
    );
    const [a] = res.sources;
    const before = store.listEvidence(session.id);
    expect(before.some((e) => e.detail.startsWith("Kamera-Timecode"))).toBe(false);
    const keep = before.find((e) => e.sourceId === a!.id)!;
    store.setEvidenceEnabled(keep.id, false);
    const manual = store.addEvidence({
      sourceId: a!.id,
      kind: "manual",
      clock: "true",
      atMediaMs: 0,
      localMs: localMs(2026, 9, 14, 9, 18, 30),
      uncertaintyMs: 1000,
      detail: "Von Hand",
    });
    const changed = applyReread(
      store,
      session.id,
      res.sources.map((s, i) => ({ source: s, metadata: fresh[i]!.metadata, evidence: fresh[i]!.evidence })),
    );
    expect(changed).toBe(2);
    const after = store.listEvidence(session.id);
    expect(after.filter((e) => e.detail.startsWith("Kamera-Timecode"))).toHaveLength(2);
    expect(after.find((e) => e.id === manual.id)).toBeDefined();
    // Unveränderter Beleg: gleiche Kennung, bleibt ausgeschaltet.
    expect(after.find((e) => e.id === keep.id)?.enabled).toBe(false);
    expect((store.getSource(a!.id).metadata.media as MediaProbe).frameRate).toEqual({ num: 50, den: 1 });
    // Zweites Mal: nichts mehr zu tun.
    const again = res.sources.map((s, i) => ({
      source: store.getSource(s.id),
      metadata: fresh[i]!.metadata,
      evidence: fresh[i]!.evidence,
    }));
    expect(applyReread(store, session.id, again)).toBe(0);
    store.close();
  });
});

describe("RC-Funde v0.3.0", () => {
  const conflictsOf = (store: ProjectStore, sessionId: string) =>
    [...resolveTimeline(store.loadResolveInput(sessionId)).placements.values()].flatMap((p) => p.conflicts);

  it("kurzer Pixel-Clip allein: Stempel als Ende, kein Widerspruch (Issue #151)", () => {
    const c = cand("PXL_20260914_083000789.mp4", probe(15_000, { creation_time: "2026-09-14T08:30:16.000000Z" }));
    expect(creationTimeMeans(c)).toBe("end");
    // Ein kurzer Clip eines Geräts, das den Beginn schreibt, bleibt beim Beginn.
    const start = cand("PXL_20260914_083000789.mp4", probe(15_000, { creation_time: "2026-09-14T08:30:01.000000Z" }));
    expect(creationTimeMeans(start)).toBe("start");
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "Europe/Berlin" });
    const res = applyImport(store, session.id, [c]);
    const p = resolveTimeline(store.loadResolveInput(session.id)).placements.get(res.sources[0]!.id)!;
    expect(formatLocal(p.startMs)).toBe("2026-09-14T10:30:00.789");
    expect(conflictsOf(store, session.id)).toEqual([]);
    store.close();
  });

  it("nach und nach eingesammelt: Aufnahmeende wie beim Einsammeln auf einmal (Issue #150)", () => {
    const parts = [
      cand("Interview_Teil1.mp4", probe(120_000, { creation_time: "2026-09-14T08:42:00.000000Z" }), "renamed"),
      cand("Interview_Teil2.mp4", probe(90_000, { creation_time: "2026-09-14T08:43:35.000000Z" }), "renamed"),
    ];
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "Europe/Berlin" });
    const first = applyImport(store, session.id, [parts[0]!]);
    expect(first.refreshed).toBe(0);
    const second = applyImport(store, session.id, [parts[1]!]);
    // Teil 1 wird nachgezogen: Mit Teil 2 zusammen überlappen sich die Clips nur, wenn der Stempel der Beginn wäre.
    expect(second.refreshed).toBe(1);
    const r = resolveTimeline(store.loadResolveInput(session.id));
    const [a, b] = [first.sources[0]!, second.sources[0]!].map((s) => r.placements.get(s.id)!);
    expect(formatLocal(a!.startMs)).toBe("2026-09-14T10:40:00");
    expect(formatLocal(b!.startMs)).toBe("2026-09-14T10:42:05");
    expect(a!.basis.detail).toMatch(/Aufnahmeende/);
    // Dieselbe Datei noch einmal: Dublette, sie zählt nicht als dritter Clip.
    const again = applyImport(store, session.id, [parts[1]!]);
    expect(again.duplicates).toHaveLength(1);
    expect(again.refreshed).toBe(0);
    store.close();
  });

  it("nach und nach eingesammelt: Kamera-Timecode für alle Clips (Issue #150)", () => {
    const tcProbe = (created: string, tc: string) =>
      probe(60_000, { creation_time: created, timecode: tc }, { frameRate: { num: 50, den: 1 } });
    const clips = [
      cand("P001C001.MOV", tcProbe("2026-09-14T09:18:27.000000Z", "10:34:39:28"), "cam"),
      cand("P001C002.MOV", tcProbe("2026-09-14T09:25:03.000000Z", "10:41:16:03"), "cam"),
      cand("P001C003.MOV", tcProbe("2026-09-14T09:40:12.000000Z", "10:56:24:35"), "cam"),
    ];
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "UTC" });
    for (const c of clips) applyImport(store, session.id, [JSON.parse(JSON.stringify(c)) as ImportCandidate]);
    const tc = store.listEvidence(session.id).filter((e) => e.detail.startsWith("Kamera-Timecode"));
    expect(tc).toHaveLength(3);
    for (const e of tc) expect(e.detail).toMatch(/aus 3 Clips/);
    // Rohwert: Abstand auf den Tag bezogen, nicht Millisekunden seit 1970 (Issue #154).
    for (const e of tc) expect(e.raw).toMatch(/uhr−timecode=−1:16:1\d\.\d$/);
    store.close();
  });

  it("älterer Stand eines Geräts bleibt unberührt, bis „Zeitbelege neu lesen“", () => {
    const old = cand("Interview_Teil1.mp4", probe(120_000, { creation_time: "2026-09-14T08:42:00.000000Z" }), "r");
    const store = ProjectStore.open(":memory:");
    const session = store.addSession({ title: "Test", date: "2026-09-14", timeZone: "Europe/Berlin" });
    // Belege, wie sie eine ältere Fassung gespeichert haben könnte (anderer Wortlaut).
    applyImport(store, session.id, [
      { ...old, evidence: old.evidence.map((e) => ({ ...e, detail: "Metadaten alt" })) },
    ]);
    const next = cand("Interview_Teil2.mp4", probe(90_000, { creation_time: "2026-09-14T08:43:35.000000Z" }), "r");
    expect(applyImport(store, session.id, [next]).refreshed).toBe(0);
    expect(store.listEvidence(session.id).some((e) => e.detail === "Metadaten alt")).toBe(true);
    store.close();
  });

  it("formatiert den Abstand Uhr − Timecode auf den Tag bezogen (Issue #154)", () => {
    const day = 86_400_000;
    expect(formatOffset(-972_160)).toBe("−0:16:12.2");
    expect(formatOffset(Date.UTC(2026, 8, 14) - 972_160)).toBe("−0:16:12.2");
    expect(formatOffset(Date.UTC(2026, 8, 14) + 3_600_000)).toBe("+1:00:00.0");
    expect(formatOffset(day - 59_960)).toBe("−0:01:00.0");
  });
});
