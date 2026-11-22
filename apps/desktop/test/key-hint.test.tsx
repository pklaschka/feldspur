// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  dismissKeyHint,
  MOUSE_CONFIRMS,
  noteMouseConfirm,
  resetKeyHintCache,
  useKeyHint,
} from "../src/renderer/review/keyHint.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Zeigt „ja“, solange der Hinweis stehen soll. */
function Probe() {
  return <span>{useKeyHint() ? "ja" : "nein"}</span>;
}
function render() {
  const host = document.createElement("div");
  act(() => createRoot(host).render(<Probe />));
  return host;
}

describe("Tastenhinweis in Durchsehen", () => {
  beforeEach(() => {
    localStorage.clear();
    resetKeyHintCache();
  });

  it(`erscheint erst nach ${MOUSE_CONFIRMS} Bestätigungen mit der Maus`, () => {
    const host = render();
    // Wenn: zweimal mit der Maus bestätigt wird, dann noch nicht
    act(() => {
      noteMouseConfirm();
      noteMouseConfirm();
    });
    expect(host.textContent).toBe("nein");
    // Wenn: ein drittes Mal, dann steht er da
    act(() => noteMouseConfirm());
    expect(host.textContent).toBe("ja");
  });

  it("kommt nach „Verstanden“ nie wieder, auch nicht nach einem Neustart", () => {
    // Angenommen: Der Hinweis stand und wurde weggeklickt.
    for (let i = 0; i < MOUSE_CONFIRMS; i++) noteMouseConfirm();
    dismissKeyHint();
    // Wenn: die App neu startet und weiter mit der Maus bestätigt wird
    resetKeyHintCache();
    for (let i = 0; i < MOUSE_CONFIRMS; i++) noteMouseConfirm();
    // Dann: bleibt er weg.
    expect(render().textContent).toBe("nein");
  });
});
