/**
 * Automatisches Netzplan-Layout (vereinfachtes Sugiyama-Verfahren).
 *
 *  1. Ebene (x) = Abhängigkeitstiefe aus der Terminberechnung,
 *  2. Reihenfolge (y) innerhalb einer Ebene = Median der Vorgängerpositionen
 *     (Baryzentrum), mehrfach iteriert, um Kantenkreuzungen zu reduzieren,
 *  3. feste Rasterabstände -> stabile, ruhige Darstellung.
 *
 * Knotenpositionen werden bewusst nicht gespeichert; das Layout ergibt sich
 * jedes Mal neu aus dem Graphen.
 */
import type { Id, Task } from '../model/types';

export interface LayoutNode {
  id: Id;
  task: Task;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: Id;
  to: Id;
  kind: 'dependency' | 'parallel';
}

export interface NetworkLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 68;
const COLUMN_GAP = 78;
const ROW_GAP = 26;
const PADDING = 24;

export function layoutNetwork(tasks: Task[], depthOf: (id: Id) => number): NetworkLayout {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // 1. Ebenen bilden
  const columns = new Map<number, Id[]>();
  for (const t of tasks) {
    const col = Math.max(0, depthOf(t.id));
    const list = columns.get(col) ?? [];
    list.push(t.id);
    columns.set(col, list);
  }

  const sortedColumns = [...columns.keys()].sort((a, b) => a - b);
  const position = new Map<Id, number>();
  for (const col of sortedColumns) {
    columns.get(col)!.forEach((id, index) => position.set(id, index));
  }

  // 2. Baryzentrum-Iterationen zur Kreuzungsreduktion
  for (let pass = 0; pass < 4; pass++) {
    for (const col of sortedColumns) {
      const ids = columns.get(col)!;
      const scored = ids.map((id) => {
        const task = byId.get(id)!;
        const refs = pass % 2 === 0 ? task.dependsOn : successorsOf(id, tasks);
        const values = refs.map((r) => position.get(r)).filter((v): v is number => v !== undefined);
        const bary = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : position.get(id)!;
        return { id, bary, title: task.title };
      });
      scored.sort((a, b) => a.bary - b.bary || a.title.localeCompare(b.title, 'de'));
      scored.forEach((s, index) => position.set(s.id, index));
      columns.set(col, scored.map((s) => s.id));
    }
  }

  // 3. Koordinaten
  const nodes: LayoutNode[] = [];
  let maxRows = 0;
  for (const col of sortedColumns) {
    const ids = columns.get(col)!;
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, row) => {
      nodes.push({
        id,
        task: byId.get(id)!,
        column: col,
        row,
        x: PADDING + col * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  const edges: LayoutEdge[] = [];
  const present = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (present.has(d)) edges.push({ from: d, to: t.id, kind: 'dependency' });
    }
    for (const p of t.parallelWith) {
      if (present.has(p)) edges.push({ from: t.id, to: p, kind: 'parallel' });
    }
  }

  const lastCol = sortedColumns.length > 0 ? sortedColumns[sortedColumns.length - 1] : 0;
  return {
    nodes,
    edges,
    width: PADDING * 2 + (lastCol + 1) * NODE_WIDTH + lastCol * COLUMN_GAP,
    height: PADDING * 2 + Math.max(1, maxRows) * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

function successorsOf(id: Id, tasks: Task[]): Id[] {
  return tasks.filter((t) => t.dependsOn.includes(id)).map((t) => t.id);
}

/** Gebogene Verbindung zwischen zwei Knoten (Bezier von rechts nach links). */
export function edgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max(30, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Verbindung zwischen Aufgabenknoten (oben) und Ressourcenblock (unten). */
export function railPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.max(24, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}
