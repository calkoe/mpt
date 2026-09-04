/**
 * Rechte Seite, Modus "Ressourcenübersicht".
 * Oben die überlagerten Ganglinien (oder die Tabelle mit Jahressummen),
 * darunter die Ressourcenlisten und der Editor der gewählten Ressource.
 */
import { useMemo, useState } from 'react';
import { createBudget, createPerson } from '../../model/factory';
import type { Id } from '../../model/types';
import { GRANULARITY_LABEL, type Granularity } from '../../engine/dates';
import {
  budgetDailyLoad,
  budgetSeries,
  formatValue,
  personDailyLoad,
  personSeries,
  type PersonUnit,
  type ResourceFilter,
  type ResourceSeries,
} from '../../engine/resources';
import { useDerived } from '../../state/useDerived';
import { usePreferences, type ResourceView } from '../../state/preferences';
import { useStore } from '../../state/store';
import { Button, Chip, EmptyState, Segmented, Switch } from '../components/controls';
import { SplitStack } from '../components/SplitStack';
import { buildTaskColors } from '../components/taskPalette';
import { ResourceChart } from './ResourceChart';
import { ResourceTable } from './ResourceTable';
import { BudgetEditor, PersonEditor, ResourceEditorHeader } from './ResourceEditors';

export function ResourceOverview() {
  const { client, ui, setUi, commitClient } = useStore();
  const { prefs, setPrefs } = usePreferences();
  const derived = useDerived();

  // Filter: Tags lokal in dieser Ansicht, Vorhaben aus der Seitenleistenauswahl.
  const [tagIds, setTagIds] = useState<Id[]>([]);
  const filter = useMemo<ResourceFilter>(
    () => ({ tagIds, ventureIds: ui.ventureId ? [ui.ventureId] : [] }),
    [tagIds, ui.ventureId],
  );

  const options = {
    from: derived.schedule.horizonStart,
    to: derived.schedule.horizonEnd,
    granularity: prefs.resourceGranularity,
    personUnit: prefs.personUnit,
  };

  const personLoads = useMemo(() => personDailyLoad(client, derived.schedule, filter), [client, derived.schedule, filter]);
  const budgetLoads = useMemo(() => budgetDailyLoad(client, derived.schedule, filter), [client, derived.schedule, filter]);

  const personAll = useMemo<ResourceSeries[]>(
    () => client.people.map((p) => personSeries(p, personLoads.get(p.id) ?? new Map(), options)),
    [client.people, personLoads, options.from, options.to, options.granularity, options.personUnit],
  );
  const budgetAll = useMemo<ResourceSeries[]>(
    () => client.budgets.map((b) => budgetSeries(b, budgetLoads.get(b.id) ?? new Map(), options)),
    [client.budgets, budgetLoads, options.from, options.to, options.granularity],
  );

  const selectedId = ui.selectedResourceId;
  const selectedPerson = client.people.find((p) => p.id === selectedId);
  const selectedBudget = client.budgets.find((b) => b.id === selectedId);
  const selectedResource = selectedPerson ?? selectedBudget;

  // Angezeigte Ganglinien: die gewählte Ressource, sonst alle.
  const shownSeries = selectedPerson
    ? personAll.filter((s) => s.resourceId === selectedPerson.id)
    : selectedBudget
      ? budgetAll.filter((s) => s.resourceId === selectedBudget.id)
      : [...personAll, ...budgetAll];

  const taskLabel = (taskId: Id) => derived.taskById.get(taskId)?.title ?? 'Unbekannt';
  // Feste Farbe je Aufgabe fuer die gestapelten Balken - siehe taskPalette.
  const taskColors = useMemo(() => buildTaskColors(client.tasks), [client.tasks]);

  const charts = (
    <div className="panel">
        <div className="panel__head">
          {selectedId ? (
            <Button
              variant="primary"
              onClick={() => setUi({ selectedResourceId: null })}
              title="Zurück zu allen Ressourcen"
            >
              ← Zurück zur Übersicht
            </Button>
          ) : (
            <span className="panel__title">Ressourcen-Ganglinien</span>
          )}

          <Segmented<ResourceView>
            ariaLabel="Darstellung"
            value={prefs.resourceView}
            onChange={(resourceView) => setPrefs({ resourceView })}
            options={[
              { value: 'chart', label: 'Diagramm' },
              { value: 'table', label: 'Tabelle' },
            ]}
          />

          <Segmented<Granularity>
            ariaLabel="Zeitraster"
            value={prefs.resourceGranularity}
            onChange={(resourceGranularity) => setPrefs({ resourceGranularity })}
            options={(['day', 'week', 'month', 'quarter', 'year'] as Granularity[]).map((g) => ({
              value: g,
              label: GRANULARITY_LABEL[g],
            }))}
          />

          <Segmented<PersonUnit>
            ariaLabel="Einheit für Personen"
            value={prefs.personUnit}
            onChange={(personUnit) => setPrefs({ personUnit })}
            options={[
              { value: 'FTE', label: 'FTE', title: 'Mittlere Auslastung je Zeitraum' },
              { value: 'PT', label: 'PT', title: 'Personentage je Zeitraum' },
            ]}
          />

          <div className="spacer" />

          <TagFilter tagIds={tagIds} onChange={setTagIds} />
        </div>

        <div className="panel__body">
          {shownSeries.length === 0 ? (
            <EmptyState title="Keine Ressourcen" hint="Personen und Budgets entstehen direkt beim Zuordnen in einer Aufgabe." />
          ) : prefs.resourceView === 'table' ? (
            <ResourceTable series={shownSeries} />
          ) : (
            /* Zwei Ganglinien nebeneinander - bei nur einer gewählten Ressource
               nimmt diese die volle Breite ein. */
            <div className={`resource-grid${selectedId ? ' resource-grid--single' : ''}`}>
              {shownSeries.map((series) => (
                <div key={series.resourceId} className="panel panel--card">
                  <div className="panel__head">
                    <span className={`status-dot status-dot--${series.breaches.length > 0 ? 'blocked' : 'done'}`} />
                    <span className="panel__title truncate">{series.name}</span>
                    <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
                      {series.kind === 'person'
                        ? `${prefs.personUnit === 'FTE' ? 'Ø aktiv' : 'Summe'}: ${formatValue(series.total, series.unit)}`
                        : `Summe: ${formatValue(series.total, series.unit)}`}
                      {series.breaches.length > 0 && ` · ${series.breaches.length} Überschreitung(en)`}
                    </span>
                    <div className="spacer" />
                    <Button size="sm" variant="ghost" onClick={() => setUi({ selectedResourceId: series.resourceId })}>
                      Details
                    </Button>
                  </div>
                  <ResourceChart
                    series={series}
                    taskLabel={taskLabel}
                    taskColors={taskColors}
                    onSelectTask={(taskId) => {
                      const task = derived.taskById.get(taskId);
                      setUi({ mode: 'tasks', selectedTaskId: taskId, ventureId: task?.ventureId ?? null });
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
    </div>
  );

  const details = (
    <div className="panel">
        {/* Warnungen und der Löschknopf der gewählten Ressource stehen hier
            oben neben "+ Person" und "+ Budget" - siehe ResourceEditorHeader. */}
        <div className="panel__head">
          {selectedId && (
            <Button
              variant="primary"
              onClick={() => setUi({ selectedResourceId: null })}
              title="Zurück zur Ressourcenliste"
            >
              ← Zurück
            </Button>
          )}
          <span className="panel__title">
            {selectedPerson ? 'Person' : selectedBudget ? 'Budget' : 'Ressourcen'}
          </span>

          {selectedResource ? (
            <ResourceEditorHeader
              person={selectedPerson}
              budget={selectedBudget}
              warnings={derived.resourceWarnings.get(selectedResource.id) ?? []}
            />
          ) : (
            <div className="spacer" />
          )}

          <Button
            onClick={() => {
              const person = createPerson();
              commitClient('Person angelegt', (c) => {
                c.people.push(person);
              });
              setUi({ selectedResourceId: person.id });
            }}
          >
            + Person
          </Button>
          <Button
            onClick={() => {
              const budget = createBudget();
              commitClient('Budget angelegt', (c) => {
                c.budgets.push(budget);
              });
              setUi({ selectedResourceId: budget.id });
            }}
          >
            + Budget
          </Button>
        </div>

        <div className="panel__body">
          {selectedPerson ? (
            <PersonEditor person={selectedPerson} tasks={client.tasks} schedule={derived.schedule} />
          ) : selectedBudget ? (
            <BudgetEditor budget={selectedBudget} tasks={client.tasks} schedule={derived.schedule} />
          ) : (
            <ResourceLists personSeriesList={personAll} budgetSeriesList={budgetAll} />
          )}
        </div>
    </div>
  );

  return (
    <SplitStack
      ratio={prefs.splitRatio}
      onRatioChange={(splitRatio) => setPrefs({ splitRatio })}
      top={charts}
      bottom={details}
    />
  );
}

/** Listen aller Personen und Budgets mit Kennzahlen. */
function ResourceLists({
  personSeriesList,
  budgetSeriesList,
}: {
  personSeriesList: ResourceSeries[];
  budgetSeriesList: ResourceSeries[];
}) {
  const { client, setUi } = useStore();
  const derived = useDerived();

  const renderRow = (series: ResourceSeries) => {
    const warnings = derived.resourceWarnings.get(series.resourceId) ?? [];
    return (
      <button
        key={series.resourceId}
        type="button"
        className="list__item"
        onClick={() => setUi({ selectedResourceId: series.resourceId })}
      >
        <span className={`status-dot status-dot--${warnings.length > 0 ? 'blocked' : 'done'}`} />
        {/* Name oben, Kennzahlen darunter - so wird der Name nie abgeschnitten. */}
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="row">
            <span className="truncate" style={{ fontWeight: 550 }}>
              {series.name}
            </span>
            {warnings.length > 0 && (
              <span className="warn-icon" title={warnings.map((w) => w.text).join('\n')}>
                &#9888;
              </span>
            )}
          </span>
          <span className="row faint mono" style={{ fontSize: 'var(--fs-sm)' }}>
            <span title={series.unit === 'EUR' ? 'Summe über den Betrachtungszeitraum' : 'Mittel über die Zeiträume mit Last'}>
              {formatValue(series.total, series.unit)}
            </span>
            <span title="Spitzenwert">↑{formatValue(series.peak, series.unit)}</span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="editor">
      <div className="editor__cols">
        <div className="editor__section">
          <div className="editor__section-title">Personen ({client.people.length})</div>
          <div className="list">
            {personSeriesList.map(renderRow)}
            {personSeriesList.length === 0 && <span className="faint">Noch keine Personen.</span>}
          </div>
        </div>
        <div className="editor__section">
          <div className="editor__section-title">Budgets ({client.budgets.length})</div>
          <div className="list">
            {budgetSeriesList.map(renderRow)}
            {budgetSeriesList.length === 0 && <span className="faint">Noch keine Budgets.</span>}
          </div>
        </div>
        <div className="editor__section">
          <div className="editor__section-title">Ungetrackte Bedingungen ({client.conditions.length})</div>
          <ConditionList />
        </div>
      </div>
    </div>
  );
}

function ConditionList() {
  const { client, commitClient } = useStore();
  return (
    <div className="col">
      {client.conditions.map((condition) => (
        <div key={condition.id} className="row">
          <Switch
            checked={condition.met}
            label={condition.name}
            onChange={(met) =>
              commitClient(met ? 'Bedingung erfüllt' : 'Bedingung offen', (c) => {
                const target = c.conditions.find((x) => x.id === condition.id);
                if (target) target.met = met;
              })
            }
          />
          <div className="spacer" />
          <Button
            size="sm"
            variant="ghost"
            title="Bedingung löschen"
            onClick={() =>
              commitClient('Bedingung gelöscht', (c) => {
                c.conditions = c.conditions.filter((x) => x.id !== condition.id);
                for (const t of c.tasks) t.conditionIds = t.conditionIds.filter((id) => id !== condition.id);
              })
            }
          >
            &times;
          </Button>
        </div>
      ))}
      {client.conditions.length === 0 && (
        <span className="faint">Bedingungen entstehen beim Erfassen in einer Aufgabe.</span>
      )}
    </div>
  );
}

/** Filtert die Ganglinien auf Aufgaben mit bestimmten Tags. */
function TagFilter({ tagIds, onChange }: { tagIds: Id[]; onChange: (ids: Id[]) => void }) {
  const { client } = useStore();
  if (client.tags.length === 0) return null;

  return (
    <div className="row row--wrap" title="Nur Aufgaben mit diesen Tags einrechnen">
      <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
        Tags:
      </span>
      {client.tags.map((tag) => (
        <Chip
          key={tag.id}
          label={tag.name}
          color={tag.color}
          active={tagIds.includes(tag.id)}
          onClick={() => onChange(tagIds.includes(tag.id) ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id])}
        />
      ))}
      {tagIds.length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => onChange([])}>
          zurücksetzen
        </Button>
      )}
    </div>
  );
}
