/**
 * Warnzentrum: alle Warnungen des aktiven Mandanten an einer Stelle.
 *
 * Die einzelnen Warnungen erscheinen weiterhin dort, wo sie entstehen (am
 * Knoten, am Balken, in der Ressourcenleiste). Dieser Dialog beantwortet die
 * andere Frage: "Wo steht das Projekt insgesamt schlecht?" - deshalb nach
 * Objekt gruppiert und jeder Eintrag als Sprungziel.
 */
import { useMemo } from 'react';
import type { Id } from '../../model/types';
import type { Warning } from '../../engine/validate';
import { useDerived } from '../../state/useDerived';
import { useStore } from '../../state/store';
import { Badge, EmptyState, Modal } from '../components/controls';

export interface WarningGroup {
  targetId: Id;
  targetKind: Warning['targetKind'];
  label: string;
  warnings: Warning[];
}

/**
 * Fasst Aufgaben- und Ressourcenwarnungen zu Gruppen je Objekt zusammen,
 * die schwersten zuerst. Wird auch für den Zähler in der Kopfzeile genutzt.
 */
export function useWarningGroups(): { groups: WarningGroup[]; total: number } {
  const { client } = useStore();
  const derived = useDerived();

  return useMemo(() => {
    const groups: WarningGroup[] = [];

    // Die Art des Objekts steht in der Warnung selbst - Personen und Budgets
    // liegen in derselben Karte.
    const labelOf = (kind: Warning['targetKind'], id: Id): string | undefined => {
      if (kind === 'task') return derived.taskById.get(id)?.title;
      if (kind === 'person') return client.people.find((p) => p.id === id)?.name;
      return client.budgets.find((b) => b.id === id)?.name;
    };

    for (const source of [derived.taskWarnings, derived.resourceWarnings]) {
      for (const [targetId, warnings] of source) {
        if (warnings.length === 0) continue;
        const targetKind = warnings[0].targetKind;
        const label = labelOf(targetKind, targetId);
        if (!label) continue;
        groups.push({ targetId, targetKind, label, warnings });
      }
    }

    const severity = (group: WarningGroup) => group.warnings.filter((w) => w.level === 'warn').length;
    groups.sort((a, b) => severity(b) - severity(a) || b.warnings.length - a.warnings.length);

    return { groups, total: groups.reduce((sum, g) => sum + g.warnings.length, 0) };
  }, [client.budgets, client.people, derived.resourceWarnings, derived.taskById, derived.taskWarnings]);
}

const KIND_LABEL: Record<Warning['targetKind'], string> = {
  task: 'Aufgabe',
  person: 'Person',
  budget: 'Budget',
};

export function WarningCenter({ onClose }: { onClose: () => void }) {
  const { setUi } = useStore();
  const { groups, total } = useWarningGroups();

  const jumpTo = (group: WarningGroup) => {
    if (group.targetKind === 'task') {
      setUi({ mode: 'tasks', selectedTaskId: group.targetId });
    } else {
      setUi({ mode: 'resources', selectedResourceId: group.targetId });
    }
    onClose();
  };

  return (
    <Modal
      title={total === 0 ? 'Warnzentrum' : `Warnzentrum · ${total} Hinweis(e)`}
      onClose={onClose}
      wide
    >
      {groups.length === 0 ? (
        <EmptyState
          title="Keine Warnungen"
          hint="Termine, Status, Bedingungen sowie die Auslastung von Personen und Budgets sind unauffällig."
        />
      ) : (
        <div className="col">
          {groups.map((group) => (
            <button
              key={`${group.targetKind}-${group.targetId}`}
              type="button"
              className="warnlist__item"
              onClick={() => jumpTo(group)}
              title="Zum betroffenen Objekt springen"
            >
              <div className="row">
                <Badge tone={group.warnings.some((w) => w.level === 'warn') ? 'warn' : 'default'}>
                  {KIND_LABEL[group.targetKind]}
                </Badge>
                <strong className="grow truncate">{group.label}</strong>
                <span className="faint nowrap">{group.warnings.length}</span>
              </div>
              <ul className="warnlist__reasons">
                {group.warnings.map((warning, index) => (
                  <li key={index} className={warning.level === 'warn' ? 'warnlist__reason--warn' : undefined}>
                    {warning.text}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
