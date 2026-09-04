/**
 * Tag-Marken in den SVG-Visualisierungen.
 *
 * Kleine Textmarken mit farbigem Hintergrund - dieselbe Idee wie `.badge` in
 * der Oberfläche: Fläche und Schrift teilen sich die Tag-Farbe, die Fläche
 * stark abgeschwächt. So bleibt der Name lesbar, egal wie hell oder dunkel die
 * Farbe ist.
 *
 * Wird von Aufgabenknoten **und** Ressourcenblöcken genutzt, damit ein Tag
 * überall gleich aussieht.
 */
import type { Id } from '../../model/types';

export interface BadgeTag {
  id: Id;
  name: string;
  color: string;
}

/** Höhe einer Marke - für die Platzberechnung im aufrufenden Knoten. */
export const TAG_BADGE_HEIGHT = 13;

interface PlacedBadge {
  key: string;
  label: string;
  color: string;
  x: number;
  width: number;
}

/**
 * Ordnet Marken nebeneinander an und lässt weg, was nicht mehr passt.
 *
 * Die Breite wird aus der Zeichenzahl geschätzt - im SVG lässt sich Text ohne
 * Messung nicht ausmessen, und eine Messung je Knoten wäre für diesen Zweck
 * deutlich zu teuer. Bei 9 px Schrift trägt ein Zeichen rund 5 px.
 */
export function layoutTagBadges(tags: BadgeTag[], available: number, startX: number): PlacedBadge[] {
  const CHAR = 5;
  const PAD = 10;
  const GAP = 4;

  const result: PlacedBadge[] = [];
  let x = startX;
  for (const tag of tags) {
    const label = truncate(tag.name, 12);
    const width = label.length * CHAR + PAD;
    if (x - startX + width > available) {
      // Rest passt nicht mehr - als "+n" andeuten statt überzulaufen.
      const rest = tags.length - result.length;
      if (rest > 0 && x - startX + 22 <= available) {
        result.push({ key: 'more', label: `+${rest}`, color: 'var(--text-faint)', x, width: 22 });
      }
      break;
    }
    result.push({ key: tag.id, label, color: tag.color, x, width });
    x += width + GAP;
  }
  return result;
}

export function TagBadges({
  tags,
  y,
  available,
  startX = 12,
}: {
  tags: BadgeTag[];
  /** Obere Kante der Markenzeile. */
  y: number;
  /** Verfügbare Breite für die Zeile. */
  available: number;
  startX?: number;
}) {
  if (tags.length === 0) return null;
  return (
    <g className="node__tags">
      {layoutTagBadges(tags, available, startX).map((badge) => (
        <g key={badge.key} transform={`translate(${badge.x},${y})`}>
          <rect width={badge.width} height={TAG_BADGE_HEIGHT} rx={3} ry={3} fill={badge.color} opacity={0.22} />
          <text x={5} y={9.5} fontSize={9} fill={badge.color} className="node__tag-label">
            {badge.label}
          </text>
        </g>
      ))}
    </g>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
