/**
 * Leiste unterhalb der Visualisierung.
 *
 * Zeigt als kleine Blöcke alles, was an den aktuell sichtbaren Aufgaben hängt:
 * Personen, Budgets und die ungetrackten Bedingungen. Verbunden sind sie mit
 * gestrichelten, gebogenen Linien nach oben zu den zugehörigen Aufgaben.
 * Wird direkt in das SVG der jeweiligen Visualisierung eingebettet, damit die
 * Verbindungen exakt sitzen und beim Zoomen mitwandern.
 *
 * Beim Überfahren eines Blocks meldet die Leiste die betroffenen Aufgaben nach
 * oben (`onHighlight`); die Visualisierung hebt sie dann hervor.
 */
import { useMemo } from 'react';
import type { Client, Id, Task } from '../../model/types';
import { railPath } from '../../engine/layout';
import { formatValue } from '../../engine/resources';
import type { Warning } from '../../engine/validate';
import { useStore } from '../../state/store';
import { TagBadges, type BadgeTag } from './TagBadges';
import { fitText, fontOf } from '../components/measureText';

/** Kopfzeile der Leiste: Trennlinie und Beschriftung über den Blöcken. */
const RAIL_HEAD = 34;
/** Grundhöhe mit einer Blockreihe. */
export const RAIL_HEIGHT = 108;

/**
 * Wieviele Blöcke nebeneinander passen und wie hoch die Leiste dadurch wird.
 *
 * Bei vielen Ressourcen liefen die Blöcke früher rechts aus dem Bild - im
 * Gantt umso schneller, weil die Leiste dort nur die sichtbare Breite hat und
 * nicht mitscrollt. Sie brechen deshalb um; die Leiste wächst mit.
 */
export function railLayout(count: number, width: number, offsetX = 0) {
  const available = Math.max(MIN_BLOCK_WIDTH, width - offsetX - BLOCK_GAP);
  const perRow = Math.max(1, Math.floor(available / (MIN_BLOCK_WIDTH + BLOCK_GAP)));
  const rows = Math.max(1, Math.ceil(count / perRow));
  const blockWidth = Math.max(MIN_BLOCK_WIDTH, Math.min(MAX_BLOCK_WIDTH, available / perRow - BLOCK_GAP));
  return { perRow, rows, blockWidth };
}

/**
 * Wieviele Blöcke die Leiste zeigen wird - die Diagramme müssen ihre Höhe
 * kennen, bevor sie zeichnen. Gezählt werden dieselben Quellen wie unten:
 * zugeordnete Personen, belastete Budgets und verknüpfte Bedingungen.
 */
export function countRailBlocks(client: Client, tasks: Task[]): number {
  const ids = new Set<Id>();
  for (const task of tasks) {
    for (const a of task.assignments) {
      if (client.people.some((p) => p.id === a.personId)) ids.add(a.personId);
    }
    for (const c of task.costs) {
      if (client.budgets.some((b) => b.id === c.budgetId)) ids.add(c.budgetId);
    }
    for (const id of task.conditionIds) {
      if (client.conditions.some((x) => x.id === id)) ids.add(id);
    }
  }
  return ids.size;
}

/** Höhe, die die Leiste für `count` Blöcke braucht. */
export function railHeight(count: number, width: number, offsetX = 0): number {
  if (count === 0) return RAIL_HEIGHT;
  const { rows } = railLayout(count, width, offsetX);
  return RAIL_HEAD + rows * (BLOCK_HEIGHT + BLOCK_GAP) + BLOCK_GAP;
}
/** Hoeher als frueher: unter den Kennzahlen ist Platz fuer die Tag-Marken. */
const BLOCK_HEIGHT = 50;

/*
 * Alle Bloecke sind gleich hoch - eine Leiste mit unterschiedlich hohen
 * Kaesten waere unruhig. Bloecke ohne Tags haetten dann aber unten ein totes
 * Loch, deshalb rutscht ihr Inhalt in die Mitte. Die beiden Werte sind die
 * Hoehe des Inhalts mit und ohne Markenzeile.
 */
const CONTENT_HEIGHT_WITH_TAGS = 42;
const CONTENT_HEIGHT_PLAIN = 24;
/** Obere Kante des Inhalts, wenn er oben ausgerichtet waere. */
const CONTENT_TOP = 4;
const BLOCK_GAP = 12;
/*
 * Breiter als zunaechst gedacht: in einen 118px-Block passten von
 * "Betriebskostenbudget" gerade die ersten zwei Silben. Namen von Personen und
 * Budgets sind in der Praxis lang, und ein Block, dessen Beschriftung immer
 * abgeschnitten ist, beantwortet die Frage nicht, fuer die er da ist.
 */
const MIN_BLOCK_WIDTH = 158;
const MAX_BLOCK_WIDTH = 230;
/** Linke Kante des Textes - lässt Platz für das Symbol der Ressourcenart. */
const TEXT_X = 30;
/** Luft zwischen Text und rechter Blockkante. */
const TEXT_PADDING = 10;

export interface RailAnchor {
  taskId: Id;
  x: number;
  y: number;
}

type BlockKind = 'person' | 'budget' | 'condition';

interface RailBlock {
  id: Id;
  kind: BlockKind;
  label: string;
  detail: string;
  /** Tags der Ressource - Bedingungen haben keine. */
  tags: BadgeTag[];
  taskIds: Id[];
  /** Grenzwert überschritten bzw. Bedingung nicht erfüllt. */
  alert: boolean;
  x: number;
  /** Zeile innerhalb der Leiste - bei vielen Ressourcen brechen die Blöcke um. */
  row: number;
  width: number;
}

const KIND_COLOR: Record<BlockKind, string> = {
  person: 'var(--accent)',
  budget: 'var(--ok)',
  condition: 'var(--warn)',
};

const KIND_TITLE: Record<BlockKind, string> = {
  person: 'Person',
  budget: 'Budget',
  condition: 'Bedingung',
};

export function ResourceRailLayer({
  client,
  tasks,
  anchors,
  top,
  width,
  offsetX = 0,
  resourceWarnings,
  highlighted,
  onHighlight,
}: {
  client: Client;
  tasks: Task[];
  anchors: RailAnchor[];
  /** Y-Koordinate, ab der die Leiste gezeichnet wird. */
  top: number;
  width: number;
  /**
   * Linker Rand der Bloecke. Im Gantt beginnt die Leiste erst hinter der festen
   * Beschriftungsspalte: sonst liefen die Verbindungslinien nach links unter
   * die Spalte und waeren dort verdeckt.
   */
  offsetX?: number;
  resourceWarnings: Map<Id, Warning[]>;
  /** Aktuell hervorgehobene Aufgaben; null = keine Hervorhebung. */
  highlighted: Set<Id> | null;
  onHighlight: (tasks: Set<Id> | null) => void;
}) {
  const { ui, setUi, commitClient } = useStore();

  const blocks = useMemo<RailBlock[]>(() => {
    interface Entry {
      kind: BlockKind;
      label: string;
      detail: string;
      amount: number;
      tags: BadgeTag[];
      taskIds: Id[];
      alert: boolean;
    }
    const tagsOf = (ids: Id[]): BadgeTag[] =>
      ids.map((id) => client.tags.find((t) => t.id === id)).filter((t): t is BadgeTag => Boolean(t));
    const map = new Map<Id, Entry>();

    for (const task of tasks) {
      for (const a of task.assignments) {
        const person = client.people.find((p) => p.id === a.personId);
        if (!person) continue;
        const entry =
          map.get(person.id) ??
          ({
            kind: 'person',
            label: person.name,
            detail: '',
            amount: 0,
            tags: tagsOf(person.tagIds),
            taskIds: [],
            alert: false,
          } as Entry);
        entry.amount += a.mode === 'FTE' ? a.value : 0;
        entry.taskIds.push(task.id);
        map.set(person.id, entry);
      }
      for (const c of task.costs) {
        const budget = client.budgets.find((b) => b.id === c.budgetId);
        if (!budget) continue;
        const entry =
          map.get(budget.id) ??
          ({
            kind: 'budget',
            label: budget.name,
            detail: '',
            amount: 0,
            tags: tagsOf(budget.tagIds),
            taskIds: [],
            alert: false,
          } as Entry);
        entry.amount += c.amount;
        entry.taskIds.push(task.id);
        map.set(budget.id, entry);
      }
      // Ungetrackte Bedingungen erscheinen wie Ressourcen in der Leiste.
      for (const id of task.conditionIds) {
        const condition = client.conditions.find((x) => x.id === id);
        if (!condition) continue;
        const entry =
          map.get(condition.id) ??
          ({
            kind: 'condition',
            label: condition.name,
            detail: condition.met ? 'erfüllt' : 'offen',
            amount: 0,
            tags: [],
            taskIds: [],
            alert: !condition.met,
          } as Entry);
        entry.taskIds.push(task.id);
        map.set(condition.id, entry);
      }
    }

    const list = [...map.entries()];
    const { perRow, blockWidth } = railLayout(list.length, width, offsetX);

    return list.map(([id, entry], index) => ({
      id,
      kind: entry.kind,
      label: entry.label,
      detail:
        entry.kind === 'person'
          ? `${formatValue(entry.amount, 'FTE')} gebunden`
          : entry.kind === 'budget'
            ? `${formatValue(entry.amount, 'EUR')} geplant`
            : entry.detail,
      tags: entry.tags,
      taskIds: [...new Set(entry.taskIds)],
      alert: entry.alert || (resourceWarnings.get(id)?.length ?? 0) > 0,
      x: offsetX + BLOCK_GAP + (index % perRow) * (blockWidth + BLOCK_GAP),
      row: Math.floor(index / perRow),
      width: blockWidth,
    }));
  }, [client.budgets, client.conditions, client.people, resourceWarnings, tasks, width, offsetX]);

  if (blocks.length === 0) return null;

  const anchorById = new Map(anchors.map((a) => [a.taskId, a]));
  const blockY = (block: RailBlock) => top + RAIL_HEAD + block.row * (BLOCK_HEIGHT + BLOCK_GAP);

  const activate = (block: RailBlock) => {
    if (block.kind === 'condition') {
      // Direkt umschaltbar - erfüllt/nicht erfüllt ist die einzige Eigenschaft.
      commitClient('Bedingung umgeschaltet', (c) => {
        const target = c.conditions.find((x) => x.id === block.id);
        if (target) target.met = !target.met;
      });
      return;
    }
    setUi({ mode: 'resources', selectedResourceId: block.id });
  };

  return (
    <g className="rail-layer">
      <line x1={0} y1={top + 6} x2={width} y2={top + 6} className="chart__gridline" />
      <text x={offsetX + BLOCK_GAP} y={top + 24} className="chart__tick">
        Ressourcen und Bedingungen dieser Aufgaben
      </text>

      {/* Verbindungen */}
      {blocks.map((block) =>
        block.taskIds.map((taskId) => {
          const anchor = anchorById.get(taskId);
          if (!anchor) return null;
          const lit = highlighted
            ? highlighted.has(taskId) && block.taskIds.some((id) => highlighted.has(id))
            : ui.selectedTaskId === taskId || ui.selectedResourceId === block.id;
          return (
            <path
              key={`${block.id}-${taskId}`}
              className={`edge edge--rail${lit ? ' edge--lit' : ''}`}
              d={railPath(anchor.x, anchor.y, block.x + block.width / 2, blockY(block))}
              opacity={lit ? 0.9 : highlighted ? 0.08 : 0.18}
              stroke={lit ? 'var(--accent)' : undefined}
            />
          );
        }),
      )}

      {/* Blöcke */}
      {blocks.map((block) => {
        const lit = Boolean(highlighted && block.taskIds.some((id) => highlighted.has(id)));
        return (
          <g
            key={block.id}
            data-node={block.id}
            className={`rail-block${lit ? ' rail-block--lit' : ''}${highlighted && !lit ? ' rail-block--dim' : ''}`}
            transform={`translate(${block.x},${blockY(block)})`}
            onClick={() => activate(block)}
            onMouseEnter={() => onHighlight(new Set(block.taskIds))}
            onMouseLeave={() => onHighlight(null)}
            tabIndex={0}
            role="button"
            aria-label={`${KIND_TITLE[block.kind]} ${block.label} - ${block.detail}`}
          >
            <title>
              {`${KIND_TITLE[block.kind]}: ${block.label}\n${block.detail}\n${block.taskIds.length} Aufgabe(n)\n` +
                (block.kind === 'condition'
                  ? 'Klick schaltet erfüllt/nicht erfüllt um'
                  : 'Klick öffnet die Ressourcenübersicht')}
            </title>
            <rect
              width={block.width}
              height={BLOCK_HEIGHT}
              rx={6}
              fill={block.alert ? 'var(--warn-soft)' : 'var(--surface-2)'}
              stroke={block.alert ? 'var(--warn)' : 'var(--border)'}
            />
            {/* Ohne Tags sitzt der Inhalt mittig statt oben - siehe oben. */}
            <g transform={`translate(0,${contentOffset(block.tags.length > 0)})`}>
              <KindIcon kind={block.kind} alert={block.alert} />
              {/* Breite messen statt Zeichen zaehlen - sonst ragt der Titel heraus. */}
              <text x={TEXT_X} y={15} className="node__title" fontSize={11}>
                {fitText(block.label, block.width - TEXT_X - TEXT_PADDING, fontOf('600 11px'))}
              </text>
              <text x={TEXT_X} y={27} className="node__meta">
                {fitText(block.detail, block.width - TEXT_X - TEXT_PADDING, fontOf('9px'))}
              </text>
              {/* Tags identisch zu den Aufgabenknoten. */}
              <TagBadges tags={block.tags} y={33} available={block.width - TEXT_X - 8} startX={TEXT_X - 8} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** Senkrechte Verschiebung, damit der Inhalt im gleich hohen Block mittig sitzt. */
function contentOffset(hasTags: boolean): number {
  const height = hasTags ? CONTENT_HEIGHT_WITH_TAGS : CONTENT_HEIGHT_PLAIN;
  return Math.round((BLOCK_HEIGHT - height) / 2 - CONTENT_TOP);
}

/**
 * Symbol der Ressourcenart. Bewusst als reine Form gezeichnet statt als
 * Zeichen aus einer Schriftart - so sieht es in jedem System gleich aus und
 * überlebt auch den PNG-Export.
 */
function KindIcon({ kind, alert }: { kind: BlockKind; alert: boolean }) {
  const color = KIND_COLOR[kind];
  if (kind === 'person') {
    // Kopf und Schultern.
    return (
      <g className="rail-block__icon" transform="translate(9,8)">
        <circle cx="6" cy="4" r="3.2" fill={color} />
        <path d="M0.5 14 C0.5 9.5 11.5 9.5 11.5 14 Z" fill={color} />
      </g>
    );
  }
  if (kind === 'budget') {
    // Münze mit Eurozeichen.
    return (
      <g className="rail-block__icon" transform="translate(9,8)">
        <circle cx="6" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
        <path
          d="M8.4 4.4 A3.4 3.4 0 1 0 8.4 9.6 M2.9 6.2 H7.2 M2.9 8 H7.2"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    );
  }
  // Bedingung: erfülltes Kästchen mit Haken, offenes Kästchen leer.
  const conditionColor = alert ? KIND_COLOR.condition : 'var(--ok)';
  return (
    <g className="rail-block__icon" transform="translate(9,8)">
      <rect
        x="0.8"
        y="1.8"
        width="10.4"
        height="10.4"
        rx="2"
        fill={alert ? 'none' : conditionColor}
        stroke={conditionColor}
        strokeWidth="1.6"
      />
      {!alert && (
        <path d="M3.4 7 L5.4 9.2 L9 4.8" fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </g>
  );
}
