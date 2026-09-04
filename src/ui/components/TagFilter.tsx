/**
 * Tag-Filter als Aufklappmenü.
 *
 * Vorher lagen alle Tags nebeneinander in der Werkzeugleiste - bei einer
 * Handvoll Tags geht das, ab einem Dutzend schiebt es die übrigen Bedienelemente
 * aus dem Bild. Als Aufklappmenü kostet der Filter immer denselben Platz und
 * zeigt trotzdem an, wie viele Tags gerade greifen.
 *
 * Wird in der Aufgaben- und in der Ressourcenansicht gleichermaßen genutzt.
 *
 * Das Menü hängt an `document.body` statt am Knopf: die Werkzeugleiste scrollt
 * waagerecht (`overflow-x: auto`), und sobald eine Achse nicht `visible` ist,
 * macht CSS die andere automatisch zu `auto` - das Menü wurde dadurch
 * abgeschnitten, egal wie hoch der z-index war.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Id } from '../../model/types';
import { useStore } from '../../state/store';
import { Button } from './controls';

export function TagFilter({
  tagIds,
  onChange,
  title = 'Nur Aufgaben mit diesen Tags anzeigen',
}: {
  tagIds: Id[];
  onChange: (ids: Id[]) => void;
  title?: string;
}) {
  const { client } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });

  // Position am Knopf ausrichten - das Menü liegt im Body und weiß sonst
  // nichts von ihm.
  useLayoutEffect(() => {
    if (!open) return;
    const box = ref.current?.getBoundingClientRect();
    if (box) setPosition({ top: box.bottom + 4, right: window.innerWidth - box.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    // Beim Scrollen oder Größenändern wandert der Knopf weg - dann schließen,
    // statt ein Menü an falscher Stelle stehen zu lassen.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (client.tags.length === 0) return null;

  const toggle = (id: Id) =>
    onChange(tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id]);

  return (
    <div className="tagfilter" ref={ref}>
      <Button
        size="sm"
        variant={tagIds.length > 0 ? 'primary' : 'default'}
        onClick={() => setOpen((o) => !o)}
        title={title}
      >
        Tags{tagIds.length > 0 ? ` (${tagIds.length})` : ''} ▾
      </Button>

      {open &&
        createPortal(
          <div
            className="tagfilter__menu"
            role="listbox"
            aria-label="Tags filtern"
            ref={menuRef}
            style={{ top: position.top, right: position.right }}
          >
          {client.tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              role="option"
              aria-selected={tagIds.includes(tag.id)}
              className={`tagfilter__option${tagIds.includes(tag.id) ? ' tagfilter__option--active' : ''}`}
              onClick={() => toggle(tag.id)}
            >
              <span className="chip__dot" style={{ background: tag.color }} />
              <span className="grow truncate">{tag.name}</span>
              {tagIds.includes(tag.id) && <span aria-hidden="true">✓</span>}
            </button>
          ))}
            {tagIds.length > 0 && (
              <button type="button" className="tagfilter__option tagfilter__reset" onClick={() => onChange([])}>
                Filter zurücksetzen
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
