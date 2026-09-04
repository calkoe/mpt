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
import { useMemo, useState } from 'react';
import type { Id } from '../../model/types';
import { formatValue, type ResourceSeries } from '../../engine/resources';
import { formatDateDe } from '../../engine/dates';
import { useElementSize } from '../components/useElementSize';
import { taskColorOf } from '../components/taskPalette';

const PADDING_LEFT = 54;
const PADDING_RIGHT = 12;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 26;
const MIN_BUCKET_WIDTH = 18;
/** Unterhalb dieser Höhe wird das Diagramm unlesbar. */
const MIN_HEIGHT = 150;

export function ResourceChart({
  series,
  onSelectTask,
  taskLabel,
  taskColors,
}: {
  series: ResourceSeries;
  onSelectTask?: (taskId: Id) => void;
  taskLabel: (taskId: Id) => string;
  taskColors: Map<Id, string>;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useElementSize<HTMLDivElement>();

  const count = series.points.length;
  // Ein Pixel Reserve: sonst erzeugt eine halbe Pixelzeile aus der Messung
  // einen senkrechten Scrollbalken, obwohl das Diagramm genau passt.
  const height = Math.max(MIN_HEIGHT, (box.height || MIN_HEIGHT) - 1);
  const innerWidth = Math.max(320, count * MIN_BUCKET_WIDTH);
  const width = PADDING_LEFT + innerWidth + PADDING_RIGHT;
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

  const hasLimit = series.points.some((p) => p.limit > 0);
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
        <svg width={width} height={height} role="img" aria-label={`Ganglinie ${series.name}`}>
          {/* Raster */}
          {ticks.map((tick, i) => (
            <g key={i}>
              <line className="chart__gridline" x1={PADDING_LEFT} y1={y(tick)} x2={width - PADDING_RIGHT} y2={y(tick)} />
              <text className="chart__tick" x={PADDING_LEFT - 6} y={y(tick) + 3} textAnchor="end">
                {compact(tick, series.unit)}
              </text>
            </g>
          ))}

          {/* Gestapelte Balken: ein Segment je beitragender Aufgabe. */}
          {series.points.map((point, index) => {
            const breach = point.limit > 0 && point.value > point.limit + 1e-9;
            const barX = x(index) + 2;
            const barWidth = Math.max(1, bucketWidth - 4);
            let cursor = 0;

            return (
              <g key={point.bucket.key} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}>
                <rect
                  x={x(index)}
                  y={PADDING_TOP}
                  width={bucketWidth}
                  height={height - PADDING_TOP - PADDING_BOTTOM}
                  fill={hover === index ? 'var(--accent)' : 'transparent'}
                  opacity={hover === index ? 0.07 : 0}
                />

                {point.parts.map((part) => {
                  const top = cursor + part.value;
                  const segmentY = y(top);
                  const segmentHeight = Math.max(0.5, y(cursor) - y(top));
                  cursor = top;
                  return (
                    <rect
                      key={part.taskId}
                      className="chart__segment"
                      x={barX}
                      y={segmentY}
                      width={barWidth}
                      height={segmentHeight}
                      fill={taskColorOf(taskColors, part.taskId)}
                      onClick={() => onSelectTask?.(part.taskId)}
                    >
                      <title>{`${taskLabel(part.taskId)}: ${formatValue(part.value, series.unit)}\n${point.bucket.label}`}</title>
                    </rect>
                  );
                })}

                {/* Überschreitungen bekommen eine rote Klammer um den ganzen Stapel. */}
                {point.value > 0 && (
                  <rect
                    className={`chart__stack${breach ? ' chart__stack--breach' : ''}`}
                    x={barX}
                    y={y(point.value)}
                    width={barWidth}
                    height={Math.max(0.5, y(0) - y(point.value))}
                  >
                    <title>{tooltip(point, series, taskLabel)}</title>
                  </rect>
                )}
              </g>
            );
          })}

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
            <span className="mono">{formatValue(hovered.value, series.unit)}</span>
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

function tooltip(
  point: ResourceSeries['points'][number],
  series: ResourceSeries,
  taskLabel: (id: string) => string,
): string {
  const lines = [
    `${point.bucket.label}: ${formatValue(point.value, series.unit)}`,
    point.limit > 0 ? `Grenzwert: ${formatValue(point.limit, series.unit)}` : '',
    ...point.parts.slice(0, 8).map((p) => `  ${taskLabel(p.taskId)}: ${formatValue(p.value, series.unit)}`),
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
