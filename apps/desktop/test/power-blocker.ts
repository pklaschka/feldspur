/** Ersatz für Electrons powerSaveBlocker: merkt sich, welche Sperren gerade laufen. */
export function fakePowerSaveBlocker() {
  const active = new Map<number, string>();
  let next = 1;
  return {
    active,
    start: (type: string) => {
      const id = next++;
      active.set(id, type);
      return id;
    },
    stop: (id: number) => active.delete(id),
    isStarted: (id: number) => active.has(id),
  };
}
