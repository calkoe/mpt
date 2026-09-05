/**
 * Wer arbeitet in einem Zeitraum woran?
 *
 * Die Ressourcenansicht beantwortet die Frage von der Ressource her ("wie ist
 * Anna ausgelastet?"), der Plan von der Aufgabe her. Beim Planen einer Woche
 * fehlt die dritte Sicht: **eine Liste aller Personen mit ihren Aufgaben in
 * genau diesem Zeitraum** - inklusive derer, die nichts zu tun haben.
 *
 * Gerechnet wird aus denselben Tageslasten wie die Ganglinien; es gibt keine
 * zweite Wahrheit über die Auslastung.
 */
import { useMemo, useState } from 'react';
import type { Id, IsoDate } from '../../model/types';
import { addDays, diffDays, formatDateDe, today } from '../../engine/dates';
import { availableWorkdays, EMPTY_FILTER, formatValue, personDailyLoad } from '../../engine/resources';
import { useDerived } from '../../state/useDerived';
import { useStore } from '../../state/store';
import { Button, EmptyState, Modal } from '../components/controls';
import { PeriodPicker } from '../components/PeriodPicker';
import { MeasureAmount, UtilisationBar } from '../components/CostMeasure';

interface TaskLoad {
  taskId: Id;
  title: string;
  /** Gebundene Personentage im Zeitraum. */
  workdays: number;
  /** Höchste Tagesbindung - zeigt Überlast auch in kurzen Spitzen. */
  peakFte: number;
  from: IsoDate;
  to: IsoDate;
}

interface PersonLoad {
  personId: Id;
  name: string;
  role: string;
  available: number;
  bound: number;
  tasks: TaskLoad[];
}

export function WorkloadDialog({ onClose }: { onClose: () => void }) {
  const { client, setUi } = useStore();
  const derived = useDerived();

  /** Voreinstellung ist die laufende Woche - danach fragt man am häufigsten. */
  const [range, setRange] = useState(() => {
    const now = today();
    return { from: now, to: addDays(now, 6) };
  });

  const loads = useMemo(
    () => personDailyLoad(client, derived.schedule, EMPTY_FILTER),
    [client, derived.schedule],
  );

  const rows = useMemo<PersonLoad[]>(() => {
    return client.people
      .map((person) => {
        const daily = loads.get(person.id) ?? new Map();
        const perTask = new Map<Id, TaskLoad>();
        let bound = 0;

        let cursor = range.from;
        let guard = 0;
        while (diffDays(cursor, range.to) >= 0 && guard++ < 4000) {
          for (const part of daily.get(cursor) ?? []) {
            const entry = perTask.get(part.taskId) ?? {
              taskId: part.taskId,
              title: derived.taskById.get(part.taskId)?.title ?? 'Unbekannt',
              workdays: 0,
              peakFte: 0,
              from: cursor,
              to: cursor,
            };
            entry.workdays += part.value;
            entry.peakFte = Math.max(entry.peakFte, part.value);
            entry.to = cursor;
            perTask.set(part.taskId, entry);
            bound += part.value;
          }
          cursor = addDays(cursor, 1);
        }

        return {
          personId: person.id,
          name: person.name,
          role: person.role,
          available: availableWorkdays(person, range.from, range.to),
          bound,
          // Die grösste Bindung zuerst - danach richtet man den Tag aus.
          tasks: [...perTask.values()].sort((a, b) => b.workdays - a.workdays),
        };
      })
      .sort((a, b) => b.bound - a.bound);
  }, [client.people, loads, range.from, range.to, derived.taskById]);

  const openTask = (taskId: Id) => {
    const task = derived.taskById.get(taskId);
    setUi({ mode: 'tasks', selectedTaskId: taskId, ventureId: task?.ventureId ?? null });
    onClose();
  };

  const setDays = (from: IsoDate, days: number) => setRange({ from, to: addDays(from, days - 1) });
  const now = today();

  return (
    <Modal title="Wer arbeitet woran?" onClose={onClose} wide>
      <div className="col">
        {/*
          Schnellwahl für die beiden häufigsten Fragen, daneben der übliche
          Zeitraumwähler für alles andere.
        */}
        <div className="row row--wrap">
          <Button size="sm" onClick={() => setDays(now, 1)}>
            Heute
          </Button>
          <Button size="sm" onClick={() => setDays(now, 7)}>
            7 Tage
          </Button>
          <div className="grow">
            <PeriodPicker
              from={range.from}
              to={range.to}
              scales={['week', 'month', 'quarter', 'year']}
              onChange={(from, to) => setRange({ from, to })}
            />
          </div>
        </div>

        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          {formatDateDe(range.from)} - {formatDateDe(range.to)}
        </span>

        {client.people.length === 0 ? (
          <EmptyState
            title="Keine Personen"
            hint="Personen entstehen beim Zuordnen in einer Aufgabe oder über die Ressourcenansicht."
          />
        ) : (
          <div className="col">
            {rows.map((row) => (
              <div key={row.personId} className="workload">
                <div className="workload__head">
                  <span className="grow truncate" style={{ fontWeight: 600 }}>
                    {row.name}
                    {row.role && <span className="faint"> · {row.role}</span>}
                  </span>
                  <MeasureAmount measure="approved" value={row.available} suffix="PT" />
                  <MeasureAmount measure="planned" value={row.bound} suffix="PT" />
                </div>

                <UtilisationBar planned={row.bound} actual={row.bound} ceiling={row.available} unit="PT" />

                {row.tasks.length === 0 ? (
                  <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    Nichts zugeordnet in diesem Zeitraum.
                  </span>
                ) : (
                  <div className="list">
                    {row.tasks.map((task) => (
                      <button
                        key={task.taskId}
                        type="button"
                        className="list__item"
                        onClick={() => openTask(task.taskId)}
                        title="Aufgabe im Plan öffnen"
                      >
                        <span className="grow truncate">{task.title}</span>
                        <span className="faint nowrap mono" style={{ fontSize: 'var(--fs-sm)' }}>
                          {formatDateDe(task.from)} - {formatDateDe(task.to)}
                        </span>
                        <span className="nowrap mono" style={{ fontSize: 'var(--fs-sm)' }}>
                          {formatValue(task.workdays, 'PT')}
                        </span>
                        <span className="faint nowrap mono" style={{ fontSize: 'var(--fs-sm)' }} title="höchste Tagesbindung">
                          {formatValue(task.peakFte, 'FTE')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
