import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vitest";
import { isEnter } from "../src/renderer/keys.js";

const key = (k: string, isComposing = false) => ({ key: k, nativeEvent: { isComposing } }) as unknown as KeyboardEvent;

describe("isEnter", () => {
  it("zählt Enter, aber nicht das Enter, das im Eingabesystem Zeichen bestätigt", () => {
    expect(isEnter(key("Enter"))).toBe(true);
    expect(isEnter(key("Enter", true))).toBe(false);
    expect(isEnter(key("a"))).toBe(false);
  });
});
