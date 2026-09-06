/**
 * Zentrale Tag-Verwaltung: umbenennen, umfärben, löschen.
 *
 * Tags entstehen beim Tippen in einer Aufgabe und bekommen dort automatisch
 * eine Farbe. Genau deshalb braucht es diese Stelle: irgendwann will man die
 * vergebenen Farben ordnen, ohne dafür durch die Aufgaben zu gehen.
 *
 * Beim Löschen verschwindet der Tag auch aus allen Aufgaben - das steht am
 * Knopf, und rückgängig machen lässt es sich mit Strg+Z.
 */
import { useMemo } from 'react';
import { TAG_PALETTE } from '../../model/factory';
import { useStore } from '../../state/store';
import { Button, ConfirmButton, EmptyState, Modal, TextInput } from '../components/controls';
import { SHORTCUTS, shortcutParts } from '../shortcuts';

export function TagDialog({ onClose }: { onClose: () => void }) {
  const { client, commitClient } = useStore();

  /** Wie oft wird jeder Tag verwendet - Entscheidungshilfe beim Aufräumen. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of client.tasks) {
      for (const id of task.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [client.tasks]);

  const rename = (id: string, name: string) =>
    commitClient(
      'Tag umbenannt',
      (c) => {
        const tag = c.tags.find((t) => t.id === id);
        if (tag) tag.name = name;
      },
      { coalesceKey: `tag-name-${id}` },
    );

  const recolor = (id: string, color: string) =>
    commitClient('Tag-Farbe geändert', (c) => {
      const tag = c.tags.find((t) => t.id === id);
      if (tag) tag.color = color;
    });

  const remove = (id: string) =>
    commitClient('Tag gelöscht', (c) => {
      c.tags = c.tags.filter((t) => t.id !== id);
      for (const task of c.tasks) task.tagIds = task.tagIds.filter((t) => t !== id);
    });

  return (
    <Modal title="Tags verwalten" onClose={onClose} wide>
      {client.tags.length === 0 ? (
        <EmptyState
          title="Noch keine Tags"
          hint="Tags entstehen beim Tippen im Aufgaben-Editor - dort einfach einen Namen eingeben und anlegen."
        />
      ) : (
        <div className="col">
          {client.tags.map((tag) => (
            <div key={tag.id} className="tagrow">
              <span className="chip__dot tagrow__dot" style={{ background: tag.color }} />
              <TextInput
                value={tag.name}
                placeholder="Name"
                title="Name des Tags. Er wirkt überall zugleich - an jeder Aufgabe, jeder Ressource und in beiden Filtern."
                onChange={(name) => rename(tag.id, name)}
              />
              <div className="tagrow__swatches">
                {TAG_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch${color === tag.color ? ' swatch--active' : ''}`}
                    style={{ background: color }}
                    title={`Farbe ${color}`}
                    aria-label={`Farbe ${color} wählen`}
                    onClick={() => recolor(tag.id, color)}
                  />
                ))}
                <input
                  type="color"
                  className="swatch swatch--custom"
                  value={tag.color}
                  title="Eigene Farbe wählen"
                  aria-label="Eigene Farbe"
                  onChange={(e) => recolor(tag.id, e.target.value)}
                />
              </div>
              <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
                {usage.get(tag.id) ?? 0}×
              </span>
              <ConfirmButton
                size="sm"
                onConfirm={() => remove(tag.id)}
                title="Tag löschen und aus allen Aufgaben entfernen"
                confirmLabel="Wirklich löschen?"
              >
                Löschen
              </ConfirmButton>
            </div>
          ))}
        </div>
      )}

      <p className="faint" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>
        Die Farbe eines Tags färbt auch den Balken im Gantt und den Streifen am Knoten im Netzplan.
        Änderungen wirken sofort und lassen sich mit{' '}
        {shortcutParts(SHORTCUTS.undo).map((part) => (
          <kbd key={part}>{part}</kbd>
        ))}{' '}
        zurücknehmen.
      </p>

      <div className="row">
        <div className="spacer" />
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </Modal>
  );
}
