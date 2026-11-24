// @vitest-environment happy-dom
/**
 * Dateien, die neben eine Ablagefläche gezogen werden (`apps/desktop/src/renderer/app/strayDrop.tsx`): Das Fenster
 * öffnet sie nicht, sondern zeigt einen Hinweis.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { StrayDropHint, installStrayDropGuard } from "../src/renderer/app/strayDrop.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function drag(type: string, target: Element, types: string[]) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types, dropEffect: "copy" };
  Object.defineProperty(e, "dataTransfer", { value: dataTransfer });
  target.dispatchEvent(e);
  return { prevented: e.defaultPrevented, dropEffect: dataTransfer.dropEffect };
}

describe("installStrayDropGuard", () => {
  document.body.innerHTML = '<div id="out"></div><div data-dropzone><span id="in"></span></div>';
  const out = document.getElementById("out")!;
  const inside = document.getElementById("in")!;

  it("Dateien neben einer Ablagefläche: nicht öffnen, Zeiger „nicht ablegen“, Hinweis", () => {
    const onStray = vi.fn();
    const off = installStrayDropGuard(document, onStray);
    // Wenn: Dateien neben eine Ablagefläche gezogen werden, dann zeigt der Zeiger „nicht ablegen“ und einmal den Hinweis
    expect(drag("dragenter", out, ["Files"])).toEqual({ prevented: true, dropEffect: "none" });
    expect(drag("dragover", out, ["Files"])).toEqual({ prevented: true, dropEffect: "none" });
    expect(onStray).toHaveBeenCalledTimes(1);
    // Wenn: sie dort losgelassen werden, dann öffnet sich nichts und der Hinweis kommt wieder
    expect(drag("drop", out, ["Files"]).prevented).toBe(true);
    expect(onStray).toHaveBeenCalledTimes(2);
    off();
  });

  it("Ablageflächen und gezogener Text bleiben unberührt", () => {
    const onStray = vi.fn();
    const off = installStrayDropGuard(document, onStray);
    // Wenn: Dateien auf eine Ablagefläche oder Text daneben gezogen werden, dann bleibt alles, wie es ist
    expect(drag("dragover", inside, ["Files"])).toEqual({ prevented: false, dropEffect: "copy" });
    expect(drag("drop", inside, ["Files"]).prevented).toBe(false);
    expect(drag("drop", out, ["text/plain"]).prevented).toBe(false);
    expect(onStray).not.toHaveBeenCalled();
    // Wenn: der Schutz abgebaut ist, dann kommt auch kein Hinweis mehr
    off();
    drag("drop", out, ["Files"]);
    expect(onStray).not.toHaveBeenCalled();
  });
});

describe("StrayDropHint", () => {
  it("zeigt nach dem (erneuten) Einhängen nur Ziehen, das danach passiert", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const shown = () => !!host.querySelector('[data-testid="stray-drop-hint"]');
    const render = (n: number, key: string) =>
      act(() => root.render(createElement(StrayDropHint, { key, n, text: "Hinweis" })));

    // Wenn: noch nichts danebengezogen wurde, dann kein Hinweis
    render(0, "a");
    expect(shown()).toBe(false);
    // Wenn: einmal danebengezogen wird, dann der Hinweis
    render(1, "a");
    expect(shown()).toBe(true);
    // Wenn: der Einsatz wechselt oder ein Projekt geöffnet wird, dann bleibt der Zähler, der Hinweis nicht
    render(1, "b");
    expect(shown()).toBe(false);
    // Wenn: danach wieder danebengezogen wird, dann kommt der Hinweis wieder
    render(2, "b");
    expect(shown()).toBe(true);
    act(() => root.unmount());
    host.remove();
  });
});
