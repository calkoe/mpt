/**
 * Zeitraumauswahl in Quartalen und Jahren.
 *
 * Für Verfügbarkeiten, Budget-Obergrenzen und Ressourcenbedarfe ist ein
 * taggenaues Datum weder nötig noch hilfreich: geplant wird in Quartalen oder
 * Jahren, und zwei Datumsfelder verlangen dafür vier Eingaben statt einer.
 * Dieser Wähler setzt `from`/`to` deshalb selbst auf die passenden Kalender-
 * grenzen - gespeichert werden weiterhin normale ISO-Daten, das Datenmodell
 * bleibt unverändert.
 */
import type { IsoDate } from '../../model/types';
import { Segmented } from './controls';

export type PeriodScale = 'quarter' | 'year';

/** Erster und letzter Tag eines Quartals bzw. Jahres. */
export function periodBounds(year: number, quarter: number | null): { from: IsoDate; to: IsoDate } {
  if (quarter === null) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  return {
    from: `${year}-${String(firstMonth).padStart(2, '0')}-01`,
    to: `${year}-${String(lastMonth).padStart(2, '0')}-${lastDay}`,
  };
}

/** Liest Jahr und Quartal aus einem gespeicherten Zeitraum zurück. */
function parsePeriod(from?: IsoDate, to?: IsoDate): { year: number; quarter: number | null } {
  const now = new Date().getUTCFullYear();
  if (!from) return { year: now, quarter: null };
  const year = Number(from.slice(0, 4)) || now;
  const month = Number(from.slice(5, 7)) || 1;
  // Deckt der Zeitraum das ganze Jahr ab, ist es eine Jahresangabe.
  const wholeYear = !to || to.slice(0, 7) === `${year}-12`;
  if (wholeYear && month === 1) return { year, quarter: null };
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}

/** Auswahlbereich: einige Jahre um das aktuelle herum plus das gesetzte Jahr. */
function yearOptions(selected: number): number[] {
  const now = new Date().getUTCFullYear();
  const years = new Set<number>([selected]);
  for (let y = now - 1; y <= now + 8; y++) years.add(y);
  return [...years].sort((a, b) => a - b);
}

export function PeriodPicker({
  from,
  to,
  onChange,
}: {
  from?: IsoDate;
  to?: IsoDate;
  onChange: (from: IsoDate, to: IsoDate) => void;
}) {
  const { year, quarter } = parsePeriod(from, to);

  const apply = (nextYear: number, nextQuarter: number | null) => {
    const bounds = periodBounds(nextYear, nextQuarter);
    onChange(bounds.from, bounds.to);
  };

  return (
    <div className="period">
      <select
        className="select period__year"
        value={year}
        aria-label="Jahr"
        onChange={(e) => apply(Number(e.target.value), quarter)}
      >
        {yearOptions(year).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <Segmented<string>
        ariaLabel="Quartal"
        value={quarter === null ? 'all' : String(quarter)}
        onChange={(value) => apply(year, value === 'all' ? null : Number(value))}
        options={[
          { value: 'all', label: 'Jahr', title: 'Gesamtes Jahr' },
          { value: '1', label: 'Q1' },
          { value: '2', label: 'Q2' },
          { value: '3', label: 'Q3' },
          { value: '4', label: 'Q4' },
        ]}
      />
    </div>
  );
}
