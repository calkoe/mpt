/**
 * Aufgaben-Editor. Direktbearbeitung ohne Speichern-Knopf: jede Eingabe wirkt
 * sofort auf Netzplan, Gantt und Ressourcen.
 *
 * Terminierung: Start, Ende und Dauer sind ineinander umrechenbar - man gibt
 * eines an, der Rest ergibt sich. Bei Abhängigkeitsanker entfällt der eigene
 * Starttermin.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TASK_STATUS_LABEL,
  type Client,
  type Id,
  type Task,
  type TaskStatus,
} from '../../model/types';
import {
  createAssignment,
  createBudget,
  createChecklistItem,
  createCondition,
  createCost,
  createFollowUp,
  createPeriodValue,
  createPerson,
  createTag,
} from '../../model/factory';
import {
  addWorkdays,
  DURATION_UNIT_LABEL,
  formatDateDe,
  sliderMaxFor,
  sliderStepFor,
  unitToWorkdays,
  WORKDAYS_PER,
  workdaysBetween,
  workdaysToUnit,
  type DurationUnit,
} from '../../engine/dates';
import { wouldCreateCycle, type ScheduleResult } from '../../engine/schedule';
import { isVentureDone, type Warning } from '../../engine/validate';
import { useStore } from '../../state/store';
import {
  Badge,
  Button,
  Chip,
  Combobox,
  ConfirmButton,
  DateInput,
  Field,
  NumberSlider,
  Segmented,
  Switch,
  TextArea,
  TextInput,
} from '../components/controls';
import { PeriodPicker, periodBounds } from '../components/PeriodPicker';
import { CostFields } from '../components/CostFields';

export function TaskEditor({
  client,
  task,
  schedule,
}: {
  client: Client;
  task: Task;
  schedule: ScheduleResult;
}) {
  const { commitClient, setUi, ui } = useStore();
  const st = schedule.byId.get(task.id);

  /** Kurzform: mutiert die aktuelle Aufgabe. */
  const edit = (label: string, recipe: (t: Task) => void, coalesceKey?: string) =>
    commitClient(label, (c) => {
      const target = c.tasks.find((t) => t.id === task.id);
      if (target) recipe(target);
    }, coalesceKey ? { coalesceKey } : undefined);

  const personById = useMemo(() => new Map(client.people.map((p) => [p.id, p])), [client.people]);
  const budgetById = useMemo(() => new Map(client.budgets.map((b) => [b.id, b])), [client.budgets]);
  const tagById = useMemo(() => new Map(client.tags.map((t) => [t.id, t])), [client.tags]);
  const taskById = useMemo(() => new Map(client.tasks.map((t) => [t.id, t])), [client.tasks]);

  const isPicking = ui.pickTarget?.taskId === task.id;

  /**
   * Eingabeeinheit der Dauer. Bewusst nur Ansichtszustand: gespeichert wird
   * immer in Arbeitstagen. Beim Wechsel der Aufgabe wird eine passende Einheit
   * vorgeschlagen, damit lange Vorgänge nicht als vierstellige AT-Zahl
   * erscheinen.
   */
  const [durationUnit, setDurationUnit] = useState<DurationUnit>(() => suggestUnit(task.schedule.durationMax));
  const lastTaskId = useRef(task.id);
  useEffect(() => {
    if (lastTaskId.current === task.id) return;
    lastTaskId.current = task.id;
    setDurationUnit(suggestUnit(task.schedule.durationMax));
  }, [task.id, task.schedule.durationMax]);

  return (
    <div className="editor">
      {/*
        Kopf: das Titelfeld füllt die verbleibende Breite, der Statusblock sitzt
        rechtsbündig daneben. Beide sind exakt gleich hoch (siehe
        `.editor__titlerow` in app.css).
      */}
      <div className="editor__titlerow">
        <TextInput
          className="input--title"
          value={task.title}
          placeholder="Titel der Aufgabe"
          onChange={(title) => edit('Titel geändert', (t) => { t.title = title; }, `title-${task.id}`)}
        />
        <Segmented<TaskStatus>
          ariaLabel="Status"
          value={task.status}
          onChange={(status) => edit('Status geändert', (t) => { t.status = status; })}
          options={(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => ({
            value: s,
            label: (
              <>
                <span className={`status-dot status-dot--${s}`} /> {TASK_STATUS_LABEL[s]}
              </>
            ),
          }))}
        />
      </div>

      {/* Beschreibung über die volle Breite, direkt unter dem Titel. */}
      <TextArea
        rows={2}
        value={task.description}
        placeholder="Kurzbeschreibung"
        onChange={(description) => edit('Beschreibung geändert', (t) => { t.description = description; }, `desc-${task.id}`)}
      />

      {/* Checkliste steht direkt unter der Kurzbeschreibung - beides beschreibt
          den Inhalt der Aufgabe und gehoert zusammen. */}
      <div className="editor__section-title">
        Checkliste
        <span className="spacer" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => edit('Checklistenpunkt ergänzt', (t) => { t.checklist.push(createChecklistItem()); })}
        >
          + Punkt
        </Button>
      </div>
      <div className="col">
        {task.checklist.map((item) => (
          <div key={item.id} className={`checklist__item${item.done ? ' checklist__item--done' : ''}`}>
            <input
              type="checkbox"
              checked={item.done}
              aria-label="Erledigt"
              onChange={(e) =>
                edit('Checkliste aktualisiert', (t) => {
                  const target = t.checklist.find((c) => c.id === item.id);
                  if (target) target.done = e.target.checked;
                })
              }
            />
            {/* TextInput statt rohem input: nur so greift die verzoegerte
                Uebernahme und es wird nicht pro Tastendruck committet. */}
            <TextInput
              className="checklist__text"
              value={item.text}
              placeholder="Punkt..."
              onChange={(text) =>
                edit('Checkliste bearbeitet', (t) => {
                  const target = t.checklist.find((c) => c.id === item.id);
                  if (target) target.text = text;
                }, `chk-${item.id}`)
              }
            />
            <Button
              size="sm"
              variant="ghost"
              title="Punkt entfernen"
              onClick={() => edit('Checklistenpunkt entfernt', (t) => { t.checklist = t.checklist.filter((c) => c.id !== item.id); })}
            >
              &times;
            </Button>
          </div>
        ))}
        {task.checklist.length === 0 && <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Keine Punkte.</span>}
      </div>

      <div className="editor__cols">
        {/* Termine */}
        <div className="editor__section">
          <div className="editor__section-title">Terminierung</div>

          <Switch
            checked={task.milestone}
            label="Ist Meilenstein"
            title="Meilensteine werden im Netzplan hervorgehoben und erzeugen im Gantt eine senkrechte Linie am Enddatum"
            onChange={(milestone) => edit('Meilenstein umgeschaltet', (t) => { t.milestone = milestone; })}
          />

          <Field label="Start ergibt sich aus">
            <Segmented
              block
              value={task.schedule.anchor}
              onChange={(anchor) =>
                edit('Terminanker geändert', (t) => {
                  t.schedule.anchor = anchor as 'date' | 'dependency';
                  if (anchor === 'dependency') t.schedule.end = undefined;
                  else if (!t.schedule.start) t.schedule.start = st?.start;
                })
              }
              options={[
                { value: 'date', label: 'Festes Datum' },
                { value: 'dependency', label: 'Vorgängern', title: 'Start = spätestes Ende der Vorgänger + 1 Arbeitstag' },
              ]}
            />
          </Field>

          {task.schedule.anchor === 'date' && (
            /* Zwei gleich breite Spalten, damit die Datumsfelder trotz
               unterschiedlich langer Beschriftungen exakt bündig stehen. */
            <div className="field-pair">
              <Field label="Start">
                <DateInput
                  value={task.schedule.start}
                  onChange={(start) => edit('Start geändert', (t) => { t.schedule.start = start || undefined; })}
                />
              </Field>
              <Field label="Ende (optional)" hint="Setzt die Dauer">
                <DateInput
                  value={task.schedule.end}
                  onChange={(end) =>
                    edit('Ende geändert', (t) => {
                      t.schedule.end = end || undefined;
                      if (end && t.schedule.start) {
                        const days = workdaysBetween(t.schedule.start, end);
                        t.schedule.durationMin = days;
                        t.schedule.durationMax = days;
                      }
                    })
                  }
                />
              </Field>
            </div>
          )}

          {/* Eingabeeinheit der Dauer. Gespeichert wird immer in
              Arbeitstagen - die Einheit rechnet nur die Anzeige um. */}
          <Field label="Dauer angeben in">
            <Segmented<DurationUnit>
              block
              ariaLabel="Einheit der Dauer"
              value={durationUnit}
              onChange={setDurationUnit}
              options={(['days', 'weeks', 'months', 'years'] as DurationUnit[]).map((u) => ({
                value: u,
                label: DURATION_UNIT_LABEL[u],
                title: `1 ${DURATION_UNIT_LABEL[u]} = ${WORKDAYS_PER[u]} Arbeitstage`,
              }))}
            />
          </Field>

          {/* Dauer 0 heißt: kein Enddatum. Ein Dauerläufer braucht deshalb
              keinen eigenen Schalter - er hat schlicht keine Dauer. */}
          <Field
            label="Dauer minimal (optimistisch)"
            hint={durationHint(task, task.schedule.durationMin)}
          >
            <NumberSlider
              min={0}
              max={sliderMaxFor(durationUnit)}
              step={sliderStepFor(durationUnit)}
              value={workdaysToUnit(task.schedule.durationMin, durationUnit)}
              suffix={DURATION_UNIT_LABEL[durationUnit]}
              onChange={(value) =>
                edit('Dauer geändert', (t) => {
                  t.schedule.durationMin = durationFromInput(value, durationUnit);
                  t.schedule.durationMax = Math.max(t.schedule.durationMax, t.schedule.durationMin);
                  t.schedule.end = undefined;
                }, `durmin-${task.id}`)
              }
            />
          </Field>

          <Field
            label="Dauer maximal (pessimistisch)"
            hint={durationHint(task, task.schedule.durationMax)}
          >
            <NumberSlider
              min={0}
              max={sliderMaxFor(durationUnit)}
              step={sliderStepFor(durationUnit)}
              value={workdaysToUnit(task.schedule.durationMax, durationUnit)}
              suffix={DURATION_UNIT_LABEL[durationUnit]}
              onChange={(value) =>
                edit('Dauer geändert', (t) => {
                  t.schedule.durationMax = durationFromInput(value, durationUnit);
                  t.schedule.durationMin = Math.min(t.schedule.durationMin, t.schedule.durationMax);
                  t.schedule.end = undefined;
                }, `durmax-${task.id}`)
              }
            />
          </Field>

          <div className="editor__section-title">Vorhaben</div>
          <select
            className="select"
            value={task.ventureId}
            onChange={(e) => edit('Vorhaben gewechselt', (t) => { t.ventureId = e.target.value; })}
          >
            {client.ventures.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          <div className="editor__section-title">Tags</div>
          <div className="row row--wrap">
            {task.tagIds.map((id) => {
              const tag = tagById.get(id);
              if (!tag) return null;
              return (
                <Chip
                  key={id}
                  label={tag.name}
                  color={tag.color}
                  onRemove={() => edit('Tag entfernt', (t) => { t.tagIds = t.tagIds.filter((x) => x !== id); })}
                />
              );
            })}
          </div>
          <Combobox
            placeholder="Tag wählen oder anlegen..."
            options={client.tags.filter((t) => !task.tagIds.includes(t.id)).map((t) => ({ id: t.id, label: t.name, color: t.color }))}
            onSelect={(id) => edit('Tag ergänzt', (t) => { if (!t.tagIds.includes(id)) t.tagIds.push(id); })}
            onCreate={(name) =>
              commitClient('Tag angelegt', (c) => {
                const tag = createTag(name, c.tags);
                c.tags.push(tag);
                const target = c.tasks.find((t) => t.id === task.id);
                if (target) target.tagIds.push(tag.id);
              })
            }
          />
        </div>

        {/* Abhängigkeiten */}
        <div className="editor__section">
          <div className="editor__section-title">
            Abhängig von
            <span className="spacer" />
            <Button
              size="sm"
              variant={isPicking && ui.pickTarget?.field === 'dependsOn' ? 'primary' : 'ghost'}
              title="Danach oben in der Visualisierung auf eine Aufgabe klicken"
              onClick={() =>
                setUi({
                  pickTarget:
                    isPicking && ui.pickTarget?.field === 'dependsOn' ? null : { field: 'dependsOn', taskId: task.id },
                })
              }
            >
              {isPicking && ui.pickTarget?.field === 'dependsOn' ? 'Auswahl aktiv' : 'Im Plan wählen'}
            </Button>
          </div>
          <div className="row row--wrap">
            {task.dependsOn.map((id) => (
              <Chip
                key={id}
                label={taskById.get(id)?.title ?? 'unbekannt'}
                onClick={() => setUi({ selectedTaskId: id })}
                onRemove={() => edit('Abhängigkeit entfernt', (t) => { t.dependsOn = t.dependsOn.filter((x) => x !== id); })}
              />
            ))}
            {task.dependsOn.length === 0 && <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Keine Vorgänger.</span>}
          </div>
          <Combobox
            placeholder="Vorgänger suchen..."
            options={client.tasks
              .filter((t) => t.id !== task.id && !task.dependsOn.includes(t.id))
              .map((t) => {
                const cycle = wouldCreateCycle(client.tasks, task.id, t.id);
                return {
                  id: t.id,
                  label: t.title,
                  hint: client.ventures.find((v) => v.id === t.ventureId)?.name,
                  // Aufgaben desselben Vorhabens stehen oben.
                  group: t.ventureId === task.ventureId ? 'Dieses Vorhaben' : undefined,
                  disabled: cycle,
                  disabledReason: 'Würde einen Abhängigkeitszyklus erzeugen.',
                };
              })}
            onSelect={(id) =>
              edit('Abhängigkeit ergänzt', (t) => {
                if (!t.dependsOn.includes(id)) t.dependsOn.push(id);
                t.schedule.anchor = 'dependency';
              })
            }
          />

          <div className="editor__section-title">
            Parallel mit
            <span className="spacer" />
            <Button
              size="sm"
              variant={isPicking && ui.pickTarget?.field === 'parallelWith' ? 'primary' : 'ghost'}
              onClick={() =>
                setUi({
                  pickTarget:
                    isPicking && ui.pickTarget?.field === 'parallelWith'
                      ? null
                      : { field: 'parallelWith', taskId: task.id },
                })
              }
            >
              Im Plan wählen
            </Button>
          </div>
          <div className="row row--wrap">
            {task.parallelWith.map((id) => (
              <Chip
                key={id}
                label={taskById.get(id)?.title ?? 'unbekannt'}
                onClick={() => setUi({ selectedTaskId: id })}
                onRemove={() => edit('Parallelität entfernt', (t) => { t.parallelWith = t.parallelWith.filter((x) => x !== id); })}
              />
            ))}
          </div>
          <Combobox
            placeholder="Parallel laufende Aufgabe..."
            options={client.tasks
              .filter((t) => t.id !== task.id && !task.parallelWith.includes(t.id))
              .map((t) => ({
                id: t.id,
                label: t.title,
                hint: client.ventures.find((v) => v.id === t.ventureId)?.name,
                group: t.ventureId === task.ventureId ? 'Dieses Vorhaben' : undefined,
              }))}
            onSelect={(id) => edit('Parallelität ergänzt', (t) => { if (!t.parallelWith.includes(id)) t.parallelWith.push(id); })}
          />

          <div className="editor__section-title">Startbedingungen</div>
          <div className="row row--wrap">
            {task.ventureConditions.map((id) => {
              const venture = client.ventures.find((v) => v.id === id);
              return (
                <Chip
                  key={id}
                  label={`Vorhaben: ${venture?.name ?? '?'}`}
                  color={venture && isVentureDone(client, venture.id) ? 'var(--ok)' : 'var(--warn)'}
                  onRemove={() => edit('Startbedingung entfernt', (t) => { t.ventureConditions = t.ventureConditions.filter((x) => x !== id); })}
                />
              );
            })}
            {task.conditionIds.map((id) => {
              const condition = client.conditions.find((c) => c.id === id);
              return (
                <Chip
                  key={id}
                  label={condition?.name ?? '?'}
                  color={condition?.met ? 'var(--ok)' : 'var(--warn)'}
                  onClick={() =>
                    commitClient('Bedingung umgeschaltet', (c) => {
                      const target = c.conditions.find((x) => x.id === id);
                      if (target) target.met = !target.met;
                    })
                  }
                  title="Klick schaltet erfüllt/nicht erfüllt um"
                  onRemove={() => edit('Bedingung entfernt', (t) => { t.conditionIds = t.conditionIds.filter((x) => x !== id); })}
                />
              );
            })}
          </div>
          <Combobox
            placeholder="Bedingung oder Vorhaben..."
            options={[
              ...client.conditions
                .filter((c) => !task.conditionIds.includes(c.id))
                .map((c) => ({ id: `cond:${c.id}`, label: c.name, hint: c.met ? 'erfüllt' : 'offen' })),
              ...client.ventures
                .filter((v) => !task.ventureConditions.includes(v.id) && v.id !== task.ventureId)
                .map((v) => ({ id: `ven:${v.id}`, label: v.name, hint: 'Vorhaben' })),
            ]}
            onSelect={(id) => {
              const [kind, realId] = id.split(':');
              edit('Startbedingung ergänzt', (t) => {
                if (kind === 'cond' && !t.conditionIds.includes(realId)) t.conditionIds.push(realId);
                if (kind === 'ven' && !t.ventureConditions.includes(realId)) t.ventureConditions.push(realId);
              });
            }}
            onCreate={(name) =>
              commitClient('Bedingung angelegt', (c) => {
                const condition = createCondition(name);
                c.conditions.push(condition);
                const target = c.tasks.find((t) => t.id === task.id);
                if (target) target.conditionIds.push(condition.id);
              })
            }
          />
        </div>

        {/* Ressourcen */}
        <div className="editor__section">
          <div className="editor__section-title">Personalressourcen</div>
          <div className="col">
            {task.assignments.map((assignment) => (
              <div key={assignment.id} className="line-item">
                <div className="col">
                  <strong className="truncate">{personById.get(assignment.personId)?.name ?? 'Unbekannt'}</strong>
                  <div className="line-item__controls">
                    <Segmented
                      value={assignment.mode}
                      onChange={(mode) =>
                        edit('Bindungsart geändert', (t) => {
                          const target = t.assignments.find((a) => a.id === assignment.id);
                          if (!target) return;
                          // Beim Wechsel den Wert sinnvoll umrechnen.
                          const days = st?.duration ?? 1;
                          if (mode === 'PT' && target.mode === 'FTE') target.value = Math.round(target.value * days * 10) / 10;
                          if (mode === 'FTE' && target.mode === 'PT') target.value = Math.round((target.value / Math.max(1, days)) * 100) / 100;
                          target.mode = mode as 'PT' | 'FTE';
                        })
                      }
                      options={[
                        { value: 'FTE', label: 'FTE', title: 'Anteil pro Woche (0..1)' },
                        { value: 'PT', label: 'PT', title: 'Personentage gesamt' },
                      ]}
                    />
                    <div style={{ minWidth: 190, flex: 1 }}>
                      <NumberSlider
                        min={0}
                        max={assignment.mode === 'FTE' ? 1 : 200}
                        step={assignment.mode === 'FTE' ? 0.1 : 1}
                        value={assignment.value}
                        onChange={(value) =>
                          edit('Aufwand geändert', (t) => {
                            const target = t.assignments.find((a) => a.id === assignment.id);
                            if (target) target.value = value;
                          }, `asg-${assignment.id}`)
                        }
                      />
                    </div>
                  </div>

                  {/*
                    Abweichende Bedarfe je Zeitraum. Ohne Eintrag gilt der
                    Grundwert oben fuer die ganze Aufgabe - der Normalfall
                    bleibt also ein einziger Regler.
                  */}
                  {assignment.periods.map((period) => (
                    <div key={period.id} className="row row--wrap subperiod">
                      <PeriodPicker
                        from={period.from}
                        to={period.to}
                        onChange={(from, to) =>
                          edit('Bedarfszeitraum geändert', (t) => {
                            const p = t.assignments
                              .find((a) => a.id === assignment.id)
                              ?.periods.find((x) => x.id === period.id);
                            if (p) {
                              p.from = from;
                              p.to = to;
                            }
                          })
                        }
                      />
                      <div style={{ minWidth: 140, flex: 1 }}>
                        <NumberSlider
                          min={0}
                          max={assignment.mode === 'FTE' ? 1 : 200}
                          step={assignment.mode === 'FTE' ? 0.1 : 1}
                          value={period.value}
                          suffix={assignment.mode}
                          onChange={(value) =>
                            edit('Bedarfszeitraum geändert', (t) => {
                              const p = t.assignments
                                .find((a) => a.id === assignment.id)
                                ?.periods.find((x) => x.id === period.id);
                              if (p) p.value = value;
                            }, `per-${period.id}`)
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        title="Zeitraum entfernen"
                        onClick={() =>
                          edit('Bedarfszeitraum entfernt', (t) => {
                            const a = t.assignments.find((x) => x.id === assignment.id);
                            if (a) a.periods = a.periods.filter((x) => x.id !== period.id);
                          })
                        }
                      >
                        &times;
                      </Button>
                    </div>
                  ))}

                  <Button
                    size="sm"
                    variant="ghost"
                    title="Abweichenden Bedarf für einen Zeitraum festlegen"
                    onClick={() =>
                      edit('Bedarfszeitraum ergänzt', (t) => {
                        const a = t.assignments.find((x) => x.id === assignment.id);
                        if (!a) return;
                        const bounds = defaultPeriodFor(st?.start);
                        a.periods.push({ ...createPeriodValue(a.value, bounds.from, bounds.to) });
                      })
                    }
                  >
                    + Zeitraum
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  icon
                  title="Zuordnung entfernen"
                  onClick={() => edit('Zuordnung entfernt', (t) => { t.assignments = t.assignments.filter((a) => a.id !== assignment.id); })}
                >
                  &times;
                </Button>
              </div>
            ))}
          </div>
          <Combobox
            placeholder="Person wählen oder anlegen..."
            options={client.people
              .filter((p) => !task.assignments.some((a) => a.personId === p.id))
              .map((p) => ({ id: p.id, label: p.name, hint: p.role || `${p.defaultFte} FTE` }))}
            onSelect={(id) => edit('Person zugeordnet', (t) => { t.assignments.push(createAssignment(id)); })}
            onCreate={(name) =>
              commitClient('Person angelegt', (c) => {
                const person = createPerson(name);
                c.people.push(person);
                const target = c.tasks.find((t) => t.id === task.id);
                if (target) target.assignments.push(createAssignment(person.id));
              })
            }
          />

          <div className="editor__section-title">Kosten</div>
          <div className="col">
            {/* Dieselben Felder wie in der Budgetansicht - siehe CostFields. */}
            {task.costs.map((cost) => (
              <CostFields
                key={cost.id}
                cost={cost}
                caption={budgetById.get(cost.budgetId)?.name ?? 'Unbekanntes Budget'}
                onEdit={(label, recipe, coalesceKey) =>
                  edit(label, (t) => {
                    const target = t.costs.find((c) => c.id === cost.id);
                    if (target) recipe(target);
                  }, coalesceKey)
                }
                onRemove={() =>
                  edit('Kostenposition entfernt', (t) => {
                    t.costs = t.costs.filter((c) => c.id !== cost.id);
                  })
                }
              />
            ))}
          </div>

          <Combobox
            placeholder="Budget wählen oder anlegen..."
            options={client.budgets.map((b) => ({ id: b.id, label: b.name }))}
            onSelect={(id) => edit('Kostenposition ergänzt', (t) => { t.costs.push(createCost(id)); })}
            onCreate={(name) =>
              commitClient('Budget angelegt', (c) => {
                const budget = createBudget(name);
                c.budgets.push(budget);
                const target = c.tasks.find((t) => t.id === task.id);
                if (target) target.costs.push(createCost(budget.id));
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Vorschlag fuer einen neuen Bedarfszeitraum: das Quartal des Aufgabenstarts. */
function defaultPeriodFor(start?: string): { from: string; to: string } {
  const iso = start ?? new Date().toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const quarter = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  return periodBounds(year, quarter);
}

/** Passende Eingabeeinheit zu einer Dauer in Arbeitstagen. */
function suggestUnit(workdays: number): DurationUnit {
  if (workdays >= WORKDAYS_PER.years) return 'years';
  if (workdays >= WORKDAYS_PER.months * 2) return 'months';
  if (workdays >= WORKDAYS_PER.weeks * 3) return 'weeks';
  return 'days';
}

/**
 * Eingabe in Arbeitstage. Die 0 bleibt erhalten - sie ist die Angabe "kein
 * Enddatum"; alles darüber wird auf mindestens einen Arbeitstag gerundet.
 */
function durationFromInput(value: number, unit: DurationUnit): number {
  return value <= 0 ? 0 : unitToWorkdays(value, unit);
}

/** Hinweiszeile unter einem Dauer-Regler. */
function durationHint(task: Task, workdays: number): string {
  if (workdays <= 0) return 'Kein Enddatum - die Aufgabe läuft dauerhaft weiter.';
  if (!task.schedule.start) return `${workdays} Arbeitstage`;
  return `${workdays} AT · Ende: ${formatDateDe(addWorkdays(task.schedule.start, workdays))}`;
}

/**
 * Werkzeugleiste über dem Aufgaben-Editor.
 *
 * Warnungen und die Löschknöpfe stehen hier oben statt verstreut im Formular:
 * beides betrifft die Aufgabe als Ganzes und soll sichtbar sein, ohne dass man
 * bis ans Ende des Editors scrollen muss.
 *
 * Gelöscht wird über `ConfirmButton` (zweiter Klick innerhalb von 3 Sekunden);
 * die Kaskade über alle Nachfolger ist ein eigener Knopf, der nur erscheint,
 * wenn es welche gibt.
 */
export function TaskEditorHeader({
  client,
  task,
  schedule,
  warnings,
}: {
  client: Client;
  task: Task;
  schedule: ScheduleResult;
  warnings: Warning[];
}) {
  const { commitClient, setUi } = useStore();
  const st = schedule.byId.get(task.id);

  const descendants = useMemo(() => {
    const result = new Set<Id>();
    const stack = [task.id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const t of client.tasks) {
        if (t.dependsOn.includes(current) && !result.has(t.id)) {
          result.add(t.id);
          stack.push(t.id);
        }
      }
    }
    return [...result];
  }, [client.tasks, task.id]);

  const remove = (cascade: boolean) => {
    const ids = new Set<Id>([task.id, ...(cascade ? descendants : [])]);
    commitClient(cascade ? 'Aufgabe mit Nachfolgern gelöscht' : 'Aufgabe gelöscht', (c) => {
      c.tasks = c.tasks.filter((t) => !ids.has(t.id));
      for (const t of c.tasks) {
        t.dependsOn = t.dependsOn.filter((d) => !ids.has(d));
        t.parallelWith = t.parallelWith.filter((d) => !ids.has(d));
      }
    });
    setUi({ selectedTaskId: null, pickTarget: null });
  };

  const cascadeTitles = descendants
    .map((id) => client.tasks.find((t) => t.id === id)?.title)
    .filter(Boolean)
    .join(', ');

  return (
    <>
      <span className="panel__title">Aufgabe bearbeiten</span>

      {/* Das Rechenergebnis gehoert neben die Ueberschrift: es beschreibt die
          Aufgabe als Ganzes und stand vorher mitten im Formular. */}
      <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
        {st
          ? `${formatDateDe(st.start)} → ${st.openEnded ? 'offen' : formatDateDe(st.end)} · ${st.duration} AT · Puffer ${st.slack} AT`
          : 'Nicht terminierbar'}
      </span>
      {st?.critical && !st.openEnded && <Badge tone="critical">kritischer Pfad</Badge>}
      {st?.cyclic && <Badge tone="critical">Zyklus</Badge>}

      {/* Warnungen dürfen schrumpfen und scrollen, damit die Knöpfe rechts
          immer erreichbar bleiben. */}
      <div className="headwarn">
        {warnings.map((w, i) => (
          <Badge key={i} tone={w.level === 'warn' ? 'warn' : 'default'}>
            <span title={w.text}>{w.text}</span>
          </Badge>
        ))}
      </div>

      <Button
        onClick={() => {
          const follow = createFollowUp(task, `${task.title} - Folge`);
          commitClient('Folgeaufgabe erstellt', (c) => {
            c.tasks.push(follow);
          });
          setUi({ selectedTaskId: follow.id });
        }}
        title="Neue Aufgabe, die direkt an diese anschließt"
      >
        + Folgeaufgabe
      </Button>
      <Button
        onClick={() => setUi({ selectedTaskId: null, pickTarget: null })}
        title="Auswahl aufheben - löscht nichts"
      >
        Schließen
      </Button>
      <ConfirmButton
        onConfirm={() => remove(false)}
        title="Nur diese Aufgabe löschen; Verweise darauf werden entfernt"
        confirmLabel="Wirklich löschen?"
      >
        Löschen
      </ConfirmButton>
      {descendants.length > 0 && (
        <ConfirmButton
          onConfirm={() => remove(true)}
          title={`Löscht zusätzlich ${descendants.length} abhängige Aufgabe(n): ${cascadeTitles} - kann mit Strg+Z rückgängig gemacht werden`}
          confirmLabel={`Wirklich ${descendants.length + 1} löschen?`}
        >
          Mit {descendants.length} Nachfolgern
        </ConfirmButton>
      )}
    </>
  );
}
