import { describe, expect, it } from "vite-plus/test";
import { createSerialQueue, restoreDraft, takeDraft } from "../src/renderer/transcriber/draft.ts";

describe("takeDraft", () => {
  it("nimmt Marke und Sprecher mit", () => {
    expect(takeDraft("Hallo", "B1", 4000, 9000)).toEqual({ atMs: 4000, speaker: "B1", text: "Hallo" });
  });
  it("ohne Marke gilt die Stelle, Kürzel im Text schlägt das Feld", () => {
    expect(takeDraft("A2: Hallo", "B1", null, 9000)).toEqual({ atMs: 9000, speaker: "A2", text: "Hallo" });
  });
  it("leer oder nur Leerraum ergibt nichts", () => {
    expect(takeDraft("  ", "B1", null, 0)).toBeNull();
  });
});

describe("restoreDraft", () => {
  const failed = { atMs: 1000, speaker: "B1", text: "Erste Zeile" };
  it("schreibt in ein leeres Feld zurück", () => {
    expect(restoreDraft({ draft: "", mark: null }, failed)).toEqual({ draft: "Erste Zeile", mark: 1000 });
  });
  it("stellt vor schon Weitergetipptes", () => {
    expect(restoreDraft({ draft: "zweite", mark: 3000 }, failed)).toEqual({
      draft: "Erste Zeile zweite",
      mark: 1000,
    });
  });
});

describe("createSerialQueue", () => {
  it("führt Aufträge nacheinander aus, auch nach einem Fehler", async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    // Wenn: ein langsamer Auftrag scheitert und ein zweiter wartet
    const a = q.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
      log.push("a");
      throw new Error("x");
    });
    const b = q.run(async () => void log.push("b"));
    // Dann: läuft der zweite erst danach, trotzdem
    await expect(a).rejects.toThrow();
    await b;
    await q.idle();
    expect(log).toEqual(["a", "b"]);
  });
});
