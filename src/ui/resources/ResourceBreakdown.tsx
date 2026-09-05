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
import { MeasureLabel } from '../components/CostMeasure';
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
   * Die Spalten sind in beiden Fällen dieselben drei Grössen in derselben
   * Reihenfolge: erst der Rahmen, dann die Absicht, dann das Abgeflossene.
   * Bei Personen heissen sie "verfügbar" und "gebunden", bei Geld "genehmigt",
   * "geplant" und "ausgegeben" - die Zeichen davor sind überall dieselben.
   */
  const showCeiling = breakdown.rows.some((r) => r.resourceCeiling !== null);
  /** Spalten vor den Zahlen - für den Fuss. */
  const leadingColumns = showResource ? 2 : 1;

  if (breakdown.rows.length === 0) {
    return <div className="faint breakdown__empty">Keine Beiträge in diesem Zeitraum.</div>;
  }

  const amount = (value: number) => formatValue(value, breakdown.unit);

  /*
   * Der Rahmen gehört der Ressource, nicht der Aufgabe - er steht trotzdem in
   * **jeder** Zeile, damit sich jede für sich lesen und in einer
   * Tabellenkalkulation weiterverwenden lässt.
   *
   * Damit stimmt die Spalte nicht mit ihrer eigenen Summe überein: hat eine
   * Person zwei Aufgaben, steht ihre Kapazität zweimal da, zählt unten aber
   * einmal. Das ist Absicht und steht im Spaltenkopf.
   */
  const ceilingHint = isBudget
    ? 'Genehmigt für dieses Budget im Zeitraum. Steht in jeder Zeile; in der Summe zählt jedes Budget der Auswertung genau einmal - auch eines ohne Position.'
    : 'Verfügbare Kapazität dieser Person im Zeitraum. Steht in jeder Zeile; in der Summe zählt jede Person der Auswertung genau einmal - auch eine ohne Position.';

  return (
    <table className="table breakdown">
      <thead>
        <tr>
          {showResource && <th>Ressource</th>}
          <th>Aufgabe</th>
          {showCeiling && (
            <th className="table__num" title={ceilingHint}>
              <MeasureLabel measure="approved">{isBudget ? undefined : 'verfügbar'}</MeasureLabel>
            </th>
          )}
          <th className="table__num">
            <MeasureLabel measure="planned">{isBudget ? undefined : 'gebunden'}</MeasureLabel>
          </th>
          {isBudget && (
            <th className="table__num">
              <MeasureLabel measure="actual" />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {breakdown.rows.map((row) => (
            <tr
              key={`${row.resourceId}-${row.taskId}`}
              className={onSelectTask ? 'breakdown__row--clickable' : undefined}
              onClick={onSelectTask ? () => onSelectTask(row.taskId) : undefined}
              title={onSelectTask ? 'Aufgabe im Plan öffnen' : undefined}
            >
              {showResource && <td className="truncate">{row.resourceName}</td>}
              <td className="truncate">{taskLabel(row.taskId)}</td>
              {showCeiling && (
                <td className="table__num mono faint" title={ceilingHint}>
                  {row.resourceCeiling === null ? '∞' : amount(row.resourceCeiling)}
                </td>
              )}
              <td className="table__num mono">{amount(row.planned)}</td>
              {isBudget && <td className="table__num mono">{amount(row.actual)}</td>}
            </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={leadingColumns}>Summe</td>
          {/* Je Ressource einmal - nicht die Summe der Spalte darüber. */}
          {showCeiling && (
            <td className="table__num mono" title={ceilingHint}>
              {breakdown.ceiling === null ? '∞' : amount(breakdown.ceiling)}
            </td>
          )}
          <td className="table__num mono">{amount(breakdown.planned)}</td>
          {isBudget && <td className="table__num mono">{amount(breakdown.actual)}</td>}
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
  const showCeiling = breakdown.rows.some((r) => r.resourceCeiling !== null);
  const unit = breakdown.unit;
  const frame = (value: number | null | undefined) =>
    value === undefined ? '' : value === null ? 'unbegrenzt' : num(value);

  const head = [
    ...(showResource ? ['Ressource'] : []),
    'Aufgabe',
    ...(showCeiling ? [`${isBudget ? 'Genehmigt' : 'Verfuegbar'} (${unit})`] : []),
    `${isBudget ? 'Geplant' : 'Gebunden'} (${unit})`,
    ...(isBudget ? [`Ausgegeben (${unit})`] : []),
  ];

  /*
   * Beim Kopieren steht der Rahmen in **jeder** Zeile, nicht nur in der ersten
   * je Ressource: in einer Tabellenkalkulation wird gefiltert und sortiert, und
   * eine leere Zelle waere dort schlicht ein fehlender Wert.
   */
  const lines = [
    `${breakdown.label}\t${formatDateDe(breakdown.from)} - ${formatDateDe(breakdown.to)}`,
    '',
    head.join('\t'),
    ...breakdown.rows.map((row) =>
      [
        ...(showResource ? [row.resourceName] : []),
        taskLabel(row.taskId),
        ...(showCeiling ? [frame(row.resourceCeiling)] : []),
        num(row.planned),
        ...(isBudget ? [num(row.actual)] : []),
      ].join('\t'),
    ),
    [
      ...(showResource ? [''] : []),
      'Summe',
      ...(showCeiling ? [frame(breakdown.ceiling)] : []),
      num(breakdown.planned),
      ...(isBudget ? [num(breakdown.actual)] : []),
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
            {formatDateDe(breakdown.from)} - {formatDateDe(breakdown.to)} · {breakdown.rows.length} {breakdown.rows.length === 1 ? 'Position' : 'Positionen'}
          </span>
          <span className="spacer" />
          <BreakdownCopyButton breakdown={breakdown} taskLabel={taskLabel} />
        </div>
        <BreakdownTable breakdown={breakdown} taskLabel={taskLabel} onSelectTask={onSelectTask} />
      </div>
    </Modal>
  );
}
