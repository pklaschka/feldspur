import { describe, expect, it } from "vite-plus/test";
import {
  canConfirm,
  checkQueue,
  checkReason,
  firstOpen,
  placesAfter,
  stepPlace,
  todos,
} from "../src/renderer/inspector/status.ts";
import type { SessionView } from "../src/shared/api.ts";

// Erfundenes Beispiel, keine Forschungsdaten. Nur die Felder, die todos() liest.
type Row = {
  id: string;
  status: "ok" | "check" | "unplaced";
  kind?: string;
  partOf?: string | null;
  startMs?: number;
  conflict?: { state: string; severity: "clear" | "strong" | null; worstMs: number };
};
const view = (o: {
  rows?: Row[];
  devices?: { label: string; isReference: boolean; offsetMs: number | null }[];
  proposals?: number;
  avCount?: number;
  analyzedCount?: number;
  episodes?: boolean;
  diaryNoteless?: string[];
  groups?: { sourceIds: string[] }[];
}) =>
  ({
    rows: (o.rows ?? []).map((r) => ({
      kind: "photo",
      partOf: null,
      startMs: 0,
      label: r.id,
      conflict: { state: "none", severity: null, worstMs: 0, count: 0, staleBecause: [] },
      diaryNote: o.diaryNoteless?.includes(r.id) ? null : "10:00",
      ...r,
    })),
    devices: o.devices ?? [],
    proposals: Array.from({ length: o.proposals ?? 0 }, () => ({})),
    conflictGroups: o.groups ?? [],
    avCount: o.avCount ?? 0,
    analyzedCount: o.analyzedCount ?? 0,
    session: { episodes: o.episodes ?? false },
  }) as unknown as SessionView;

const texts = (v: SessionView) => todos(v).map((t) => `${t.step}: ${t.text}`);

describe("Offene Punkte im Inspektor", () => {
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
    // Angenommen: Referenzuhr Kamera, zwei Geräte ohne Abweichung, ein Vorschlag, eine Lage zu prüfen, zwei Quellen ohne Uhrzeit
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
    // Dann: stehen die Punkte in der Reihenfolge der Schritte, der letzte führt zur ersten Quelle ohne Uhrzeit
    expect(texts(v)).toEqual([
      "sync: Abweichung für Handy, Rekorder klären.",
      "sync: 1 Vorschlag aus der Tonspur prüfen.",
      "review: 1 Lage prüfen.",
      "review: 2 Quellen haben noch keine Uhrzeit.",
    ]);
    expect(todos(v).find((t) => t.step === "review" && t.text.includes("Uhrzeit"))?.sourceId).toBe("x");
  });

  it("springt zur frühesten Lage, die zu prüfen ist", () => {
    // Angenommen: zwei Lagen zu prüfen, a liegt früher als b
    const v = view({
      rows: [
        { id: "b", status: "check" },
        { id: "a", status: "check" },
      ],
    });
    const rows = v.rows as unknown as { id: string; startMs: number }[];
    rows[0]!.startMs = 2000;
    rows[1]!.startMs = 1000;
    // Dann: führt der Punkt zu a
    expect(todos(v)[0]).toMatchObject({ text: "2 Lagen prüfen.", sourceId: "a" });
  });

  it("Widersprüche zuerst, stärkste vorn; eine Gruppe zählt als eine Stelle", () => {
    const c = (severity: "clear" | "strong", worstMs: number) => ({ state: "open", severity, worstMs });
    // Angenommen: eine unsichere Lage, ein klarer und ein starker Widerspruch und eine Gruppe mit starkem Widerspruch
    const v = view({
      rows: [
        { id: "early", status: "check", startMs: 0 },
        { id: "clear", status: "check", startMs: 10, conflict: c("clear", 80_000) },
        { id: "big", status: "check", startMs: 20, conflict: c("strong", -3_600_000) },
        { id: "g1", status: "check", startMs: 30, conflict: c("strong", 7_200_000) },
        { id: "g2", status: "check", startMs: 40, conflict: c("strong", 7_200_000) },
      ],
      groups: [{ sourceIds: ["g1", "g2"] }],
    });
    // Dann: kommt die Gruppe zuerst, dann der starke, der klare und zuletzt die unsichere Lage
    expect(checkQueue(v.rows).map((r) => r.id)).toEqual(["g1", "g2", "big", "clear", "early"]);
    // Dann: zählen die Widersprüche drei Stellen statt vier
    expect(todos(v).slice(0, 2)).toEqual([
      {
        text: "Zeitbelege widersprechen sich an 3 Stellen, davon 2 stark.",
        step: "review",
        sourceId: "g1",
        action: "Ersten ansehen",
      },
      { text: "1 Lage prüfen.", step: "review", sourceId: "early", action: "Erste prüfen" },
    ]);
  });

  it("Tonspuren noch nicht abgeglichen: Begründung hängt an Episoden", () => {
    // Angenommen: zwei Ton- und Videoquellen, noch nicht abgeglichen
    const base = { rows: [{ id: "a", status: "ok" as const }], avCount: 2 };
    // Dann: begründet der Punkt mit Klatschern
    expect(texts(view(base))).toEqual(["sync: Tonspuren abgleichen, damit Klatscher und Stille erkannt werden."]);
    // Wenn: es Episoden gibt, dann mit Episoden
    expect(texts(view({ ...base, episodes: true }))).toEqual([
      "sync: Tonspuren abgleichen, damit Episoden und Stille erkannt werden.",
    ]);
    // Wenn: eine Spur abgeglichen ist, dann entfällt der Punkt
    expect(texts(view({ ...base, analyzedCount: 1 }))).toEqual([]);
  });

  it("Tagebuchseiten ohne Randnotiz, weitere Bilder einer Seite zählen nicht", () => {
    // Angenommen: zwei Seiten ohne Randnotiz, eine davon mit weiterem Bild
    const v = view({
      rows: [
        { id: "t1", status: "ok", kind: "diary" },
        { id: "t2", status: "ok", kind: "diary" },
        { id: "t2b", status: "ok", kind: "diary", partOf: "t2" },
      ],
      diaryNoteless: ["t1", "t2", "t2b"],
    });
    // Dann: zählt der Punkt zwei Seiten
    expect(todos(v)).toEqual([
      { text: "2 Tagebuchseiten ohne Randnotiz.", step: "collect", sourceId: "t1", action: "Erste ansehen" },
    ]);
  });
});

describe("Reihenfolge der Stellen", () => {
  // Angenommen: eine erfundene Reihenfolge wie aus checkQueue, g1 und g2 sind eine Gruppe (eine Stelle)
  const q = ["g1", "g2", "a", "b"].map((id) => ({ id }));
  const groups = [{ sourceIds: ["g1", "g2"] }];
  const ids = (r: { id: string } | undefined) => r?.id;

  it.each`
    taste           | richtung | von        | nach    | fall
    ${"N"}          | ${1}     | ${null}    | ${"g1"} | ${"ohne Auswahl zur ersten Stelle"}
    ${"N"}          | ${1}     | ${"g1"}    | ${"a"}  | ${"über die Gruppe hinweg"}
    ${"N"}          | ${1}     | ${"g2"}    | ${"a"}  | ${"ein Gruppenmitglied zählt als seine Gruppe"}
    ${"N"}          | ${1}     | ${"b"}     | ${"g1"} | ${"nach der letzten wieder vorn"}
    ${"N"}          | ${1}     | ${"fremd"} | ${"g1"} | ${"von einer anderen Quelle zur ersten Stelle"}
    ${"Umschalt+N"} | ${-1}    | ${"a"}     | ${"g1"} | ${"zurück zur Gruppe"}
    ${"Umschalt+N"} | ${-1}    | ${"g2"}    | ${"b"}  | ${"vor der ersten wieder hinten"}
    ${"Umschalt+N"} | ${-1}    | ${null}    | ${"b"}  | ${"ohne Auswahl zur letzten Stelle"}
  `("$taste von $von springt zu $nach: $fall", ({ richtung, von, nach }) => {
    expect(ids(stepPlace(q, groups, von, richtung))).toBe(nach);
  });

  it("ohne Stellen springt N nirgendwohin", () => {
    expect(stepPlace([], groups, null, 1)).toBeUndefined();
  });

  it("nach „Lage passt“: die nächste noch offene Stelle in der alten Reihenfolge", () => {
    // Wenn: an Stelle a „Lage passt“ gewählt wird, dann geht es in der alten Reihenfolge weiter
    const order = placesAfter(q, groups, "a");
    expect(order).toEqual(["b", "g1"]);
    // Wenn: b sich inzwischen mit erledigt hat, dann geht es weiter zur Gruppe
    expect(ids(firstOpen(order, [{ id: "g1" }, { id: "g2" }], groups))).toBe("g1");
    // Wenn: b noch offen ist, dann zu b; ist nichts mehr offen, dann nirgendwohin
    expect(ids(firstOpen(order, [{ id: "b" }, { id: "g1" }], groups))).toBe("b");
    expect(firstOpen(order, [], groups)).toBeUndefined();
    // Wenn: nur die eigene Stelle übrig bleibt (z. B. noch nicht erledigt), dann gibt es keinen Sprung
    expect(firstOpen(placesAfter([{ id: "a" }], [], "a"), [{ id: "a" }], [])).toBeUndefined();
  });

  const lage = (o: object) =>
    ({
      status: "check",
      startMs: 0,
      kind: "photo",
      partOf: null,
      conflict: { state: "none" },
      evidence: [],
      ...o,
    }) as unknown as Parameters<typeof canConfirm>[0];

  it.each`
    quelle                                                     | passt    | fall
    ${lage({})}                                                | ${true}  | ${"unsichere Lage ohne Widerspruch"}
    ${lage({ status: "ok" })}                                  | ${false} | ${"sichere Lage"}
    ${lage({ kind: "diary" })}                                 | ${false} | ${"Tagebuchseite"}
    ${lage({ partOf: "x" })}                                   | ${false} | ${"weiteres Bild einer Seite"}
    ${lage({ conflict: { state: "open" } })}                   | ${false} | ${"offener Widerspruch"}
    ${lage({ evidence: [{ kind: "checked", chosen: true }] })} | ${false} | ${"schon geprüft"}
  `("„Lage passt“ gibt es: $passt bei $fall", ({ quelle, passt }) => {
    expect(canConfirm(quelle)).toBe(passt);
  });
});

describe("Hinweise der Zeitbestimmung", () => {
  it.each`
    hinweis                        | geraet       | satz
    ${"Uhr weicht ab?"}            | ${"Handy"}   | ${"Die Uhr von Handy ist noch nicht abgeglichen."}
    ${"Uhr weicht ab?"}            | ${undefined} | ${"Die Uhr von diesem Gerät ist noch nicht abgeglichen."}
    ${"Keine Referenzuhr gewählt"} | ${"x"}       | ${"Es ist noch keine Referenzuhr gewählt."}
    ${"nur Minute"}                | ${"x"}       | ${"Die Uhrzeit ist nur minutengenau bekannt."}
    ${"± 2:00"}                    | ${"x"}       | ${"Die Uhrzeit ist nur ungefähr bekannt (± 2:00)."}
    ${"Widerspruch 3:00"}          | ${"x"}       | ${"Zeitbelege widersprechen sich (3:00)."}
    ${"Entscheidung neu prüfen"}   | ${"x"}       | ${"Seit der Entscheidung hat sich ein Zeitbeleg geändert."}
    ${"etwas anderes"}             | ${"x"}       | ${"etwas anderes"}
  `("„$hinweis“ ($geraet) heißt: $satz", ({ hinweis, geraet, satz }) => {
    expect(checkReason(hinweis, geraet)).toBe(satz);
  });
});
