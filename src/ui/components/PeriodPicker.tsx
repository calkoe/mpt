/**
 * Zeitraumauswahl in Jahren, Quartalen und Monaten.
 *
 * Für Verfügbarkeiten, Budget-Obergrenzen, Ressourcenbedarfe und die
 * Aufgabentermine ist ein taggenaues Datum weder nötig noch hilfreich: geplant
 * wird in Monaten, Quartalen oder Jahren, und zwei Datumsfelder verlangen dafür
 * vier Eingaben statt einer. Dieser Wähler setzt `from`/`to` deshalb selbst auf
 * die passenden Kalendergrenzen - gespeichert werden weiterhin normale
 * ISO-Daten, das Datenmodell bleibt unverändert.
 */
import { useState } from 'react';
import type { IsoDate } from '../../model/types';
import { addDays, diffDays, isoWeekNumber, isoWeekStart, isoWeekYear, startOfWeek, weeksInIsoYear } from '../../engine/dates';
import { Segmented } from './controls';

/**
 * `custom` ist keine wählbare Stufe, sondern das Ergebnis beim Lesen: ein
 * Zeitraum, der auf keine Stufe passt (etwa "die nächsten sieben Tage"). Dann
 * ist keine Schaltfläche hervorgehoben - sonst behauptete der Wähler einen
 * Zustand, in dem er gar nicht ist.
 */
export type PeriodScale = 'total' | 'year' | 'quarter' | 'month' | 'week' | 'custom';

const MONTH_LABEL = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Erster und letzter Tag eines Quartals bzw. Jahres. */
export function periodBounds(year: number, quarter: number | null): { from: IsoDate; to: IsoDate } {
  if (quarter === null) return { from: `${year}-01-01`, to: `${year}-12-31` };
  return monthRangeBounds(year, (quarter - 1) * 3 + 1, 3);
}

/** Grenzen eines Bereichs von `length` Monaten ab `firstMonth` (1-basiert). */
function monthRangeBounds(year: number, firstMonth: number, length: number): { from: IsoDate; to: IsoDate } {
  const lastMonth = firstMonth + length - 1;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  return {
    from: `${year}-${String(firstMonth).padStart(2, '0')}-01`,
    to: `${year}-${String(lastMonth).padStart(2, '0')}-${lastDay}`,
  };
}

const DEFAULT_SCALES: PeriodScale[] = ['total', 'year', 'quarter', 'month', 'week'];

const SCALE_OPTION: Record<PeriodScale, { value: PeriodScale; label: string; title?: string }> = {
  total: { value: 'total', label: 'Gesamt', title: 'Über den gesamten Betrachtungszeitraum' },
  year: { value: 'year', label: 'Jahr', title: 'Gesamtes Jahr' },
  quarter: { value: 'quarter', label: 'Quartal' },
  month: { value: 'month', label: 'Monat' },
  week: { value: 'week', label: 'KW', title: 'Kalenderwoche (Montag bis Sonntag)' },
  custom: { value: 'custom', label: '' },
};

export interface Selection {
  year: number;
  scale: PeriodScale;
  /** Quartal 1-4, Monat 1-12 bzw. Kalenderwoche 1-53; bei `year` ohne Bedeutung. */
  index: number;
}

/**
 * Liest die Auswahl aus einem gespeicherten Zeitraum zurück.
 *
 * Die Länge entscheidet über die Stufe: ein ganzes Jahr, ein Quartal oder ein
 * Monat. Zeiträume, die auf keines davon passen (taggenau eingetragen), werden
 * als der Monat gelesen, in dem sie beginnen - der Wähler zeigt dann die
 * nächstliegende Stufe, ändert aber nichts, solange niemand ihn anfasst.
 */
function parsePeriod(from?: IsoDate, to?: IsoDate): Selection {
  const now = new Date().getUTCFullYear();
  if (!from) return { year: now, scale: 'year', index: 1 };

  const year = Number(from.slice(0, 4)) || now;
  const month = Number(from.slice(5, 7)) || 1;

  if (!to) return { year, scale: month === 1 ? 'year' : 'month', index: month };

  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  if (year === endYear && month === 1 && endMonth === 12) return { year, scale: 'year', index: 1 };
  if (year === endYear && month % 3 === 1 && endMonth === month + 2) {
    return { year, scale: 'quarter', index: Math.floor((month - 1) / 3) + 1 };
  }
  // Genau sieben Tage ab einem Montag: eine Kalenderwoche.
  if (diffDays(from, to) === 6 && startOfWeek(from) === from) {
    return { year: isoWeekYear(from), scale: 'week', index: isoWeekNumber(from) };
  }
  // Ein ganzer Monat - sonst passt der Zeitraum auf keine Stufe.
  const monthEnd = monthRangeBounds(year, month, 1).to;
  if (to === monthEnd && from.slice(8) === '01') return { year, scale: 'month', index: month };
  return { year, scale: 'custom', index: month };
}

/**
 * Auf welches Raster passt ein einzelner Zeitpunkt - **grösstmöglich zuerst**?
 *
 * Der 1. Januar ist auch ein Quartals- und ein Monatsanfang; genannt wird das
 * gröbste passende Raster, weil man in ihm gedacht hat, als man den Termin
 * gesetzt hat. Passt keines, ist das Datum taggenau gemeint und gehört in ein
 * Datumsfeld statt in eine Rasterauswahl.
 */
export function scaleOfStart(from?: IsoDate): PeriodScale {
  if (!from) return 'custom';
  const month = Number(from.slice(5, 7));
  const day = from.slice(8, 10);
  if (day === '01') {
    if (month === 1) return 'year';
    if (month === 4 || month === 7 || month === 10) return 'quarter';
    return 'month';
  }
  if (startOfWeek(from) === from) return 'week';
  return 'custom';
}

/** Passt der Zeitpunkt auf eine der Rasterstufen? */
export function fitsScale(from?: IsoDate): boolean {
  return scaleOfStart(from) !== 'custom';
}

/**
 * Auswahl aus einem einzelnen Zeitpunkt - der Index passend zur **gezeigten**
 * Stufe.
 *
 * Das ist der Unterschied zu `parsePeriod`: dort steht ohne Endtermin immer
 * die Monatszahl im Index. Bei der Stufe "KW" wurde daraus die Kalenderwoche
 * mit derselben Nummer - ein Septembertermin zeigte "KW 9".
 */
export function selectionOfStart(from: IsoDate | undefined, scale: PeriodScale): Selection {
  const now = new Date().getUTCFullYear();
  if (!from) return { year: now, scale, index: 1 };

  const year = Number(from.slice(0, 4)) || now;
  const month = Number(from.slice(5, 7)) || 1;

  if (scale === 'week') return { year: isoWeekYear(from), scale, index: isoWeekNumber(from) };
  if (scale === 'quarter') return { year, scale, index: Math.floor((month - 1) / 3) + 1 };
  if (scale === 'year' || scale === 'total') return { year, scale, index: 1 };
  return { year, scale, index: month };
}

/** Auswahlbereich: einige Jahre um das aktuelle herum plus das gesetzte Jahr. */
function yearOptions(selected: number): number[] {
  const now = new Date().getUTCFullYear();
  const years = new Set<number>([selected]);
  for (let y = now - 1; y <= now + 8; y++) years.add(y);
  return [...years].sort((a, b) => a - b);
}

export function boundsOf(selection: Selection): { from: IsoDate; to: IsoDate } {
  if (selection.scale === 'year' || selection.scale === 'total') return periodBounds(selection.year, null);
  if (selection.scale === 'quarter') return periodBounds(selection.year, selection.index);
  // `custom` erreicht diese Stelle nie - es entsteht nur beim Lesen.
  if (selection.scale === 'month' || selection.scale === 'custom') {
    return monthRangeBounds(selection.year, selection.index, 1);
  }
  const monday = isoWeekStart(selection.year, selection.index);
  return { from: monday, to: addDays(monday, 6) };
}

export function PeriodPicker({
  from,
  to,
  onChange,
  mode = 'range',
  total,
  scales,
  title,
}: {
  from?: IsoDate;
  to?: IsoDate;
  onChange: (from: IsoDate, to: IsoDate) => void;
  /** Erklärt, wofür der Zeitraum steht - liegt auf der ganzen Auswahl. */
  title?: string;
  /**
   * Bietet zusätzlich "Gesamt" an und liefert dafür diesen Bereich. Gedacht
   * für Summen, die wahlweise über einen Zeitraum oder über alles gehen.
   */
  total?: { from: IsoDate; to: IsoDate };
  /** Einschränkung der angebotenen Stufen; Standard sind alle. */
  scales?: PeriodScale[];
  /**
   * `range` wählt einen Zeitraum, `start` nur dessen Beginn. Im Start-Modus
   * gibt es kein Ende, aus dem sich die Stufe ablesen liesse - sie ist dort
   * eine reine Anzeigeentscheidung und wird deshalb hier gehalten.
   */
  mode?: 'range' | 'start';
}) {
  const parsed = parsePeriod(from, to);
  const isTotal = Boolean(total && from === total.from && to === total.to);
  /*
   * Im Start-Modus gibt es kein Ende, aus dem sich die Stufe ablesen liesse.
   * Ausgangspunkt ist deshalb das gröbste Raster, auf das der Zeitpunkt passt
   * - danach entscheidet der Nutzer. Beim Wechsel auf eine andere Aufgabe
   * setzt der Aufrufer die Komponente über `key` zurück.
   */
  const [startScale, setStartScale] = useState<PeriodScale>(() =>
    mode === 'start' ? scaleOfStart(from) : parsed.scale,
  );
  const selection: Selection = isTotal
    ? { ...parsed, scale: 'total' }
    : mode === 'start'
      ? selectionOfStart(from, startScale)
      : parsed;

  const apply = (patch: Partial<Selection>) => {
    if (patch.scale) setStartScale(patch.scale);
    const next = { ...selection, ...patch };
    if (next.scale === 'total' && total) {
      onChange(total.from, total.to);
      return;
    }

    /*
     * Beim Wechsel der Stufe bleibt der **Zeitpunkt** stehen, nur die Körnung
     * ändert sich. Denselben Weg geht `selectionOfStart` beim Anzeigen -
     * deshalb hier dieselbe Funktion und nicht dieselbe Rechnung ein zweites
     * Mal: als beides getrennt existierte, war der Umschaltpfad richtig und
     * der Anzeigepfad zeigte für einen Septembertermin "KW 9".
     */
    if (patch.scale && patch.index === undefined) {
      const derived = selectionOfStart(from ?? `${next.year}-01-01`, patch.scale);
      next.year = derived.year;
      next.index = derived.index;
    }

    const bounds = boundsOf(next);
    onChange(bounds.from, bounds.to);
  };

  return (
    <div className="period" title={title}>
      <select
        className="select period__year"
        value={selection.year}
        aria-label="Jahr"
        title="Jahr, in dem der gewählte Zeitraum liegt. Die Stufe daneben bestimmt, wie fein er darin geschnitten wird."
        disabled={selection.scale === 'total'}
        onChange={(e) => apply({ year: Number(e.target.value) })}
      >
        {yearOptions(selection.year).map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <Segmented<PeriodScale>
        ariaLabel="Stufe"
        title="Körnung der Auswahl. Der Zeitpunkt bleibt beim Wechsel stehen, nur der Zuschnitt ändert sich - aus einem Septembertermin wird der Monat September, das dritte Quartal oder das Jahr."
        value={selection.scale}
        onChange={(scale) => apply({ scale })}
        options={(scales ?? DEFAULT_SCALES).filter((sc) => sc !== 'total' || total).map((sc) => SCALE_OPTION[sc])}
      />

      {selection.scale === 'quarter' && (
        <Segmented<string>
          ariaLabel="Quartal"
          title="Quartal innerhalb des Jahres - drei Monate vom Ersten bis zum Letzten."
          value={String(selection.index)}
          onChange={(value) => apply({ index: Number(value) })}
          options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `Q${q}` }))}
        />
      )}

      {selection.scale === 'month' && (
        <select
          className="select period__month"
          value={selection.index}
          aria-label="Monat"
          title="Monat innerhalb des Jahres. Der Zeitraum reicht vom Ersten bis zum Letzten dieses Monats."
          onChange={(e) => apply({ index: Number(e.target.value) })}
        >
          {MONTH_LABEL.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
      )}

      {selection.scale === 'week' && (
        <select
          className="select period__month"
          value={selection.index}
          aria-label="Kalenderwoche"
          title="Kalenderwoche nach ISO - sie beginnt am Montag und kann am Jahreswechsel zum Nachbarjahr gehören."
          onChange={(e) => apply({ index: Number(e.target.value) })}
        >
          {Array.from({ length: weeksInIsoYear(selection.year) }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              KW {w}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
