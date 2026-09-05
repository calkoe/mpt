/**
 * Tabellenansicht der Ganglinien. Pro Ressource und pro Kalenderjahr werden
 * zusätzlich Summen gebildet (bei FTE der Mittelwert, da eine Summe von
 * Anteilen fachlich nichts aussagt).
 *
 * Bei Geld gibt es drei Grössen, die nie verwechselt werden dürfen:
 * **genehmigt** (die Obergrenze), **geplant** (die Absicht) und **ausgegeben**
 * (was tatsächlich abgeflossen ist). Sie stehen nicht nebeneinander, sondern
 * werden umgeschaltet - drei Zahlen je Zelle wären in einer Tabelle über
 * dreissig Zeiträume nicht mehr lesbar.
 */
import { formatValue, type ResourceSeries } from '../../engine/resources';
import { utilisationState } from '../../engine/validate';
import { MeasureLabel, type CostMeasure } from '../components/CostMeasure';

export function ResourceTable({ series, measure }: { series: ResourceSeries[]; measure: CostMeasure }) {
  if (series.length === 0) {
    return <div className="empty">Keine Ressourcen in dieser Auswahl.</div>;
  }

  const buckets = series[0].points.map((p) => p.bucket);
  const years = [...new Set(series.flatMap((s) => s.yearly.map((y) => y.year)))].sort((a, b) => a - b);

  /**
   * Wert einer Zelle in der gewählten Grösse. Personen kennen nur eine Grösse -
   * eine "genehmigte" Personalkapazität ist die Verfügbarkeit, also der
   * Grenzwert, und Ausgaben gibt es dort nicht.
   */
  const valueOf = (s: ResourceSeries, point: ResourceSeries['points'][number]): number => {
    if (measure === 'approved') return point.limit;
    if (measure === 'actual') return s.kind === 'budget' ? point.actual : point.value;
    return point.value;
  };

  const totalOf = (s: ResourceSeries): number => {
    if (measure === 'approved') return s.kind === 'budget' ? s.ceiling : s.total;
    if (measure === 'actual') return s.kind === 'budget' ? s.cumulativeActualTotal : s.total;
    return s.total;
  };

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table className="table">
        <thead>
          <tr>
            <th>
              <span className="row">
                Ressource
                <MeasureLabel measure={measure} />
              </span>
            </th>
            {buckets.map((b) => (
              <th key={b.key}>{b.label}</th>
            ))}
            {years.map((y) => (
              <th key={`y${y}`} style={{ borderLeft: '2px solid var(--border-strong)' }}>
                Σ {y}
              </th>
            ))}
            <th style={{ borderLeft: '2px solid var(--border-strong)' }}>Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.resourceId}>
              <td title={s.kind === 'person' ? 'Person' : 'Budget'}>{s.name}</td>
              {s.points.map((p) => {
                // Gemessen wird immer am Ist - eine Planung reisst nichts.
                const state = utilisationState(s.kind === 'budget' ? p.actual : p.value, p.limit);
                const value = valueOf(s, p);
                return (
                  <td
                    key={p.bucket.key}
                    className={state === 'over' ? 'table__breach' : undefined}
                    title={state === 'over' ? `Grenzwert ${formatValue(p.limit, s.unit)} überschritten` : undefined}
                  >
                    {value === 0 ? <span className="faint">–</span> : formatValue(value, s.unit)}
                  </td>
                );
              })}
              {years.map((year) => {
                const entry = s.yearly.find((y) => y.year === year);
                if (!entry) {
                  return (
                    <td key={`y${year}`} style={{ borderLeft: '2px solid var(--border-strong)' }}>
                      –
                    </td>
                  );
                }
                const value = measure === 'approved' ? entry.limit : entry.value;
                return (
                  <td
                    key={`y${year}`}
                    style={{ borderLeft: '2px solid var(--border-strong)', fontWeight: 600 }}
                  >
                    {formatValue(value, s.unit)}
                  </td>
                );
              })}
              <td style={{ borderLeft: '2px solid var(--border-strong)', fontWeight: 650 }}>
                {formatValue(totalOf(s), s.unit)}
              </td>
            </tr>
          ))}

          {/* Gesamtzeile über alle gezeigten Ressourcen (nur bei gleicher Einheit sinnvoll) */}
          {series.length > 1 && series.every((s) => s.unit === series[0].unit) && (
            <tr className="table__sum">
              <td>Summe</td>
              {buckets.map((b, index) => (
                <td key={b.key}>
                  {formatValue(
                    series.reduce((sum, s) => sum + (s.points[index] ? valueOf(s, s.points[index]) : 0), 0),
                    series[0].unit,
                  )}
                </td>
              ))}
              {years.map((year) => (
                <td key={`y${year}`} style={{ borderLeft: '2px solid var(--border-strong)' }}>
                  {formatValue(
                    series.reduce((sum, s) => {
                      const entry = s.yearly.find((y) => y.year === year);
                      if (!entry) return sum;
                      return sum + (measure === 'approved' ? entry.limit : entry.value);
                    }, 0),
                    series[0].unit,
                  )}
                </td>
              ))}
              <td style={{ borderLeft: '2px solid var(--border-strong)' }}>
                {formatValue(
                  series.reduce((sum, s) => sum + totalOf(s), 0),
                  series[0].unit,
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
