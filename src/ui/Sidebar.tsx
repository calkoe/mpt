/**
 * Linke Seitenleiste: Mandantenauswahl, Vorhaben-Blöcke, Moduswechsel.
 *
 * Ein Klick auf ein Vorhaben filtert die gesamte rechte Seite. Das aktive
 * Vorhaben klappt seine Bearbeitung direkt auf - kein separater Dialog, kein
 * Speichern-Klick.
 */
import { useState } from 'react';
import { createClient, createVenture } from '../model/factory';
import type { Venture } from '../model/types';
import { useDerived } from '../state/useDerived';
import { useStore, type ViewMode } from '../state/store';
import { Button, Combobox, ConfirmButton, Field, Segmented, Switch, TextInput, WarnIcon } from './components/controls';
import { TagDialog } from './dialogs/TagDialog';

export function Sidebar() {
  const { db, client, ui, setUi, commit, commitClient } = useStore();
  const { taskWarnings } = useDerived();
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const ventureStats = (venture: Venture) => {
    const tasks = client.tasks.filter((t) => t.ventureId === venture.id);
    const done = tasks.filter((t) => t.status === 'done').length;
    const warnings = tasks.reduce((sum, t) => sum + (taskWarnings.get(t.id)?.length ?? 0), 0);
    return { total: tasks.length, done, warnings, progress: tasks.length === 0 ? 0 : done / tasks.length };
  };

  const addVenture = () => {
    const venture = createVenture();
    commitClient('Vorhaben angelegt', (c) => {
      c.ventures.push(venture);
    });
    setUi({ ventureId: venture.id, selectedTaskId: null });
  };

  const totalTasks = client.tasks.length;
  const unassignedWarnings = client.tasks.reduce((sum, t) => sum + (taskWarnings.get(t.id)?.length ?? 0), 0);

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
            Alle Vorhaben
            {unassignedWarnings > 0 && <WarnIcon warnings={[`${unassignedWarnings} Hinweise im Mandanten`]} />}
          </div>
          <div className="venture__meta">
            <span>{totalTasks} Aufgaben</span>
            <span>{client.ventures.length} Vorhaben</span>
          </div>
        </button>

        {client.ventures.map((venture) => {
          const stats = ventureStats(venture);
          const active = ui.ventureId === venture.id;
          return (
            <div key={venture.id}>
              <button
                type="button"
                className={`venture${active ? ' venture--active' : ''}`}
                onClick={() => setUi({ ventureId: active ? null : venture.id, selectedTaskId: null })}
                title={venture.description || venture.name}
              >
                <div className="venture__title">
                  <span className={`status-dot status-dot--${venture.done ? 'done' : 'open'}`} />
                  <span className="grow truncate">{venture.name}</span>
                  {stats.warnings > 0 && <WarnIcon warnings={[`${stats.warnings} Hinweise in diesem Vorhaben`]} />}
                </div>
                <div className="venture__meta">
                  <span>
                    {stats.done}/{stats.total} erledigt
                  </span>
                  {venture.done && <span className="badge badge--ok">abgeschlossen</span>}
                </div>
                <div className="venture__bar">
                  <i style={{ width: `${Math.round(stats.progress * 100)}%` }} />
                </div>
              </button>

              {active && (
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
                  <TextInput
                    value={venture.description}
                    placeholder="Kurzbeschreibung"
                    onChange={(description) =>
                      commitClient('Vorhaben bearbeitet', (c) => {
                        const v = c.ventures.find((x) => x.id === venture.id);
                        if (v) v.description = description;
                      }, { coalesceKey: `venture-desc-${venture.id}` })
                    }
                  />
                  <div className="row row--between">
                    <Switch
                      checked={venture.done}
                      label="Abgeschlossen"
                      onChange={(done) =>
                        commitClient(done ? 'Vorhaben abgeschlossen' : 'Vorhaben wieder geöffnet', (c) => {
                          const v = c.ventures.find((x) => x.id === venture.id);
                          if (v) v.done = done;
                        })
                      }
                    />
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
        <Segmented<ViewMode>
          block
          ariaLabel="Ansicht"
          value={ui.mode}
          onChange={(mode) => setUi({ mode })}
          options={[
            { value: 'tasks', label: 'Aufgaben', title: 'Aufgabenübersicht (Alt+1)' },
            { value: 'resources', label: 'Ressourcen', title: 'Ressourcenübersicht (Alt+3)' },
          ]}
        />
        <Button
          block
          variant="ghost"
          onClick={() => setTagsOpen(true)}
          title="Tags umbenennen, umfärben oder löschen"
        >
          Tags verwalten ({client.tags.length})
        </Button>
      </div>

      {tagsOpen && <TagDialog onClose={() => setTagsOpen(false)} />}
    </aside>
  );
}
