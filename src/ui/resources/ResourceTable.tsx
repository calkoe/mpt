/**
 * Tabellenansicht der Ganglinien. Pro Ressource und pro Kalenderjahr werden
 * zusätzlich Summen gebildet (bei FTE der Mittelwert, da eine Summe von
 * Anteilen fachlich nichts aussagt).
 */
import { formatValue, type ResourceSeries } from '../../engine/resources';

export function ResourceTable({ series }: { series: ResourceSeries[] }) {
  if (series.length === 0) {
    return <div className="empty">Keine Ressourcen in dieser Auswahl.</div>;
  }

  const buckets = series[0].points.map((p) => p.bucket);
  const years = [...new Set(series.flatMap((s) => s.yearly.map((y) => y.year)))].sort((a, b) => a - b);

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Ressource</th>
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
                const breach = p.limit > 0 && p.value > p.limit + 1e-9;
                return (
                  <td key={p.bucket.key} className={breach ? 'table__breach' : undefined} title={breach ? `Grenzwert ${formatValue(p.limit, s.unit)} überschritten` : undefined}>
                    {p.value === 0 ? <span className="faint">–</span> : formatValue(p.value, s.unit)}
                  </td>
                );
              })}
              {years.map((year) => {
                const entry = s.yearly.find((y) => y.year === year);
                const breach = entry && entry.limit > 0 && entry.value > entry.limit + 1e-9;
                return (
                  <td
                    key={`y${year}`}
                    style={{ borderLeft: '2px solid var(--border-strong)', fontWeight: 600 }}
                    className={breach ? 'table__breach' : undefined}
                  >
                    {entry ? formatValue(entry.value, s.unit) : '–'}
                  </td>
                );
              })}
              <td style={{ borderLeft: '2px solid var(--border-strong)', fontWeight: 650 }}>
                {formatValue(s.total, s.unit)}
              </td>
            </tr>
          ))}

          {/* Gesamtzeile über alle gezeigten Ressourcen (nur bei gleicher Einheit sinnvoll) */}
          {series.length > 1 && series.every((s) => s.unit === series[0].unit) && (
            <tr className="table__sum">
              <td>Summe</td>
              {buckets.map((b, index) => (
                <td key={b.key}>{formatValue(series.reduce((sum, s) => sum + (s.points[index]?.value ?? 0), 0), series[0].unit)}</td>
              ))}
              {years.map((year) => (
                <td key={`y${year}`} style={{ borderLeft: '2px solid var(--border-strong)' }}>
                  {formatValue(
                    series.reduce((sum, s) => sum + (s.yearly.find((y) => y.year === year)?.value ?? 0), 0),
                    series[0].unit,
                  )}
                </td>
              ))}
              <td style={{ borderLeft: '2px solid var(--border-strong)' }}>
                {formatValue(series.reduce((sum, s) => sum + s.total, 0), series[0].unit)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
