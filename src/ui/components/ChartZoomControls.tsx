/**
 * Zoomstufe eines zeitbasierten Diagramms - dieselbe Bedienung wie im
 * Netzplan, damit man nicht zwei Muster lernen muss.
 */
import type { ChartZoom } from './useChartZoom';
import { Button } from './controls';

export function ChartZoomControls({ zoom }: { zoom: ChartZoom }) {
  return (
    <>
      <Button size="sm" icon onClick={() => zoom.zoomBy(1 / 1.3)} title="Zeitachse stauchen">
        &minus;
      </Button>
      <span className="viz__zoomlevel mono" title="Aktuelle Zoomstufe">
        {Math.round(zoom.zoom * 100)}%
      </span>
      <Button size="sm" icon onClick={() => zoom.zoomBy(1.3)} title="Zeitachse dehnen">
        +
      </Button>
      <Button
        size="sm"
        onClick={zoom.fit}
        disabled={!zoom.userAdjusted}
        title="Gesamten Zeitraum wieder über die volle Breite zeigen"
      >
        Einpassen
      </Button>
    </>
  );
}
