/**
 * Die drei Geldgrössen und ihre Zeichen.
 *
 * **genehmigt** (▢ der Rahmen), **geplant** (○ eine Absicht) und **ausgegeben**
 * (● tatsächlich geflossen) stehen an einem Dutzend Stellen nebeneinander. Drei
 * Zahlen ohne Beschriftung sind nicht unterscheidbar, drei ausgeschriebene
 * Wörter sprengen jede Zeile - deshalb je ein festes Zeichen, gezeichnet als
 * SVG, damit es überall gleich aussieht und den PNG-Export übersteht.
 *
 * **Neue Stellen, die Geld zeigen, benutzen diese Zeichen.**
 */
import type { ReactNode } from 'react';
import type { CostMeasure } from '../../state/preferences';
import { formatValue } from '../../engine/resources';
import { utilisationState } from '../../engine/validate';

export type { CostMeasure };

export const COST_MEASURES: CostMeasure[] = ['approved', 'planned', 'actual'];

export const MEASURE_LABEL: Record<CostMeasure, string> = {
  approved: 'genehmigt',
  planned: 'geplant',
  actual: 'ausgegeben',
};

export const MEASURE_HINT: Record<CostMeasure, string> = {
  approved: 'genehmigt - Obergrenze aus Basiswert und Zeiträumen',
  planned: 'geplant - was vorgesehen ist',
  actual: 'ausgegeben - was tatsächlich abgeflossen ist',
};

/** Das Zeichen allein - für Beschriftungen und Tabellenköpfe. */
export function MeasureMark({ measure }: { measure: CostMeasure }) {
  return (
    <svg className="measure__mark" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      {measure === 'approved' && <rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      {measure === 'planned' && <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      {measure === 'actual' && <circle cx="5" cy="5" r="4" fill="currentColor" />}
    </svg>
  );
}

/**
 * Ein Betrag mit seinem Zeichen. `value === null` heisst "keine Obergrenze
 * gepflegt" und wird als Unendlichzeichen gezeigt - eine 0 stünde dort für
 * "nichts genehmigt" und wäre das Gegenteil der Wahrheit.
 */
export function MeasureAmount({
  measure,
  value,
  suffix,
}: {
  measure: CostMeasure;
  value: number | null;
  /** Abweichende Einheit; Standard ist Euro. */
  suffix?: 'FTE' | 'PT' | 'EUR';
}) {
  return (
    <span className={`measure measure--${measure}`} title={MEASURE_HINT[measure]}>
      <MeasureMark measure={measure} />
      <span className="mono">{value === null ? '∞' : formatValue(value, suffix ?? 'EUR')}</span>
    </span>
  );
}

/** Beschriftung mit Zeichen - für Feldbezeichner und Tabellenköpfe. */
export function MeasureLabel({ measure, children }: { measure: CostMeasure; children?: ReactNode }) {
  return (
    <span className={`measure measure--${measure}`} title={MEASURE_HINT[measure]}>
      <MeasureMark measure={measure} />
      {children ?? MEASURE_LABEL[measure]}
    </span>
  );
}

/**
 * Summe mehrerer Obergrenzen. **Ist auch nur eine unbegrenzt, ist die Summe
 * unbegrenzt** - sonst suggerierte ein sauber addierter Betrag eine Schranke,
 * die es gar nicht gibt.
 */
export interface Ceiling {
  /** Summe der gepflegten Obergrenzen. */
  sum: number;
  /** Mindestens ein Budget ohne Obergrenze. */
  unlimited: boolean;
}

export const EMPTY_CEILING: Ceiling = { sum: 0, unlimited: false };

export function addCeiling(total: Ceiling, ceiling: number): Ceiling {
  return ceiling > 0
    ? { sum: total.sum + ceiling, unlimited: total.unlimited }
    : { sum: total.sum, unlimited: true };
}

/** Anzeigewert einer Obergrenzensumme: `null`, sobald etwas unbegrenzt ist. */
export function ceilingValue(ceiling: Ceiling): number | null {
  return ceiling.unlimited ? null : ceiling.sum;
}

/**
 * Waagerechter Auslastungsbalken: geplant blass, ausgegeben kräftig, beides
 * gemessen am genehmigten Rahmen. Dieselbe Aussage wie im Kostendiagramm, nur
 * auf eine Zeile eingedampft - und dieselbe Farblogik: rot über der Grenze,
 * orange knapp darunter, blau genau auf der Grenze.
 *
 * Auch für Personen benutzbar: dort ist "genehmigt" die verfügbare Kapazität
 * und "geplant" die gebundene - deshalb die frei wählbare Einheit.
 */
export function UtilisationBar({
  planned,
  actual,
  ceiling,
  unit = 'EUR',
}: {
  planned: number;
  actual: number;
  ceiling: number;
  unit?: 'EUR' | 'PT' | 'FTE';
}) {
  const state = utilisationState(actual, ceiling);
  // Ohne Obergrenze gibt es keinen Bezug - dann skaliert der Balken auf die
  // Planung, damit der Ist-Anteil trotzdem ablesbar bleibt.
  const scale = Math.max(ceiling, planned, 1e-9);
  const percent = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;

  return (
    <div
      className={`ubar ubar--${state}`}
      title={
        `${MEASURE_LABEL.planned} ${formatValue(planned, unit)} · ${MEASURE_LABEL.actual} ${formatValue(actual, unit)}` +
        (ceiling > 0 ? ` · ${MEASURE_LABEL.approved} ${formatValue(ceiling, unit)}` : ' · keine Obergrenze')
      }
    >
      <div className="ubar__track">
        <div className="ubar__planned" style={{ width: percent(planned) }} />
        <div className="ubar__actual" style={{ width: percent(actual) }} />
      </div>
      <span className="ubar__label mono">
        {ceiling > 0 ? `${Math.round((actual / ceiling) * 100)} %` : formatValue(actual, unit)}
      </span>
    </div>
  );
}
