/**
 * Abgeleitete Daten (Termine, Warnungen, Sichtbarkeit). Alles memoisiert, damit
 * die Visualisierungen bei jeder Eingabe sofort - aber ohne Neuberechnung des
 * gesamten Graphen pro Tastendruck - aktualisieren.
 */
import { useMemo } from 'react';
import type { Client, Id, Task } from '../model/types';
import { computeSchedule, type ScheduleResult } from '../engine/schedule';
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
  /** Sichtbare Aufgaben nach Vorhaben- und Tag-Filter. */
  visibleTasks: Task[];
  taskById: Map<Id, Task>;
}

export function useDerived(): Derived {
  const { client, ui } = useStore();
  const { prefs } = usePreferences();

  const schedule = useMemo(() => computeSchedule(client, prefs.scenario), [client, prefs.scenario]);
  const tWarnings = useMemo(() => taskWarnings(client, schedule), [client, schedule]);
  const rWarnings = useMemo(() => resourceWarnings(client, schedule), [client, schedule]);

  const ventureTasks = useMemo(() => {
    const byVenture = ui.ventureId ? client.tasks.filter((t) => t.ventureId === ui.ventureId) : client.tasks;
    // Tag-Filter wirkt zusaetzlich zum Vorhaben - leer heisst "alle".
    if (ui.tagFilter.length === 0) return byVenture;
    return byVenture.filter((t) => t.tagIds.some((id) => ui.tagFilter.includes(id)));
  }, [client.tasks, ui.ventureId, ui.tagFilter]);

  /*
   * Sichtbar ist, was der Vorhaben- und der Tag-Filter übrig lassen. Einen
   * Tiefengrad-Filter um die gewählte Aufgabe gab es früher zusätzlich; er
   * wurde mit seinem Schieber entfernt.
   */
  const visibleTasks = ventureTasks;

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
