/**
 * Linke Seitenleiste: Mandantenauswahl, Vorhaben-Blöcke, Moduswechsel.
 *
 * Ein Klick auf ein Vorhaben filtert die gesamte rechte Seite. Umbenennen und
 * Löschen liegen hinter einem kleinen Pfeil, der nur am gewählten Vorhaben
 * erscheint - kein separater Dialog, kein Speichern-Klick, aber auch keine
 * Bedienelemente in einer Liste, durch die man vor allem navigiert.
 */
import { useState } from 'react';
import { createClient, createVenture } from '../model/factory';
import type { Id, Venture } from '../model/types';
import { isVentureDone } from '../engine/validate';
import { useStore, type ViewMode } from '../state/store';
import { Button, Combobox, ConfirmButton, Field, Segmented, TextInput } from './components/controls';
import { TagDialog } from './dialogs/TagDialog';
import { WorkloadDialog } from './dialogs/WorkloadDialog';
import { useDetached } from './PanelWindow';
import { moveItem, useReorder } from './components/useReorder';

export function Sidebar() {
  const { db, client, ui, setUi, commit, commitClient } = useStore();
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [workloadOpen, setWorkloadOpen] = useState(false);
  const detached = useDetached();

  // Anzeigereihenfolge der Vorhaben = Array-Reihenfolge, per Ziehen aenderbar.
  /** Welches Vorhaben gerade seine Bearbeitungsfelder zeigt. */
  const [editing, setEditing] = useState<Id | null>(null);

  const ventureOrder = useReorder((from, to) =>
    commitClient('Vorhaben umsortiert', (c) => moveItem(c.ventures, from, to)),
  );

  const ventureStats = (venture: Venture) => ({
    total: client.tasks.filter((t) => t.ventureId === venture.id).length,
    done: isVentureDone(client, venture.id),
  });

  const addVenture = () => {
    const venture = createVenture();
    commitClient('Vorhaben angelegt', (c) => {
      c.ventures.push(venture);
    });
    setUi({ ventureId: venture.id, selectedTaskId: null });
  };

  const totalTasks = client.tasks.length;

  return (
    <aside className="sidebar app__sidebar">
      {/* Mandanten */}
      <div className="sidebar__section">
        <div className="sidebar__label">Mandant</div>
        <div className="row">
          <select
            className="select grow"
            value={client?.id ?? ''}
            onChange={(e) => setUi({ clientId: e.target.value, ventureId: null, selectedTaskId: null, selectedResourceId: null })}
            title="Trennt den Datenbestand in unabhängige Projekte"
          >
            {db.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button icon variant="ghost" title="Mandanten verwalten" onClick={() => setClientMenuOpen((o) => !o)}>
            &#9881;
          </Button>
        </div>

        {clientMenuOpen && (
          <div className="col" style={{ marginTop: 'var(--sp-2)' }}>
            <Field label="Name">
              <TextInput
                value={client?.name ?? ''}
                onChange={(name) =>
                  commit('Mandant umbenannt', (clients) => {
                    const target = clients.find((c) => c.id === client.id);
                    if (target) target.name = name;
                  }, { coalesceKey: `client-name-${client?.id}` })
                }
              />
            </Field>
            <div className="row">
              <Button
                size="sm"
                onClick={() => {
                  const fresh = createClient();
                  commit('Mandant angelegt', (clients) => {
                    clients.push(fresh);
                  });
                  setUi({ clientId: fresh.id, ventureId: null, selectedTaskId: null });
                }}
              >
                + Mandant
              </Button>
              <ConfirmButton
                size="sm"
                disabled={db.clients.length <= 1}
                title={db.clients.length <= 1 ? 'Der letzte Mandant kann nicht gelöscht werden' : 'Mandant mit allen Daten löschen'}
                onConfirm={() => {
                  commit('Mandant gelöscht', (clients) => {
                    const index = clients.findIndex((c) => c.id === client.id);
                    if (index >= 0 && clients.length > 1) clients.splice(index, 1);
                  });
                  setUi({ clientId: null, ventureId: null, selectedTaskId: null });
                }}
              >
                Löschen
              </ConfirmButton>
            </div>
          </div>
        )}
      </div>

      {/* Vorhaben */}
      <div className="sidebar__scroll">
        <div className="row row--between" style={{ marginBottom: 'var(--sp-1)' }}>
          <span className="sidebar__label" style={{ margin: 0 }}>
            Vorhaben
          </span>
          <Button size="sm" variant="ghost" onClick={addVenture} title="Neues Vorhaben (Alt+V)">
            + Neu
          </Button>
        </div>

        <button
          type="button"
          className={`venture${ui.ventureId === null ? ' venture--active' : ''}`}
          onClick={() => setUi({ ventureId: null })}
        >
          <div className="venture__title">
            <span className="grow truncate">Alle Vorhaben</span>
            {/* Leerer Platz für den Ausklapp-Pfeil - siehe unten. */}
            <span className="venture__slot" />
          </div>
          <div className="venture__meta">
            <span>{totalTasks} Aufgaben</span>
            <span>{client.ventures.length} Vorhaben</span>
          </div>
        </button>

        {client.ventures.map((venture, index) => {
          const stats = ventureStats(venture);
          const active = ui.ventureId === venture.id;
          return (
            <div key={venture.id}>
              <div
                role="button"
                tabIndex={0}
                className={`venture sortable${active ? ' venture--active' : ''}`}
                {...ventureOrder.itemProps(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setUi({ ventureId: active ? null : venture.id, selectedTaskId: null });
                  }
                }}
                onClick={() => setUi({ ventureId: active ? null : venture.id, selectedTaskId: null })}
                title={venture.name}
              >
                <div className="venture__title">
                  <span className={`status-dot status-dot--${stats.done ? 'done' : 'open'}`} />
                  <span className="grow truncate">{venture.name}</span>
                  {/*
                    Fester Platz am rechten Rand für den Ausklapp-Pfeil: er ist
                    auch dann breit, wenn der Pfeil fehlt - sonst wechselte die
                    Breite des Namens, sobald ein Vorhaben gewählt wird.

                    Warnungen stehen hier bewusst nicht mehr: sie hingen an
                    jedem Vorhaben, ohne zu sagen woran es liegt. Wer sie sucht,
                    findet sie im Warnzentrum und an der Aufgabe selbst.

                    Umbenennen und Löschen sind seltene Eingriffe und stehen
                    deshalb eingeklappt; der Pfeil erscheint nur am gewählten
                    Vorhaben - eine Liste voller Bedienelemente lenkt von dem
                    ab, wofür die Liste da ist: dem Wechseln.
                  */}
                  <span className="venture__slot">
                    {active && (
                      <button
                        type="button"
                        className={`venture__toggle${editing === venture.id ? ' venture__toggle--open' : ''}`}
                        aria-expanded={editing === venture.id}
                        title={editing === venture.id ? 'Bearbeiten schließen' : 'Vorhaben bearbeiten'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(editing === venture.id ? null : venture.id);
                        }}
                      >
                        ▾
                      </button>
                    )}
                  </span>

                </div>
                <div className="venture__meta">
                  <span>{stats.total} Aufgaben</span>
                  {stats.done && <span className="badge badge--ok">abgeschlossen</span>}
                </div>
              </div>

              {active && editing === venture.id && (
                <div className="col" style={{ padding: 'var(--sp-2) var(--sp-2) var(--sp-3)' }}>
                  <TextInput
                    value={venture.name}
                    placeholder="Name des Vorhabens"
                    onChange={(name) =>
                      commitClient('Vorhaben umbenannt', (c) => {
                        const v = c.ventures.find((x) => x.id === venture.id);
                        if (v) v.name = name;
                      }, { coalesceKey: `venture-name-${venture.id}` })
                    }
                  />
                  <div className="row row--between">
                    <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                      {stats.done
                        ? 'Abgeschlossen - alle Aufgaben erledigt oder im Betrieb.'
                        : `${stats.total} Aufgabe(n)`}
                    </span>
                    <ConfirmButton
                      size="sm"
                      title="Vorhaben und dessen Aufgaben löschen"
                      onConfirm={() => {
                        commitClient('Vorhaben gelöscht', (c) => {
                          const taskIds = new Set(c.tasks.filter((t) => t.ventureId === venture.id).map((t) => t.id));
                          c.tasks = c.tasks.filter((t) => !taskIds.has(t.id));
                          for (const t of c.tasks) {
                            t.dependsOn = t.dependsOn.filter((d) => !taskIds.has(d));
                            t.parallelWith = t.parallelWith.filter((d) => !taskIds.has(d));
                            t.ventureConditions = t.ventureConditions.filter((v) => v !== venture.id);
                          }
                          c.ventures = c.ventures.filter((v) => v.id !== venture.id);
                        });
                        setUi({ ventureId: null, selectedTaskId: null });
                      }}
                    >
                      Löschen
                    </ConfirmButton>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {client.ventures.length === 0 && (
          <div className="muted" style={{ padding: 'var(--sp-3) 0', fontSize: 'var(--fs-sm)' }}>
            Noch keine Vorhaben. Ein Vorhaben bündelt zusammengehörende Aufgaben.
          </div>
        )}

        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Field label="Schnellsprung Aufgabe">
            <Combobox
              placeholder="Aufgabe suchen..."
              options={client.tasks.map((t) => ({
                id: t.id,
                label: t.title,
                hint: client.ventures.find((v) => v.id === t.ventureId)?.name,
              }))}
              onSelect={(id) => {
                const task = client.tasks.find((t) => t.id === id);
                setUi({ mode: 'tasks', selectedTaskId: id, ventureId: task ? task.ventureId : null });
              }}
            />
          </Field>
        </div>
      </div>

      {/* Moduswechsel */}
      <div className="sidebar__footer">
        {/*
          Der Umschalter gilt für dieses Fenster. Läuft eine der beiden
          Ansichten im eigenen Fenster, trägt sie hier ein ⧉ - sonst wüsste man
          nicht, warum die Auswahl scheinbar nichts Neues zeigt.
        */}
        <Segmented<ViewMode>
          block
          ariaLabel="Ansicht"
          value={ui.mode}
          onChange={(mode) => setUi({ mode })}
          options={([
            ['tasks', 'Aufgaben', 'Aufgabenübersicht (Alt+1)'],
            ['resources', 'Ressourcen', 'Ressourcenübersicht (Alt+3)'],
          ] as const).map(([value, label, title]) => ({
            value,
            label: detached?.mode === value ? `${label} ⧉` : label,
            title: detached?.mode === value ? `${title} - läuft gerade in einem eigenen Fenster` : title,
          }))}
        />
        {/*
          Der Moduswechsel bestimmt, was rechts zu sehen ist; darunter stehen
          Werkzeuge, die unabhängig davon wirken. Die feine Linie trennt beides
          - ohne sie liest sich der Fuß als eine einzige Knopfreihe.
        */}
        <div className="section-rule" />

        {/*
          Beides sind Werkzeuge, keine Randnotizen - deshalb als richtige
          Knöpfe mit Rahmen. Als flache Textzeilen ("ghost") sahen sie unter
          dem Moduswechsel aus wie Beschriftungen und wurden übersehen.
        */}
        <Button block onClick={() => setTagsOpen(true)} title="Tags umbenennen, umfärben oder löschen">
          Tags verwalten ({client.tags.length})
        </Button>
        <Button
          block
          onClick={() => setWorkloadOpen(true)}
          title="Wer arbeitet in einem Zeitraum an welcher Aufgabe?"
        >
          Wer arbeitet woran?
        </Button>
      </div>

      {tagsOpen && <TagDialog onClose={() => setTagsOpen(false)} />}
      {workloadOpen && <WorkloadDialog onClose={() => setWorkloadOpen(false)} />}
    </aside>
  );
}
