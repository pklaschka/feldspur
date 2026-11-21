// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";
import { isEditable } from "../src/renderer/app/history.tsx";

describe("isEditable", () => {
  const el = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  };
  it.each`
    html                          | textfeld
    ${"<textarea></textarea>"}    | ${true}
    ${'<input type="text">'}      | ${true}
    ${"<input>"}                  | ${true}
    ${'<input type="checkbox">'}  | ${false}
    ${'<input type="radio">'}     | ${false}
    ${'<input type="button">'}    | ${false}
    ${'<input type="submit">'}    | ${false}
    ${'<input type="range">'}     | ${false}
    ${"<button></button>"}        | ${false}
  `("$html macht selbst rückgängig: $textfeld", ({ html, textfeld }) => {
    expect(isEditable(el(html))).toBe(textfeld);
  });

  it("ohne Fokus macht das Projekt rückgängig", () => {
    expect(isEditable(null)).toBe(false);
  });
});
