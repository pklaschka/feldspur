import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "@feldspur/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { sessionChangeLogCsv } from "../src/main/changelog.ts";
import { addLine } from "../src/main/transcript.ts";

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
