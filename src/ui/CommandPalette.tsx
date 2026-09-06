/**
 * Command-Palette (Strg+K): zentraler Tastatur-Einstieg zu allen Aktionen und
 * zur Suche über Aufgaben, Vorhaben und Ressourcen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { usePreferences } from '../state/preferences';
import { formatShortcut, SHORTCUTS } from './shortcuts';
import { createTask, createVenture } from '../model/factory';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { prefs, setPrefs } = usePreferences();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const { client, ui, setUi, commitClient, undo, redo } = store;
    const list: Command[] = [
      {
        id: 'new-task',
        label: 'Neue Aufgabe',
        hint: formatShortcut(SHORTCUTS.newTask),
        group: 'Aktionen',
        run: () => {
          const ventureId = ui.ventureId ?? client.ventures[0]?.id;
          if (!ventureId) return;
          const task = createTask(ventureId);
          commitClient('Aufgabe angelegt', (c) => {
            c.tasks.push(task);
          });
          setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId });
        },
      },
      {
        id: 'new-venture',
        label: 'Neues Vorhaben',
        hint: formatShortcut(SHORTCUTS.newVenture),
        group: 'Aktionen',
        run: () => {
          const venture = createVenture();
          commitClient('Vorhaben angelegt', (c) => {
            c.ventures.push(venture);
          });
          setUi({ ventureId: venture.id, selectedTaskId: null });
        },
      },
      { id: 'undo', label: 'Rückgängig', hint: formatShortcut(SHORTCUTS.undo), group: 'Aktionen', run: undo },
      { id: 'redo', label: 'Wiederholen', hint: formatShortcut(SHORTCUTS.redo), group: 'Aktionen', run: redo },
      { id: 'save', label: 'Jetzt speichern', hint: formatShortcut(SHORTCUTS.save), group: 'Aktionen', run: () => void store.saveNow() },
      /*
       * Dieselben vier Ansichten wie Alt+1..4 - mit denselben Beschriftungen
       * und derselben Wirkung. Vorher standen hier zwei Einträge, die nur den
       * Modus umschalteten und dabei ein Kürzel nannten, das etwas anderes
       * tat (Alt+2 ist der Gantt, nicht die Ressourcenübersicht).
       */
      {
        id: 'view-network',
        label: SHORTCUTS.viewNetwork.label,
        hint: formatShortcut(SHORTCUTS.viewNetwork),
        group: 'Ansicht',
        run: () => {
          setUi({ mode: 'tasks' });
          setPrefs({ taskView: 'network' });
        },
      },
      {
        id: 'view-gantt',
        label: SHORTCUTS.viewGantt.label,
        hint: formatShortcut(SHORTCUTS.viewGantt),
        group: 'Ansicht',
        run: () => {
          setUi({ mode: 'tasks' });
          setPrefs({ taskView: 'gantt' });
        },
      },
      {
        id: 'view-resource-chart',
        label: SHORTCUTS.viewResourceChart.label,
        hint: formatShortcut(SHORTCUTS.viewResourceChart),
        group: 'Ansicht',
        run: () => {
          setUi({ mode: 'resources' });
          setPrefs({ resourceView: 'chart' });
        },
      },
      {
        id: 'view-resource-table',
        label: SHORTCUTS.viewResourceTable.label,
        hint: formatShortcut(SHORTCUTS.viewResourceTable),
        group: 'Ansicht',
        run: () => {
          setUi({ mode: 'resources' });
          setPrefs({ resourceView: 'table' });
        },
      },
      {
        id: 'toggle-view',
        label: prefs.taskView === 'network' ? 'Zu Gantt-Chart wechseln' : 'Zu Netzplan wechseln',
        hint: formatShortcut(SHORTCUTS.togglePlan),
        group: 'Ansicht',
        run: () => setPrefs({ taskView: prefs.taskView === 'network' ? 'gantt' : 'network' }),
      },
      {
        id: 'toggle-scenario',
        label: prefs.scenario === 'max' ? 'Szenario: optimistisch' : 'Szenario: pessimistisch',
        group: 'Ansicht',
        run: () => setPrefs({ scenario: prefs.scenario === 'max' ? 'min' : 'max' }),
      },
      {
        id: 'toggle-critical',
        label: prefs.showCriticalPath ? 'Kritischen Pfad ausblenden' : 'Kritischen Pfad hervorheben',
        group: 'Ansicht',
        run: () => setPrefs({ showCriticalPath: !prefs.showCriticalPath }),
      },
      {
        id: 'toggle-theme',
        label: 'Hell/Dunkel umschalten',
        group: 'Ansicht',
        run: () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }),
      },
    ];

    for (const venture of client.ventures) {
      list.push({
        id: `venture-${venture.id}`,
        label: venture.name,
        hint: 'Vorhaben',
        group: 'Springe zu',
        run: () => setUi({ ventureId: venture.id, selectedTaskId: null, mode: 'tasks' }),
      });
    }
    for (const task of client.tasks) {
      list.push({
        id: `task-${task.id}`,
        label: task.title,
        hint: client.ventures.find((v) => v.id === task.ventureId)?.name ?? 'Aufgabe',
        group: 'Springe zu',
        run: () => setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId: task.ventureId }),
      });
    }
    for (const person of client.people) {
      list.push({
        id: `person-${person.id}`,
        label: person.name,
        hint: 'Person',
        group: 'Springe zu',
        run: () => setUi({ mode: 'resources', selectedResourceId: person.id }),
      });
    }
    for (const budget of client.budgets) {
      list.push({
        id: `budget-${budget.id}`,
        label: budget.name,
        hint: 'Budget',
        group: 'Springe zu',
        run: () => setUi({ mode: 'resources', selectedResourceId: budget.id }),
      });
    }
    return list;
  }, [store, prefs, setPrefs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands
      .filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
      .slice(0, 40);
  }, [commands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('.palette__item--active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <div className="modal__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Befehle">
        <input
          autoFocus
          className="palette__input"
          placeholder="Befehl oder Aufgabe suchen..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % Math.max(1, filtered.length));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + filtered.length) % Math.max(1, filtered.length));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(active);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className="palette__list" ref={listRef}>
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={`palette__item${index === active ? ' palette__item--active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(index)}
            >
              <span className="badge">{command.group}</span>
              <span className="grow truncate">{command.label}</span>
              {command.hint && <span className="palette__hint">{command.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <div className="combo__empty">Keine Treffer</div>}
        </div>
      </div>
    </div>
  );
}
