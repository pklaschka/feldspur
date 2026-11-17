// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vite-plus/test";
import { useDraft, useLatest, useLoaded } from "../src/renderer/hooks.ts";
import { renderHook } from "./render-hook.tsx";

describe("useDraft", () => {
  it("behält eigene Eingaben, solange sich der Wert nicht ändert", () => {
    const h = renderHook((p: { v: string }) => useDraft(p.v), { v: "10:15" });
    act(() => h.result()[1]("10:1"));
    expect(h.result()[0]).toBe("10:1");
    h.rerender({ v: "10:15" });
    expect(h.result()[0]).toBe("10:1");
    h.unmount();
  });

  it("folgt einem neuen Wert von außen und verwirft dabei den Entwurf", () => {
    const h = renderHook((p: { v: string }) => useDraft(p.v), { v: "a" });
    act(() => h.result()[1]("a, getippt"));
    h.rerender({ v: "b" });
    expect(h.result()[0]).toBe("b");
    h.unmount();
  });

  it("setzt bei neuem resetKey zurück, auch wenn der Wert gleich bleibt", () => {
    const h = renderHook((p: { v: number; open: boolean }) => useDraft(p.v, p.open), { v: 3, open: false });
    act(() => h.result()[1](7));
    h.rerender({ v: 3, open: true });
    expect(h.result()[0]).toBe(3);
    h.unmount();
  });
});

/** Versprechen, das der Test selbst erfüllt. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLoaded", () => {
  const setup = (keep = false) => {
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const load = (k: string) => {
      const d = deferred<string>();
      pending.set(k, d);
      return d.promise;
    };
    const h = renderHook((p: { k: string | null }) => useLoaded(p.k, load, { keep }), { k: "a" as string | null });
    const settle = async (k: string, v: string) => {
      await act(async () => pending.get(k)!.resolve(v));
    };
    return { h, pending, settle };
  };

  it("lädt zum Schlüssel und meldet den Wert", async () => {
    const { h, settle } = setup();
    expect(h.result()).toMatchObject({ state: "loading", value: undefined });
    await settle("a", "A");
    expect(h.result()).toMatchObject({ state: "done", value: "A" });
    h.unmount();
  });

  it("beginnt bei neuem Schlüssel leer und ignoriert späte Antworten zum alten", async () => {
    const { h, settle } = setup();
    await settle("a", "A");
    h.rerender({ k: "b" });
    expect(h.result()).toMatchObject({ state: "loading", value: undefined });
    h.rerender({ k: "c" });
    await settle("b", "B");
    expect(h.result().state).toBe("loading");
    await settle("c", "C");
    expect(h.result()).toMatchObject({ state: "done", value: "C" });
    h.unmount();
  });

  it("lädt nach null erneut, auch beim selben Schlüssel (Dialog wieder geöffnet)", async () => {
    const { h, pending, settle } = setup();
    await settle("a", "A");
    h.rerender({ k: null });
    expect(h.result()).toMatchObject({ state: "idle", value: undefined });
    pending.clear();
    h.rerender({ k: "a" });
    expect(h.result().state).toBe("loading");
    expect(pending.has("a")).toBe(true);
    await settle("a", "A2");
    expect(h.result().value).toBe("A2");
    h.unmount();
  });

  it("behält mit keep den letzten Wert, bis der neue da ist", async () => {
    const { h, settle } = setup(true);
    await settle("a", "A");
    h.rerender({ k: "b" });
    expect(h.result()).toMatchObject({ state: "loading", value: "A" });
    await settle("b", "B");
    expect(h.result().value).toBe("B");
    h.unmount();
  });

  it("meldet Fehler", async () => {
    const { h, pending } = setup();
    await act(async () => pending.get("a")!.reject(new Error("kaputt")));
    expect(h.result().state).toBe("failed");
    h.unmount();
  });
});

describe("useLatest", () => {
  it("behält dasselbe Objekt und zeigt nach dem Rendern den neuen Wert", () => {
    const h = renderHook((p: { v: number }) => useLatest(p.v), { v: 1 });
    const ref = h.result();
    h.rerender({ v: 2 });
    expect(h.result()).toBe(ref);
    expect(ref.current).toBe(2);
    h.unmount();
  });
});
