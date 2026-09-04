/**
 * Editoren für Personen und Budgets, inklusive der zeitraumabhängigen
 * Grenzwerte (verfügbare FTE bzw. Budget-Obergrenzen je Zeitraum).
 */
import { BUDGET_KIND_LABEL, type Budget, type BudgetKind, type Id, type PeriodValue, type Person, type Task } from '../../model/types';
import { createPeriodValue, createTag } from '../../model/factory';
import { formatDateDe } from '../../engine/dates';
import type { ScheduleResult } from '../../engine/schedule';
import type { Warning } from '../../engine/validate';
import { useStore } from '../../state/store';
import {
  AmountInput,
  Badge,
  Button,
  Chip,
  Combobox,
  ConfirmButton,
  Field,
  NumberSlider,
  Segmented,
  TextInput,
} from '../components/controls';
import { PeriodPicker } from '../components/PeriodPicker';
import { CostFields } from '../components/CostFields';
import { formatValue } from '../../engine/resources';

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
          {/* 1,0 FTE ist eine volle Stelle - mehr kann eine Person nicht sein. */}
          <Field label="Verfügbare FTE (Standard)" hint="Gilt, wenn kein Zeitraum unten greift">
            <NumberSlider
              min={0}
              max={1}
              step={0.1}
              value={person.defaultFte}
              onChange={(defaultFte) => edit('Verfügbarkeit geändert', (p) => { p.defaultFte = defaultFte; }, `person-fte-${person.id}`)}
            />
          </Field>

          <ResourceTags
            tagIds={person.tagIds}
            onAdd={(id) => edit('Tag ergänzt', (p) => { if (!p.tagIds.includes(id)) p.tagIds.push(id); })}
            onRemove={(id) => edit('Tag entfernt', (p) => { p.tagIds = p.tagIds.filter((t) => t !== id); })}
            onCreate={(name) =>
              commitClient('Tag angelegt', (c) => {
                const tag = createTag(name, c.tags);
                c.tags.push(tag);
                c.people.find((x) => x.id === person.id)?.tagIds.push(tag.id);
              })
            }
          />
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

export function BudgetEditor({ budget, tasks }: { budget: Budget; tasks: Task[] }) {
  const { commitClient } = useStore();

  const edit = (label: string, recipe: (b: Budget) => void, coalesceKey?: string) =>
    commitClient(label, (c) => {
      const target = c.budgets.find((b) => b.id === budget.id);
      if (target) recipe(target);
    }, coalesceKey ? { coalesceKey } : undefined);

  /** Alle Kostenpositionen, die auf dieses Budget zeigen - mit ihrer Aufgabe. */
  const costItems = tasks.flatMap((task) =>
    task.costs.filter((c) => c.budgetId === budget.id).map((cost) => ({ task, cost })),
  );
  const plannedSum = costItems.reduce((s, { cost }) => s + cost.amount, 0);
  const actualSum = costItems.reduce((s, { cost }) => s + cost.actualAmount, 0);

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
          {/* Die Art trennt die Gesamtsummen in der Uebersicht. */}
          <Field label="Art des Budgets">
            <Segmented<BudgetKind>
              block
              ariaLabel="Art des Budgets"
              value={budget.kind}
              onChange={(kind) => edit('Budgetart geändert', (b) => { b.kind = kind; })}
              options={(Object.keys(BUDGET_KIND_LABEL) as BudgetKind[]).map((k) => ({
                value: k,
                label: BUDGET_KIND_LABEL[k],
              }))}
            />
          </Field>

          <ResourceTags
            tagIds={budget.tagIds}
            onAdd={(id) => edit('Tag ergänzt', (b) => { if (!b.tagIds.includes(id)) b.tagIds.push(id); })}
            onRemove={(id) => edit('Tag entfernt', (b) => { b.tagIds = b.tagIds.filter((t) => t !== id); })}
            onCreate={(name) =>
              commitClient('Tag angelegt', (c) => {
                const tag = createTag(name, c.tags);
                c.tags.push(tag);
                c.budgets.find((x) => x.id === budget.id)?.tagIds.push(tag.id);
              })
            }
          />

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
          <div className="editor__section-title">Kosten dieses Budgets ({costItems.length})</div>
          {/*
            Dieselben Felder wie im Aufgaben-Editor, nur aus der anderen
            Richtung: dort steht das Budget in der Ueberschrift, hier die
            Aufgabe. Ein Bauteil fuer beide - siehe CostFields.
          */}
          <div className="col">
            {costItems.map(({ task, cost }) => (
              <CostFields
                key={cost.id}
                cost={cost}
                caption={task.title}
                onEdit={(label, recipe, coalesceKey) =>
                  commitClient(label, (c) => {
                    const target = c.tasks.find((t) => t.id === task.id)?.costs.find((x) => x.id === cost.id);
                    if (target) recipe(target);
                  }, coalesceKey ? { coalesceKey } : undefined)
                }
                onRemove={() =>
                  commitClient('Kostenposition entfernt', (c) => {
                    const target = c.tasks.find((t) => t.id === task.id);
                    if (target) target.costs = target.costs.filter((x) => x.id !== cost.id);
                  })
                }
              />
            ))}
            {costItems.length === 0 && <span className="faint">Keine Kosten zugeordnet.</span>}
          </div>

          {costItems.length > 0 && (
            <div className="totals">
              <div className="totals__row">
                <span className="faint">geplant</span>
                <span className="mono">{formatValue(plannedSum, 'EUR')}</span>
              </div>
              <div className="totals__row">
                <span className="faint">abgerufen</span>
                <span className="mono">{formatValue(actualSum, 'EUR')}</span>
              </div>
              <div className="totals__row totals__row--sum">
                <span>offen</span>
                <span className="mono">{formatValue(plannedSum - actualSum, 'EUR')}</span>
              </div>
            </div>
          )}
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
              {/* Quartal oder Jahr genuegt - taggenau wird hier nicht geplant. */}
              <PeriodPicker
                from={entry.from}
                to={entry.to}
                onChange={(from, to) => onChange(entry.id, { from, to })}
              />
              {unit === 'FTE' ? (
                <NumberSlider min={0} max={1} step={0.1} value={entry.value} suffix="FTE" onChange={(value) => onChange(entry.id, { value })} />
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
 * Tags an einer Ressource. Personen und Budgets nutzen denselben Block, damit
 * das Zuordnen sich überall gleich anfühlt - und dieselbe `Combobox` wie bei
 * Aufgaben, inklusive "beim Tippen neu anlegen".
 */
function ResourceTags({
  tagIds,
  onAdd,
  onRemove,
  onCreate,
}: {
  tagIds: Id[];
  onAdd: (id: Id) => void;
  onRemove: (id: Id) => void;
  onCreate: (name: string) => void;
}) {
  const { client } = useStore();
  const tagById = new Map(client.tags.map((t) => [t.id, t]));

  return (
    <>
      <div className="editor__section-title">Tags</div>
      <div className="row row--wrap">
        {tagIds.map((id) => {
          const tag = tagById.get(id);
          return tag ? (
            <Chip key={id} label={tag.name} color={tag.color} onRemove={() => onRemove(id)} />
          ) : null;
        })}
        {tagIds.length === 0 && (
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Keine Tags.</span>
        )}
      </div>
      <Combobox
        placeholder="Tag wählen oder anlegen..."
        options={client.tags
          .filter((t) => !tagIds.includes(t.id))
          .map((t) => ({ id: t.id, label: t.name, color: t.color }))}
        onSelect={onAdd}
        onCreate={onCreate}
      />
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
