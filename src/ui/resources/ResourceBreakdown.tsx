/**
 * Auswertung - die Einzelpositionen hinter einer Zahl.
 *
 * Es gibt zwei Wege hierher, aber nur **einen** Dialog und **eine** Tabelle:
 *  - Klick auf einen Zeitraum in einer Ganglinie (Detailansicht) - dann geht
 *    es um diese eine Ressource in diesem einen Zeitraum,
 *  - Knopf "Auswertung erzeugen" unter einer Ressourcenliste - dann um alle
 *    dort gezeigten Ressourcen im dort gewählten Zeitraum.
 *
 * Die Zeilen kommen in beiden Fällen aus `engine/resources.ts` und sind
 * dieselben Zahlen, die daneben im Diagramm stehen. Die Tabelle selbst hat
 * keine Meinung darüber, woher sie stammen - sie zeigt, was sie bekommt.
 */
import { useState } from 'react';
import { formatValue, type Breakdown } from '../../engine/resources';
import { formatDateDe } from '../../engine/dates';
import type { Id } from '../../model/types';
import { MeasureAmount, MeasureLabel } from '../components/CostMeasure';
import { Button, Modal } from '../components/controls';

export function BreakdownTable({
  breakdown,
  taskLabel,
  onSelectTask,
}: {
  breakdown: Breakdown;
  taskLabel: (taskId: Id) => string;
  onSelectTask?: (taskId: Id) => void;
}) {
  const isBudget = breakdown.unit === 'EUR';
  const showResource = hasSeveralResources(breakdown);
  /*
   * Die verfügbare Kapazität steht bei Personen als eigene Spalte: sie ist je
   * Person verschieden und genau die Zahl, gegen die man die gebundene liest.
   * Bei Budgets gibt es dagegen **eine** genehmigte Summe für die ganze
   * Auswertung - die steht über der Tabelle, nicht als Spalte voller
   * Wiederholungen.
   */
  const showCapacity = !isBudget && breakdown.rows.some((r) => r.resourceCeiling !== null);

  if (breakdown.rows.length === 0) {
    return <div className="faint breakdown__empty">Keine Beiträge in diesem Zeitraum.</div>;
  }

  /*
   * Die Kapazität gehört der Ressource, nicht der Aufgabe. Sie erscheint
   * deshalb nur in der ersten Zeile einer Ressource - stünde sie in jeder,
   * läse man sie als "verfügbar für diese Aufgabe".
   */
  const seen = new Set<Id>();
  const capacityOf = (row: (typeof breakdown.rows)[number]) => {
    if (seen.has(row.resourceId)) return null;
    seen.add(row.resourceId);
    return row.resourceCeiling;
  };

  return (
    <table className="table breakdown">
      <thead>
        <tr>
          {showResource && <th>Ressource</th>}
          <th>Aufgabe</th>
          <th className="table__num">{isBudget ? <MeasureLabel measure="planned" /> : 'gebunden'}</th>
          {isBudget && (
            <th className="table__num">
              <MeasureLabel measure="actual" />
            </th>
          )}
          {showCapacity && (
            <th className="table__num">
              <MeasureLabel measure="approved">verfügbar</MeasureLabel>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {breakdown.rows.map((row) => {
          const capacity = showCapacity ? capacityOf(row) : null;
          return (
            <tr
              key={`${row.resourceId}-${row.taskId}`}
              className={onSelectTask ? 'breakdown__row--clickable' : undefined}
              onClick={onSelectTask ? () => onSelectTask(row.taskId) : undefined}
              title={onSelectTask ? 'Aufgabe im Plan öffnen' : undefined}
            >
              {showResource && <td className="truncate">{row.resourceName}</td>}
              <td className="truncate">{taskLabel(row.taskId)}</td>
              <td className="table__num mono">{formatValue(row.planned, breakdown.unit)}</td>
              {isBudget && <td className="table__num mono">{formatValue(row.actual, breakdown.unit)}</td>}
              {showCapacity && (
                <td className="table__num mono faint">
                  {capacity === null ? '' : formatValue(capacity, breakdown.unit)}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={showResource ? 2 : 1}>Summe</td>
          <td className="table__num mono">{formatValue(breakdown.planned, breakdown.unit)}</td>
          {isBudget && <td className="table__num mono">{formatValue(breakdown.actual, breakdown.unit)}</td>}
          {showCapacity && (
            <td className="table__num mono">
              {breakdown.ceiling === null ? '∞' : formatValue(breakdown.ceiling, breakdown.unit)}
            </td>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Dieselbe Tabelle als Text mit Tabulatoren - so landet sie beim Einfügen in
 * einer Tabellenkalkulation in getrennten Spalten. Bewusst die rohen Zahlen
 * ohne Einheit und ohne Tausenderpunkte: formatiert wären sie in Excel Text.
 */
export function breakdownToTsv(breakdown: Breakdown, taskLabel: (taskId: Id) => string): string {
  const isBudget = breakdown.unit === 'EUR';
  const showResource = hasSeveralResources(breakdown);
  const showCapacity = !isBudget && breakdown.rows.some((r) => r.resourceCeiling !== null);
  const rahmen = breakdown.ceiling === null ? 'unbegrenzt' : num(breakdown.ceiling);

  const head = [
    ...(showResource ? ['Ressource'] : []),
    'Aufgabe',
    isBudget ? `Geplant (${breakdown.unit})` : `Gebunden (${breakdown.unit})`,
    ...(isBudget ? [`Ausgegeben (${breakdown.unit})`] : []),
    ...(showCapacity ? [`Verfuegbar (${breakdown.unit})`] : []),
  ];

  /*
   * Beim Kopieren steht die Kapazitaet in **jeder** Zeile, nicht nur in der
   * ersten je Ressource: in einer Tabellenkalkulation wird gefiltert und
   * sortiert, und eine leere Zelle waere dort schlicht ein fehlender Wert.
   */
  const lines = [
    `${breakdown.label}\t${formatDateDe(breakdown.from)} - ${formatDateDe(breakdown.to)}`,
    ...(isBudget ? [`Genehmigt (${breakdown.unit})\t${rahmen}`] : []),
    '',
    head.join('\t'),
    ...breakdown.rows.map((row) =>
      [
        ...(showResource ? [row.resourceName] : []),
        taskLabel(row.taskId),
        num(row.planned),
        ...(isBudget ? [num(row.actual)] : []),
        ...(showCapacity ? [row.resourceCeiling === null ? 'unbegrenzt' : num(row.resourceCeiling)] : []),
      ].join('\t'),
    ),
    [
      ...(showResource ? [''] : []),
      'Summe',
      num(breakdown.planned),
      ...(isBudget ? [num(breakdown.actual)] : []),
      ...(showCapacity ? [rahmen] : []),
    ].join('\t'),
  ];
  return lines.join('\n');
}

/**
 * Die Spalte "Ressource" nur, wenn es mehr als eine gibt. Bei der Auswertung
 * eines einzelnen Zeitraums stuende sonst in jeder Zeile derselbe Name; er
 * steht dort ueber der Tabelle.
 */
function hasSeveralResources(breakdown: Breakdown): boolean {
  return new Set(breakdown.rows.map((r) => r.resourceId)).size > 1;
}

/** Deutsches Dezimalkomma, damit die Zahl in Excel eine Zahl bleibt. */
function num(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

/**
 * Kopiert die Tabelle in die Zwischenablage - an beiden Stellen derselbe Knopf.
 *
 * Er meldet den Erfolg an sich selbst statt in einer Zeile daneben: eine
 * Meldung, die man wegklicken muss, waere fuer "kopiert" zu viel, und ohne
 * jede Rueckmeldung weiss man nicht, ob es geklappt hat.
 */
export function BreakdownCopyButton({
  breakdown,
  taskLabel,
}: {
  breakdown: Breakdown;
  taskLabel: (taskId: Id) => string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(breakdownToTsv(breakdown, taskLabel));
      setState('ok');
    } catch {
      // Ohne Zugriff auf die Zwischenablage bleibt der Weg ueber das Markieren.
      setState('fail');
    }
    setTimeout(() => setState('idle'), 2500);
  };

  return (
    <Button
      size="sm"
      variant={state === 'fail' ? 'danger' : 'default'}
      disabled={breakdown.rows.length === 0}
      onClick={() => void copy()}
      title={
        state === 'fail'
          ? 'Die Zwischenablage ist nicht zugaenglich - die Tabelle laesst sich markieren und von Hand kopieren.'
          : 'Tabelle tabulatorgetrennt kopieren - in Excel einfuegbar'
      }
    >
      {state === 'ok' ? 'Kopiert' : state === 'fail' ? 'Nicht moeglich' : 'Kopieren'}
    </Button>
  );
}

/**
 * Die Tabelle als Dialog - der einzige Ort, an dem eine Auswertung erscheint.
 *
 * Ein Dialog statt einer Fläche in der Ansicht: eine Aufstellung wird schnell
 * lang, und man will sie ansehen, markieren und weiterverwenden - nicht
 * dauerhaft danebenstehen haben. Ausserdem ist so beides gleich, egal ob man
 * im Diagramm geklickt oder den Knopf unter einer Liste benutzt hat.
 */
export function BreakdownDialog({
  breakdown,
  taskLabel,
  onClose,
  onSelectTask,
}: {
  breakdown: Breakdown;
  taskLabel: (taskId: Id) => string;
  onClose: () => void;
  /** Klick auf eine Zeile springt zur Aufgabe im Plan. */
  onSelectTask?: (taskId: Id) => void;
}) {
  /** Genau eine Ressource? Dann gehört ihr Name über die Tabelle, nicht hinein. */
  const names = new Set(breakdown.rows.map((r) => r.resourceName));
  const only = names.size === 1 ? [...names][0] : '';
  const isBudget = breakdown.unit === 'EUR';

  return (
    <Modal
      title={`Auswertung · ${breakdown.label}`}
      onClose={onClose}
      wide
      footer={
        <Button variant="primary" onClick={onClose}>
          Schliessen
        </Button>
      }
    >
      <div className="col">
        {/* Kopf ueber der Tabelle: Zeitraum links, Kopieren rechts. */}
        <div className="row">
          <span className="faint truncate" style={{ fontSize: 'var(--fs-sm)' }}>
            {only ? `${only} · ` : ''}
            {formatDateDe(breakdown.from)} - {formatDateDe(breakdown.to)} · {breakdown.rows.length} Positionen
          </span>
          {/*
            Bei Geld steht der genehmigte Rahmen hier oben beim Zeitraum: es
            gibt genau einen für die ganze Auswertung, als Tabellenspalte wäre
            er in jeder Zeile derselbe. Bei Personen ist er je Person
            verschieden und steht deshalb in der Tabelle.
          */}
          {isBudget && (
            <span className="faint nowrap" style={{ fontSize: 'var(--fs-sm)' }}>
              <MeasureAmount measure="approved" value={breakdown.ceiling} />
            </span>
          )}
          <span className="spacer" />
          <BreakdownCopyButton breakdown={breakdown} taskLabel={taskLabel} />
        </div>
        <BreakdownTable breakdown={breakdown} taskLabel={taskLabel} onSelectTask={onSelectTask} />
      </div>
    </Modal>
  );
}
