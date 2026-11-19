// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { installStrayDropGuard } from "../src/renderer/app/strayDrop.tsx";

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
    expect(drag("dragenter", out, ["Files"])).toEqual({ prevented: true, dropEffect: "none" });
    expect(drag("dragover", out, ["Files"])).toEqual({ prevented: true, dropEffect: "none" });
    expect(onStray).toHaveBeenCalledTimes(1);
    expect(drag("drop", out, ["Files"]).prevented).toBe(true);
    expect(onStray).toHaveBeenCalledTimes(2);
    off();
  });

  it("Ablageflächen und gezogener Text bleiben unberührt", () => {
    const onStray = vi.fn();
    const off = installStrayDropGuard(document, onStray);
    expect(drag("dragover", inside, ["Files"])).toEqual({ prevented: false, dropEffect: "copy" });
    expect(drag("drop", inside, ["Files"]).prevented).toBe(false);
    expect(drag("drop", out, ["text/plain"]).prevented).toBe(false);
    expect(onStray).not.toHaveBeenCalled();
    off();
    drag("drop", out, ["Files"]);
    expect(onStray).not.toHaveBeenCalled();
  });
});
