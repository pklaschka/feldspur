/**
 * Änderungsprotokoll (.csv) im Ausgabeordner eines Einsatzes (`apps/desktop/src/main/changelog.ts`) und die deutschen
 * Bezeichnungen der Tabellen und Schritte darin (`apps/desktop/src/shared/changelog.ts`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sessionChangeLogCsv } from "../src/main/changelog.ts";
import { MIGRATIONS } from "../../../packages/core/src/db/migrations.ts";
import { addLine } from "../src/main/transcript.ts";
import { stepLabel, TABLE_LABEL } from "../src/shared/changelog.ts";

let dir: string;
let store: ProjectStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "feldspur-log-"));
  store = ProjectStore.create(join(dir, "t.feldspur"), { name: "Test" });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Erfundener Einsatz mit Rekorder und einer Tonaufnahme, als ein Schritt im Verlauf. */
function seed(title: string, sha: string) {
  return store.history.record(`${title} angelegt`, () => {
    const session = store.addSession({ title, date: "2026-09-14", place: "", extra: {} });
    const rec = store.addDevice({
      sessionId: session.id,
      label: "Rekorder",
      isReference: true,
      offsetBasis: "reference",
    });
    const audio = store.addSource({
      sessionId: session.id,
      deviceId: rec.id,
      originalPath: "/x",
      sizeBytes: 1,
      metadata: {},
      kind: "audio",
      fileName: `${title}.m4a`,
      sha256: sha.padStart(64, "0"),
      durationMs: 600_000,
    });
    return { session, audio };
  });
}

describe("Änderungsprotokoll im Ausgabeordner eines Einsatzes", () => {
  it("enthält nur Änderungen an diesem Einsatz, auch an seinen gelöschten Quellen", () => {
    // Angenommen: zwei Einsätze, in beiden wird mitgeschrieben
    const a = seed("Wochenmarkt", "1");
    const b = seed("Flohmarkt", "2");
    store.history.record("Zeile angelegt", () =>
      addLine(store, a.audio.id, { atMs: 1_000, speaker: "", text: "Äpfel" }),
    );
    store.history.record("Zeile angelegt", () =>
      addLine(store, b.audio.id, { atMs: 1_000, speaker: "", text: "Teller" }),
    );
    // Und: die Quelle des ersten Einsatzes wird danach gelöscht
    store.history.record("Quelle entfernt", () => store.deleteSource(a.audio.id));

    // Wenn: das Änderungsprotokoll des ersten Einsatzes entsteht
    const csv = sessionChangeLogCsv(store.history, a.session.id);

    // Dann: steht darin der Einsatz, seine Zeile und das Löschen, aber nichts vom anderen Einsatz
    expect(csv).toContain("Wochenmarkt");
    expect(csv).toContain("Äpfel");
    expect(csv).toContain("Quelle entfernt");
    expect(csv).not.toContain("Flohmarkt");
    expect(csv).not.toContain("Teller");
  });
});

describe("Bezeichnungen im Änderungsprotokoll", () => {
  it("jede Tabelle der Projektdatei hat einen deutschen Namen, außer Zwischenspeichern und dem Protokoll selbst", () => {
    const tables = [...MIGRATIONS.join("\n").matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map((m) => m[1]!);
    const ohne = new Set(["audio_analysis", "export_records", "change_log"]);
    expect(tables.filter((t) => !ohne.has(t) && !(t in TABLE_LABEL))).toEqual([]);
    expect(Object.keys(TABLE_LABEL).filter((t) => !tables.includes(t))).toEqual([]);
  });

  const change = (table: string) => ({ table, op: "insert" as const, rowKey: "1", before: null, after: {} });
  it.each`
    fall                          | label               | tabellen                                   | name
    ${"mit eigener Beschriftung"} | ${"Zeile gelöscht"} | ${["transcript_lines"]}                    | ${"Zeile gelöscht"}
    ${"vom Einsammeln"}           | ${null}             | ${["devices", "sources", "time_evidence"]} | ${"Dateien eingesammelt"}
    ${"vom Tonspur-Abgleich"}     | ${null}             | ${["sync_anchors"]}                        | ${"Anker vorgeschlagen"}
    ${"sonst ohne Beschriftung"}  | ${null}             | ${["sessions"]}                            | ${"Automatisch geändert"}
  `("ein Schritt $fall heißt „$name“", ({ label, tabellen, name }) => {
    expect(stepLabel({ label, changes: (tabellen as string[]).map(change) })).toBe(name);
  });
});
