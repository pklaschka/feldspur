import { describe, expect, it } from "vite-plus/test";
import { checkReason, todos } from "../src/renderer/inspector/status.ts";
import type { SessionView } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten. Nur die Felder, die todos() liest.
type Row = { id: string; status: "ok" | "check" | "unplaced"; kind?: string; partOf?: string | null };
const view = (o: {
  rows?: Row[];
  devices?: { label: string; isReference: boolean; offsetMs: number | null }[];
  proposals?: number;
  avCount?: number;
  analyzedCount?: number;
  episodes?: boolean;
  diaryNoteless?: string[];
}) =>
  ({
    rows: (o.rows ?? []).map((r) => ({
      kind: "photo",
      partOf: null,
      startMs: 0,
      diaryNote: o.diaryNoteless?.includes(r.id) ? null : "10:00",
      ...r,
    })),
    devices: o.devices ?? [],
    proposals: Array.from({ length: o.proposals ?? 0 }, () => ({})),
    avCount: o.avCount ?? 0,
    analyzedCount: o.analyzedCount ?? 0,
    session: { episodes: o.episodes ?? false },
  }) as unknown as SessionView;

const texts = (v: SessionView) => todos(v).map((t) => `${t.step}: ${t.text}`);

describe("todos", () => {
  it("ohne Quellen: erst einsammeln", () => {
    expect(texts(view({}))).toEqual(["collect: Dateien des Einsatzes einsammeln."]);
  });

  it("ohne Referenzuhr: erst eine wählen, Abweichungen erst danach", () => {
    const v = view({
      rows: [{ id: "a", status: "ok" }],
      devices: [{ label: "Rekorder", isReference: false, offsetMs: null }],
    });
    expect(texts(v)).toEqual(["sync: Eine Referenzuhr wählen."]);
  });

  it("nennt Geräte ohne Abweichung, Vorschläge und Lagen in der Reihenfolge der Schritte", () => {
    const v = view({
      rows: [
        { id: "late", status: "check" },
        { id: "x", status: "unplaced" },
        { id: "y", status: "unplaced" },
        { id: "part", status: "unplaced", partOf: "y" },
      ],
      devices: [
        { label: "Kamera", isReference: true, offsetMs: 0 },
        { label: "Handy", isReference: false, offsetMs: null },
        { label: "Rekorder", isReference: false, offsetMs: null },
      ],
      proposals: 1,
    });
    expect(texts(v)).toEqual([
      "sync: Abweichung für Handy, Rekorder klären.",
      "sync: 1 Vorschlag aus der Tonspur prüfen.",
      "review: 1 Lage prüfen.",
      "review: 2 Quellen haben noch keine Uhrzeit.",
    ]);
    expect(todos(v).find((t) => t.step === "review" && t.text.includes("Uhrzeit"))?.sourceId).toBe("x");
  });

  it("springt zur frühesten Lage, die zu prüfen ist", () => {
    const v = view({
      rows: [
        { id: "b", status: "check" },
        { id: "a", status: "check" },
      ],
    });
    const rows = v.rows as unknown as { id: string; startMs: number }[];
    rows[0]!.startMs = 2000;
    rows[1]!.startMs = 1000;
    expect(todos(v)[0]).toMatchObject({ text: "2 Lagen prüfen.", sourceId: "a" });
  });

  it("Tonspuren noch nicht abgeglichen: Begründung hängt an Episoden", () => {
    const base = { rows: [{ id: "a", status: "ok" as const }], avCount: 2 };
    expect(texts(view(base))).toEqual(["sync: Tonspuren abgleichen, damit Klatscher und Stille erkannt werden."]);
    expect(texts(view({ ...base, episodes: true }))).toEqual([
      "sync: Tonspuren abgleichen, damit Episoden und Stille erkannt werden.",
    ]);
    expect(texts(view({ ...base, analyzedCount: 1 }))).toEqual([]);
  });

  it("Tagebuchseiten ohne Randnotiz, weitere Bilder einer Seite zählen nicht", () => {
    const v = view({
      rows: [
        { id: "t1", status: "ok", kind: "diary" },
        { id: "t2", status: "ok", kind: "diary" },
        { id: "t2b", status: "ok", kind: "diary", partOf: "t2" },
      ],
      diaryNoteless: ["t1", "t2", "t2b"],
    });
    expect(todos(v)).toEqual([
      { text: "2 Tagebuchseiten ohne Randnotiz.", step: "collect", sourceId: "t1", action: "Erste ansehen" },
    ]);
  });
});

describe("checkReason", () => {
  it("übersetzt die Hinweise der Zeitbestimmung", () => {
    expect(checkReason("Uhr weicht ab?", "Handy")).toBe("Die Uhr von Handy ist noch nicht abgeglichen.");
    expect(checkReason("Uhr weicht ab?", undefined)).toBe("Die Uhr von diesem Gerät ist noch nicht abgeglichen.");
    expect(checkReason("Keine Referenzuhr gewählt", "x")).toBe("Es ist noch keine Referenzuhr gewählt.");
    expect(checkReason("nur Minute", "x")).toBe("Die Uhrzeit ist nur minutengenau bekannt.");
    expect(checkReason("± 2:00", "x")).toBe("Die Uhrzeit ist nur ungefähr bekannt (± 2:00).");
    expect(checkReason("Widerspruch 3:00", "x")).toBe("Zeitbelege widersprechen sich (3:00).");
    expect(checkReason("etwas anderes", "x")).toBe("etwas anderes");
  });
});
