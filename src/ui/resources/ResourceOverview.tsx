/**
 * Rechte Seite, Modus "Ressourcenübersicht".
 * Oben die überlagerten Ganglinien (oder die Tabelle mit Jahressummen),
 * darunter die Ressourcenlisten und der Editor der gewählten Ressource.
 */
import { useEffect, useMemo, useState } from 'react';
import { createBudget, createPerson } from '../../model/factory';
import { BUDGET_KIND_LABEL, type BudgetKind, type Id } from '../../model/types';
import { diffDays, GRANULARITY_LABEL, SELECTABLE_GRANULARITIES, type Granularity } from '../../engine/dates';
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
import { Button, EmptyState, Segmented, Switch, TextInput } from '../components/controls';
import { SplitStack } from '../components/SplitStack';
import { buildTaskColors } from '../components/taskPalette';
import { ChartZoomControls } from '../components/ChartZoomControls';
import { useChartZoom } from '../components/useChartZoom';
import { useElementSize } from '../components/useElementSize';
import { moveItem, useReorder } from '../components/useReorder';
import { TagFilter } from '../components/TagFilter';
import { ResourceChart } from './ResourceChart';
import { ResourceTable } from './ResourceTable';
import { BudgetEditor, PersonEditor, ResourceEditorHeader } from './ResourceEditors';

export function ResourceOverview() {
  const { client, ui, setUi, commitClient } = useStore();
  const { prefs, setPrefs } = usePreferences();
  const derived = useDerived();

  // Filter: Tags und Freitext lokal in dieser Ansicht, Vorhaben aus der
  // Seitenleistenauswahl.
  const [tagIds, setTagIds] = useState<Id[]>([]);
  const [search, setSearch] = useState('');
  const filter = useMemo<ResourceFilter>(
    () => ({ tagIds, ventureIds: ui.ventureId ? [ui.ventureId] : [] }),
    [tagIds, ui.ventureId],
  );

  // Gerechnet und gezeichnet wird der volle Zehnjahreshorizont - die Kosten
  // eines Dauerlaeufers laufen ja tatsaechlich weiter. Nur die Zoomstufe
  // richtet sich nach dem Ende der letzten endlichen Aufgabe (siehe unten).
  const options = {
    from: derived.schedule.displayStart,
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

  /**
   * Freitextsuche über Name und Rolle. Wirkt gleichermaßen auf die Ganglinien
   * und auf die Listen darunter - sonst zeigte die Ansicht zwei verschiedene
   * Ausschnitte desselben Bestands.
   */
  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return () => true;
    const roleById = new Map(client.people.map((p) => [p.id, p.role]));
    return (id: Id, name: string) =>
      name.toLowerCase().includes(q) || (roleById.get(id) ?? '').toLowerCase().includes(q);
  }, [search, client.people]);

  const personShown = personAll.filter((s) => matchesSearch(s.resourceId, s.name));
  const budgetShown = budgetAll.filter((s) => matchesSearch(s.resourceId, s.name));

  // Angezeigte Ganglinien: die gewählte Ressource, sonst alle passenden.
  const shownSeries = selectedPerson
    ? personAll.filter((s) => s.resourceId === selectedPerson.id)
    : selectedBudget
      ? budgetAll.filter((s) => s.resourceId === selectedBudget.id)
      : [...personShown, ...budgetShown];

  const taskLabel = (taskId: Id) => derived.taskById.get(taskId)?.title ?? 'Unbekannt';

  /*
   * Eine Zoomstufe fuer alle Ganglinien - sie zeigen denselben Zeitraum und
   * waeren mit unterschiedlichen Massstaeben nicht vergleichbar. Beim Wechsel
   * des Rasters wird automatisch wieder eingepasst.
   */
  const chartBox = useElementSize<HTMLDivElement>();
  const bucketCount = shownSeries[0]?.points.length ?? 0;
  /*
   * Die Zahl der Kacheln je Reihe ergibt sich aus dem Raster (`auto-fill`) und
   * ist nicht fest. Statt sie zu raten, wird die Breite einer tatsaechlich
   * gezeichneten Kachel gemessen - sonst passt das Einpassen nur zufaellig.
   */
  const tileWidth = useTileWidth(chartBox.ref, chartBox.width);
  /*
   * Nur die Zeitraeume bis zum Anzeigehorizont bestimmen die Zoomstufe. Die
   * Dauerlaeufer laufen rechts weiter und sind durch Scrollen erreichbar.
   */
  const focusBuckets =
    shownSeries[0]?.points.filter((p) => diffDays(p.bucket.start, derived.schedule.displayEnd) >= 0).length ??
    bucketCount;
  const chartZoom = useChartZoom({
    /*
     * Nur die Saeulenflaeche wird gezoomt - die beiden Achsen (links 54,
     * rechts 62) bleiben gleich breit. Sie gehoeren deshalb NICHT in
     * `naturalWidth`, sondern werden von der verfuegbaren Breite abgezogen.
     */
    naturalWidth: Math.max(1, focusBuckets * 18),
    availableWidth: Math.max(60, tileWidth - CHART_AXES_WIDTH - 10),
    resetKey: `${prefs.resourceGranularity}|${options.from}|${derived.schedule.displayEnd}|${selectedId ?? 'alle'}|${Math.round(tileWidth)}`,
  });
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
            options={SELECTABLE_GRANULARITIES.map((g) => ({
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

          <div style={{ width: 170 }}>
            <TextInput
              value={search}
              placeholder="Ressource suchen..."
              title="Filtert Ganglinien und Listen nach Name oder Rolle"
              onChange={setSearch}
            />
          </div>
          <ChartZoomControls zoom={chartZoom} />
          <TagFilter tagIds={tagIds} onChange={setTagIds} title="Nur Ressourcen mit diesen Tags anzeigen" />
        </div>

        <div className="panel__body" ref={chartBox.ref}>
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
                    <span className={`status-dot status-dot--${series.breaches.length > 0 ? 'breach' : 'ok'}`} />
                    <span className="panel__title truncate">{series.name}</span>
                    <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
                      {series.kind === 'person'
                        ? `${prefs.personUnit === 'FTE' ? 'Ø aktiv' : 'Summe'}: ${formatValue(series.total, series.unit)}`
                        : `Summe: ${formatValue(series.total, series.unit)}`}
                      {series.breaches.length > 0 && ` · ${series.breaches.length} Überschreitung(en)`}
                    </span>
                    <div className="spacer" />
                    <Button
                      size="sm"
                      onClick={() => setUi({ selectedResourceId: series.resourceId })}
                      title="Diese Ressource einzeln betrachten und bearbeiten"
                    >
                      Details
                    </Button>
                  </div>
                  <ResourceChart
                    series={series}
                    taskLabel={taskLabel}
                    taskColors={taskColors}
                    zoom={chartZoom.zoom}
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
            <BudgetEditor budget={selectedBudget} tasks={client.tasks} />
          ) : (
            <ResourceLists personSeriesList={personShown} budgetSeriesList={budgetShown} />
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

/** Feste Breite der beiden Achsen im Ganglinien-Diagramm (siehe ResourceChart). */
const CHART_AXES_WIDTH = 116;

/**
 * Breite einer Diagrammkachel. Wird gemessen statt berechnet, weil das Raster
 * die Spaltenzahl selbst bestimmt (`auto-fill` in `.resource-grid`).
 */
function useTileWidth(containerRef: React.RefObject<HTMLDivElement>, containerWidth: number): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const tile = containerRef.current?.querySelector('.resource-grid > .panel');
    if (tile) setWidth(tile.getBoundingClientRect().width);
  }, [containerRef, containerWidth]);
  return width || containerWidth;
}

/** Listen aller Personen und Budgets mit Kennzahlen. */
function ResourceLists({
  personSeriesList,
  budgetSeriesList,
}: {
  personSeriesList: ResourceSeries[];
  budgetSeriesList: ResourceSeries[];
}) {
  const { client, setUi, commitClient } = useStore();
  const derived = useDerived();

  // Die Anzeigereihenfolge ist die Array-Reihenfolge; Ziehen schreibt sie um.
  const peopleOrder = useReorder((from, to) =>
    commitClient('Personen umsortiert', (c) => moveItem(c.people, from, to)),
  );
  const budgetOrder = useReorder((from, to) =>
    commitClient('Budgets umsortiert', (c) => moveItem(c.budgets, from, to)),
  );

  const renderRow = (order: ReturnType<typeof useReorder>) => (series: ResourceSeries, index: number) => {
    const warnings = derived.resourceWarnings.get(series.resourceId) ?? [];
    return (
      <div
        key={series.resourceId}
        className="list__item list__item--sortable sortable"
        onClick={() => setUi({ selectedResourceId: series.resourceId })}
        title="Ziehen zum Umsortieren, Klick öffnet die Ressource"
        {...order.itemProps(index)}
      >
        <span className="list__grip" aria-hidden="true">
          ⠿
        </span>
        <span className={`status-dot status-dot--${warnings.length > 0 ? 'breach' : 'ok'}`} />
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
      </div>
    );
  };

  return (
    <div className="editor">
      <div className="editor__cols">
        <div className="editor__section">
          <div className="editor__section-title">Personen ({client.people.length})</div>
          <div className="list">
            {personSeriesList.map(renderRow(peopleOrder))}
            {personSeriesList.length === 0 && <span className="faint">Noch keine Personen.</span>}
          </div>
        </div>
        <div className="editor__section">
          <div className="editor__section-title">Budgets ({client.budgets.length})</div>
          <div className="list">
            {budgetSeriesList.map(renderRow(budgetOrder))}
            {budgetSeriesList.length === 0 && <span className="faint">Noch keine Budgets.</span>}
          </div>
          <BudgetTotals seriesList={budgetSeriesList} />
        </div>
        <div className="editor__section">
          <div className="editor__section-title">Ungetrackte Bedingungen ({client.conditions.length})</div>
          <ConditionList />
        </div>
      </div>
    </div>
  );
}

/**
 * Gesamtsummen der Budgets, getrennt nach Art. Ohne diese Trennung sagt eine
 * Gesamtsumme wenig: Investitionen und Beauftragungen werden in aller Regel
 * aus verschiedenen Töpfen bezahlt.
 */
function BudgetTotals({ seriesList }: { seriesList: ResourceSeries[] }) {
  const { client } = useStore();
  const kindOf = new Map(client.budgets.map((b) => [b.id, b.kind]));

  const sums = new Map<BudgetKind, number>();
  for (const series of seriesList) {
    const kind = kindOf.get(series.resourceId) ?? 'neutral';
    sums.set(kind, (sums.get(kind) ?? 0) + series.total);
  }
  const gesamt = [...sums.values()].reduce((s, v) => s + v, 0);
  if (seriesList.length === 0) return null;

  return (
    <div className="totals">
      {(Object.keys(BUDGET_KIND_LABEL) as BudgetKind[]).map((kind) => (
        <div key={kind} className="totals__row">
          <span className="faint">{BUDGET_KIND_LABEL[kind]}</span>
          <span className="mono">{formatValue(sums.get(kind) ?? 0, 'EUR')}</span>
        </div>
      ))}
      <div className="totals__row totals__row--sum">
        <span>Gesamt</span>
        <span className="mono">{formatValue(gesamt, 'EUR')}</span>
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
