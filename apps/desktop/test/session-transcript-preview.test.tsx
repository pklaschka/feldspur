// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import {
  SESSION_TRANSCRIPT_CLOCK_COLOR,
  SESSION_TRANSCRIPT_CONTEXT_COLOR,
  SESSION_TRANSCRIPT_KIND_COLOR,
} from "@feldspur/media";
import { SessionTranscriptLine } from "../src/renderer/SessionTranscriptLine.tsx";
import type { SessionTranscriptPreviewEntry } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Farben der Einsatztranskript-Vorschau", () => {
  it("hell sind es genau die Farben aus dem .docx", () => {
    const css = readFileSync(join(import.meta.dirname, "../src/renderer/styles.css"), "utf8");
    const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
    const value = (name: string) => light.match(new RegExp(`--st-${name}:\\s*#([0-9a-f]{6});`, "i"))?.[1];
    expect(value("clock")?.toUpperCase()).toBe(SESSION_TRANSCRIPT_CLOCK_COLOR);
    for (const [kind, hex] of Object.entries(SESSION_TRANSCRIPT_KIND_COLOR))
      expect(value(kind)?.toUpperCase(), kind).toBe(hex);
    // Kontext steht in der Vorschau in der Farbe der Episoden (text-st-episode), im .docx ebenso.
    expect(value("episode")?.toUpperCase()).toBe(SESSION_TRANSCRIPT_CONTEXT_COLOR);
  });
});

describe("SessionTranscriptLine", () => {
  const render = (entry: SessionTranscriptPreviewEntry) => {
    const host = document.createElement("ol");
    const root = createRoot(host);
    act(() => root.render(<SessionTranscriptLine entry={entry} />));
    return host.firstElementChild as HTMLElement;
  };
  const base = { stamp: "#00:01:02-0#", clock: "10:16:20", head: "", body: "" };

  it("setzt die Zeile wie im .docx und bleibt als Text gleich lesbar", () => {
    const li = render({ ...base, kind: "photo", head: "Foto", body: "IMG_0042.jpg" });
    expect(li.textContent).toBe("#00:01:02-0# Uhrzeit 10:16:20 · Foto: IMG_0042.jpg");
    expect(li.querySelector(".text-st-clock")?.textContent).toBe("Uhrzeit 10:16:20 · ");
    expect(li.querySelector(".text-st-photo.font-semibold")?.textContent).toBe("Foto: ");
  });
  it("Mitschrift: Sprecher nicht fett, mit Mittelpunkt wie im .docx", () => {
    const li = render({ ...base, kind: "line", head: "A", body: "Guten Morgen" });
    expect(li.textContent).toBe("#00:01:02-0# Uhrzeit 10:16:20 · A · Guten Morgen");
    expect(li.querySelector(".font-semibold")).toBeNull();
  });
  it("Zwischentafel kursiv, ohne Uhrzeit kein grauer Teil", () => {
    const li = render({ ...base, clock: "", kind: "card", head: "Zwischenzeit", body: "10:20–10:40" });
    expect(li.querySelector(".text-st-clock")).toBeNull();
    expect(li.querySelector(".italic")?.textContent).toBe("10:20–10:40");
  });
  it("Zeilenumbrüche im Text bleiben sichtbar", () => {
    const li = render({ ...base, kind: "diary", head: "Tagebuch", body: "a\nb" });
    expect(li.querySelector(".whitespace-pre-line")?.textContent).toBe("a\nb");
  });
});
