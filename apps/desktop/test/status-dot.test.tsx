// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vite-plus/test";
import { StatusDot } from "../src/renderer/ui.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: React.ReactElement): HTMLElement {
  const host = document.createElement("div");
  act(() => createRoot(host).render(el));
  return host;
}

describe("StatusDot", () => {
  it.each`
    status        | bezeichnung
    ${"ok"}       | ${"Zeit: sicher"}
    ${"check"}    | ${"Zeit: prüfen"}
    ${"unplaced"} | ${"Zeit: ohne Zeit"}
  `("heißt für Screenreader und als Tooltip „$bezeichnung“ ($status)", ({ status, bezeichnung }) => {
    const host = render(<StatusDot status={status} />);
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(bezeichnung);
    expect(host.querySelector("[title]")?.getAttribute("title")).toBe(bezeichnung);
  });

  it("ist bei Text daneben rein dekorativ", () => {
    const host = render(<StatusDot status="ok" decorative />);
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('[role="img"]')).toBeNull();
  });
});
