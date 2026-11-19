import { describe, expect, it } from "vite-plus/test";
import { editBox, MIN_SIZE, nudgeBox, sameBox } from "../src/renderer/diary/regionEdit.ts";

const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };
const close = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => expect(sameBox(a, b)).toBe(true);

describe("Rahmen verschieben und in der Größe ändern", () => {
  it("verschieben bleibt auf der Seite", () => {
    close(editBox(box, "move", 0.1, -0.1), { x: 0.3, y: 0.1, w: 0.4, h: 0.3 });
    close(editBox(box, "move", 1, 1), { x: 0.6, y: 0.7, w: 0.4, h: 0.3 });
    close(editBox(box, "move", -1, -1), { x: 0, y: 0, w: 0.4, h: 0.3 });
  });

  it("Kanten und Ecken ziehen, die gegenüberliegende Seite bleibt stehen", () => {
    close(editBox(box, "e", 0.1, 0.5), { x: 0.2, y: 0.2, w: 0.5, h: 0.3 });
    close(editBox(box, "w", -0.1, 0), { x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
    close(editBox(box, "n", 0, 0.1), { x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
    close(editBox(box, "se", 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.4 });
    close(editBox(box, "nw", -0.5, -0.5), { x: 0, y: 0, w: 0.6, h: 0.5 });
  });

  it("über die andere Kante hinaus bleibt die kleinste Größe", () => {
    const r = editBox(box, "e", -1, 0);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.w).toBeCloseTo(MIN_SIZE);
    const s = editBox(box, "n", 0, 1);
    expect(s.y + s.h).toBeCloseTo(0.5);
    expect(s.h).toBeCloseTo(MIN_SIZE);
  });

  it("Pfeiltasten: verschieben, mit Alt Größe, mit Umschalt große Schritte", () => {
    close(nudgeBox(box, "ArrowRight", { shift: false, alt: false })!, { ...box, x: 0.205 });
    close(nudgeBox(box, "ArrowUp", { shift: true, alt: false })!, { ...box, y: 0.15 });
    close(nudgeBox(box, "ArrowDown", { shift: false, alt: true })!, { ...box, h: 0.305 });
    close(nudgeBox(box, "ArrowLeft", { shift: true, alt: true })!, { ...box, w: 0.35 });
    expect(nudgeBox(box, "a", { shift: false, alt: false })).toBeNull();
  });
});
