/**
 * Zoomstufe für die zeitbasierten Diagramme (Gantt, Ressourcen-Ganglinien).
 *
 * Anders als `useZoomPan` wird hier nichts verschoben: die Diagramme scrollen
 * waagerecht, gezoomt wird nur ihre Breite. Der Faktor multipliziert die
 * Grundbreite je Zeiteinheit.
 *
 * Der wichtige Teil ist das automatische Einpassen: wechselt man das Zeitraster
 * von Woche auf Quartal, ändert sich die Zahl der Säulen um eine Größenordnung.
 * Ohne Nachführung steht man danach entweder vor einem kilometerbreiten
 * Diagramm oder vor einem Streifen am linken Rand. Deshalb wird bei jedem
 * Wechsel der Zeitspanne die Stufe neu bestimmt, bei der der gesamte Zeitraum
 * genau in die Fläche passt - bis der Nutzer selbst zoomt.
 */
import { useEffect, useRef, useState } from 'react';

export const MIN_CHART_ZOOM = 0.2;
export const MAX_CHART_ZOOM = 6;

export interface ChartZoom {
  /** Faktor auf die Grundbreite je Zeiteinheit. */
  zoom: number;
  zoomBy: (factor: number) => void;
  /** Wieder einpassen und die automatische Nachführung reaktivieren. */
  fit: () => void;
  userAdjusted: boolean;
}

export function useChartZoom({
  /** Breite des Inhalts bei Faktor 1, in Pixeln. */
  naturalWidth,
  /** Verfügbare Breite der Fläche, in Pixeln. */
  availableWidth,
  /**
   * Ändert sich dieser Schlüssel, wird neu eingepasst - unabhängig davon, ob
   * vorher von Hand gezoomt wurde. Gedacht für Zeitraster und Zeitraum.
   */
  resetKey,
}: {
  naturalWidth: number;
  availableWidth: number;
  resetKey: string;
}): ChartZoom {
  const [zoom, setZoom] = useState(1);
  const [userAdjusted, setUserAdjusted] = useState(false);
  const lastKey = useRef(resetKey);

  const clamp = (value: number) => Math.min(MAX_CHART_ZOOM, Math.max(MIN_CHART_ZOOM, value));
  const fitting = () =>
    naturalWidth > 0 && availableWidth > 0 ? clamp(availableWidth / naturalWidth) : 1;

  // Einpassen beim ersten Aufbau, bei jeder Änderung der Zeitspanne und
  // solange der Nutzer nicht selbst gezoomt hat.
  useEffect(() => {
    const keyChanged = lastKey.current !== resetKey;
    if (keyChanged) {
      lastKey.current = resetKey;
      setUserAdjusted(false);
      setZoom(fitting());
      return;
    }
    if (!userAdjusted) setZoom(fitting());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, naturalWidth, availableWidth, userAdjusted]);

  return {
    zoom,
    zoomBy: (factor) => {
      setUserAdjusted(true);
      setZoom((current) => clamp(current * factor));
    },
    fit: () => {
      setUserAdjusted(false);
      setZoom(fitting());
    },
    userAdjusted,
  };
}
