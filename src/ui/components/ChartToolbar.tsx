/**
 * Bedienelemente eines Diagramms - Zoom, Einpassen, Export.
 *
 * Sie gehören in die Werkzeugleiste des Panels, nicht auf die Zeichenfläche:
 * als schwebende Kachel liefen sie im Gantt beim Scrollen mit dem Inhalt weg.
 * Die Zoomstufe kennt aber nur das Diagramm selbst - es rendert seine Knöpfe
 * deshalb weiterhin dort und `ChartToolbar` schiebt sie per Portal in den
 * Platzhalter oben. Netzplan, Gantt und Ganglinien nutzen dieselben Knöpfe.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './controls';

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Gemeinsame Sicht auf eine Zoomstufe - Netzplan und Zeitachsen rechnen intern verschieden. */
export interface ZoomHandle {
  /** 1 = eingepasst. */
  scale: number;
  zoomBy: (factor: number) => void;
  /** Wieder einpassen. */
  fit: () => void;
  /** Wurde von Hand verstellt? Nur dann lohnt "Einpassen". */
  adjusted: boolean;
}

const STEP = 1.3;

export function ZoomControls({ zoom, fitTitle }: { zoom: ZoomHandle; fitTitle: string }) {
  return (
    <>
      <Button size="sm" icon onClick={() => zoom.zoomBy(1 / STEP)} title="Herauszoomen">
        &minus;
      </Button>
      <span className="viz__zoomlevel mono" title="Aktuelle Zoomstufe">
        {Math.round(zoom.scale * 100)}%
      </span>
      <Button size="sm" icon onClick={() => zoom.zoomBy(STEP)} title="Hineinzoomen">
        +
      </Button>
      <Button size="sm" onClick={zoom.fit} disabled={!zoom.adjusted} title={fitTitle}>
        Einpassen
      </Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Platzhalter in der Werkzeugleiste
// ---------------------------------------------------------------------------

interface SlotValue {
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
}

const SlotContext = createContext<SlotValue | null>(null);

/** Klammert Werkzeugleiste und Diagramm eines Panels. */
export function ChartToolbarProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Stabiler Wert: sonst liefe der Effekt im Platzhalter bei jedem Rendern.
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** Steht in der Werkzeugleiste und nimmt die Bedienelemente des Diagramms auf. */
export function ChartToolbarSlot() {
  const context = useContext(SlotContext);
  const ref = useRef<HTMLDivElement>(null);
  const setSlot = context?.setSlot;

  useEffect(() => {
    setSlot?.(ref.current);
    return () => setSlot?.(null);
  }, [setSlot]);

  return <div className="row chart-toolbar" ref={ref} />;
}

/**
 * Wird im Diagramm gerendert, erscheint aber im Platzhalter oben. Ohne
 * Platzhalter (etwa im PNG-Export oder in Tests) entfällt der Inhalt still.
 */
export function ChartToolbar({ children }: { children: ReactNode }) {
  const context = useContext(SlotContext);
  if (!context?.slot) return null;
  return createPortal(children, context.slot);
}
