/**
 * Abgeleitete Daten (Termine, Warnungen, Sichtbarkeit). Alles memoisiert, damit
 * die Visualisierungen bei jeder Eingabe sofort - aber ohne Neuberechnung des
 * gesamten Graphen pro Tastendruck - aktualisieren.
 */
import { useMemo } from 'react';
import type { Client, Id, Task } from '../model/types';
import { collectNeighbourhood, computeSchedule, type ScheduleResult } from '../engine/schedule';
import { resourceWarnings, taskWarnings, type Warning } from '../engine/validate';
import { usePreferences } from './preferences';
import { useStore } from './store';

export interface Derived {
  client: Client;
  schedule: ScheduleResult;
  taskWarnings: Map<Id, Warning[]>;
  resourceWarnings: Map<Id, Warning[]>;
  /** Aufgaben des aktiven Vorhabens (oder alle, wenn keins gewählt ist). */
  ventureTasks: Task[];
  /** Sichtbare Aufgaben nach Vorhaben- und Tiefengrad-Filter. */
  visibleTasks: Task[];
  taskById: Map<Id, Task>;
}

export function useDerived(): Derived {
  const { client, ui } = useStore();
  const { prefs } = usePreferences();

  const schedule = useMemo(() => computeSchedule(client, prefs.scenario), [client, prefs.scenario]);
  const tWarnings = useMemo(() => taskWarnings(client, schedule), [client, schedule]);
  const rWarnings = useMemo(() => resourceWarnings(client, schedule), [client, schedule]);

  const ventureTasks = useMemo(
    () => (ui.ventureId ? client.tasks.filter((t) => t.ventureId === ui.ventureId) : client.tasks),
    [client.tasks, ui.ventureId],
  );

  const visibleTasks = useMemo(() => {
    // Ohne Auswahl oder bei vollem Tiefengrad: alle Aufgaben des Vorhabens.
    if (prefs.depth >= 99 || !ui.selectedTaskId) return ventureTasks;
    const reachable = collectNeighbourhood(client.tasks, ui.selectedTaskId, prefs.depth);
    const filtered = ventureTasks.filter((t) => reachable.has(t.id));
    // Vorhaben-übergreifende Nachbarn ergänzen, damit der Graph nicht reißt.
    const extra = client.tasks.filter((t) => reachable.has(t.id) && !filtered.includes(t));
    return [...filtered, ...extra];
  }, [client.tasks, prefs.depth, ui.selectedTaskId, ventureTasks]);

  const taskById = useMemo(() => new Map(client.tasks.map((t) => [t.id, t])), [client.tasks]);

  return {
    client,
    schedule,
    taskWarnings: tWarnings,
    resourceWarnings: rWarnings,
    ventureTasks,
    visibleTasks,
    taskById,
  };
}
