/**
 * Farben je Aufgabe für die gestapelten Ressourcen-Ganglinien.
 *
 * Bewusst ausschließlich Blau- und Türkistöne: die Tag-Palette in
 * `model/factory.ts` deckt das ganze Farbrad ab, und eine zweite bunte Skala
 * daneben würde den Eindruck erwecken, die Farben eines Balkens hätten etwas
 * mit den Tags zu tun. Ein geschlossener Farbbereich liest sich sofort als
 * "das ist eine Aufteilung", nicht als Kategorie.
 *
 * Die Zuordnung hängt nur an der Reihenfolge der Aufgaben im Mandanten und ist
 * deshalb über alle Ansichten hinweg stabil - sie wird nicht gespeichert.
 */
import type { Id, Task } from '../../model/types';

export const TASK_PALETTE = [
  '#2f5fd0',
  '#4d86e6',
  '#7aa7f0',
  '#1d7fa8',
  '#3fa3c4',
  '#79c3d8',
  '#3d4f8c',
  '#6272b8',
  '#22a08e',
  '#5fc2b2',
] as const;

export function buildTaskColors(tasks: Task[]): Map<Id, string> {
  const map = new Map<Id, string>();
  tasks.forEach((task, index) => map.set(task.id, TASK_PALETTE[index % TASK_PALETTE.length]));
  return map;
}

/** Farbe einer Aufgabe; unbekannte Ids bekommen einen neutralen Ton. */
export function taskColorOf(colors: Map<Id, string>, taskId: Id): string {
  return colors.get(taskId) ?? 'var(--text-faint)';
}
