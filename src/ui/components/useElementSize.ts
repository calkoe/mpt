/**
 * Misst den **nutzbaren Innenraum** eines Elements.
 *
 * Wird gebraucht, wo ein SVG die verfügbare Fläche ausfüllen soll: eine
 * prozentuale Höhe hilft dort nicht, weil die Koordinaten im SVG in Pixeln
 * gerechnet werden. Ein ResizeObserver ist nötig, weil sich die Fläche beim
 * Ziehen des Trenners und beim Umschalten der Ansicht ändert.
 *
 * Gemessen wird `clientWidth`/`clientHeight`, nicht `getBoundingClientRect()`:
 * letzteres zählt eine sichtbare Bildlaufleiste mit. Ein Diagramm, das sich
 * danach richtet, wird um genau deren Dicke zu groß - und schneidet sich dann
 * selbst die Achsenbeschriftung ab.
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
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) =>
        // Ohne diesen Vergleich löst jede Messung ein Rendern aus, das wieder
        // eine Messung auslöst.
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
