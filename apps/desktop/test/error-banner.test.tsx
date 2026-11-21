// @vitest-environment happy-dom
import { Dialog } from "radix-ui";
import { act, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SessionView } from "../src/shared/api.ts";
import type { Guard } from "../src/renderer/App.tsx";
import { ErrorBanner, ErrorProvider } from "../src/renderer/ui.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fail: (m: string) => void = () => {};

function Harness({ open, inner = false }: { open: boolean; inner?: boolean }) {
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
            <Dialog.Root open={inner}>
              <Dialog.Portal>
                <Dialog.Content aria-describedby={undefined} data-testid="inner">
                  <Dialog.Title>Sicherungen</Dialog.Title>
                  <ErrorBanner dialog />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ErrorProvider>
  );
}

const roots: ReturnType<typeof createRoot>[] = [];
function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return root;
}
function render(open: boolean) {
  const root = mount(<Harness open={open} />);
  return {
    rerender: (o: boolean, inner = false) => act(() => root.render(<Harness open={o} inner={inner} />)),
  };
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("ErrorBanner", () => {
  it("zeigt einen Fehler im offenen Dialog als role=alert, nicht auf der verdeckten Seite", () => {
    // Angenommen: ein Dialog ist offen
    render(true);
    // Wenn: ein Fehler kommt
    act(() => fail("Unbekannte Zeitzone: Mars/Olympus"));
    // Dann: steht er einmal im Dialog und nicht auf der verdeckten Seite
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(q("dialog").contains(alerts[0]!)).toBe(true);
    expect(alerts[0]!.textContent).toContain("Unbekannte Zeitzone: Mars/Olympus");
    expect(q("page").querySelector('[role="alert"]')).toBeNull();
  });

  it("lässt sich schließen", () => {
    render(true);
    act(() => fail("Datei fehlt"));
    // Wenn: die Meldung geschlossen wird, dann ist sie weg
    const close = q("dialog").querySelector<HTMLButtonElement>('button[aria-label="Meldung schließen"]')!;
    act(() => close.click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("ohne offenen Dialog erscheint der Fehler auf der Seite", () => {
    const { rerender } = render(true);
    // Wenn: der Dialog schließt und dann ein Fehler kommt, dann steht er auf der Seite
    rerender(false);
    act(() => fail("Datei fehlt"));
    expect(q("page").querySelector('[role="alert"]')?.textContent).toContain("Datei fehlt");
  });

  it("verschachtelt: nur der oberste Dialog zeigt den Fehler, ein alter Fehler verschwindet beim Öffnen", () => {
    const { rerender } = render(true);
    // Wenn: ein Fehler im Dialog steht und ein zweiter Dialog darüber öffnet, dann verschwindet er
    act(() => fail("Alter Fehler"));
    rerender(true, true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // Wenn: dann ein neuer Fehler kommt, dann steht er nur im obersten Dialog
    act(() => fail("Sicherung nicht lesbar"));
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(q("inner").contains(alerts[0]!)).toBe(true);
    // Wenn: der obere Dialog schließt, dann wandert der Fehler mit in den unteren
    rerender(true, false);
    expect(q("dialog").querySelector('[role="alert"]')?.textContent).toContain("Sicherung nicht lesbar");
  });

  it("Dialog Originale zeigt einen Fehler beim Prüfen in sich selbst", async () => {
    // Angenommen: der Dialog Originale ist offen, und die Prüfung scheitert
    Object.assign(window, {
      feldspur: {
        onOriginalsProgress: () => () => {},
        checkOriginals: () => Promise.reject(new Error("Ordner nicht lesbar")),
      },
    });
    const { OriginalsDialog } = await import("../src/renderer/Originals.tsx");
    const view = { session: { id: "s1" }, rows: [] } as unknown as SessionView;
    function OriginalsHarness() {
      const [error, setError] = useState<string | null>(null);
      const guard: Guard = async (fn) => {
        try {
          return await fn();
        } catch (e) {
          setError((e as Error).message);
          return undefined;
        }
      };
      return (
        <ErrorProvider message={error} onDismiss={() => setError(null)}>
          <main data-testid="page">
            <ErrorBanner />
          </main>
          <OriginalsDialog view={view} open onOpenChange={() => {}} onView={() => {}} guard={guard} />
        </ErrorProvider>
      );
    }
    mount(<OriginalsHarness />);
    const check = [...q("originals-dialog").querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Prüfsummen prüfen"),
    )!;
    // Wenn: „Prüfsummen prüfen“ gewählt wird
    await act(async () => check.click());
    // Dann: steht der Fehler im Dialog selbst
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(q("originals-dialog").contains(alerts[0]!)).toBe(true);
    expect(alerts[0]!.textContent).toContain("Ordner nicht lesbar");
  });
});
