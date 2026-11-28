// @vitest-environment happy-dom
/**
 * Schritt „Ansehen“ (`apps/desktop/src/renderer/Watch.tsx`, Issue #131): gibt dem Rahmen die Seite, merkt sich die
 * Stelle, führt „Bearbeiten“ an den richtigen Ort und lädt nur neu, wenn sich am Einsatz etwas geändert hat.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EntryOrigin, SessionView, WatchPreview } from "../src/shared/api.ts";
import type { FromFrame, ToFrame } from "../src/renderer/watch/messages.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Erfundenes Beispiel, keine Forschungsdaten.
const origins: (EntryOrigin | null)[] = [
  null,
  { kind: "line", id: "a1", atMs: 38_000, clockMs: 36_038_000 },
  { kind: "diary", id: "seite1", clockMs: 36_100_000 },
  { kind: "source", id: "foto1", clockMs: 36_200_000 },
  { kind: "sync", id: "v1", clockMs: 36_300_000 },
];
const preview = (body: string, durationMs = 600_000): WatchPreview =>
  ({ css: "", body, plan: { durationMs, pieces: [] }, images: [], origins, tracks: {} }) as unknown as WatchPreview;
const view = (id: string) =>
  ({
    session: { id, episodes: false },
    rows: [
      { id: "a1", kind: "audio", level: null },
      { id: "foto1", kind: "photo", level: null },
      { id: "v1", kind: "video", level: null },
    ],
  }) as unknown as SessionView;

const watchPreview = vi.fn<(sessionId: string, realtime?: boolean) => Promise<WatchPreview>>();
(window as unknown as { feldspur: unknown }).feldspur = { watchPreview };
const { Watch } = await import("../src/renderer/Watch.tsx");
const { PlaybackProvider, usePlayback } = await import("../src/renderer/playback.tsx");

// happy-dom lädt keine Seiten in Rahmen und meldet jeden Versuch als Fehler. Mit leerem `srcdoc` versucht es das nicht.
const getAttribute = HTMLIFrameElement.prototype.getAttribute;
HTMLIFrameElement.prototype.getAttribute = function (name: string) {
  return name === "srcdoc" ? "" : getAttribute.call(this, name);
};
/** Der Rahmen, wie ihn der Schritt sieht: nimmt Nachrichten an und lässt sich neu laden. */
const frame = { postMessage: vi.fn<(m: ToFrame) => void>(), location: { reload: vi.fn() } };
Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", { configurable: true, get: () => frame });
/** Nachricht aus dem Rahmen an die Oberfläche. */
const fromFrame = (data: FromFrame) =>
  act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, source: frame as unknown as Window }));
  });
const sent = (type: ToFrame["type"]) => frame.postMessage.mock.calls.map(([m]) => m).filter((m) => m.type === type);

const jump = { onSource: vi.fn(), onTranscribe: vi.fn(), onDiary: vi.fn(), onReview: vi.fn(), onReveal: vi.fn() };
const onSync = vi.fn();
/** Zeigt die gemeldete Stelle der Wiedergabe, damit der Test sie lesen kann. */
function Probe() {
  return <output data-testid="position">{JSON.stringify(usePlayback().position)}</output>;
}
let root: Root;
const show = (v: SessionView, covered = false) =>
  act(async () => {
    root.render(
      <PlaybackProvider>
        <Probe />
        <Watch view={v} covered={covered} jump={jump} onSync={onSync} onNext={() => {}} />
      </PlaybackProvider>,
    );
  });

beforeEach(() => {
  vi.clearAllMocks();
  watchPreview.mockResolvedValue(preview("<p>Stand 1</p>"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => act(() => root.unmount()));

describe("Schritt „Ansehen“", () => {
  it("gibt dem Rahmen die Seite, sobald er bereit ist, und beginnt vorn", async () => {
    await show(view("einsatz-vorn"));
    // Dann: Echtzeit ist der Normalfall; vor „bereit“ geht nichts an den Rahmen
    expect(watchPreview).toHaveBeenCalledWith("einsatz-vorn", true);
    expect(sent("load")).toHaveLength(0);
    // Wenn: der Rahmen sich meldet
    await fromFrame({ type: "ready" });
    expect(sent("load")).toMatchObject([
      {
        at: 0,
        preview: { body: "<p>Stand 1</p>" },
        levels: [
          ["a1", null],
          ["foto1", null],
          ["v1", null],
        ],
      },
    ]);
  });

  it("steht nach einer Änderung am Einsatz wieder an derselben Stelle", async () => {
    await show(view("einsatz-stelle"));
    await fromFrame({ type: "ready" });
    await fromFrame({ type: "at", t: 127.5 });
    // Wenn: sich der Einsatz ändert (neue Ansicht, andere Seite)
    watchPreview.mockResolvedValue(preview("<p>Stand 2</p>"));
    await show(view("einsatz-stelle"));
    // Dann: beginnt der Rahmen von vorn und bekommt den neuen Stand an der gemerkten Stelle
    expect(frame.location.reload).toHaveBeenCalledOnce();
    await fromFrame({ type: "ready" });
    expect(sent("load").at(-1)).toMatchObject({ at: 127.5, preview: { body: "<p>Stand 2</p>" } });
  });

  it("lässt den Rahmen in Ruhe, wenn sich nichts geändert hat", async () => {
    await show(view("einsatz-gleich"));
    await fromFrame({ type: "ready" });
    // Wenn: die Ansicht neu kommt, die Seite aber dieselbe ist (etwa nach einer gewählten Quelle)
    await show(view("einsatz-gleich"));
    expect(watchPreview).toHaveBeenCalledTimes(2);
    expect(frame.location.reload).not.toHaveBeenCalled();
    expect(sent("load")).toHaveLength(1);
  });

  it("hält an und holt nichts neu, solange ein Fenster davor liegt", async () => {
    await show(view("einsatz-fenster"));
    await fromFrame({ type: "ready" });
    // Wenn: Mitschreiben davor aufgeht und sich der Einsatz mit jeder Eingabe ändert
    await show(view("einsatz-fenster"), true);
    await show(view("einsatz-fenster"), true);
    expect(sent("pause")).toHaveLength(1);
    expect(watchPreview).toHaveBeenCalledTimes(1);
    // Wenn: es wieder zugeht, dann wird einmal neu geholt
    await show(view("einsatz-fenster"));
    expect(watchPreview).toHaveBeenCalledTimes(2);
  });

  it.each`
    zeile                | index | ziel
    ${"Mitschriftzeile"} | ${1}  | ${"Mitschreiben an der Stelle"}
    ${"Tagebucheintrag"} | ${2}  | ${"die Tagebuchseite"}
    ${"Foto"}            | ${3}  | ${"Durchsehen mit der Quelle"}
    ${"Sync-Signal"}     | ${4}  | ${"Abgleichen"}
  `("„Bearbeiten“ an $zeile öffnet $ziel", async ({ index }) => {
    await show(view("einsatz-bearbeiten"));
    await fromFrame({ type: "ready" });
    // Wenn: an der Zeile „Bearbeiten“ gewählt wird
    await fromFrame({ type: "edit", index: index as number });
    const called = {
      transcribe: jump.onTranscribe.mock.calls.at(-1)?.[0],
      diary: jump.onDiary.mock.calls.at(-1)?.[0],
      review: jump.onReview.mock.calls.length,
      source: jump.onSource.mock.calls.at(-1)?.[0],
      sync: onSync.mock.calls.at(-1)?.[0],
    };
    expect(called).toEqual(
      [
        null,
        // Mitschreiben öffnet an der Stelle der Zeile (0:38 in der Aufnahme)
        { transcribe: "a1", diary: undefined, review: 0, source: undefined, sync: undefined },
        { transcribe: null, diary: "seite1", review: 0, source: undefined, sync: undefined },
        { transcribe: null, diary: null, review: 1, source: "foto1", sync: undefined },
        { transcribe: undefined, diary: undefined, review: 0, source: undefined, sync: "v1" },
      ][index as number],
    );
    if (index === 1)
      expect(JSON.parse(document.querySelector("[data-testid=position]")!.textContent)).toEqual({
        sourceId: "a1",
        atMs: 38_000,
        playing: false,
      });
  });

  it("sagt es, wenn noch keine Quelle eine Uhrzeit hat", async () => {
    watchPreview.mockResolvedValue(preview("", 0));
    await show(view("einsatz-leer"));
    await fromFrame({ type: "ready" });
    expect(document.querySelector("[data-testid=watch-empty]")!.textContent).toContain(
      "Noch keine Quelle hat eine Uhrzeit",
    );
    expect(sent("load")).toHaveLength(0);
  });

  it("reicht Kürzel der App aus dem Rahmen weiter (Suche mit Strg+K)", async () => {
    await show(view("einsatz-tasten"));
    const keys: string[] = [];
    const on = (ev: KeyboardEvent) => keys.push(`${ev.ctrlKey ? "Strg+" : ""}${ev.key}`);
    window.addEventListener("keydown", on);
    await fromFrame({ type: "key", key: "k", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
    window.removeEventListener("keydown", on);
    expect(keys).toEqual(["Strg+k"]);
  });
});
