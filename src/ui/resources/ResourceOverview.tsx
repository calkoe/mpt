/**
 * Rechte Seite, Modus "Ressourcenübersicht".
 * Oben die überlagerten Ganglinien (oder die Tabelle mit Jahressummen),
 * darunter die Ressourcenlisten und der Editor der gewählten Ressource.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBudget, createCondition, createPerson } from '../../model/factory';
import { BUDGET_KIND_LABEL, type BudgetKind, type Id, type IsoDate } from '../../model/types';
import {
  diffDays,
  GRANULARITY_LABEL,
  SELECTABLE_GRANULARITIES,
  today,
  yearOf,
  type Granularity,
} from '../../engine/dates';
import {
  availableWorkdays,
  budgetCeiling,
  budgetDailyLoad,
  budgetSeries,
  formatValue,
  isTotalResource,
  mergeDailyLoads,
  personDailyLoad,
  personSeries,
  sumDailyLoad,
  totalBudgetOf,
  totalPersonOf,
  buildBreakdown,
  type Breakdown,
  type Contribution,
  type PersonUnit,
  type ResourceFilter,
  type ResourceSeries,
} from '../../engine/resources';
import {
  addCeiling,
  ceilingValue,
  COST_MEASURES,
  EMPTY_CEILING,
  MEASURE_HINT,
  MeasureAmount,
  MeasureLabel,
  UtilisationBar,
  type Ceiling,
} from '../components/CostMeasure';
import { useDerived } from '../../state/useDerived';
import { usePreferences, type CostMeasure, type ResourceView } from '../../state/preferences';
import { useStore } from '../../state/store';
import { Button, EmptyState, Segmented, Switch, TextInput } from '../components/controls';
import { SplitStack } from '../components/SplitStack';
import { buildTaskColors } from '../components/taskPalette';
import { ZoomControls } from '../components/ChartToolbar';
import { ExportPngButton } from '../components/ExportPngButton';
import { DetachButton } from '../PanelWindow';
import { useChartZoom } from '../components/useChartZoom';
import { useElementSize } from '../components/useElementSize';
import { moveItem, useReorder } from '../components/useReorder';
import { TagFilter } from '../components/TagFilter';
import { PeriodPicker } from '../components/PeriodPicker';
import { RESCHART_AXES_FIT, ResourceChart } from './ResourceChart';
import { BreakdownDialog } from './ResourceBreakdown';
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

  /*
   * Zwei Gesamtsichten als eigene Ganglinien: alle Budgets zusammen und alle
   * Personen zusammen, mit aufsummierten Obergrenzen. Sie beantworten die
   * Frage, die aus einzelnen Toepfen nicht abzulesen ist - "wie steht es um
   * das Geld / um die Leute insgesamt?". Technisch sind es gewoehnliche
   * Ressourcen, deshalb funktionieren Diagramm, Tabelle und Zoom unveraendert.
   */
  const totals = useMemo<ResourceSeries[]>(() => {
    const list: ResourceSeries[] = [];
    if (client.budgets.length > 1) {
      list.push(
        budgetSeries(
          totalBudgetOf(client.budgets, options.from, options.to),
          mergeDailyLoads(budgetLoads.values()),
          options,
        ),
      );
    }
    if (client.people.length > 1) {
      list.push(
        personSeries(
          totalPersonOf(client.people, options.from, options.to),
          mergeDailyLoads(personLoads.values()),
          options,
        ),
      );
    }
    return list;
  }, [
    client.budgets,
    client.people,
    budgetLoads,
    personLoads,
    options.from,
    options.to,
    options.granularity,
    options.personUnit,
  ]);

  const selectedId = ui.selectedResourceId;
  const selectedPerson = client.people.find((p) => p.id === selectedId);
  const selectedBudget = client.budgets.find((b) => b.id === selectedId);
  const selectedResource = selectedPerson ?? selectedBudget;
  /** Eine der beiden gerechneten Gesamtsichten - sie hat keinen Editor. */
  const selectedTotal = selectedId !== null && isTotalResource(selectedId);

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
      : // Auch die Gesamtsichten lassen sich gross betrachten - sie sind
        // gerechnete Ressourcen, aber genauso interessant wie die einzelnen.
        isTotalResource(selectedId ?? '')
        ? totals.filter((s) => s.resourceId === selectedId)
        : // Die Gesamtsichten stehen vorn - sie sind die Antwort auf die erste
        // Frage, die man an diese Ansicht hat.
        [...totals, ...personShown, ...budgetShown];

  const taskLabel = (taskId: Id) => derived.taskById.get(taskId)?.title ?? 'Unbekannt';

  /*
   * Abschnitte der Ganglinien: Gesamtsichten, Personen, Budgets. Leere
   * Abschnitte fallen weg, damit keine Trennlinie ins Nichts zeigt.
   */
  const sections = useMemo(() => {
    const groups = [
      { key: 'totals', series: shownSeries.filter((s) => isTotalResource(s.resourceId)) },
      { key: 'people', series: shownSeries.filter((s) => s.kind === 'person' && !isTotalResource(s.resourceId)) },
      { key: 'budgets', series: shownSeries.filter((s) => s.kind === 'budget' && !isTotalResource(s.resourceId)) },
    ];
    return groups.filter((g) => g.series.length > 0);
  }, [shownSeries]);

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

  /*
   * Zeichenflaeche und mitgefuehrte Achsen der Detailansicht. Sie liegen hier
   * und nicht in der Kachel, weil der PNG-Knopf oben in der Werkzeugleiste
   * sitzt - in der Detailansicht gibt es genau eine Kachel, die sie fuellt.
   */
  const detailPlotRef = useRef<SVGSVGElement>(null);
  const detailAxesRef = useRef<SVGSVGElement>(null);

  /**
   * Offene Auswertung - **ein** Zustand für beide Wege dorthin: den Klick auf
   * einen Zeitraum im Diagramm und den Knopf unter einer Ressourcenliste. Zwei
   * getrennte Dialoge für dieselbe Tabelle wären zwei Stellen, an denen sie
   * auseinanderlaufen kann.
   */
  const [report, setReport] = useState<Breakdown | null>(null);

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
            title="Ganglinien über die Zeit oder Zahlen je Zeitraum - dieselben Werte, zwei Darstellungen."
            value={prefs.resourceView}
            onChange={(resourceView) => setPrefs({ resourceView })}
            options={[
              { value: 'chart', label: 'Diagramm' },
              { value: 'table', label: 'Tabelle' },
            ]}
          />

          {/* Nur in der Tabelle: genehmigt / geplant / ausgegeben umschalten. */}
          {prefs.resourceView === 'table' && (
            <Segmented<CostMeasure>
              ariaLabel="Kennzahl"
              title="Welche der drei Geldgrößen die Tabelle zeigt. Sie werden nie vermischt - genehmigt ist der Rahmen, geplant die Zusage, ausgegeben der Abruf."
              value={prefs.costMeasure}
              onChange={(costMeasure) => setPrefs({ costMeasure })}
              options={COST_MEASURES.map((m) => ({
                value: m,
                label: <MeasureLabel measure={m} />,
                title: MEASURE_HINT[m],
              }))}
            />
          )}

          <Segmented<Granularity>
            ariaLabel="Zeitraster"
            title="Breite eines Balkens bzw. einer Spalte. Die Summen bleiben dieselben, sie werden nur gröber zusammengefasst."
            value={prefs.resourceGranularity}
            onChange={(resourceGranularity) => setPrefs({ resourceGranularity })}
            options={SELECTABLE_GRANULARITIES.map((g) => ({
              value: g,
              label: GRANULARITY_LABEL[g],
            }))}
          />

          <Segmented<PersonUnit>
            ariaLabel="Einheit für Personen"
            title="Maßstab für Personen: FTE misst die Auslastung gegen die Kapazität, PT zählt Personentage."
            value={prefs.personUnit}
            onChange={(personUnit) => setPrefs({ personUnit })}
            options={[
              { value: 'FTE', label: 'FTE', title: 'Mittlere Auslastung je Zeitraum - vergleichbar mit der Verfügbarkeit.' },
              { value: 'PT', label: 'PT', title: 'Personentage je Zeitraum - aufsummierbar, aber ohne Bezug zur Kapazität.' },
            ]}
          />

          <div className="spacer" />

          <div style={{ width: 170 }}>
            <TextInput
              value={search}
              placeholder="Ressource suchen..."
              title="Filtert Ganglinien und Listen nach Name oder Rolle. Die Summen darunter beziehen sich auf das, was übrig bleibt."
              onChange={setSearch}
            />
          </div>
          {/*
            Dieselben Knoepfe wie im Netzplan und im Gantt, und im selben
            abgesetzten Block: dort schiebt `ChartToolbar` sie per Portal in
            diesen Platzhalter, hier kennt die Ansicht ihre Zoomstufe selbst -
            aussehen soll es trotzdem gleich.

            Der PNG-Knopf erscheint erst in der Detailansicht: in der Übersicht
            stehen mehrere Diagramme nebeneinander, und ein Knopf in der Leiste
            liesse offen, welches gemeint ist. Sobald genau eines die Fläche
            füllt, ist es eindeutig - und der Knopf steht an derselben Stelle
            wie im Netzplan und im Gantt.
          */}
          <div className="row chart-toolbar">
            <ZoomControls
              fitTitle="Gesamten Zeitraum wieder über die volle Breite zeigen"
              zoom={{
                scale: chartZoom.zoom,
                zoomBy: chartZoom.zoomBy,
                fit: chartZoom.fit,
                adjusted: chartZoom.userAdjusted,
              }}
            />
            {selectedId && prefs.resourceView === 'chart' && (
              <ExportPngButton
                svgRef={detailPlotRef}
                overlayRef={detailAxesRef}
                overlayFit={RESCHART_AXES_FIT}
                namePrefix={`mpt-ganglinie-${shownSeries[0]?.name ?? 'ressource'}`}
              />
            )}
          </div>

          <TagFilter tagIds={tagIds} onChange={setTagIds} title="Nur Ressourcen mit diesen Tags anzeigen" />

          {/* Ganz rechts, in beiden Ansichten an derselben Stelle - er betrifft
              nicht den Inhalt, sondern das Fenster. Siehe ui/PanelWindow.tsx. */}
          <DetachButton mode="resources" />
        </div>

        <div className="panel__body" ref={chartBox.ref}>
          {shownSeries.length === 0 ? (
            <EmptyState title="Keine Ressourcen" hint="Personen und Budgets entstehen direkt beim Zuordnen in einer Aufgabe." />
          ) : prefs.resourceView === 'table' ? (
            <ResourceTable series={shownSeries} measure={prefs.costMeasure} />
          ) : (
            /*
              Gegliedert statt in einem Fluss: erst die beiden Gesamtsichten
              nebeneinander, dann - durch eine feine Linie abgesetzt - die
              Personen und zuletzt die Geldbudgets. Ohne diese Trennung stehen
              Euro und Personentage bunt gemischt in einem Raster und man muss
              jede Kachel einzeln lesen, um zu wissen, was man vor sich hat.
            */
            /*
              Eine gewaehlte Ressource fuellt die Flaeche - dann gibt es nichts
              zu gliedern. Wichtig ist die **direkte** Verschachtelung: das
              Diagramm misst seine Hoehe, also muss sie definit sein. Steckte
              das Raster in einem Zwischen-`div` ohne eigene Hoehe, ergaebe
              `height: 100%` nichts Bestimmtes, das Diagramm zoege die Kachel
              auf und die Kachel das Diagramm - die Flaeche waechst dann
              endlos weiter und der Bereich scrollt von selbst.
            */
            <div className="resource-sections">
              {sections.map((section, index) => (
                <SectionFrame key={section.key} withRule={index > 0} single={Boolean(selectedId)}>
                  <div
                    className={`resource-grid${selectedId ? ' resource-grid--single' : ''}${
                      section.key === 'totals' ? ' resource-grid--totals' : ''
                    }`}
                  >
                    {section.series.map((series) => (
                      <SeriesCard
                        key={series.resourceId}
                        series={series}
                        taskLabel={taskLabel}
                        taskColors={taskColors}
                        zoom={chartZoom.zoom}
                        /* Nur die eine Kachel der Detailansicht wird exportiert. */
                        plotRef={selectedId ? detailPlotRef : undefined}
                        axesRef={selectedId ? detailAxesRef : undefined}
                        onAnalyse={selectedId ? setReport : undefined}
                        onOpen={() => setUi({ selectedResourceId: series.resourceId })}
                        onSelectTask={(taskId) => {
                          const task = derived.taskById.get(taskId);
                          setUi({ mode: 'tasks', selectedTaskId: taskId, ventureId: task?.ventureId ?? null });
                        }}
                      />
                    ))}
                  </div>
                </SectionFrame>
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
            {selectedPerson ? 'Person' : selectedBudget ? 'Budget' : selectedTotal ? 'Gesamtsicht' : 'Ressourcen'}
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
          {selectedTotal ? (
            <EmptyState
              title="Gerechnete Gesamtsicht"
              hint="Sie fasst alle Budgets bzw. alle Personen zusammen. Bearbeiten lassen sich nur die einzelnen Ressourcen - zurück zur Übersicht und dort eine auswählen."
            />
          ) : selectedPerson ? (
            <PersonEditor person={selectedPerson} tasks={client.tasks} schedule={derived.schedule} />
          ) : selectedBudget ? (
            <BudgetEditor
              budget={selectedBudget}
              tasks={client.tasks}
              schedule={derived.schedule}
              horizon={{ from: options.from, to: options.to }}
            />
          ) : (
            <ResourceLists
              personSeriesList={personShown}
              budgetSeriesList={budgetShown}
              personLoads={personLoads}
              budgetLoads={budgetLoads}
              horizon={{ from: options.from, to: options.to }}
              onReport={setReport}
            />
          )}
        </div>
    </div>
  );

  return (
    <>
      <SplitStack
        ratio={prefs.splitRatio}
        onRatioChange={(splitRatio) => setPrefs({ splitRatio })}
        top={charts}
        bottom={details}
      />
      {report && (
        <BreakdownDialog
          breakdown={report}
          taskLabel={taskLabel}
          onClose={() => setReport(null)}
          onSelectTask={(taskId) => {
            const task = derived.taskById.get(taskId);
            setUi({ mode: 'tasks', selectedTaskId: taskId, ventureId: task?.ventureId ?? null });
            setReport(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Umhuellung eines Abschnitts. Bei einer gewaehlten Ressource entfaellt sie
 * ganz: das Raster wird dann direktes Flex-Kind und erbt damit eine definite
 * Hoehe - siehe den Kommentar an der Aufrufstelle.
 */
function SectionFrame({
  withRule,
  single,
  children,
}: {
  withRule: boolean;
  single: boolean;
  children: React.ReactNode;
}) {
  if (single) return <>{children}</>;
  return (
    <div className="resource-sections__group">
      {withRule && <div className="section-rule" />}
      {children}
    </div>
  );
}

/**
 * Eine Ganglinien-Kachel.
 *
 * Die Kennzahlen in der Überschrift folgen dem Mauszeiger: überfährt man einen
 * Zeitraum, stehen dort dessen Werte. Ohne Zeiger zeigt die Überschrift die
 * Werte über den ganzen Betrachtungszeitraum - so beantwortet dieselbe Stelle
 * beide Fragen, ohne dass eine zweite Zahlenreihe nötig wäre.
 *
 * Die ganze Kachel öffnet die Detailansicht. Ein eigener Knopf dafür war
 * überflüssig: man klickt ohnehin ins Diagramm.
 */
function SeriesCard({
  series,
  taskLabel,
  taskColors,
  zoom,
  plotRef,
  axesRef,
  onOpen,
  onSelectTask,
  onAnalyse,
}: {
  series: ResourceSeries;
  taskLabel: (id: Id) => string;
  taskColors: Map<Id, string>;
  zoom: number;
  /** Nur in der Detailansicht gesetzt - dann exportiert die Werkzeugleiste diese Kachel. */
  plotRef?: React.RefObject<SVGSVGElement>;
  axesRef?: React.RefObject<SVGSVGElement>;
  onOpen: () => void;
  onSelectTask: (taskId: Id) => void;
  /** Nur in der Detailansicht: Klick auf einen Zeitraum öffnet die Auswertung. */
  onAnalyse?: (breakdown: Breakdown) => void;
}) {
  const [hovered, setHovered] = useState<ResourceSeries['points'][number] | null>(null);
  const isBudget = series.kind === 'budget';
  /*
   * "Gesamt" bei Personen nur in Personentagen. In FTE ist der Wert ein
   * Mittelwert über die belegten Zeiträume und damit keine Summe - als
   * "gesamt" gelesen führt er in die Irre, deshalb steht dort ohne Zeiger
   * gar nichts.
   */
  const hasTotal = isBudget || series.unit !== 'FTE';

  return (
    <div
      className="panel panel--card panel--clickable"
      role="button"
      tabIndex={0}
      title={`${series.name} - klicken für die Detailansicht`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="panel__head">
        <span className={`status-dot status-dot--${series.breaches.length > 0 ? 'breach' : 'ok'}`} />
        <span className="panel__title truncate">{series.name}</span>
        <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
          {hovered ? hovered.bucket.label : hasTotal ? 'gesamt' : ''}
        </span>

        {isBudget ? (
          <span className="row faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
            {!hovered && <MeasureAmount measure="approved" value={series.ceiling > 0 ? series.ceiling : null} />}
            <MeasureAmount measure="planned" value={hovered ? hovered.value : series.cumulativeTotal} />
            <MeasureAmount measure="actual" value={hovered ? hovered.actual : series.cumulativeActualTotal} />
          </span>
        ) : (
          <span className="row faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
            {hovered ? (
              <>
                {hovered.limit > 0 && (
                  <MeasureAmount measure="approved" value={hovered.limit} suffix={series.unit as 'FTE' | 'PT'} />
                )}
                <MeasureAmount measure="planned" value={hovered.value} suffix={series.unit as 'FTE' | 'PT'} />
              </>
            ) : (
              hasTotal && <MeasureAmount measure="planned" value={series.total} suffix={series.unit as 'FTE' | 'PT'} />
            )}
          </span>
        )}
      </div>

      <ResourceChart
        series={series}
        taskLabel={taskLabel}
        taskColors={taskColors}
        zoom={zoom}
        onHoverPoint={setHovered}
        onSelectTask={onSelectTask}
        plotRef={plotRef}
        axesRef={axesRef}
        onAnalyse={onAnalyse}
      />
    </div>
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
    // (Der Aufbau ist jetzt in Abschnitte gegliedert - der Selektor trifft
    //  weiterhin die erste tatsaechlich gezeichnete Kachel.)
    if (tile) setWidth(tile.getBoundingClientRect().width);
  }, [containerRef, containerWidth]);
  return width || containerWidth;
}

/** Listen aller Personen und Budgets mit Kennzahlen. */
function ResourceLists({
  personSeriesList,
  budgetSeriesList,
  personLoads,
  budgetLoads,
  horizon,
  onReport,
}: {
  personSeriesList: ResourceSeries[];
  budgetSeriesList: ResourceSeries[];
  personLoads: Map<Id, Map<IsoDate, Contribution[]>>;
  budgetLoads: Map<Id, Map<IsoDate, Contribution[]>>;
  /** Ganzer Betrachtungszeitraum - die Auswahl "Gesamt" meint genau ihn. */
  horizon: { from: IsoDate; to: IsoDate };
  /** Zeigt die fertige Auswertung - siehe ResourceOverview. */
  onReport: (breakdown: Breakdown) => void;
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

  /*
   * Voreinstellung ist das laufende Jahr, nicht der ganze Horizont: nur über
   * denselben Zeitraum sind "genehmigt" und "geplant" überhaupt vergleichbar.
   * Über zehn Jahre stünde die Planung eines Dauerläufers neben einer
   * Obergrenze für zwei Jahre - da kann nur herauskommen, dass mehr geplant
   * als genehmigt ist, ohne dass das etwas bedeutet.
   */
  const thisYear = { from: `${yearOf(today())}-01-01`, to: `${yearOf(today())}-12-31` };
  const [personRange, setPersonRange] = useState(thisYear);
  const [budgetRange, setBudgetRange] = useState(thisYear);

  /**
   * Die Auswertung entsteht aus genau dem, was die Liste gerade zeigt:
   * derselbe Zeitraum, dieselben gefilterten Ressourcen. Eine eigene Auswahl
   * daneben wäre eine zweite Wahrheit über denselben Ausschnitt. Gezeigt wird
   * sie eine Ebene höher - im selben Dialog wie ein Klick im Diagramm.
   */
  const makeReport = (
    kind: 'person' | 'budget',
    list: ResourceSeries[],
    loads: Map<Id, Map<IsoDate, Contribution[]>>,
    range: { from: IsoDate; to: IsoDate },
  ) => {
    /*
     * Der Rahmen kommt aus denselben Werten wie die Zeilen der Liste darüber -
     * `personFigures`/`budgetFigures`. Bei Budgets gilt dabei: ist auch nur
     * eines unbegrenzt, ist die Summe unbegrenzt (siehe addCeiling).
     */
    let ceiling: number | null;
    if (kind === 'person') {
      ceiling = list.reduce((sum, s) => sum + (personFigures.get(s.resourceId)?.available ?? 0), 0);
    } else {
      const total = list.reduce(
        (acc, s) => addCeiling(acc, budgetFigures.get(s.resourceId)?.approved ?? 0),
        EMPTY_CEILING,
      );
      ceiling = ceilingValue(total);
    }

    onReport(
      buildBreakdown(
        list.map((s) => ({
          resourceId: s.resourceId,
          name: s.name,
          daily: loads.get(s.resourceId) ?? new Map(),
          ceiling:
            kind === 'person'
              ? (personFigures.get(s.resourceId)?.available ?? null)
              : ((budgetFigures.get(s.resourceId)?.approved ?? 0) || null),
        })),
        {
          label: kind === 'person' ? `Personal (${list.length})` : `Budgets (${list.length})`,
          from: range.from,
          to: range.to,
          // Personentage statt FTE: über einen frei gewählten Zeitraum ist die
          // Summe die Aussage, nicht ein Mittelwert.
          unit: kind === 'person' ? 'PT' : 'EUR',
          ceiling,
        },
      ),
    );
  };

  /*
   * Kennzahlen aller Zeilen in einem Durchgang. Die Tagessummen laufen über
   * jeden Tag des Zeitraums - bei zehn Jahren und mehreren Ressourcen ist das
   * nichts, was man pro Rendern wiederholen darf.
   */
  const budgetFigures = useMemo(() => {
    const map = new Map<Id, { approved: number; planned: number; actual: number }>();
    for (const budget of client.budgets) {
      const period = sumDailyLoad(budgetLoads.get(budget.id) ?? new Map(), budgetRange.from, budgetRange.to);
      map.set(budget.id, {
        approved: budgetCeiling(budget, budgetRange.from, budgetRange.to),
        planned: period.planned,
        actual: period.actual,
      });
    }
    return map;
  }, [client.budgets, budgetLoads, budgetRange.from, budgetRange.to]);

  const personFigures = useMemo(() => {
    const map = new Map<Id, { available: number; bound: number }>();
    for (const person of client.people) {
      map.set(person.id, {
        available: availableWorkdays(person, personRange.from, personRange.to),
        bound: sumDailyLoad(personLoads.get(person.id) ?? new Map(), personRange.from, personRange.to).planned,
      });
    }
    return map;
  }, [client.people, personLoads, personRange.from, personRange.to]);

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
          {series.kind === 'budget' ? (
            /*
              Bei Geld sagt der Spitzenwert eines einzelnen Zeitraums wenig -
              entscheidend sind die drei Groessen genehmigt, geplant und
              ausgegeben und ihr Verhaeltnis zueinander. Genau das zeigt die
              Zeile mit dem Balken, ohne dass man ein Diagramm oeffnen muss.
            */
            (() => {
              const figures = budgetFigures.get(series.resourceId) ?? { approved: 0, planned: 0, actual: 0 };
              return (
                <>
                  <span className="row faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    <MeasureAmount measure="approved" value={figures.approved > 0 ? figures.approved : null} />
                    <MeasureAmount measure="planned" value={figures.planned} />
                    <MeasureAmount measure="actual" value={figures.actual} />
                  </span>
                  <UtilisationBar planned={figures.planned} actual={figures.actual} ceiling={figures.approved} />
                </>
              );
            })()
          ) : (
            (() => {
              const figures = personFigures.get(series.resourceId) ?? { available: 0, bound: 0 };
              return (
                <>
                  <span className="row faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    <MeasureAmount measure="approved" value={figures.available} suffix="PT" />
                    <MeasureAmount measure="planned" value={figures.bound} suffix="PT" />
                  </span>
                  <UtilisationBar planned={figures.bound} actual={figures.bound} ceiling={figures.available} />
                </>
              );
            })()
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="editor">
      <div className="editor__cols">
        <div className="editor__section">
          <div className="editor__section-title">Personen ({client.people.length})</div>
          {/* Zeitraum der Kennzahlen - gilt für die Zeilen und die Summe. */}
          <PeriodPicker
            title="Zeitraum der Zahlen rechts in der Liste und der Summe darunter. Die Zuordnungen selbst bleiben unberührt - es wird nur anders zusammengefasst."
            from={personRange.from}
            to={personRange.to}
            total={horizon}
            scales={['total', 'year', 'quarter', 'month']}
            onChange={(from, to) => setPersonRange({ from, to })}
          />
          <div className="list">
            {personSeriesList.map(renderRow(peopleOrder))}
            {personSeriesList.length === 0 && <span className="faint">Noch keine Personen.</span>}
          </div>
          <PersonTotals seriesList={personSeriesList} figures={personFigures} />
          <Button
            size="sm"
            block
            disabled={personSeriesList.length === 0}
            onClick={() => makeReport('person', personSeriesList, personLoads, personRange)}
            title="Tabelle mit allen Einzelpositionen im gewählten Zeitraum - zum Ansehen und Kopieren"
          >
            Auswertung erzeugen
          </Button>
        </div>
        <div className="editor__section">
          <div className="editor__section-title">Budgets ({client.budgets.length})</div>
          <PeriodPicker
            title="Zeitraum der Beträge rechts in der Liste und der Summe darunter. Er gilt auch für die Auswertung, die der Knopf darunter erzeugt."
            from={budgetRange.from}
            to={budgetRange.to}
            total={horizon}
            scales={['total', 'year', 'quarter', 'month']}
            onChange={(from, to) => setBudgetRange({ from, to })}
          />
          <div className="list">
            {budgetSeriesList.map(renderRow(budgetOrder))}
            {budgetSeriesList.length === 0 && <span className="faint">Noch keine Budgets.</span>}
          </div>
          <BudgetTotals seriesList={budgetSeriesList} figures={budgetFigures} />
          <Button
            size="sm"
            block
            disabled={budgetSeriesList.length === 0}
            onClick={() => makeReport('budget', budgetSeriesList, budgetLoads, budgetRange)}
            title="Tabelle mit allen Einzelpositionen im gewählten Zeitraum - zum Ansehen und Kopieren"
          >
            Auswertung erzeugen
          </Button>
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
function BudgetTotals({
  seriesList,
  figures,
}: {
  seriesList: ResourceSeries[];
  /** Bereits gerechnete Werte je Budget - siehe ResourceLists. */
  figures: Map<Id, { approved: number; planned: number; actual: number }>;
}) {
  const { client } = useStore();

  // Alle drei Groessen stammen aus **demselben** Zeitraum - siehe ResourceLists.
  const sums = new Map<BudgetKind, Sums>();
  for (const series of seriesList) {
    const budget = client.budgets.find((b) => b.id === series.resourceId);
    const f = figures.get(series.resourceId);
    if (!budget || !f) continue;
    const entry = sums.get(budget.kind) ?? { approved: EMPTY_CEILING, planned: 0, actual: 0 };
    entry.approved = addCeiling(entry.approved, f.approved);
    entry.planned += f.planned;
    entry.actual += f.actual;
    sums.set(budget.kind, entry);
  }
  if (seriesList.length === 0) return null;

  const all: Sums = { approved: EMPTY_CEILING, planned: 0, actual: 0 };
  for (const s of sums.values()) {
    all.approved = s.approved.unlimited
      ? { sum: all.approved.sum + s.approved.sum, unlimited: true }
      : { ...all.approved, sum: all.approved.sum + s.approved.sum };
    all.planned += s.planned;
    all.actual += s.actual;
  }

  return (
    <div className="totals">
      {/*
        Drei Groessen, die nie verwechselt werden duerfen - deshalb stehen sie
        nebeneinander in eigenen Spalten und nicht als eine Zahl: genehmigt ist
        der Rahmen, geplant die Absicht, ausgegeben das abgeflossene Geld.
      */}
      <div className="totals__head">
        <span />
        <MeasureLabel measure="approved" />
        <MeasureLabel measure="planned" />
        <MeasureLabel measure="actual" />
      </div>
      {(Object.keys(BUDGET_KIND_LABEL) as BudgetKind[]).map((kind) => {
        const sum: Sums = sums.get(kind) ?? { approved: EMPTY_CEILING, planned: 0, actual: 0 };
        return (
          <div key={kind} className="totals__block">
            <div className="totals__grid">
              <span className="faint truncate">{BUDGET_KIND_LABEL[kind]}</span>
              <span className="mono">{ceilingValue(sum.approved) === null ? '∞' : formatValue(sum.approved.sum, 'EUR')}</span>
              <span className="mono">{formatValue(sum.planned, 'EUR')}</span>
              <span className="mono">{formatValue(sum.actual, 'EUR')}</span>
            </div>
            <UtilisationBar planned={sum.planned} actual={sum.actual} ceiling={ceilingValue(sum.approved) ?? 0} />
          </div>
        );
      })}
      <div className="totals__block totals__row--sum">
        <div className="totals__grid">
          <span>Gesamt</span>
          <span className="mono">{ceilingValue(all.approved) === null ? '∞' : formatValue(all.approved.sum, 'EUR')}</span>
          <span className="mono">{formatValue(all.planned, 'EUR')}</span>
          <span className="mono">{formatValue(all.actual, 'EUR')}</span>
        </div>
        <UtilisationBar planned={all.planned} actual={all.actual} ceiling={ceilingValue(all.approved) ?? 0} />
      </div>
    </div>
  );
}

/**
 * Summen unter der Personenliste: verfügbare Kapazität gegen gebundene, beide
 * in Personentagen über denselben Zeitraum. FTE wäre hier die falsche Einheit -
 * ein Anteil je Woche lässt sich nicht über ein Jahr aufsummieren.
 */
function PersonTotals({
  seriesList,
  figures,
}: {
  seriesList: ResourceSeries[];
  /** Bereits gerechnete Werte je Person - siehe ResourceLists. */
  figures: Map<Id, { available: number; bound: number }>;
}) {
  if (seriesList.length === 0) return null;

  let available = 0;
  let bound = 0;
  for (const series of seriesList) {
    const f = figures.get(series.resourceId);
    if (!f) continue;
    available += f.available;
    bound += f.bound;
  }

  return (
    <div className="totals">
      <div className="totals__head totals__grid--two">
        <span />
        <MeasureLabel measure="approved">verfügbar</MeasureLabel>
        <MeasureLabel measure="planned">gebunden</MeasureLabel>
      </div>
      <div className="totals__block totals__row--sum">
        <div className="totals__grid totals__grid--two">
          <span>Alle Personen</span>
          <span className="mono">{formatValue(available, 'PT')}</span>
          <span className="mono">{formatValue(bound, 'PT')}</span>
        </div>
        <UtilisationBar planned={bound} actual={bound} ceiling={available} />
      </div>
    </div>
  );
}

interface Sums {
  /** Genehmigt: die Obergrenzen; unbegrenzt schlägt auf die Summe durch. */
  approved: Ceiling;
  planned: number;
  actual: number;
}

function ConditionList() {
  const { client, commitClient } = useStore();
  const order = useReorder((from, to) =>
    commitClient('Bedingungen umsortiert', (c) => moveItem(c.conditions, from, to)),
  );

  return (
    <div className="col">
      <div className="list">
        {client.conditions.map((condition, index) => (
          <div
            key={condition.id}
            className="list__item list__item--sortable sortable"
            title="Ziehen zum Umsortieren"
            {...order.itemProps(index)}
          >
            <span className="list__grip" aria-hidden="true">
              ⠿
            </span>
            <Switch
              checked={condition.met}
              title="Erfüllt oder offen. Offene Bedingungen erzeugen an den Aufgaben, die darauf verweisen, eine Warnung - Termine bleiben unberührt."
              onChange={(met) =>
                commitClient(met ? 'Bedingung erfüllt' : 'Bedingung offen', (c) => {
                  const target = c.conditions.find((x) => x.id === condition.id);
                  if (target) target.met = met;
                })
              }
            />
            <span className="grow" style={{ minWidth: 0 }}>
              <TextInput
                value={condition.name}
                placeholder="Bedingung"
                title="Name der Bedingung. Aufgaben können darauf verweisen; ist sie nicht erfüllt, warnt MPT - Termine verschiebt sie nie."
                onChange={(name) =>
                  commitClient('Bedingung umbenannt', (c) => {
                    const target = c.conditions.find((x) => x.id === condition.id);
                    if (target) target.name = name;
                  }, { coalesceKey: `condition-${condition.id}` })
                }
              />
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon
              title="Bedingung löschen; Verweise in Aufgaben werden entfernt"
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
          <span className="faint">Noch keine Bedingungen.</span>
        )}
      </div>

      <Button
        size="sm"
        onClick={() => {
          const condition = createCondition();
          commitClient('Bedingung angelegt', (c) => {
            c.conditions.push(condition);
          });
        }}
      >
        + Bedingung
      </Button>
    </div>
  );
}

/** Filtert die Ganglinien auf Aufgaben mit bestimmten Tags. */
