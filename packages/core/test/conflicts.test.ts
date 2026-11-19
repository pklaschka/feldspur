/**
 * Widersprüche zwischen Zeitbelegen: Rundung, Zeitzonen, Geräteabweichung, Entscheidungen.
 * Alle Fälle am erfundenen Testmarkt (14.09.2026, Europe/Berlin).
 */
import { describe, expect, it } from "vite-plus/test";
import type { Decision, Device, TimeEvidence } from "../src/model.ts";
import {
  assessDeviation,
  precisionText,
  resolveTimeline,
  type EvidenceComparison,
  type Placement,
} from "../src/resolve.ts";
import { localMs, localToUtc } from "../src/time.ts";
import { T, testmarkt } from "./scenario.ts";

type Ev = Partial<TimeEvidence> & Pick<TimeEvidence, "id" | "kind" | "localMs">;

/** Ein Foto „P.jpg“ auf einem eigenen Gerät mit den gegebenen Belegen. */
function photo(evs: Ev[], device: Partial<Device> = {}, date = "2026-09-14", timeZone = "Europe/Berlin") {
  const input = testmarkt();
  input.session = { ...input.session, date, timeZone };
  input.devices.push({ ...input.devices[1]!, id: "cam", label: "Kamera Stativ", ...device });
  input.sources.push({ ...input.sources[3]!, id: "P.jpg", label: "F-009", deviceId: "cam" });
  for (const e of evs)
    input.evidence.push({
      sourceId: "P.jpg",
      clock: e.kind === "manual" || e.kind === "spoken" || e.kind === "checked" ? "true" : "device",
      atMediaMs: 0,
      utcMs: null,
      uncertaintyMs: 1_000,
      detail: e.kind,
      raw: "",
      enabled: true,
      ...e,
    });
  const res = resolveTimeline(input);
  const p = res.placements.get("P.jpg")!;
  return { input, res, p, of: (id: string) => p.comparison.find((c) => c.evidenceId === id)! };
}

const known = { isReference: true, offsetBasis: "reference" } as const;
const verdict = (c: EvidenceComparison) => c.verdict;
const minuteName = (h: number, m: number): Ev => ({
  id: "name",
  kind: "filename",
  localMs: T(h, m, 30),
  uncertaintyMs: 30_000,
});

describe("Rundung und Unsicherheit", () => {
  it("1: EXIF sekundengenau, Dateiname minutengenau, passt", () => {
    const { of, p } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 32, 7) }, minuteName(10, 32)], known);
    expect(verdict(of("exif"))).toBe("chosen");
    expect(verdict(of("name"))).toBe("agrees");
    expect(p.status).toBe("ok");
  });

  it("2: aufgerundete Minute ist Rundung, kein Widerspruch", () => {
    const ok = photo([{ id: "exif", kind: "metadata", localMs: T(10, 32, 58) }, minuteName(10, 32)], known);
    expect(verdict(ok.of("name"))).toBe("agrees");
    const r = photo([{ id: "exif", kind: "metadata", localMs: T(10, 33, 8) }, minuteName(10, 32)], known);
    expect(verdict(r.of("name"))).toBe("rounding");
    expect(r.p.status).toBe("ok");
    expect(r.p.conflict.state).toBe("none");
    expect(r.p.notes.join()).not.toContain("Widerspruch");
  });

  it("3: über einer Minute ist es ein deutlicher Widerspruch", () => {
    const { of, p } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 33, 35) }, minuteName(10, 32)], known);
    expect(of("name")).toMatchObject({ verdict: "conflict", severity: "clear" });
    expect(p.status).toBe("check");
    expect(p.conflict).toMatchObject({ state: "open", severity: "clear", count: 1 });
  });

  it("4: zwei sekundengenaue Angaben: 4 s Rundung, 9 s Widerspruch", () => {
    const a = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
        { id: "name", kind: "filename", localMs: T(10, 32, 11) },
      ],
      known,
    );
    expect(verdict(a.of("name"))).toBe("rounding");
    const b = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
        { id: "name", kind: "filename", localMs: T(10, 32, 16) },
      ],
      known,
    );
    expect(b.of("name")).toMatchObject({ verdict: "conflict", severity: "clear" });
  });

  it("5: Grenze zwischen deutlich und stark liegt bei 5 Minuten", () => {
    expect(assessDeviation(4 * 60_000 + 59_000, 2_000).severity).toBe("clear");
    expect(assessDeviation(5 * 60_000, 2_000).severity).toBe("strong");
  });

  it("6: grobe Handeingabe passt im Rahmen, kein Stunden-Hinweis bei großer Unsicherheit", () => {
    const { of } = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
        { id: "hand", kind: "manual", localMs: T(10, 20), uncertaintyMs: 15 * 60_000 },
      ],
      known,
    );
    expect(verdict(of("exif"))).toBe("agrees");
    expect(assessDeviation(30 * 60_000, 15 * 60_000 + 1_000).hours).toBeUndefined();
  });

  it("7: gleiche Geräteuhr: die Unsicherheit der Uhrabweichung zählt nicht doppelt", () => {
    const { of } = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
        { id: "name", kind: "filename", localMs: T(10, 32, 47), uncertaintyMs: 500 },
      ],
      { offsetBasis: "manual", clockOffsetMs: 0, clockOffsetUncertaintyMs: 60_000 },
    );
    // Verwendet wird der Dateiname (± 0,5 s), die Metadaten widersprechen ihm um 40 s.
    expect(verdict(of("name"))).toBe("chosen");
    expect(of("exif")).toMatchObject({ verdict: "conflict", severity: "clear" });
  });
});

describe("Zeitzonen und UTC", () => {
  const utc = (h: number, m: number, s: number, date: [number, number, number] = [2026, 9, 14]) =>
    localToUtc(localMs(...date, h, m, s), "UTC");
  const stamp = (h: number, m: number, s: number, date?: [number, number, number]): Ev => ({
    id: "meta",
    kind: "metadata",
    localMs: localMs(...(date ?? [2026, 9, 14]), h, m, s),
    utcMs: utc(h, m, s, date),
  });

  it("8: als UTC markierter Stempel, richtig umgerechnet, passt zum Dateinamen", () => {
    const { of } = photo([stamp(8, 18, 47), { id: "name", kind: "filename", localMs: T(10, 18, 47) }], {
      ...known,
      timestampsAreUtc: true,
    });
    expect(of("meta").convertedFromUtc).toBe(true);
    expect(verdict(of("name"))).toBe("agrees");
  });

  it("9: im Winter beträgt der Abstand eine Stunde", () => {
    const d: [number, number, number] = [2026, 1, 14];
    const { of } = photo(
      [stamp(9, 18, 47, d), { id: "name", kind: "filename", localMs: localMs(2026, 1, 14, 10, 18, 47) }],
      { ...known, timestampsAreUtc: true },
      "2026-01-14",
    );
    expect(verdict(of("name"))).toBe("agrees");
  });

  it("10: falsche Lesart „Sind UTC“ bleibt ein starker Widerspruch mit Ursache utc", () => {
    const { of, p, input } = photo([stamp(10, 18, 47), { id: "name", kind: "filename", localMs: T(10, 18, 47) }], {
      ...known,
      timestampsAreUtc: true,
    });
    const conflicting = p.comparison.find((c) => c.verdict === "conflict")!;
    expect(conflicting).toMatchObject({ severity: "strong", cause: "utc", utcEvidenceId: "meta" });
    expect(p.status).toBe("check");
    // Umgestellt auf „schon Ortszeit“: passt.
    input.devices.find((d) => d.id === "cam")!.timestampsAreUtc = false;
    const after = resolveTimeline(input).placements.get("P.jpg")!;
    expect(after.conflict.state).toBe("none");
    void of;
  });

  it("11: umgekehrt: Gerät liest als Ortszeit, Stempel ist echte UTC", () => {
    const { p } = photo([stamp(8, 18, 47), { id: "name", kind: "filename", localMs: T(10, 18, 47) }], known);
    expect(p.comparison.find((c) => c.verdict === "conflict")).toMatchObject({ cause: "utc", utcEvidenceId: "meta" });
  });

  it("12: Geräteuhr in UTC: beide Belege der Geräteuhr werden gleich umgerechnet", () => {
    const { of, p } = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(8, 32, 7) },
        { id: "name", kind: "filename", localMs: T(8, 32, 7) },
        { id: "hand", kind: "manual", localMs: T(10, 32, 0), uncertaintyMs: 30_000 },
      ],
      { ...known, timeZone: "UTC" },
    );
    expect(verdict(of("hand"))).toBe("chosen");
    expect(verdict(of("exif"))).toBe("agrees");
    expect(verdict(of("name"))).toBe("agrees");
    expect(p.conflict.state).toBe("none");
  });

  it("13: glatter Versatz um Stunden gegen eine Handeingabe", () => {
    const at = (h: number, m: number) =>
      photo(
        [
          { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
          { id: "hand", kind: "manual", localMs: T(h, m, 0) },
        ],
        known,
      ).of("exif");
    expect(at(12, 32)).toMatchObject({ verdict: "conflict", severity: "strong", cause: "hours" });
    expect(at(11, 32)).toMatchObject({ cause: "hours" });
    expect(at(11, 40).cause).toBe("clock");
  });

  it("14: Viertelstunden-Raster (z. B. 5:30 Stunden)", () => {
    expect(assessDeviation(5.5 * 3_600_000 + 4_000, 2_000)).toMatchObject({ verdict: "conflict", hours: true });
    expect(assessDeviation(5.5 * 3_600_000 + 7 * 60_000, 2_000).hours).toBeUndefined();
  });

  it("15: Nacht der Zeitumstellung mit Geräteuhr in anderer Zone rechnet ohne Absturz", () => {
    const night = (h: number, m: number) => localMs(2026, 10, 25, h, m, 0);
    const { p } = photo(
      [
        { id: "exif", kind: "metadata", localMs: night(1, 30) },
        { id: "hand", kind: "manual", localMs: night(2, 30), uncertaintyMs: 30_000 },
      ],
      { ...known, timeZone: "Europe/London" },
      "2026-10-25",
    );
    expect(Number.isFinite(p.startMs)).toBe(true);
    expect(p.comparison).toHaveLength(2);
  });

  it("16: mehr als ein Tag Abstand ist stark", () => {
    expect(assessDeviation(26 * 3_600_000, 2_000)).toMatchObject({ verdict: "conflict", severity: "strong" });
  });
});

describe("Geräteabweichung", () => {
  const manualAt = (t: number): Ev => ({ id: "hand", kind: "manual", localMs: t });

  it("17: bekannte Abweichung wird herausgerechnet, dann passt es", () => {
    const { of } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 34, 54) }, manualAt(T(10, 32, 7))], {
      offsetBasis: "manual",
      clockOffsetMs: 167_000,
    });
    expect(verdict(of("exif"))).toBe("agrees");
  });

  it("18: unbekannte Abweichung: erwarteter Abstand, kein Widerspruch", () => {
    const { of, p } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 34, 54) }, manualAt(T(10, 32, 7))]);
    expect(verdict(of("exif"))).toBe("unsynced");
    expect(p.conflict.state).toBe("none");
    expect(p.notes.join()).not.toContain("Widerspruch");
  });

  it("19: abgeglichene Uhr, Handeingabe 2:47 daneben: Ursache Geräteuhr", () => {
    const { of } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 34, 54) }, manualAt(T(10, 32, 7))], known);
    expect(of("exif")).toMatchObject({ verdict: "conflict", severity: "clear", cause: "clock" });
  });

  it("20: Abstand zwischen zwei Belegen der Geräteuhr bleibt beim Abgleichen gleich", () => {
    const evs: Ev[] = [
      { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
      { id: "name", kind: "filename", localMs: T(10, 45, 30) },
    ];
    const before = photo(evs).of("name");
    const after = photo(evs, { offsetBasis: "manual", clockOffsetMs: 167_000 }).of("name");
    expect(before.differenceMs).toBe(after.differenceMs);
    expect(before.verdict).toBe("conflict");
  });

  it("verwendeter Beleg nennt den Grund für seinen Vorrang", () => {
    const { p } = photo([{ id: "exif", kind: "metadata", localMs: T(10, 32, 7) }, minuteName(10, 32)], known);
    expect(p.basis.reason).toBe("genaueste Angabe (sekundengenau statt nur Minute)");
    const hand = photo([{ id: "exif", kind: "metadata", localMs: T(10, 32, 7) }, manualAt(T(10, 32, 7))], known).p;
    expect(hand.basis.reason).toContain("von Hand");
    const only = photo([{ id: "exif", kind: "metadata", localMs: T(10, 32, 7) }], known).p;
    expect(only.basis.reason).toBe("einziger Zeitbeleg");
  });

  it("abgeschaltete Belege werden verglichen, zählen aber nicht", () => {
    const { of, p } = photo(
      [
        { id: "exif", kind: "metadata", localMs: T(10, 32, 7) },
        { id: "name", kind: "filename", localMs: T(10, 45, 30), enabled: false },
      ],
      known,
    );
    expect(of("name")).toMatchObject({ verdict: "conflict", enabled: false });
    expect(p.conflict.state).toBe("none");
    expect(p.status).toBe("ok");
  });
});

describe("Entscheidungen", () => {
  const exif: Ev = { id: "exif", kind: "metadata", localMs: T(10, 32, 7) };
  const name: Ev = { id: "name", kind: "filename", localMs: T(10, 45, 30), uncertaintyMs: 30_000 };
  const decision = (seen: Decision["seen"]): Decision => ({
    at: "2026-11-18T16:00:00.000Z",
    basisId: "exif",
    basisKind: "metadata",
    reason: "Datei beim Export umbenannt",
    seen,
  });
  const checked = (d: Decision | null): Ev => ({
    id: "chk",
    kind: "checked",
    localMs: T(10, 32, 7),
    decision: d,
  });
  const seenNow: Decision["seen"] = [
    { id: "exif", kind: "metadata", differenceMs: 0 },
    { id: "name", kind: "filename", differenceMs: T(10, 45, 30) - T(10, 32, 7) },
  ];
  const state = (p: Placement) => [p.conflict.state, p.status];

  it("entschieden: Status sicher, Widerspruch bleibt sichtbar", () => {
    const { p } = photo([exif, name, checked(decision(seenNow))], known);
    expect(state(p)).toEqual(["decided", "ok"]);
    expect(p.conflict.severity).toBe("strong");
    expect(p.basis.reason).toBe("deine Entscheidung vom 18.11.2026");
  });

  it("neuer widersprechender Beleg macht die Entscheidung veraltet", () => {
    const spoken: Ev = { id: "ansage", kind: "spoken", localMs: T(10, 31, 10) };
    const { p } = photo([exif, name, spoken, checked(decision(seenNow))], known);
    expect(state(p)).toEqual(["stale", "check"]);
    expect(p.conflict.staleBecause).toEqual([
      { evidenceId: "ansage", wasMs: null, nowMs: T(10, 31, 10) - T(10, 32, 7) },
    ]);
    expect(p.notes).toContain("Entscheidung neu prüfen");
  });

  it("Uhr nachträglich abgeglichen: verschobener Beleg macht sie veraltet", () => {
    const { p } = photo([exif, name, checked(decision(seenNow))], {
      offsetBasis: "manual",
      clockOffsetMs: 120_000,
    });
    expect(p.conflict.state).toBe("stale");
    expect(p.conflict.staleBecause.find((s) => s.evidenceId === "exif")).toMatchObject({ wasMs: 0 });
  });

  it("Uhr um weniger als die Unsicherheit verschoben: bestätigte Lage ist trotzdem neu zu prüfen (#117)", () => {
    // Bestätigt, als die Uhr noch als genau galt; jetzt 20 s anders abgeglichen (± 1 Min.): kein Widerspruch,
    // aber die bestätigte Lage stimmt nicht mehr mit dem Beleg überein, auf dem sie beruhte.
    const chk: Ev = {
      ...checked(decision([{ id: "exif", kind: "metadata", differenceMs: 0 }])),
      uncertaintyMs: 60_000,
    };
    const { p } = photo([exif, chk], {
      offsetBasis: "manual",
      clockOffsetMs: 20_000,
      clockOffsetUncertaintyMs: 60_000,
    });
    expect(state(p)).toEqual(["stale", "check"]);
    expect(p.conflict.staleBecause).toEqual([{ evidenceId: "exif", wasMs: 0, nowMs: -20_000 }]);
    expect(p.notes).toContain("Entscheidung neu prüfen");
    // Unverändert abgeglichen: bleibt entschieden.
    expect(photo([exif, chk], known).p.conflict.state).toBe("none");
  });

  it("ein passender neuer Beleg und abgeschaltete Belege ändern nichts", () => {
    const fits: Ev = { id: "ansage", kind: "spoken", localMs: T(10, 32, 7) };
    expect(state(photo([exif, name, fits, checked(decision(seenNow))], known).p)).toEqual(["decided", "ok"]);
    const off = { ...name, enabled: false };
    expect(photo([exif, off, checked(decision(seenNow))], known).p.conflict.state).toBe("none");
  });

  it("alte Bestätigung ohne Entscheidung veraltet nie", () => {
    const spoken: Ev = { id: "ansage", kind: "spoken", localMs: T(10, 31, 10) };
    const { p } = photo([exif, name, spoken, checked(null)], known);
    expect(state(p)).toEqual(["decided", "ok"]);
    expect(p.basis.reason).toBe("von dir geprüft");
  });
});

describe("Genauigkeit als Text", () => {
  it("nennt Einzahl und Mehrzahl richtig", () => {
    expect(precisionText(500)).toBe("sekundengenau");
    expect(precisionText(30_000)).toBe("nur Minute");
    expect(precisionText(5_000)).toBe("auf 5 Sekunden genau");
    expect(precisionText(60_000)).toBe("auf 1 Minute genau");
    expect(precisionText(61_000)).toBe("auf 1 Minute genau");
    expect(precisionText(120_000)).toBe("auf 2 Minuten genau");
  });
});
