/**
 * Automatisches Netzplan-Layout (vereinfachtes Sugiyama-Verfahren).
 *
 *  1. Ebene (x) = Abhängigkeitstiefe aus der Terminberechnung,
 *  2. Reihenfolge (y) innerhalb einer Ebene = Median der Vorgängerpositionen
 *     (Baryzentrum), mehrfach iteriert, um Kantenkreuzungen zu reduzieren,
 *  3. feste Rasterabstände -> stabile, ruhige Darstellung.
 *
 * Die berechnete Position ist die Wahrheit; eine Handverschiebung wird als
 * **relativer Versatz** (`task.layout`) darauf addiert. Dadurch ordnet sich der
 * Plan bei Strukturänderungen weiterhin selbst, behält aber die persönliche
 * Anordnung.
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

/** Etwas breiter als noetig waere - so bleibt mehr vom Titel lesbar. */
export const NODE_WIDTH = 216;
/**
 * Hoehe eines Knotens. Ergibt sich aus dem senkrechten Rhythmus in
 * `NetworkChart` (Titel, zwei Metazeilen, Tag-Marken) mit gleichem Rand oben
 * und unten - siehe die Konstanten dort.
 */
export const NODE_HEIGHT = 80;
const COLUMN_GAP = 78;
const ROW_GAP = 26;
const PADDING = 24;

/** Hat mindestens eine Aufgabe eine Handverschiebung? */
export function hasManualLayout(tasks: Task[]): boolean {
  return tasks.some((t) => t.layout && (t.layout.dx !== 0 || t.layout.dy !== 0));
}

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
      const task = byId.get(id)!;
      // Berechnete Position plus Handverschiebung - siehe Modulkommentar.
      const offset = task.layout ?? { dx: 0, dy: 0 };
      nodes.push({
        id,
        task,
        column: col,
        row,
        x: PADDING + col * (NODE_WIDTH + COLUMN_GAP) + offset.dx,
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP) + offset.dy,
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
  // Verschobene Knoten koennen ueber das Raster hinausragen; die Flaeche muss
  // sie einschliessen, sonst schneidet "Einpassen" sie ab.
  const rightMost = nodes.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const bottomMost = nodes.reduce((m, n) => Math.max(m, n.y + n.height), 0);
  return {
    nodes,
    edges,
    width: Math.max(PADDING * 2 + (lastCol + 1) * NODE_WIDTH + lastCol * COLUMN_GAP, rightMost + PADDING),
    height: Math.max(
      PADDING * 2 + Math.max(1, maxRows) * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
      bottomMost + PADDING,
    ),
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

/**
 * Parallelitaet verlaesst die Knoten oben bzw. unten statt seitlich.
 *
 * Das ist keine Kosmetik: Abhaengigkeiten laufen waagerecht und bedeuten "erst
 * A, dann B". Eine Parallelitaet bedeutet "gleichzeitig" und darf deshalb nicht
 * wie eine zeitliche Reihenfolge aussehen - senkrechte Anschluesse trennen die
 * beiden Aussagen auf den ersten Blick.
 */
export function parallelPath(from: LayoutNode, to: LayoutNode): string {
  // Immer vom unteren Knoten nach oben zum oberen - so ist die Kurve stabil,
  // egal in welcher Reihenfolge die Aufgaben verknuepft wurden.
  const [upper, lower] = from.y <= to.y ? [from, to] : [to, from];
  const x1 = upper.x + upper.width / 2;
  const y1 = upper.y + upper.height;
  const x2 = lower.x + lower.width / 2;
  const y2 = lower.y;
  const dy = Math.max(20, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

/** Verbindung zwischen Aufgabenknoten (oben) und Ressourcenblock (unten). */
export function railPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.max(24, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}
