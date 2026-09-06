/**
 * Rechte Seite, Modus "Aufgabenübersicht".
 * Oben Netzplan oder Gantt inkl. Ressourcen-/Bedingungsleiste, darunter die
 * gewählte Aufgabe zur Direktbearbeitung. Die Trennung dazwischen ist
 * verschiebbar, die Flächen grenzen randlos aneinander.
 */
import { createTask } from '../../model/factory';
import { useDerived } from '../../state/useDerived';
import { usePreferences, type TaskView, type Weighting } from '../../state/preferences';
import { useStore } from '../../state/store';
import type { Granularity } from '../../engine/dates';
import { GRANULARITY_LABEL, SELECTABLE_GRANULARITIES } from '../../engine/dates';
import type { Scenario } from '../../engine/schedule';
import { Button, EmptyState, Segmented, Switch } from '../components/controls';
import { SplitStack } from '../components/SplitStack';
import { TagFilter } from '../components/TagFilter';
import { ChartToolbarProvider, ChartToolbarSlot } from '../components/ChartToolbar';
import { DetachButton } from '../PanelWindow';
import { GanttChart } from './GanttChart';
import { NetworkChart } from './NetworkChart';
import { TaskEditor, TaskEditorHeader } from './TaskEditor';
import { SHORTCUTS, withShortcut } from '../shortcuts';

export function TaskOverview() {
  const { client, ui, setUi, commitClient } = useStore();
  const { prefs, setPrefs } = usePreferences();
  const derived = useDerived();
  const selected = ui.selectedTaskId ? derived.taskById.get(ui.selectedTaskId) : undefined;

  const addTask = () => {
    const ventureId = ui.ventureId ?? client.ventures[0]?.id;
    if (!ventureId) return;
    const task = createTask(ventureId);
    commitClient('Aufgabe angelegt', (c) => {
      c.tasks.push(task);
    });
    setUi({ selectedTaskId: task.id, ventureId });
  };

  if (client.ventures.length === 0) {
    return (
      <div className="stack">
        <EmptyState
          title="Noch kein Vorhaben angelegt"
          hint="Vorhaben bündeln Aufgaben. Lege links in der Seitenleiste eines an - danach kannst du Aufgaben erfassen."
        />
      </div>
    );
  }

  const plan = (
    /*
     * Werkzeugleiste und Diagramm gehoeren zusammen: der Platzhalter unten in
     * der Leiste nimmt die Bedienelemente auf, die das Diagramm rendert - Zoom,
     * Einpassen, Export. Siehe ChartToolbar.
     */
    <ChartToolbarProvider>
      <div className="panel">
        <div className="panel__head">
          <Segmented<TaskView>
            ariaLabel="Darstellung"
            title="Netz der Abhängigkeiten oder Balken über die Zeit - derselbe Plan, zwei Sichten."
            value={prefs.taskView}
            onChange={(taskView) => setPrefs({ taskView })}
            options={[
              { value: 'network', label: 'Netzplan', title: withShortcut('Abhängigkeitsnetz', SHORTCUTS.togglePlan) },
              { value: 'gantt', label: 'Gantt', title: withShortcut('Balkenplan', SHORTCUTS.togglePlan) },
            ]}
          />

          {/* Kurze Beschriftungen, damit die Leiste einzeilig bleibt. */}
          <Segmented<Scenario>
            ariaLabel="Szenario"
            title="Rechnet den ganzen Plan mit der minimalen oder der maximalen Dauer. Das ändert Termine, Puffer, kritischen Pfad und die Lage der Ressourcenlasten."
            value={prefs.scenario}
            onChange={(scenario) => setPrefs({ scenario })}
            options={[
              { value: 'min', label: 'opt.', title: 'Optimistisch - rechnet mit der minimalen Dauer' },
              { value: 'max', label: 'pess.', title: 'Pessimistisch - rechnet mit der maximalen Dauer' },
            ]}
          />

          {prefs.taskView === 'gantt' && (
            <Segmented<Granularity>
              ariaLabel="Zeitraster"
              title="Breite der Zeitachse im Gantt. Nur die Darstellung ändert sich, keine Zahl."
              value={prefs.ganttGranularity}
              onChange={(ganttGranularity) => setPrefs({ ganttGranularity })}
              options={SELECTABLE_GRANULARITIES.map((g) => ({
                value: g,
                label: GRANULARITY_LABEL[g],
              }))}
            />
          )}

          <div className="spacer" />

          {/*
            Die Gewichtung faerbt den Balken am Netzplan-Knoten. Im Gantt gibt
            es diesen Balken nicht - der Schalter waere dort wirkungslos und
            haette die Leiste nur ueber die Breite geschoben.
          */}
          {prefs.taskView === 'network' && (
            <Segmented<Weighting>
              ariaLabel="Gewichtung"
              title="Was der Balken am Knoten zeigt. Nur Darstellung - am Plan ändert die Wahl nichts."
              value={prefs.weighting}
              onChange={(weighting) => setPrefs({ weighting })}
              options={[
                { value: 'none', label: 'ohne', title: 'Kein Balken am Knoten' },
                {
                  value: 'duration',
                  label: 'Zeit',
                  title: 'Balken zeigt den Fortschritt im geplanten Zeitraum - leer heisst noch nicht begonnen',
                },
                { value: 'cost', label: 'Kosten', title: 'Balken nach Kosten, gefüllt nach abgerufenem Anteil' },
              ]}
            />
          )}

          {/* Kritischer Pfad nur auf Knopfdruck - der Knopf zeigt deutlich, ob er aktiv ist. */}
          <Button
            variant={prefs.showCriticalPath ? 'primary' : 'default'}
            onClick={() => setPrefs({ showCriticalPath: !prefs.showCriticalPath })}
            title={
              prefs.showCriticalPath
                ? 'Hervorhebung des kritischen Pfads ausschalten'
                : 'Kritischen Pfad im Plan hervorheben'
            }
          >
            Kritischer Pfad
          </Button>

          <ChartToolbarSlot />

          <TagFilter tagIds={ui.tagFilter} onChange={(tagFilter) => setUi({ tagFilter })} />

          <Switch
            checked={prefs.showResourceRail}
            label="Ressourcen"
            title="Leiste mit Ressourcen und Bedingungen unterhalb der Visualisierung"
            onChange={(showResourceRail) => setPrefs({ showResourceRail })}
          />

          <Button variant="primary" onClick={addTask} title={withShortcut('Neue Aufgabe', SHORTCUTS.newTask)}>
            + Aufgabe
          </Button>

          {/* Ganz rechts, in beiden Ansichten an derselben Stelle - er betrifft
              nicht den Inhalt, sondern das Fenster. Siehe ui/PanelWindow.tsx. */}
          <DetachButton mode="tasks" />
        </div>

        <div className="panel__body">
          {prefs.taskView === 'network' ? (
            <NetworkChart
              client={client}
              tasks={derived.visibleTasks}
              schedule={derived.schedule}
              warnings={derived.taskWarnings}
              resourceWarnings={derived.resourceWarnings}
            />
          ) : (
            <GanttChart
              client={client}
              tasks={derived.visibleTasks}
              schedule={derived.schedule}
              warnings={derived.taskWarnings}
              resourceWarnings={derived.resourceWarnings}
            />
          )}
        </div>
      </div>
    </ChartToolbarProvider>
  );

  const editor = (
    <div className="panel">
      {/* Warnungen und Löschknöpfe der gewählten Aufgabe stehen hier oben -
          siehe TaskEditorHeader. */}
      <div className="panel__head">
        {selected ? (
          <TaskEditorHeader
            client={client}
            task={selected}
            schedule={derived.schedule}
            warnings={derived.taskWarnings.get(selected.id) ?? []}
          />
        ) : (
          <>
            <span className="panel__title">Aufgabe</span>
            <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
              Änderungen wirken sofort - kein Speichern nötig.
            </span>
          </>
        )}
      </div>
      <div className="panel__body">
        {selected ? (
          <TaskEditor client={client} task={selected} schedule={derived.schedule} />
        ) : (
          <EmptyState
            title="Keine Aufgabe gewählt"
            hint="Oben im Plan eine Aufgabe anklicken - oder eine neue anlegen."
            action={
              <Button variant="primary" onClick={addTask}>
                + Neue Aufgabe
              </Button>
            }
          />
        )}
      </div>
    </div>
  );

  return (
    <SplitStack
      ratio={prefs.splitRatio}
      onRatioChange={(splitRatio) => setPrefs({ splitRatio })}
      top={plan}
      bottom={editor}
    />
  );
}
