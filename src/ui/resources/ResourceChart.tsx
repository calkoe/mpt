/**
 * Ressourcen-Ganglinie als gestapeltes Balkendiagramm.
 *
 * Ein Balken je Zeitraum, aufgeteilt nach den Aufgaben, aus denen sich die
 * Last zusammensetzt - die Gesamthöhe allein beantwortet nämlich nie die
 * eigentliche Frage: "Wodurch bin ich hier eigentlich ausgelastet?"
 *
 * Die Farben kommen aus `taskPalette` (nur Blau-/Türkistöne), damit sie nicht
 * mit den frei vergebenen Tag-Farben verwechselt werden. Dieselbe Farbe
 * erscheint in der Legende unter dem Diagramm.
 *
 * Die Höhe folgt der verfügbaren Fläche; Grenzwerte liegen als gestrichelte
 * Treppe darüber, Überschreitungen werden rot umrandet.
 */
import { useMemo, useState, type RefObject } from 'react';
import type { Id } from '../../model/types';
import { formatValue, type ResourceSeries } from '../../engine/resources';
import { diffDays, formatDateDe, today } from '../../engine/dates';
import { utilisationState } from '../../engine/validate';
import { useElementSize } from '../components/useElementSize';
import { taskColorOf } from '../components/taskPalette';

const PADDING_LEFT = 54;
/** Rechts liegt die zweite Achse fuer die kumulierte Summe. */
const PADDING_RIGHT = 62;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 26;
const MIN_BUCKET_WIDTH = 18;
/** Nur als Rückfallwert, solange die Fläche noch nicht gemessen wurde. */
const FALLBACK_HEIGHT = 150;

/**
 * Breite der beiden mitgeführten Achsenstreifen für den PNG-Export. Sie bleiben
 * am Bildschirm stehen, das Bild ist aber breiter - siehe export/png.ts.
 */
export const RESCHART_AXES_FIT = { left: PADDING_LEFT, right: PADDING_RIGHT };

export function ResourceChart({
  series,
  onSelectTask,
  taskLabel,
  taskColors,
  zoom,
  onHoverPoint,
  plotRef,
  axesRef,
}: {
  series: ResourceSeries;
  onSelectTask?: (taskId: Id) => void;
  taskLabel: (taskId: Id) => string;
  taskColors: Map<Id, string>;
  /** Gemeinsame Zoomstufe aller Ganglinien - siehe ResourceOverview. */
  zoom: number;
  /**
   * Meldet den überfahrenen Zeitraum nach oben. Die Kachelüberschrift zeigt
   * daraufhin dessen Kennzahlen - dort steht die Frage "wieviel in diesem
   * Quartal?" ohnehin an, und im Diagramm selbst ist dafür kein Platz.
   */
  onHoverPoint?: (point: ResourceSeries['points'][number] | null) => void;
  /**
   * Zeichenfläche und mitgeführte Achsen. Sie liegen ausserhalb, weil der
   * PNG-Knopf in der Kachelkopfzeile sitzt - das Diagramm selbst hat dort
   * keinen Platz und würde ihn beim Scrollen ohnehin verlieren.
   */
  plotRef?: RefObject<SVGSVGElement>;
  axesRef?: RefObject<SVGSVGElement>;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const enter = (index: number) => {
    setHover(index);
    onHoverPoint?.(series.points[index] ?? null);
  };
  const leave = () => {
    setHover(null);
    onHoverPoint?.(null);
  };
  const box = useElementSize<HTMLDivElement>();

  const count = series.points.length;
  /*
   * Die Zeichenflaeche folgt exakt der gemessenen Hoehe. Eine Untergrenze
   * darueber waere falsch: waere sie groesser als die Kachel, ragte das SVG
   * unten heraus und die Beschriftung der Zeitachse wuerde abgeschnitten.
   * Fuer genug Platz sorgt stattdessen die Mindesthoehe der Rasterzeile
   * (`.resource-grid`). Ein Pixel Reserve verhindert einen Scrollbalken durch
   * Rundung.
   */
  const height = box.height > 0 ? box.height - 1 : FALLBACK_HEIGHT;
  /*
   * Untergrenze bewusst niedrig: sie soll nur verhindern, dass ein Diagramm
   * mit sehr wenigen Zeitraeumen zum Strich zusammenfaellt. Ein hoher Wert
   * wuerde dem automatischen Einpassen entgegenarbeiten - die Flaeche waere
   * dann breiter als die Kachel und das Diagramm liesse sich nur scrollend
   * betrachten.
   */
  const innerWidth = Math.max(120, count * MIN_BUCKET_WIDTH * zoom);
  const width = PADDING_LEFT + innerWidth + PADDING_RIGHT;
  /** Sichtbare Breite - daran haengen die mitgefuehrten Achsen. */
  const viewportWidth = Math.max(PADDING_LEFT + PADDING_RIGHT + 40, box.width);
  const bucketWidth = innerWidth / Math.max(1, count);
  const maxValue = Math.max(series.peak, 1e-6) * 1.15;

  const y = (value: number) => PADDING_TOP + (1 - value / maxValue) * (height - PADDING_TOP - PADDING_BOTTOM);
  const x = (index: number) => PADDING_LEFT + index * bucketWidth;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxValue);

  // Grenzwertlinie als Treppe (Grenzwerte können je Bucket wechseln).
  const limitPath = series.points
    .map((point, index) => {
      const left = `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.limit)}`;
      const right = `L ${x(index + 1)} ${y(point.limit)}`;
      return `${left} ${right}`;
    })
    .join(' ');

  /*
   * Kumulierte Linie, auf die eigene Hoehe skaliert. Sie steigt monoton; ihre
   * Steigung zeigt den Bedarf je Zeiteinheit.
   */
  const cumulativeMax = Math.max(series.cumulativeTotal, 1e-6);
  /** Personentage statt FTE: eine Rate laesst sich nicht aufsummieren. */
  const cumulativeUnit = series.unit === 'FTE' ? 'PT' : series.unit;
  const cumulativeY = (value: number) =>
    PADDING_TOP + (1 - value / cumulativeMax) * (height - PADDING_TOP - PADDING_BOTTOM);
  const cumulativeTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * cumulativeMax);
  const cumulativePath =
    series.cumulativeTotal > 0
      ? series.points
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index) + bucketWidth / 2} ${cumulativeY(point.cumulative)}`)
          .join(' ')
      : '';

  /**
   * Waagerechte Lage des heutigen Tages. Der Bucket, in den er faellt, wird
   * anteilig interpoliert - sonst spraenge die Linie bei grobem Raster um ein
   * ganzes Quartal.
   */
  const todayIso = today();
  const todayX = (() => {
    const index = series.points.findIndex(
      (p) => diffDays(p.bucket.start, todayIso) >= 0 && diffDays(todayIso, p.bucket.end) >= 0,
    );
    if (index < 0) return null;
    const bucket = series.points[index].bucket;
    const span = Math.max(1, diffDays(bucket.start, bucket.end) + 1);
    const into = diffDays(bucket.start, todayIso) / span;
    return x(index) + bucketWidth * into;
  })();

  const hasLimit = series.points.some((p) => p.limit > 0);
  /** Nur Budgets kennen den Unterschied zwischen geplant und ausgegeben. */
  const isBudget = series.kind === 'budget';
  const hovered = hover !== null ? series.points[hover] : null;

  /** Aufgaben, die überhaupt zu dieser Ressource beitragen - für die Legende. */
  const contributors = useMemo(() => {
    const seen = new Map<Id, number>();
    for (const point of series.points) {
      for (const part of point.parts) seen.set(part.taskId, (seen.get(part.taskId) ?? 0) + part.value);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([taskId]) => taskId);
  }, [series.points]);

  if (count === 0) {
    return <div className="empty">Keine Daten im Betrachtungszeitraum.</div>;
  }

  return (
    <div className="reschart">
      <div className="reschart__plot" ref={box.ref}>
        <svg ref={plotRef} width={width} height={height} role="img" aria-label={`Ganglinie ${series.name}`}>
          {/* Raster - die Beschriftung liegt in der mitgefuehrten Ebene. */}
          {ticks.map((tick, i) => (
            <line
              key={i}
              className="chart__gridline"
              x1={PADDING_LEFT}
              y1={y(tick)}
              x2={width - PADDING_RIGHT}
              y2={y(tick)}
            />
          ))}

          {/*
            Gestapelte Balken: ein Segment je beitragender Aufgabe.

            Bei Budgets liegen zwei Balken **ineinander**: aussen und blass die
            Planung, innen und kräftig das tatsächlich abgerufene Geld. So sieht
            man in einem Bild beides - was vorgesehen war und was davon schon
            weg ist - ohne zwei Diagramme nebeneinander vergleichen zu müssen.
            Die Farbe je Aufgabe bleibt dieselbe, nur die Deckkraft trennt die
            beiden Aussagen.
          */}
          {series.points.map((point, index) => {
            const state = utilisationState(isBudget ? point.actual : point.value, point.limit);
            const barX = x(index) + 2;
            const barWidth = Math.max(1, bucketWidth - 4);
            /** Der Ist-Balken sitzt schmaler mittig im Plan-Balken. */
            const actualWidth = Math.max(1, barWidth * 0.52);
            const actualX = barX + (barWidth - actualWidth) / 2;
            let plannedCursor = 0;
            let actualCursor = 0;

            return (
              <g key={point.bucket.key} onMouseEnter={() => enter(index)} onMouseLeave={leave}>
                {/*
                  **Ein** Tooltip je Zeitraum, an der Gruppe statt an jedem
                  Segment. Ein `<title>` gilt für das Element samt allem
                  darin - an der Gruppe deckt es die ganze Säule ab, auch die
                  leere Fläche darüber. Vorher trug jedes gestapelte Segment
                  einen eigenen; bei acht Kacheln waren das über viertausend
                  zusätzliche Knoten, die React bei jeder Änderung abgleichen
                  musste. Der Inhalt geht dabei nicht verloren: `tooltip()`
                  listet die Aufgaben ohnehin einzeln auf, und die Zeile unter
                  dem Diagramm zeigt dieselbe Aufteilung farbig.
                */}
                {(point.value > 0 || point.actual > 0) && (
                  <title>{tooltip(point, series, taskLabel)}</title>
                )}

                {/*
                  Fängt den Zeiger für die ganze Säule ab - `pointer-events`
                  ausdrücklich, weil die Fläche ungehoverte durchsichtig ist
                  und sonst nur die Balken selbst treffbar wären.
                */}
                <rect
                  className="chart__column"
                  x={x(index)}
                  y={PADDING_TOP}
                  width={bucketWidth}
                  height={height - PADDING_TOP - PADDING_BOTTOM}
                  fill={hover === index ? 'var(--accent)' : 'transparent'}
                  opacity={hover === index ? 0.07 : 0}
                />

                {point.parts.map((part) => {
                  const top = plannedCursor + part.value;
                  const segmentY = y(top);
                  const segmentHeight = Math.max(0.5, y(plannedCursor) - y(top));
                  plannedCursor = top;
                  return (
                    <rect
                      key={part.taskId}
                      className="chart__segment"
                      x={barX}
                      y={segmentY}
                      width={barWidth}
                      height={segmentHeight}
                      fill={taskColorOf(taskColors, part.taskId)}
                      opacity={isBudget ? 0.4 : 1}
                      onClick={() => onSelectTask?.(part.taskId)}
                    />
                  );
                })}

                {isBudget &&
                  point.parts.map((part) => {
                    const spent = part.actual ?? 0;
                    if (spent <= 0) return null;
                    const top = actualCursor + spent;
                    const segmentY = y(top);
                    const segmentHeight = Math.max(0.5, y(actualCursor) - y(top));
                    actualCursor = top;
                    return (
                      <rect
                        key={`actual-${part.taskId}`}
                        className="chart__segment"
                        x={actualX}
                        y={segmentY}
                        width={actualWidth}
                        height={segmentHeight}
                        fill={taskColorOf(taskColors, part.taskId)}
                        onClick={() => onSelectTask?.(part.taskId)}
                      />
                    );
                  })}

                {/*
                  Überschreitungen bekommen eine rote Klammer um den ganzen
                  Stapel. Ohne eigenen Tooltip - der hängt an der Gruppe und
                  gilt damit auch hier.
                */}
                {point.value > 0 && (
                  <rect
                    className={`chart__stack chart__stack--${state}`}
                    x={barX}
                    y={y(point.value)}
                    width={barWidth}
                    height={Math.max(0.5, y(0) - y(point.value))}
                  />
                )}
              </g>
            );
          })}

          {/*
            Kumulierte Linie mit eigener Achse rechts. Die Summe ist um
            Groessenordnungen groesser als der Wert je Zeitraum - auf derselben
            Skala waeren die Saeulen platt oder die Linie liefe aus dem Bild.
          */}
          {cumulativePath && <path className="chart__cumulative" d={cumulativePath} />}

          {/*
            Heute als gestrichelte Senkrechte - dasselbe Zeichen wie im Gantt,
            damit man in beiden Ansichten sofort weiss, wo man steht.
          */}
          {todayX !== null && (
            <line className="chart__today" x1={todayX} y1={PADDING_TOP} x2={todayX} y2={y(0)}>
              <title>Heute</title>
            </line>
          )}

          {/* Grenzwert */}
          {hasLimit && <path className="chart__limit" d={limitPath} />}

          {/* Achsen */}
          <line className="chart__axis" x1={PADDING_LEFT} y1={y(0)} x2={width - PADDING_RIGHT} y2={y(0)} />

          {/* X-Beschriftung, ausgedünnt bei vielen Buckets */}
          {series.points.map((point, index) => {
            const every = Math.ceil((count * 46) / innerWidth);
            if (index % every !== 0) return null;
            return (
              <text
                key={point.bucket.key}
                className="chart__tick"
                x={x(index) + bucketWidth / 2}
                y={height - 10}
                textAnchor="middle"
              >
                {point.bucket.label}
              </text>
            );
          })}
        </svg>

        {/*
          Beide Achsen bleiben stehen. Sie liegen am linken und rechten Rand des
          **sichtbaren** Bereichs, nicht am Rand des Inhalts: das Diagramm ist
          breiter als die Flaeche (zehn Jahre Vorschau), und eine Skala, die man
          erst herscrollen muss, ist keine Skala. Umgesetzt ueber
          `position: sticky` - das erledigt der Compositor ohne JavaScript.
        */}
        <svg
          ref={axesRef}
          className="reschart__axes"
          width={viewportWidth}
          height={height}
          style={{ marginTop: -height }}
        >
          <rect className="reschart__axis-bg" x={0} y={0} width={PADDING_LEFT - 4} height={height} />
          {ticks.map((tick, i) => (
            <text key={i} className="chart__tick" x={PADDING_LEFT - 6} y={y(tick) + 3} textAnchor="end">
              {compact(tick, series.unit)}
            </text>
          ))}

          {cumulativePath && (
            <>
              <rect
                className="reschart__axis-bg"
                x={viewportWidth - PADDING_RIGHT + 2}
                y={0}
                width={PADDING_RIGHT}
                height={height}
              />
              <line
                className="chart__axis chart__axis--cumulative"
                x1={viewportWidth - PADDING_RIGHT}
                y1={PADDING_TOP}
                x2={viewportWidth - PADDING_RIGHT}
                y2={y(0)}
              />
              {cumulativeTicks.map((tick, i) => (
                <text
                  key={i}
                  className="chart__tick chart__tick--cumulative"
                  x={viewportWidth - PADDING_RIGHT + 6}
                  y={cumulativeY(tick) + 3}
                >
                  {compact(tick, cumulativeUnit)}
                </text>
              ))}
            </>
          )}
        </svg>
      </div>

      {/*
        Unter dem Diagramm entweder die Aufteilung des überfahrenen Zeitraums
        oder - solange nichts überfahren wird - die Legende. Beides in
        derselben Zeile, damit die Farbzuordnung immer sichtbar ist.
      */}
      <div className="reschart__legend">
        {hovered ? (
          <>
            <strong className="nowrap">{hovered.bucket.label}</strong>
            <span className="mono" title={isBudget ? 'geplant' : undefined}>
              {formatValue(hovered.value, series.unit)}
            </span>
            {isBudget && (
              <span className="mono" title="tatsächlich ausgegeben">
                → {formatValue(hovered.actual, series.unit)}
              </span>
            )}
            {hovered.limit > 0 && (
              <span className={hovered.value > hovered.limit ? 'table__breach' : 'faint'}>
                Grenzwert {formatValue(hovered.limit, series.unit)}
              </span>
            )}
            <span className="faint nowrap">
              {formatDateDe(hovered.bucket.start)} - {formatDateDe(hovered.bucket.end)}
            </span>
            {hovered.parts.slice(0, 6).map((part) => (
              <LegendChip
                key={part.taskId}
                color={taskColorOf(taskColors, part.taskId)}
                label={`${taskLabel(part.taskId)}: ${formatValue(part.value, series.unit)}`}
                onClick={() => onSelectTask?.(part.taskId)}
              />
            ))}
          </>
        ) : (
          contributors
            .slice(0, 8)
            .map((taskId) => (
              <LegendChip
                key={taskId}
                color={taskColorOf(taskColors, taskId)}
                label={taskLabel(taskId)}
                onClick={() => onSelectTask?.(taskId)}
              />
            ))
        )}
      </div>
    </div>
  );
}

function LegendChip({ color, label, onClick }: { color: string; label: string; onClick?: () => void }) {
  return (
    <button type="button" className="chip chip--button" onClick={onClick} title="Zur Aufgabe springen">
      <span className="chip__dot" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Der einzige Tooltip eines Zeitraums - er hängt an der Gruppe und gilt damit
 * für die ganze Säule.
 *
 * Er nennt je Aufgabe auch den abgerufenen Anteil. Das stand früher an einem
 * eigenen `<title>` im inneren Balken; die Angabe ist damit nicht verloren,
 * sondern nur an einer Stelle statt an vieren.
 */
function tooltip(
  point: ResourceSeries['points'][number],
  series: ResourceSeries,
  taskLabel: (id: string) => string,
): string {
  const isBudget = series.kind === 'budget';
  const lines = [
    `${point.bucket.label}: ${formatValue(point.value, series.unit)}${isBudget ? ' geplant' : ''}`,
    isBudget ? `davon ausgegeben: ${formatValue(point.actual, series.unit)}` : '',
    point.limit > 0 ? `Grenzwert: ${formatValue(point.limit, series.unit)}` : '',
    ...point.parts.slice(0, 8).map((p) => {
      const spent = isBudget && (p.actual ?? 0) > 0 ? `, davon ${formatValue(p.actual ?? 0, series.unit)} ausgegeben` : '';
      return `  ${taskLabel(p.taskId)}: ${formatValue(p.value, series.unit)}${spent}`;
    }),
  ];
  return lines.filter(Boolean).join('\n');
}

function compact(value: number, unit: string): string {
  if (unit === 'EUR') {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
    return String(Math.round(value));
  }
  return value.toFixed(unit === 'FTE' ? 2 : 0);
}
