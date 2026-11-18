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
  it("hat eine Bezeichnung für Screenreader", () => {
    expect(
      render(<StatusDot status="ok" />)
        .querySelector('[role="img"]')
        ?.getAttribute("aria-label"),
    ).toBe("Zeit: sicher");
    expect(
      render(<StatusDot status="check" />)
        .querySelector("[title]")
        ?.getAttribute("title"),
    ).toBe("Zeit: prüfen");
    expect(
      render(<StatusDot status="unplaced" />)
        .querySelector('[role="img"]')
        ?.getAttribute("aria-label"),
    ).toBe("Zeit: ohne Zeit");
  });

  it("ist bei Text daneben rein dekorativ", () => {
    const host = render(<StatusDot status="ok" decorative />);
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('[role="img"]')).toBeNull();
  });
});
