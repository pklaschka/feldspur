/**
 * Hooks ohne zusätzliche Testbibliothek ausführen: React rendert in ein happy-dom-Element.
 * Testdateien brauchen dafür oben `// @vitest-environment happy-dom`.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function renderHook<P, R>(hook: (props: P) => R, props: P) {
  let last: R;
  function Probe(p: { props: P }) {
    last = hook(p.props);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe props={props} />));
  return {
    result: () => last,
    rerender: (next: P) => act(() => root.render(<Probe props={next} />)),
    unmount: () => act(() => root.unmount()),
  };
}
