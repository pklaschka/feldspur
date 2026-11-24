/**
 * Tagebuch-Editor: Rahmen eines Eintrags mit Maus und Pfeiltasten verschieben und in der Größe ändern
 * (`apps/desktop/src/renderer/diary/regionEdit.ts`).
 */
import { describe, expect, it } from "vite-plus/test";
import { editBox, MIN_SIZE, nudgeBox, sameBox } from "../src/renderer/diary/regionEdit.ts";

const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };
const close = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => expect(sameBox(a, b)).toBe(true);

describe("Rahmen verschieben und in der Größe ändern", () => {
  // Angenommen: ein Rahmen bei x 0,2 / y 0,2, 0,4 breit und 0,3 hoch
  it.each`
    griff     | dx      | dy      | ergebnis                              | fall
    ${"move"} | ${0.1}  | ${-0.1} | ${{ x: 0.3, y: 0.1, w: 0.4, h: 0.3 }} | ${"verschoben"}
    ${"move"} | ${1}    | ${1}    | ${{ x: 0.6, y: 0.7, w: 0.4, h: 0.3 }} | ${"verschoben, bleibt rechts unten auf der Seite"}
    ${"move"} | ${-1}   | ${-1}   | ${{ x: 0, y: 0, w: 0.4, h: 0.3 }}     | ${"verschoben, bleibt links oben auf der Seite"}
    ${"e"}    | ${0.1}  | ${0.5}  | ${{ x: 0.2, y: 0.2, w: 0.5, h: 0.3 }} | ${"rechte Kante, nur waagerecht"}
    ${"w"}    | ${-0.1} | ${0}    | ${{ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }} | ${"linke Kante, rechte bleibt"}
    ${"n"}    | ${0}    | ${0.1}  | ${{ x: 0.2, y: 0.3, w: 0.4, h: 0.2 }} | ${"obere Kante, untere bleibt"}
    ${"se"}   | ${0.1}  | ${0.1}  | ${{ x: 0.2, y: 0.2, w: 0.5, h: 0.4 }} | ${"Ecke rechts unten"}
    ${"nw"}   | ${-0.5} | ${-0.5} | ${{ x: 0, y: 0, w: 0.6, h: 0.5 }}     | ${"Ecke links oben, bis zum Seitenrand"}
  `("$griff um $dx/$dy: $fall", ({ griff, dx, dy, ergebnis }) => {
    close(editBox(box, griff, dx, dy), ergebnis);
  });

  it("über die andere Kante hinaus bleibt die kleinste Größe", () => {
    // Wenn: die rechte Kante weit über die linke gezogen wird, dann bleibt die linke stehen und die kleinste Breite
    const r = editBox(box, "e", -1, 0);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.w).toBeCloseTo(MIN_SIZE);
    // Wenn: die obere Kante weit über die untere gezogen wird, dann bleibt die untere stehen und die kleinste Höhe
    const s = editBox(box, "n", 0, 1);
    expect(s.y + s.h).toBeCloseTo(0.5);
    expect(s.h).toBeCloseTo(MIN_SIZE);
  });

  it.each`
    taste           | umschalt | alt      | ergebnis                | fall
    ${"ArrowRight"} | ${false} | ${false} | ${{ ...box, x: 0.205 }} | ${"kleiner Schritt nach rechts"}
    ${"ArrowUp"}    | ${true}  | ${false} | ${{ ...box, y: 0.15 }}  | ${"großer Schritt nach oben"}
    ${"ArrowDown"}  | ${false} | ${true}  | ${{ ...box, h: 0.305 }} | ${"etwas höher"}
    ${"ArrowLeft"}  | ${true}  | ${true}  | ${{ ...box, w: 0.35 }}  | ${"deutlich schmaler"}
  `("$taste (Umschalt $umschalt, Alt $alt): $fall", ({ taste, umschalt, alt, ergebnis }) => {
    close(nudgeBox(box, taste, { shift: umschalt, alt })!, ergebnis);
  });

  it("andere Tasten bewegen nichts", () => {
    expect(nudgeBox(box, "a", { shift: false, alt: false })).toBeNull();
  });
});
