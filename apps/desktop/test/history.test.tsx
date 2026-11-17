// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { isEditable } from "../src/renderer/app/history.tsx";

describe("isEditable", () => {
  const el = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  };
  it("Textfelder machen zuerst selbst rückgängig", () => {
    expect(isEditable(el("<textarea></textarea>"))).toBe(true);
    expect(isEditable(el('<input type="text">'))).toBe(true);
    expect(isEditable(el("<input>"))).toBe(true);
  });
  it("Knöpfe, Schalter und Schieber nicht, ebenso nichts", () => {
    for (const t of ["checkbox", "radio", "button", "submit", "range"])
      expect(isEditable(el(`<input type="${t}">`))).toBe(false);
    expect(isEditable(el("<button></button>"))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
