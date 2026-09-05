/**
 * Aufgaben-Editor. Direktbearbeitung ohne Speichern-Knopf: jede Eingabe wirkt
 * sofort auf Netzplan, Gantt und Ressourcen.
 *
 * Terminierung: Start, Ende und Dauer sind ineinander umrechenbar - man gibt
 * eines an, der Rest ergibt sich. Bei Abhängigkeitsanker entfällt der eigene
 * Starttermin.
 */
import { useMemo, useState } from 'react';
import {
  DURATION_UNIT_LABEL,
  TASK_STATUS_LABEL,
  type Client,
  type DurationUnit,
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
  createPerson,
  createTag,
} from '../../model/factory';
import { addDuration, formatDateDe, formatDateTimeDe, sliderMaxFor, workdaysBetween } from '../../engine/dates';
import { formatDuration, wouldCreateCycle, type ScheduleResult } from '../../engine/schedule';
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
import { PeriodPicker } from '../components/PeriodPicker';
import { CostFields } from '../components/CostFields';
import { AssignmentFields } from '../components/AssignmentFields';

export function TaskEditor({
  client,
  task,
  schedule,
}: {
  client: Client;
  task: Task;
  schedule: ScheduleResult;
}) {
  const { commitClient } = useStore();
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

  /*
   * Die Einheit der Dauer gehoert zur Aufgabe, nicht zur Ansicht: sie
   * entscheidet, wie das Enddatum gerechnet wird (Arbeitstage oder
   * Kalenderzeit) - siehe `addDuration`.
   */
  const durationUnit = task.schedule.durationUnit;

  /** Taggenaue Datumsfelder sind eingeklappt; der Regelfall ist der Zeitraum. */
  const [exactDates, setExactDates] = useState(false);

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
          block
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

      {/*
        Beschreibung und Verknüpfungen nebeneinander. Der rechte Block ist
        genauso breit wie die Statusauswahl darüber und genauso hoch wie die
        Beschreibung - dadurch läuft die rechte Kante des Editors durch, statt
        an drei Stellen unterschiedlich weit zu reichen.
      */}
      <div className="editor__brief">
        <TextArea
          rows={5}
          value={task.description}
          placeholder="Kurzbeschreibung"
          onChange={(description) => edit('Beschreibung geändert', (t) => { t.description = description; }, `desc-${task.id}`)}
        />
        <LinkPanel task={task} client={client} taskById={taskById} edit={edit} />
      </div>

      {/*
        Drei Spalten mit unterschiedlichem Gewicht: die Ressourcenspalte traegt
        Zeitraumwaehler und Kostenfelder und braucht deshalb den meisten Platz,
        die Verknuepfungen kommen mit Auswahllisten aus.
      */}
      <div className="editor__cols editor__cols--task">
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

          {task.schedule.anchor === 'date' && !exactDates && (
            <Field label="Beginn der Aufgabe" hint="Jahr, Quartal oder Monat - genauer geht es unten">
              <PeriodPicker
                mode="start"
                from={task.schedule.start}
                onChange={(from) =>
                  edit('Beginn geändert', (t) => {
                    t.schedule.start = from;
                    // Das Ende ergibt sich aus der Dauer; ein alter fester
                    // Endtermin passte danach nicht mehr zum neuen Beginn.
                    t.schedule.end = undefined;
                  })
                }
              />
            </Field>
          )}

          {task.schedule.anchor === 'date' && exactDates && (
            /* Zwei gleich breite Spalten, damit die Datumsfelder trotz
               unterschiedlich langer Beschriftungen exakt bündig stehen. */
            <div className="field-pair">
              <Field label="Start">
                <DateInput
                  value={task.schedule.start}
                  onChange={(start) => edit('Start geändert', (t) => { t.schedule.start = start || undefined; })}
                />
              </Field>
              <Field label="Ende" hint="Setzt die Dauer">
                <DateInput
                  value={task.schedule.end}
                  onChange={(end) =>
                    edit('Ende geändert', (t) => {
                      t.schedule.end = end || undefined;
                      if (end && t.schedule.start) {
                        const days = workdaysBetween(t.schedule.start, end);
                        t.schedule.durationMin = days;
                        t.schedule.durationMax = days;
                        t.schedule.durationUnit = 'days';
                      }
                    })
                  }
                />
              </Field>
            </div>
          )}

          {!exactDates && (
          <>
          <Field
            label="Dauer angeben in"
            hint="AT zählt Arbeitstage, alles andere ist Kalenderzeit"
          >
            <Segmented<DurationUnit>
              block
              ariaLabel="Einheit der Dauer"
              value={durationUnit}
              onChange={(unit) => edit('Dauereinheit geändert', (t) => { t.schedule.durationUnit = unit; })}
              options={(['days', 'weeks', 'months', 'quarters', 'years'] as DurationUnit[]).map((u) => ({
                value: u,
                label: DURATION_UNIT_LABEL[u],
                title:
                  u === 'days'
                    ? 'Arbeitstage, Montag bis Freitag'
                    : `Kalenderzeit - 1 ${DURATION_UNIT_LABEL[u]} ab dem 1. endet am letzten Tag`,
              }))}
            />
          </Field>

          {/* Dauer 0 heißt: kein Enddatum. Ein Dauerläufer braucht deshalb
              keinen eigenen Schalter - er hat schlicht keine Dauer. */}
          <Field
            label="Dauer minimal (optimistisch)"
            hint={durationHint(task, task.schedule.durationMin, durationUnit)}
          >
            <NumberSlider
              min={0}
              max={sliderMaxFor(durationUnit)}
              step={1}
              value={task.schedule.durationMin}
              suffix={DURATION_UNIT_LABEL[durationUnit]}
              onChange={(value) =>
                edit('Dauer geändert', (t) => {
                  t.schedule.durationMin = Math.max(0, Math.round(value));
                  t.schedule.durationMax = Math.max(t.schedule.durationMax, t.schedule.durationMin);
                  t.schedule.end = undefined;
                }, `durmin-${task.id}`)
              }
            />
          </Field>

          <Field
            label="Dauer maximal (pessimistisch)"
            hint={durationHint(task, task.schedule.durationMax, durationUnit)}
          >
            <NumberSlider
              min={0}
              max={sliderMaxFor(durationUnit)}
              step={1}
              value={task.schedule.durationMax}
              suffix={DURATION_UNIT_LABEL[durationUnit]}
              onChange={(value) =>
                edit('Dauer geändert', (t) => {
                  t.schedule.durationMax = Math.max(0, Math.round(value));
                  t.schedule.durationMin = Math.min(t.schedule.durationMin, t.schedule.durationMax);
                  t.schedule.end = undefined;
                }, `durmax-${task.id}`)
              }
            />
          </Field>
          </>
          )}

          {/*
            Zwei Wege, ein Ergebnis - aber nie beide gleichzeitig sichtbar:
            entweder grob (Beginn plus Dauer) oder taggenau (Start und Ende).
            Beides nebeneinander zu zeigen hiess, zwei Eingaben anzubieten, die
            sich gegenseitig ueberschreiben.
          */}
          {task.schedule.anchor === 'date' && (
            <Button size="sm" variant="ghost" block onClick={() => setExactDates((v) => !v)}>
              {exactDates ? '← Beginn und Dauer' : 'Taggenau eintragen →'}
            </Button>
          )}

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

        {/* Ressourcen */}
        <div className="editor__section">
          <div className="editor__section-title">Personalressourcen</div>
          <div className="col">
            {/* Dieselben Felder wie im Personen-Editor - siehe AssignmentFields. */}
            {task.assignments.map((assignment) => (
              <AssignmentFields
                key={assignment.id}
                assignment={assignment}
                caption={personById.get(assignment.personId)?.name ?? 'Unbekannt'}
                taskStart={st?.start}
                taskWorkdays={st?.workdays ?? 1}
                onEdit={(label, recipe, coalesceKey) =>
                  edit(label, (t) => {
                    const target = t.assignments.find((a) => a.id === assignment.id);
                    if (target) recipe(target);
                  }, coalesceKey)
                }
                onRemove={() =>
                  edit('Zuordnung entfernt', (t) => {
                    t.assignments = t.assignments.filter((a) => a.id !== assignment.id);
                  })
                }
              />
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
                term={st ? { start: st.start, end: st.end, openEnded: st.openEnded } : undefined}
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

      {/*
        Checkliste unter den Blöcken: sie wächst mit der Arbeit und wäre weiter
        oben der einzige Teil des Editors, der ständig seine Höhe ändert - alles
        darunter rutschte dann bei jedem Punkt mit.
      */}
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
            {/* Runder, gruener Haken - siehe .checklist__box. */}
            <label className="checklist__box" title={item.done ? 'Erledigt' : 'Als erledigt markieren'}>
              <input
                type="checkbox"
                checked={item.done}
                aria-label="Erledigt"
                onChange={(e) =>
                  edit('Checkliste aktualisiert', (t) => {
                    const target = t.checklist.find((c) => c.id === item.id);
                    if (!target) return;
                    target.done = e.target.checked;
                    // Zeitpunkt festhalten - und beim Zuruecknehmen wieder
                    // verwerfen, sonst behauptet er etwas Falsches.
                    target.doneAt = e.target.checked ? new Date().toISOString() : undefined;
                  })
                }
              />
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 8.4 L6.8 11 L12 5.4" />
              </svg>
            </label>
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
            {item.doneAt && (
              <span className="checklist__stamp nowrap" title={`Abgehakt am ${formatDateTimeDe(item.doneAt)}`}>
                {formatDateTimeDe(item.doneAt)}
              </span>
            )}
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
    </div>
  );
}


/** Art der Verknüpfung, die der Wähler unten anlegt. */
type LinkKind = 'dependsOn' | 'parallelWith' | 'condition';

const LINK_LABEL: Record<LinkKind, string> = {
  dependsOn: 'Vorgänger',
  parallelWith: 'Parallel',
  condition: 'Bedingung',
};

/**
 * Verknüpfungen einer Aufgabe auf kleinem Raum.
 *
 * Vorgänger, Parallelitäten und Startbedingungen hatten vorher eine eigene
 * Spalte mit drei Überschriften, drei Auswahllisten und drei Chip-Reihen - für
 * drei Angaben, die man meistens einmal setzt und dann nur noch liest. Hier
 * teilen sie sich **eine** Auswahlliste; der Umschalter darüber bestimmt, was
 * sie anbietet. Alle bestehenden Verknüpfungen stehen darunter gemeinsam als
 * Marken, jede mit einem Zeichen für ihre Art - so sieht man den Zusammenhang
 * auf einen Blick, statt ihn aus drei Blöcken zusammenzusetzen.
 */
function LinkPanel({
  task,
  client,
  taskById,
  edit,
}: {
  task: Task;
  client: Client;
  taskById: Map<Id, Task>;
  edit: (label: string, recipe: (task: Task) => void, coalesceKey?: string) => void;
}) {
  const { ui, setUi, commitClient } = useStore();
  const [kind, setKind] = useState<LinkKind>('dependsOn');
  const picking = ui.pickTarget?.taskId === task.id ? ui.pickTarget.field : null;

  const taskOptions = (exclude: Id[]) =>
    client.tasks
      .filter((t) => t.id !== task.id && !exclude.includes(t.id))
      .map((t) => ({
        id: t.id,
        label: t.title,
        hint: client.ventures.find((v) => v.id === t.ventureId)?.name,
        // Aufgaben desselben Vorhabens stehen oben - danach sucht man zuerst.
        group: t.ventureId === task.ventureId ? 'Dieses Vorhaben' : undefined,
        ...(kind === 'dependsOn' && wouldCreateCycle(client.tasks, task.id, t.id)
          ? { disabled: true, disabledReason: 'Würde einen Abhängigkeitszyklus erzeugen.' }
          : {}),
      }));

  const options =
    kind === 'dependsOn'
      ? taskOptions(task.dependsOn)
      : kind === 'parallelWith'
        ? taskOptions(task.parallelWith)
        : [
            ...client.conditions
              .filter((c) => !task.conditionIds.includes(c.id))
              .map((c) => ({ id: `cond:${c.id}`, label: c.name, hint: c.met ? 'erfüllt' : 'offen' })),
            ...client.ventures
              .filter((v) => !task.ventureConditions.includes(v.id) && v.id !== task.ventureId)
              .map((v) => ({ id: `ven:${v.id}`, label: v.name, hint: 'Vorhaben' })),
          ];

  const select = (id: Id) => {
    if (kind === 'dependsOn') {
      edit('Abhängigkeit ergänzt', (t) => {
        if (!t.dependsOn.includes(id)) t.dependsOn.push(id);
        t.schedule.anchor = 'dependency';
      });
      return;
    }
    if (kind === 'parallelWith') {
      edit('Parallelität ergänzt', (t) => {
        if (!t.parallelWith.includes(id)) t.parallelWith.push(id);
      });
      return;
    }
    const [prefix, realId] = id.split(':');
    edit('Startbedingung ergänzt', (t) => {
      if (prefix === 'cond' && !t.conditionIds.includes(realId)) t.conditionIds.push(realId);
      if (prefix === 'ven' && !t.ventureConditions.includes(realId)) t.ventureConditions.push(realId);
    });
  };

  const empty =
    task.dependsOn.length + task.parallelWith.length + task.conditionIds.length + task.ventureConditions.length === 0;

  return (
    <div className="linkpanel">
      <Segmented<LinkKind>
        block
        ariaLabel="Art der Verknüpfung"
        value={kind}
        onChange={setKind}
        options={(Object.keys(LINK_LABEL) as LinkKind[]).map((k) => ({ value: k, label: LINK_LABEL[k] }))}
      />

      <div className="row">
        <div className="grow">
          <Combobox
            placeholder={kind === 'condition' ? 'Bedingung oder Vorhaben...' : 'Aufgabe suchen...'}
            options={options}
            onSelect={select}
            onCreate={
              kind === 'condition'
                ? (name) =>
                    commitClient('Bedingung angelegt', (c) => {
                      const condition = createCondition(name);
                      c.conditions.push(condition);
                      c.tasks.find((t) => t.id === task.id)?.conditionIds.push(condition.id);
                    })
                : undefined
            }
          />
        </div>
        {/* Nur für Aufgaben sinnvoll - Bedingungen stehen nicht im Plan. */}
        {kind !== 'condition' && (
          <Button
            size="sm"
            variant={picking === kind ? 'primary' : 'ghost'}
            title="Danach oben in der Visualisierung auf eine Aufgabe klicken"
            onClick={() =>
              setUi({ pickTarget: picking === kind ? null : { field: kind, taskId: task.id } })
            }
          >
            {picking === kind ? 'aktiv' : 'im Plan'}
          </Button>
        )}
      </div>

      <div className="linkpanel__chips">
        {task.dependsOn.map((id) => (
          <Chip
            key={`dep-${id}`}
            label={`← ${taskById.get(id)?.title ?? 'unbekannt'}`}
            title="Vorgänger - klicken zum Öffnen"
            onClick={() => setUi({ selectedTaskId: id })}
            onRemove={() => edit('Abhängigkeit entfernt', (t) => { t.dependsOn = t.dependsOn.filter((x) => x !== id); })}
          />
        ))}
        {task.parallelWith.map((id) => (
          <Chip
            key={`par-${id}`}
            label={`↕ ${taskById.get(id)?.title ?? 'unbekannt'}`}
            title="Läuft parallel - klicken zum Öffnen"
            onClick={() => setUi({ selectedTaskId: id })}
            onRemove={() => edit('Parallelität entfernt', (t) => { t.parallelWith = t.parallelWith.filter((x) => x !== id); })}
          />
        ))}
        {task.ventureConditions.map((id) => {
          const venture = client.ventures.find((v) => v.id === id);
          return (
            <Chip
              key={`ven-${id}`}
              label={`⚑ ${venture?.name ?? '?'}`}
              title="Vorhaben muss abgeschlossen sein"
              color={venture && isVentureDone(client, venture.id) ? 'var(--ok)' : 'var(--warn)'}
              onRemove={() =>
                edit('Startbedingung entfernt', (t) => {
                  t.ventureConditions = t.ventureConditions.filter((x) => x !== id);
                })
              }
            />
          );
        })}
        {task.conditionIds.map((id) => {
          const condition = client.conditions.find((c) => c.id === id);
          return (
            <Chip
              key={`cond-${id}`}
              label={`⚑ ${condition?.name ?? '?'}`}
              color={condition?.met ? 'var(--ok)' : 'var(--warn)'}
              title="Bedingung - Klick schaltet erfüllt/nicht erfüllt um"
              onClick={() =>
                commitClient('Bedingung umgeschaltet', (c) => {
                  const target = c.conditions.find((x) => x.id === id);
                  if (target) target.met = !target.met;
                })
              }
              onRemove={() => edit('Bedingung entfernt', (t) => { t.conditionIds = t.conditionIds.filter((x) => x !== id); })}
            />
          );
        })}
        {empty && <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Keine Verknüpfungen.</span>}
      </div>
    </div>
  );
}

/** Hinweiszeile unter einem Dauer-Regler. */
function durationHint(task: Task, amount: number, unit: DurationUnit): string {
  if (amount <= 0) return 'Kein Enddatum - die Aufgabe läuft dauerhaft weiter.';
  const label = `${amount} ${DURATION_UNIT_LABEL[unit]}`;
  if (!task.schedule.start) return label;
  return `${label} · Ende: ${formatDateDe(addDuration(task.schedule.start, amount, unit))}`;
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
          ? `${formatDateDe(st.start)} → ${st.openEnded ? 'offen' : formatDateDe(st.end)} · ${formatDuration(st)} · Puffer ${st.slack} AT`
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
