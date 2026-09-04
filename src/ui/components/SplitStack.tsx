/**
 * Randloser Stapel aus zwei Flächen mit verschiebbarer horizontaler Trennung.
 *
 * Die obere Fläche bekommt eine feste Höhe in Prozent, die untere füllt den
 * Rest. Das Verhältnis liegt in den Ansichts-Einstellungen und überlebt damit
 * einen Reload. Bedienbar auch per Tastatur (Pfeil hoch/runter), sobald der
 * Trenner fokussiert ist.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const MIN_RATIO = 0.12;
const MAX_RATIO = 0.88;

export function SplitStack({
  ratio,
  onRatioChange,
  top,
  bottom,
}: {
  /** Anteil der oberen Fläche, 0..1. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  top: ReactNode;
  bottom: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const clamp = (value: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));

  const applyFromPointer = useCallback(
    (clientY: number) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.height === 0) return;
      onRatioChange(clamp((clientY - box.top) / box.height));
    },
    [onRatioChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      applyFromPointer(event.clientY);
    };
    const onUp = () => setDragging(false);

    document.body.classList.add('app--resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      document.body.classList.remove('app--resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applyFromPointer, dragging]);

  return (
    <div className="stack" ref={containerRef}>
      <div className="stack__top" style={{ height: `${clamp(ratio) * 100}%` }}>
        {top}
      </div>
      <div
        className={`splitter${dragging ? ' splitter--active' : ''}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Trennung zwischen Plan und Bearbeitung verschieben"
        aria-valuenow={Math.round(clamp(ratio) * 100)}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => onRatioChange(0.55)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onRatioChange(clamp(ratio - 0.03));
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            onRatioChange(clamp(ratio + 0.03));
          }
        }}
        title="Ziehen zum Verschieben · Doppelklick setzt zurück"
      />
      <div className="stack__bottom">{bottom}</div>
    </div>
  );
}
