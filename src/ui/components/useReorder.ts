/**
 * Umsortieren einer Liste per Ziehen.
 *
 * Bewusst über die HTML5-Drag-Ereignisse statt über Zeigerereignisse: für
 * Listen ist das die eingebaute Mechanik, sie bringt Tastaturfokus und
 * Barrierefreiheit mit und kostet keine eigene Trefferberechnung. Für die
 * frei beweglichen Knoten im Netzplan wäre sie ungeeignet - dort wird mit
 * Zeigerereignissen gearbeitet.
 *
 * Die Reihenfolge ist die Array-Reihenfolge im Datenbestand; ein eigenes
 * Sortierfeld gibt es nicht. Verschieben ist damit ein ganz normaler Commit
 * und über Strg+Z rücknehmbar.
 */
import { useState } from 'react';

export interface Reorder {
  /** Index, der gerade gezogen wird - für die Darstellung. */
  draggingIndex: number | null;
  /** Index, über dem gerade losgelassen würde. */
  overIndex: number | null;
  itemProps: (index: number) => {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragOver: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    'data-dragging'?: string;
    'data-dragover'?: string;
  };
}

export function useReorder(onMove: (from: number, to: number) => void): Reorder {
  const [draggingIndex, setDragging] = useState<number | null>(null);
  const [overIndex, setOver] = useState<number | null>(null);

  const finish = () => {
    setDragging(null);
    setOver(null);
  };

  return {
    draggingIndex,
    overIndex,
    itemProps: (index) => ({
      draggable: true,
      onDragStart: (event) => {
        setDragging(index);
        // Ohne Nutzlast startet Firefox das Ziehen gar nicht erst.
        event.dataTransfer.setData('text/plain', String(index));
        event.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (event) => {
        if (draggingIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (overIndex !== index) setOver(index);
      },
      onDrop: (event) => {
        event.preventDefault();
        const from = draggingIndex ?? Number(event.dataTransfer.getData('text/plain'));
        if (Number.isFinite(from) && from !== index) onMove(from, index);
        finish();
      },
      onDragEnd: finish,
      ...(draggingIndex === index ? { 'data-dragging': 'true' } : {}),
      ...(overIndex === index && draggingIndex !== index ? { 'data-dragover': 'true' } : {}),
    }),
  };
}

/** Element von `from` nach `to` verschieben - an Ort und Stelle. */
export function moveItem<T>(list: T[], from: number, to: number): void {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}
