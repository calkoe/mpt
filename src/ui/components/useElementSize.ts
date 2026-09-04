/**
 * Misst die tatsächliche Größe eines Elements.
 *
 * Wird gebraucht, wo ein SVG die verfügbare Fläche ausfüllen soll: eine
 * prozentuale Höhe hilft dort nicht, weil die Koordinaten im SVG in Pixeln
 * gerechnet werden. Ein ResizeObserver ist nötig, weil sich die Fläche beim
 * Ziehen des Trenners und beim Umschalten der Ansicht ändert.
 */
import { useEffect, useRef, useState } from 'react';

export function useElementSize<T extends HTMLElement>(): {
  ref: React.RefObject<T>;
  width: number;
  height: number;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const apply = () => {
      const box = element.getBoundingClientRect();
      setSize((previous) =>
        // Ohne diesen Vergleich löst jede Messung ein Rendern aus, das wieder
        // eine Messung auslöst.
        Math.abs(previous.width - box.width) < 0.5 && Math.abs(previous.height - box.height) < 0.5
          ? previous
          : { width: box.width, height: box.height },
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
