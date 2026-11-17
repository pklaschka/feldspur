import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Größe eines Elements, das erst später erscheint (im Dialog). Gemessen wird über die Ref-Funktion: Radix hängt den
 * Dialoginhalt erst nach dem eigenen Rendern ein, ein Effekt im Editor käme dafür zu früh und bliebe bei 0 stehen
 * (dann war die Seite beim Öffnen winzig).
 */
export function useElementSize(): [{ w: number; h: number }, (el: HTMLElement | null) => void] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observed = useRef<{ el: HTMLElement; ro: ResizeObserver } | null>(null);
  const observe = useCallback((el: HTMLElement | null) => {
    if (observed.current?.el === el) return;
    observed.current?.ro.disconnect();
    observed.current = null;
    if (!el) return;
    const measure = () =>
      setSize((s) =>
        s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight },
      );
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observed.current = { el, ro };
    measure();
  }, []);
  useEffect(() => () => observed.current?.ro.disconnect(), []);
  return [size, observe];
}
