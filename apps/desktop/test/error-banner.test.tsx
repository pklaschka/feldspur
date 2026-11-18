// @vitest-environment happy-dom
import { Dialog } from "radix-ui";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ErrorBanner, ErrorProvider } from "../src/renderer/ui.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fail: (m: string) => void = () => {};

function Harness({ open }: { open: boolean }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fail = setError;
  }, []);
  return (
    <ErrorProvider message={error} onDismiss={() => setError(null)}>
      <main data-testid="page">
        <ErrorBanner />
      </main>
      <Dialog.Root open={open}>
        <Dialog.Portal>
          <Dialog.Content aria-describedby={undefined} data-testid="dialog">
            <Dialog.Title>Einsatzdaten</Dialog.Title>
            <ErrorBanner dialog />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ErrorProvider>
  );
}

const roots: ReturnType<typeof createRoot>[] = [];
function render(open: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Harness open={open} />));
  return { rerender: (o: boolean) => act(() => root.render(<Harness open={o} />)) };
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("ErrorBanner", () => {
  it("zeigt einen Fehler im offenen Dialog als role=alert, nicht auf der verdeckten Seite", () => {
    render(true);
    act(() => fail("Unbekannte Zeitzone: Mars/Olympus"));
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(q("dialog").contains(alerts[0]!)).toBe(true);
    expect(alerts[0]!.textContent).toContain("Unbekannte Zeitzone: Mars/Olympus");
    expect(q("page").querySelector('[role="alert"]')).toBeNull();
  });

  it("lässt sich schließen", () => {
    render(true);
    act(() => fail("Datei fehlt"));
    const close = q("dialog").querySelector<HTMLButtonElement>('button[aria-label="Meldung schließen"]')!;
    act(() => close.click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("ohne offenen Dialog erscheint der Fehler auf der Seite", () => {
    const { rerender } = render(true);
    rerender(false);
    act(() => fail("Datei fehlt"));
    expect(q("page").querySelector('[role="alert"]')?.textContent).toContain("Datei fehlt");
  });
});
