/**
 * Wer arbeitet gerade woran?
 *
 * Die Ressourcenansicht beantwortet die Frage von der Ressource her ("wie ist
 * Anna ausgelastet?"), der Plan von der Aufgabe her. Hier fehlt die dritte
 * Sicht: **eine Liste aller Personen mit dem, was jetzt bei ihnen liegt** -
 * inklusive derer, die nichts zu tun haben.
 *
 * Gezeigt wird eine Aufgabe, wenn ihr **Beginn in der Vergangenheit liegt**
 * und sie **weder erledigt noch im Betrieb** ist - also alles, was angefangen
 * hat und noch offen ist.
 *
 * Bewusst ohne Zeitauswahl: die Frage lautet "was liegt an?", und die hat
 * genau eine Antwort. Der Status wird dabei nicht zur Bedingung, sondern zur
 * Auskunft: eine begonnene Aufgabe, die noch auf "Offen" steht, erscheint mit
 * grauem Punkt und zurückgenommenem Balken - sie liegt an, aber niemand hat
 * sie angefasst.
 *
 * Gerechnet wird aus denselben Tageslasten wie die Ganglinien; es gibt keine
 * zweite Wahrheit über die Auslastung. Der Aufwand je Aufgabe ist immer ihr
 * **ganzer** Aufwand, nicht ein Ausschnitt.
 */
import { useMemo } from 'react';
import { isSettled, TASK_STATUS_LABEL, type Id, type IsoDate, type TaskStatus } from '../../model/types';
import { diffDays, formatDateDe, today } from '../../engine/dates';
import { formatValue, personDailyLoad, type ResourceFilter } from '../../engine/resources';
import { isOverdue, taskProgress } from '../../engine/schedule';
import { useDerived } from '../../state/useDerived';
import { useStore } from '../../state/store';
import { EmptyState, Modal } from '../components/controls';

interface TaskLoad {
  taskId: Id;
  title: string;
  status: TaskStatus;
  /** Fortschritt der Aufgabe, 0..1 - siehe `progressOf`. */
  progress: number;
  /** Der geplante Endtermin liegt hinter uns, die Aufgabe ist aber offen. */
  overdue: boolean;
  /** Gebundene Personentage über die ganze Aufgabe. */
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
  /** Summe der Personentage über alle gezeigten Aufgaben. */
  bound: number;
  tasks: TaskLoad[];
}

export function WorkloadDialog({ onClose }: { onClose: () => void }) {
  const { client, ui, setUi } = useStore();
  const derived = useDerived();

  const heute = today();

  /*
   * Die Vorhabenauswahl der Seitenleiste gilt auch hier. Sonst zeigte der
   * Dialog Aufgaben aus Vorhaben, die man gerade ausgeblendet hat - und man
   * suchte im Plan vergeblich nach ihnen.
   */
  const venture = ui.ventureId ? client.ventures.find((v) => v.id === ui.ventureId) : undefined;
  const filter = useMemo<ResourceFilter>(
    () => ({ tagIds: [], ventureIds: ui.ventureId ? [ui.ventureId] : [] }),
    [ui.ventureId],
  );

  const loads = useMemo(
    () => personDailyLoad(client, derived.schedule, filter),
    [client, derived.schedule, filter],
  );

  const rows = useMemo<PersonLoad[]>(() => {
    /**
     * Liegt die Aufgabe an? Begonnen und noch nicht abgeschlossen.
     *
     * `isSettled` schliesst erledigte **und** in Betrieb genommene Aufgaben
     * aus - Betrieb heisst inhaltlich fertig, auch wenn er weiter Ressourcen
     * bindet. Ein Ende wird nicht geprüft: eine überfällige Aufgabe liegt
     * erst recht an.
     */
    const anliegend = (taskId: Id) => {
      const task = derived.taskById.get(taskId);
      if (!task || isSettled(task.status)) return false;
      const st = derived.schedule.byId.get(taskId);
      return Boolean(st && diffDays(st.start, heute) >= 0);
    };

    return client.people
      .map((person) => {
        const daily = loads.get(person.id) ?? new Map<IsoDate, { taskId: Id; value: number }[]>();
        const perTask = new Map<Id, TaskLoad>();

        // Über die ganze Tageskarte: bei jeder Aufgabe steht ihr vollständiger
        // Aufwand, nicht der Ausschnitt eines Fensters.
        for (const parts of daily.values()) {
          for (const part of parts) {
            if (!anliegend(part.taskId)) continue;
            const task = derived.taskById.get(part.taskId);
            const st = derived.schedule.byId.get(part.taskId);
            const entry = perTask.get(part.taskId) ?? {
              taskId: part.taskId,
              title: task?.title ?? 'Unbekannt',
              status: task?.status ?? 'open',
              progress: taskProgress(task, st),
              overdue: isOverdue(task, st),
              workdays: 0,
              peakFte: 0,
              from: st?.start ?? heute,
              to: st?.end ?? heute,
            };
            entry.workdays += part.value;
            entry.peakFte = Math.max(entry.peakFte, part.value);
            perTask.set(part.taskId, entry);
          }
        }

        const tasks = [...perTask.values()].sort(
          // In der Reihenfolge, in der sie begonnen haben bzw. beginnen.
          (a, b) => diffDays(b.from, a.from) || a.title.localeCompare(b.title, 'de'),
        );

        return {
          personId: person.id,
          name: person.name,
          role: person.role,
          bound: tasks.reduce((sum, t) => sum + t.workdays, 0),
          tasks,
        };
      })
      .sort((a, b) => b.bound - a.bound);
  }, [client.people, loads, heute, derived.taskById, derived.schedule]);

  const openTask = (taskId: Id) => {
    const task = derived.taskById.get(taskId);
    setUi({ mode: 'tasks', selectedTaskId: taskId, ventureId: task?.ventureId ?? null });
    onClose();
  };

  return (
    <Modal title="Wer arbeitet woran?" onClose={onClose} wide>
      <div className="col">
        {/*
          Keine Zeitauswahl: die Liste beantwortet genau eine Frage, und die
          Regel dahinter steht hier statt in einem Bedienelement.
        */}
        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Begonnen und noch nicht abgeschlossen · Stand {formatDateDe(heute)}
          {venture && <> · nur Vorhaben „{venture.name}"</>}
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
                  {/*
                    Nur der Aufwand, keine Kapazitaet daneben: es gibt keinen
                    Zeitraum mehr, gegen den man sie stellen koennte, und die
                    Aufgaben laufen unterschiedlich weit. Eine Zahl, die
                    aussieht wie eine Auslastung, aber keine ist, waere hier
                    schlimmer als gar keine.
                  */}
                  <span className="nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
                    <span className="faint">in diesen Aufgaben</span>{' '}
                    <span className="mono">{formatValue(row.bound, 'PT')}</span>
                  </span>
                </div>

                {row.tasks.length === 0 ? (
                  <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    Nichts, was gerade anliegt.
                  </span>
                ) : (
                  <div className="list">
                    {row.tasks.map((task) => {
                      /*
                       * "Läuft" heisst: an der Aufgabe wird gearbeitet oder sie
                       * ist im Betrieb. Alles andere bindet zwar rechnerisch
                       * Kapazität, wartet aber noch - der Balken ist dann
                       * ausgegraut, damit man beim Blick auf die Woche sofort
                       * sieht, was davon tatsächlich anliegt.
                       */
                      const running = task.status === 'active' || task.status === 'operations';
                      const percent = Math.round(task.progress * 100);
                      /*
                       * Überfällig schlägt alles andere: dass die Aufgabe
                       * laut Plan fertig sein müsste, ist die wichtigere
                       * Aussage als die Frage, ob jemand sie in Arbeit
                       * gesetzt hat.
                       */
                      const barClass = task.overdue
                        ? 'progress-row progress-row--overdue'
                        : running
                          ? 'progress-row'
                          : 'progress-row workload__bar--waiting';
                      return (
                        <button
                          key={task.taskId}
                          type="button"
                          className="list__item"
                          onClick={() => openTask(task.taskId)}
                          title="Aufgabe im Plan öffnen"
                        >
                          {/* Zustand der Aufgabe als Punkt - dieselbe Farbe wie im Plan. */}
                          <span
                            className={`status-dot status-dot--${task.status}`}
                            title={TASK_STATUS_LABEL[task.status]}
                          />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="row">
                              <span className="grow truncate">{task.title}</span>
                              <span className="faint nowrap mono" style={{ fontSize: 'var(--fs-sm)' }}>
                                {formatDateDe(task.from)} - {formatDateDe(task.to)}
                              </span>
                              <span className="nowrap mono" style={{ fontSize: 'var(--fs-sm)' }}>
                                {formatValue(task.workdays, 'PT')}
                              </span>
                              <span
                                className="faint nowrap mono"
                                style={{ fontSize: 'var(--fs-sm)' }}
                                title="höchste Tagesbindung"
                              >
                                {formatValue(task.peakFte, 'FTE')}
                              </span>
                            </span>
                            <span className={barClass}>
                              <span
                                className="progress"
                                title={
                                  task.overdue
                                    ? `Überfällig: laut Plan seit ${formatDateDe(task.to)} fertig`
                                    : `Fortschritt: ${percent} %`
                                }
                              >
                                <i style={{ width: `${percent}%` }} />
                              </span>
                              <span className="progress-row__label mono">{percent} %</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
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
