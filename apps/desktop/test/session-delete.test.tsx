// @vitest-environment happy-dom
/**
 * Einsatz löschen: die Nachfrage in den Einsatzdetails (`apps/desktop/src/renderer/SessionDetails.tsx`) und der Hinweis
 * danach mit dem Weg zurück (`apps/desktop/src/renderer/app/history.tsx`).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionDetails } from "../src/renderer/SessionDetails.tsx";
import { DeletedToast } from "../src/renderer/app/history.tsx";
import type { SessionView } from "../src/shared/api.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Erfundenes Beispiel, keine Forschungsdaten.
const view = {
  session: {
    id: "s1",
    title: "Testmarkt",
    date: "2026-09-14",
    place: "",
    timeZone: "Europe/Berlin",
    extra: {},
    dataset: {},
  },
  diaryLookbackMin: 15,
  rows: [{ id: "a1" }, { id: "v1" }],
  projectDataset: {},
} as unknown as SessionView;

const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

describe("Einsatz löschen", () => {
  it("fragt nach, nennt Titel und Zahl der Quellen und löscht erst nach Bestätigung", () => {
    // Angenommen: die Einsatzdetails von „Testmarkt“ mit zwei Quellen sind offen
    const onDelete = vi.fn();
    const onOpenChange = vi.fn();
    const root = createRoot(document.createElement("div"));
    act(() =>
      root.render(
        <SessionDetails view={view} open onOpenChange={onOpenChange} onSave={async () => true} onDelete={onDelete} />,
      ),
    );
    // Wenn: „Einsatz löschen…“ gewählt wird
    act(() => button("Einsatz löschen…").click());
    // Dann: fragt die App nach und sagt, was verloren geht und was bleibt
    const dialog = document.querySelector("[data-testid=delete-session]")!;
    expect(dialog.textContent).toContain("Einsatz „Testmarkt“ löschen?");
    expect(dialog.textContent).toContain("Alle 2 Quellen");
    expect(dialog.textContent).toContain("Originaldateien und frühere Ausgaben bleiben erhalten.");
    // Der Verlauf ist nach dem Schließen, Einsammeln oder einer Analyse weg: das sagt die Nachfrage auch.
    expect(dialog.textContent).toContain("solange das Projekt offen ist");
    expect(onDelete).not.toHaveBeenCalled();
    // Wenn: bestätigt wird, dann wird gelöscht und die Details schließen
    act(() => button("Einsatz löschen").click());
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    act(() => root.unmount());
  });
});

describe("Hinweis nach dem Löschen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const render = (topUndo: string | null | undefined, onClose = vi.fn()) => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    const draw = (t: string | null | undefined) =>
      act(() => root.render(<DeletedToast title="Testmarkt" topUndo={t} onUndo={() => {}} onClose={onClose} />));
    draw(topUndo);
    return { root, draw, onClose };
  };

  it("verschwindet, sobald der oberste Schritt nicht mehr das Löschen ist", () => {
    const { root, draw, onClose } = render(undefined);
    expect(button("Rückgängig")).toBeTruthy();
    // Wenn: das Löschen der oberste Schritt ist, dann bleibt der Hinweis
    draw("Einsatz gelöscht");
    expect(onClose).not.toHaveBeenCalled();
    // Wenn: danach etwas anderes geändert wird, dann verschwindet er (dort erscheint womöglich der UndoToast)
    draw("Anker gesetzt");
    expect(onClose).toHaveBeenCalledOnce();
    expect(button("Rückgängig")).toBeUndefined();
    act(() => root.unmount());
  });

  it("verschwindet nach acht Sekunden wie der UndoToast", () => {
    vi.useFakeTimers();
    const { root, onClose } = render("Einsatz gelöscht");
    // Wenn: knapp acht Sekunden vergehen, dann ist er noch da
    act(() => vi.advanceTimersByTime(7999));
    expect(onClose).not.toHaveBeenCalled();
    // Wenn: die acht Sekunden voll sind, dann verschwindet er
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
