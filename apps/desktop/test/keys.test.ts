import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vite-plus/test";
import { isEnter, reviewKey } from "../src/renderer/keys.js";

const key = (k: string, isComposing = false) => ({ key: k, nativeEvent: { isComposing } }) as unknown as KeyboardEvent;

describe("isEnter", () => {
  it("zählt Enter, aber nicht das Enter, das im Eingabesystem Zeichen bestätigt", () => {
    expect(isEnter(key("Enter"))).toBe(true);
    expect(isEnter(key("Enter", true))).toBe(false);
    expect(isEnter(key("a"))).toBe(false);
  });
});

describe("reviewKey", () => {
  const ev = (k: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...mods,
  });
  // Ziel, das auf die genannten Selektor-Teile passt (z. B. "textarea").
  const at = (...matches: string[]) => ({
    closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null),
  });

  it("N, Umschalt+N und Strg/⌘+Enter", () => {
    expect(reviewKey(ev("n"), at(), false)).toBe("next");
    expect(reviewKey(ev("N", { shiftKey: true }), at(), false)).toBe("prev");
    expect(reviewKey(ev("Enter", { ctrlKey: true }), at(), false)).toBe("confirm");
    expect(reviewKey(ev("Enter", { metaKey: true }), null, false)).toBe("confirm");
  });

  it("andere Tasten und Kombinationen bleiben frei", () => {
    expect(reviewKey(ev("Enter"), at(), false)).toBeNull();
    expect(reviewKey(ev("n", { ctrlKey: true }), at(), false)).toBeNull();
    expect(reviewKey(ev("n", { altKey: true }), at(), false)).toBeNull();
    expect(reviewKey(ev("m"), at(), false)).toBeNull();
  });

  it("nicht in Textfeldern, Menüs oder bei offenem Dialog", () => {
    expect(reviewKey(ev("n"), at("textarea"), false)).toBeNull();
    expect(reviewKey(ev("Enter", { ctrlKey: true }), at("input"), false)).toBeNull();
    expect(reviewKey(ev("n"), at("[role='menu']"), false)).toBeNull();
    expect(reviewKey(ev("n"), at("[role='dialog']"), false)).toBeNull();
    expect(reviewKey(ev("n"), at(), true)).toBeNull();
    expect(reviewKey({ ...ev("n"), isComposing: true }, at(), false)).toBeNull();
  });
});
