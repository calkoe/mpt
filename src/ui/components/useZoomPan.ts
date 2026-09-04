/**
 * Zoom und Verschieben für SVG-Visualisierungen.
 *
 * Bedienung:
 *  - Mausrad zoomt auf den Cursor (Strg/Cmd nicht nötig, aber möglich)
 *  - Ziehen mit der Maus verschiebt die Fläche
 *  - `focusOn(box)` zoomt auf ein bestimmtes Objekt
 *  - `fit()` passt den gesamten Inhalt ein
 *
 * Der Zustand ist bewusst nicht persistent: er gehört zur Sitzung, nicht zu den
 * Daten. Angewendet wird er als `transform` auf einer SVG-Gruppe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 4;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoomPan {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Für `transform` der SVG-Gruppe. */
  transform: string;
  /** Auf das Wurzelelement der Visualisierung setzen. */
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  isPanning: boolean;
  /**
   * true, sobald der Nutzer selbst gezoomt oder verschoben hat. Solange es
   * false ist, darf sich die Ansicht automatisch neu einpassen.
   */
  userAdjusted: boolean;
  zoomBy: (factor: number) => void;
  setScale: (scale: number) => void;
  /**
   * Markiert die Ansicht als "vom Nutzer bestimmt", ohne selbst zu zoomen.
   * Noetig z.B. beim Verschieben eines Knotens: dadurch aendert sich die
   * Groesse des Inhalts, und ohne diese Markierung wuerde sich die Ansicht
   * sofort neu einpassen - der Plan springt einem unter der Hand weg.
   */
  markAdjusted: () => void;
  reset: () => void;
  /** Passt den gesamten Inhalt in die sichtbare Fläche ein. */
  fit: (content: Box) => void;
  /** Zoomt mittig auf ein Objekt. */
  focusOn: (box: Box, targetScale?: number) => void;
  /** Handler für das Wurzelelement. */
  onPointerDown: (event: React.PointerEvent) => void;
}

export function useZoomPan(): ZoomPan {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScaleState] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [userAdjusted, setUserAdjusted] = useState(false);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  /** Zoomt so, dass der Punkt unter dem Cursor stehen bleibt. */
  const zoomAt = useCallback((factor: number, pointX: number, pointY: number) => {
    setUserAdjusted(true);
    setScaleState((currentScale) => {
      const next = clampScale(currentScale * factor);
      const applied = next / currentScale;
      setOffset((current) => ({
        x: pointX - (pointX - current.x) * applied,
        y: pointY - (pointY - current.y) * applied,
      }));
      return next;
    });
  }, []);

  // Mausrad: nicht-passiver Listener, damit das Scrollen der Seite unterbleibt.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(factor, event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Ziehen
  useEffect(() => {
    if (!isPanning) return;
    const onMove = (event: PointerEvent) => {
      const start = panStart.current;
      if (!start) return;
      setOffset({ x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) });
    };
    const onUp = () => {
      setIsPanning(false);
      panStart.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isPanning]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // Nur linke Maustaste, und nicht wenn ein Knoten angeklickt wurde.
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (target.closest('[data-node]')) return;
      panStart.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
      setIsPanning(true);
      setUserAdjusted(true);
    },
    [offset.x, offset.y],
  );

  const viewport = () => {
    const box = containerRef.current?.getBoundingClientRect();
    return { width: box?.width ?? 800, height: box?.height ?? 400 };
  };

  const fit = useCallback((content: Box) => {
    const { width, height } = viewport();
    if (content.width <= 0 || content.height <= 0) return;
    const padding = 24;
    const next = clampScale(
      Math.min((width - padding * 2) / content.width, (height - padding * 2) / content.height, 1),
    );
    setScaleState(next);
    setOffset({
      x: (width - content.width * next) / 2 - content.x * next,
      y: (height - content.height * next) / 2 - content.y * next,
    });
  }, []);

  const focusOn = useCallback((box: Box, targetScale = 1.6) => {
    const { width, height } = viewport();
    setUserAdjusted(true);
    const next = clampScale(targetScale);
    setScaleState(next);
    setOffset({
      x: width / 2 - (box.x + box.width / 2) * next,
      y: height / 2 - (box.y + box.height / 2) * next,
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const { width, height } = viewport();
      zoomAt(factor, width / 2, height / 2);
    },
    [zoomAt],
  );

  const reset = useCallback(() => {
    setUserAdjusted(false);
    setScaleState(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  return {
    scale,
    offsetX: offset.x,
    offsetY: offset.y,
    transform: `translate(${offset.x},${offset.y}) scale(${scale})`,
    containerRef,
    isPanning,
    userAdjusted,
    zoomBy,
    setScale: (value) => {
      setUserAdjusted(true);
      setScaleState(clampScale(value));
    },
    reset,
    fit,
    focusOn,
    onPointerDown,
    markAdjusted: () => setUserAdjusted(true),
  };
}
