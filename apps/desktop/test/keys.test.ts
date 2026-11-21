import type { KeyboardEvent } from "react";
import { describe, expect, it } from "vite-plus/test";
import { isEnter, reviewKey } from "../src/renderer/keys.js";

const key = (k: string, isComposing = false) => ({ key: k, nativeEvent: { isComposing } }) as unknown as KeyboardEvent;

describe("isEnter", () => {
  it.each`
    taste      | eingabesystem | enter    | fall
    ${"Enter"} | ${false}      | ${true}  | ${"Enter"}
    ${"Enter"} | ${true}       | ${false} | ${"Enter, das im Eingabesystem Zeichen bestätigt"}
    ${"a"}     | ${false}      | ${false} | ${"andere Taste"}
  `("$fall zählt als Enter: $enter", ({ taste, eingabesystem, enter }) => {
    expect(isEnter(key(taste, eingabesystem))).toBe(enter);
  });
});

describe("reviewKey", () => {
  const ev = (
    k: string,
    mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "isComposing", boolean>> = {},
  ) => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    ...mods,
  });
  // Ziel, das auf die genannten Selektor-Teile passt (z. B. "textarea").
  const at = (...matches: string[]) => ({
    closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null),
  });

  it.each`
    taste      | mit                                 | ziel                  | dialog   | aktion       | fall
    ${"n"}     | ${{}}                               | ${at()}               | ${false} | ${"next"}    | ${"N: nächste"}
    ${"N"}     | ${{ shiftKey: true }}               | ${at()}               | ${false} | ${"prev"}    | ${"Umschalt+N: vorige"}
    ${"Enter"} | ${{ ctrlKey: true }}                | ${at()}               | ${false} | ${"confirm"} | ${"Strg+Enter: bestätigen"}
    ${"Enter"} | ${{ metaKey: true }}                | ${null}               | ${false} | ${"confirm"} | ${"⌘+Enter ohne Ziel: bestätigen"}
    ${"n"}     | ${{ repeat: true }}                 | ${at()}               | ${false} | ${"next"}    | ${"gehaltenes N wiederholt"}
    ${"N"}     | ${{ shiftKey: true, repeat: true }} | ${at()}               | ${false} | ${"prev"}    | ${"gehaltenes Umschalt+N wiederholt"}
    ${"Enter"} | ${{ ctrlKey: true, repeat: true }}  | ${at()}               | ${false} | ${null}      | ${"gehaltenes Strg+Enter bestätigt nur einmal"}
    ${"Enter"} | ${{ metaKey: true, repeat: true }}  | ${at()}               | ${false} | ${null}      | ${"gehaltenes ⌘+Enter bestätigt nur einmal"}
    ${"Enter"} | ${{}}                               | ${at()}               | ${false} | ${null}      | ${"Enter allein bleibt frei"}
    ${"n"}     | ${{ ctrlKey: true }}                | ${at()}               | ${false} | ${null}      | ${"Strg+N bleibt frei"}
    ${"n"}     | ${{ altKey: true }}                 | ${at()}               | ${false} | ${null}      | ${"Alt+N bleibt frei"}
    ${"m"}     | ${{}}                               | ${at()}               | ${false} | ${null}      | ${"andere Taste bleibt frei"}
    ${"n"}     | ${{}}                               | ${at("textarea")}     | ${false} | ${null}      | ${"nicht im Textfeld"}
    ${"Enter"} | ${{ ctrlKey: true }}                | ${at("input")}        | ${false} | ${null}      | ${"nicht im Eingabefeld"}
    ${"n"}     | ${{}}                               | ${at("[role='menu']")}   | ${false} | ${null}   | ${"nicht im Menü"}
    ${"n"}     | ${{}}                               | ${at("[role='dialog']")} | ${false} | ${null}   | ${"nicht in einem Dialog"}
    ${"n"}     | ${{}}                               | ${at()}               | ${true}  | ${null}      | ${"nicht bei offenem Dialog"}
    ${"n"}     | ${{ isComposing: true }}            | ${at()}               | ${false} | ${null}      | ${"nicht während das Eingabesystem Zeichen bildet"}
  `("$fall", ({ taste, mit, ziel, dialog, aktion }) => {
    expect(reviewKey(ev(taste, mit), ziel, dialog)).toBe(aktion);
  });
});
