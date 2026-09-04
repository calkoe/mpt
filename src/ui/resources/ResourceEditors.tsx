/**
 * Editoren für Personen und Budgets, inklusive der zeitraumabhängigen
 * Grenzwerte (verfügbare FTE bzw. Budget-Obergrenzen je Zeitraum).
 */
import type { Budget, Id, PeriodValue, Person, Task } from '../../model/types';
import { createPeriodValue } from '../../model/factory';
import { formatDateDe } from '../../engine/dates';
import type { ScheduleResult } from '../../engine/schedule';
import type { Warning } from '../../engine/validate';
import { useStore } from '../../state/store';
import { AmountInput, Badge, Button, ConfirmButton, DateInput, Field, NumberSlider, TextInput } from '../components/controls';

export function PersonEditor({
  person,
  tasks,
  schedule,
}: {
  person: Person;
  tasks: Task[];
  schedule: ScheduleResult;
}) {
  const { commitClient, setUi } = useStore();

  const edit = (label: string, recipe: (p: Person) => void, coalesceKey?: string) =>
    commitClient(label, (c) => {
      const target = c.people.find((p) => p.id === person.id);
      if (target) recipe(target);
    }, coalesceKey ? { coalesceKey } : undefined);

  const linked = tasks.filter((t) => t.assignments.some((a) => a.personId === person.id));

  return (
    <div className="editor">
      <TextInput
        className="input--title"
        value={person.name}
        placeholder="Name"
        onChange={(name) => edit('Person umbenannt', (p) => { p.name = name; }, `person-name-${person.id}`)}
      />

      <div className="editor__cols">
        <div className="editor__section">
          <div className="editor__section-title">Stammdaten</div>
          <Field label="Rolle">
            <TextInput
              value={person.role}
              placeholder="z.B. Entwicklung"
              onChange={(role) => edit('Rolle geändert', (p) => { p.role = role; }, `person-role-${person.id}`)}
            />
          </Field>
          <Field label="Verfügbare FTE (Standard)" hint="Gilt, wenn kein Zeitraum unten greift">
            <NumberSlider
              min={0}
              max={2}
              step={0.05}
              value={person.defaultFte}
              onChange={(defaultFte) => edit('Verfügbarkeit geändert', (p) => { p.defaultFte = defaultFte; }, `person-fte-${person.id}`)}
            />
          </Field>
        </div>

        <div className="editor__section">
          <PeriodValueList
            title="Verfügbarkeit je Zeitraum"
            hint="z.B. ab 2027 nur noch 0,5 FTE"
            entries={person.availability}
            unit="FTE"
            onAdd={() => edit('Verfügbarkeitszeitraum ergänzt', (p) => { p.availability.push(createPeriodValue(p.defaultFte)); })}
            onChange={(id, patch) =>
              edit('Verfügbarkeit geändert', (p) => {
                const entry = p.availability.find((e) => e.id === id);
                if (entry) Object.assign(entry, patch);
              }, `person-avail-${id}`)
            }
            onRemove={(id) => edit('Zeitraum entfernt', (p) => { p.availability = p.availability.filter((e) => e.id !== id); })}
          />
        </div>

        <div className="editor__section">
          <div className="editor__section-title">Verknüpfte Aufgaben ({linked.length})</div>
          <div className="list">
            {linked.map((task) => {
              const st = schedule.byId.get(task.id);
              const assignments = task.assignments.filter((a) => a.personId === person.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className="list__item"
                  onClick={() => setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId: task.ventureId })}
                >
                  <span className={`status-dot status-dot--${task.status}`} />
                  <span className="grow truncate">{task.title}</span>
                  <span className="faint nowrap">
                    {assignments.map((a) => `${a.value}${a.mode === 'FTE' ? ' FTE' : ' PT'}`).join(', ')}
                  </span>
                  <span className="faint nowrap">{st ? formatDateDe(st.start) : ''}</span>
                </button>
              );
            })}
            {linked.length === 0 && <span className="faint">Keine Aufgaben zugeordnet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BudgetEditor({
  budget,
  tasks,
  schedule,
}: {
  budget: Budget;
  tasks: Task[];
  schedule: ScheduleResult;
}) {
  const { commitClient, setUi } = useStore();

  const edit = (label: string, recipe: (b: Budget) => void, coalesceKey?: string) =>
    commitClient(label, (c) => {
      const target = c.budgets.find((b) => b.id === budget.id);
      if (target) recipe(target);
    }, coalesceKey ? { coalesceKey } : undefined);

  const linked = tasks.filter((t) => t.costs.some((c) => c.budgetId === budget.id));

  return (
    <div className="editor">
      <TextInput
        className="input--title"
        value={budget.name}
        placeholder="Name"
        onChange={(name) => edit('Budget umbenannt', (b) => { b.name = name; }, `budget-name-${budget.id}`)}
      />

      <div className="editor__cols">
        <div className="editor__section">
          <div className="editor__section-title">Obergrenze gesamt</div>
          <Field label="Über die gesamte Laufzeit" hint="0 = keine Obergrenze">
            <AmountInput value={budget.totalLimit} onChange={(totalLimit) => edit('Obergrenze geändert', (b) => { b.totalLimit = totalLimit; }, `budget-total-${budget.id}`)} />
          </Field>
        </div>

        <div className="editor__section">
          <PeriodValueList
            title="Obergrenzen je Zeitraum"
            hint="typisch ein Eintrag pro Kalenderjahr"
            entries={budget.limits}
            unit="EUR"
            onAdd={() => edit('Obergrenze ergänzt', (b) => {
              const year = new Date().getFullYear() + b.limits.length;
              b.limits.push(createPeriodValue(0, `${year}-01-01`, `${year}-12-31`));
            })}
            onChange={(id, patch) =>
              edit('Obergrenze geändert', (b) => {
                const entry = b.limits.find((e) => e.id === id);
                if (entry) Object.assign(entry, patch);
              }, `budget-limit-${id}`)
            }
            onRemove={(id) => edit('Obergrenze entfernt', (b) => { b.limits = b.limits.filter((e) => e.id !== id); })}
          />
        </div>

        <div className="editor__section">
          <div className="editor__section-title">Verknüpfte Aufgaben ({linked.length})</div>
          <div className="list">
            {linked.map((task) => {
              const st = schedule.byId.get(task.id);
              const costs = task.costs.filter((c) => c.budgetId === budget.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className="list__item"
                  onClick={() => setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId: task.ventureId })}
                >
                  <span className={`status-dot status-dot--${task.status}`} />
                  <span className="grow truncate">{task.title}</span>
                  <span className="faint nowrap">
                    {costs
                      .map((c) => `${c.amount.toLocaleString('de-DE')} €${c.recurring ? ` / ${c.every}` : ''}`)
                      .join(', ')}
                  </span>
                  <span className="faint nowrap">{st ? formatDateDe(st.start) : ''}</span>
                </button>
              );
            })}
            {linked.length === 0 && <span className="faint">Keine Kosten zugeordnet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Liste zeitraumabhängiger Werte - für Verfügbarkeiten und Obergrenzen. */
function PeriodValueList({
  title,
  hint,
  entries,
  unit,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string;
  hint?: string;
  entries: PeriodValue[];
  unit: 'FTE' | 'EUR';
  onAdd: () => void;
  onChange: (id: Id, patch: Partial<PeriodValue>) => void;
  onRemove: (id: Id) => void;
}) {
  return (
    <>
      <div className="editor__section-title">
        {title}
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={onAdd}>
          + Zeitraum
        </Button>
      </div>
      {hint && <span className="field__hint">{hint}</span>}
      <div className="col">
        {entries.map((entry) => (
          <div key={entry.id} className="line-item">
            <div className="col">
              <div className="row row--wrap">
                <Field label="von">
                  <DateInput value={entry.from} onChange={(from) => onChange(entry.id, { from: from || undefined })} />
                </Field>
                <Field label="bis">
                  <DateInput value={entry.to} onChange={(to) => onChange(entry.id, { to: to || undefined })} />
                </Field>
              </div>
              {unit === 'FTE' ? (
                <NumberSlider min={0} max={2} step={0.05} value={entry.value} suffix="FTE" onChange={(value) => onChange(entry.id, { value })} />
              ) : (
                <AmountInput value={entry.value} onChange={(value) => onChange(entry.id, { value })} />
              )}
            </div>
            <Button variant="ghost" icon title="Zeitraum entfernen" onClick={() => onRemove(entry.id)}>
              &times;
            </Button>
          </div>
        ))}
        {entries.length === 0 && <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Keine Zeiträume definiert.</span>}
      </div>
    </>
  );
}

/**
 * Werkzeugleiste über dem Ressourcen-Editor.
 *
 * Wie beim Aufgaben-Editor stehen Warnungen und der Löschknopf oben in der
 * Leiste - dort, wo auch "+ Person" und "+ Budget" sitzen. Im Formular
 * darunter geht es dann nur noch um die Eigenschaften selbst.
 */
export function ResourceEditorHeader({
  person,
  budget,
  warnings,
}: {
  person?: Person;
  budget?: Budget;
  warnings: Warning[];
}) {
  const { commitClient, setUi } = useStore();

  const removePerson = () => {
    if (!person) return;
    commitClient('Person gelöscht', (c) => {
      c.people = c.people.filter((p) => p.id !== person.id);
      for (const t of c.tasks) t.assignments = t.assignments.filter((a) => a.personId !== person.id);
    });
    setUi({ selectedResourceId: null });
  };

  const removeBudget = () => {
    if (!budget) return;
    commitClient('Budget gelöscht', (c) => {
      c.budgets = c.budgets.filter((b) => b.id !== budget.id);
      for (const t of c.tasks) t.costs = t.costs.filter((cost) => cost.budgetId !== budget.id);
    });
    setUi({ selectedResourceId: null });
  };

  return (
    <>
      <div className="headwarn">
        {warnings.map((w, i) => (
          <Badge key={i} tone="warn">
            <span title={w.text}>{w.text}</span>
          </Badge>
        ))}
      </div>

      {person && (
        <ConfirmButton
          title="Person löschen; Zuordnungen in Aufgaben werden entfernt"
          confirmLabel="Wirklich löschen?"
          onConfirm={removePerson}
        >
          Löschen
        </ConfirmButton>
      )}
      {budget && (
        <ConfirmButton
          title="Budget löschen; Kostenpositionen in Aufgaben werden entfernt"
          confirmLabel="Wirklich löschen?"
          onConfirm={removeBudget}
        >
          Löschen
        </ConfirmButton>
      )}
    </>
  );
}
