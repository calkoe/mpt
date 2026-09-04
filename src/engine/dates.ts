/**
 * Datums- und Arbeitstags-Mathematik.
 *
 * Alle Daten sind reine Kalendertage (`YYYY-MM-DD`) ohne Zeitzone. Intern wird
 * mit UTC-Millisekunden gerechnet, damit Sommerzeit-Übergänge keine Rolle
 * spielen. Dauern zählen ausschließlich Arbeitstage (Mo-Fr); Feiertage werden
 * bewusst nicht berücksichtigt.
 */
import type { IsoDate } from '../model/types';

export const MS_PER_DAY = 86_400_000;

export function toDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function toIso(date: Date): IsoDate {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidIso(value: unknown): value is IsoDate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toDate(value).getTime());
}

export function today(): IsoDate {
  const now = new Date();
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIso(new Date(toDate(iso).getTime() + days * MS_PER_DAY));
}

/** Differenz in Kalendertagen (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_PER_DAY);
}

export function isWeekend(iso: IsoDate): boolean {
  const day = toDate(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkday(iso: IsoDate): boolean {
  return !isWeekend(iso);
}

/** Nächster Arbeitstag ab `iso` (inklusive). */
export function nextWorkday(iso: IsoDate): IsoDate {
  let cur = iso;
  while (isWeekend(cur)) cur = addDays(cur, 1);
  return cur;
}

/** Vorheriger Arbeitstag ab `iso` (inklusive). */
export function prevWorkday(iso: IsoDate): IsoDate {
  let cur = iso;
  while (isWeekend(cur)) cur = addDays(cur, -1);
  return cur;
}

/**
 * Endtag einer Aufgabe, die am `start` beginnt und `duration` Arbeitstage dauert.
 * Der Starttag zählt mit: duration = 1 => Ende === Start (auf Arbeitstag gerundet).
 */
export function addWorkdays(start: IsoDate, duration: number): IsoDate {
  const d = Math.max(1, Math.round(duration));
  let cur = nextWorkday(start);
  let remaining = d - 1;
  while (remaining > 0) {
    cur = addDays(cur, 1);
    if (isWorkday(cur)) remaining--;
  }
  return cur;
}

/** Anzahl Arbeitstage von `start` bis `end` (beide inklusive, mind. 1). */
export function workdaysBetween(start: IsoDate, end: IsoDate): number {
  if (diffDays(start, end) < 0) return 1;
  let count = 0;
  let cur = start;
  while (diffDays(cur, end) >= 0) {
    if (isWorkday(cur)) count++;
    cur = addDays(cur, 1);
  }
  return Math.max(1, count);
}

/** Liste aller Arbeitstage im Intervall [start, end]. */
export function workdaysIn(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let cur = start;
  while (diffDays(cur, end) >= 0) {
    if (isWorkday(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function minDate(a: IsoDate | undefined, b: IsoDate | undefined): IsoDate | undefined {
  if (!a) return b;
  if (!b) return a;
  return diffDays(a, b) < 0 ? b : a;
}

export function maxDate(a: IsoDate | undefined, b: IsoDate | undefined): IsoDate | undefined {
  if (!a) return b;
  if (!b) return a;
  return diffDays(a, b) > 0 ? b : a;
}

export function clampDate(iso: IsoDate, from: IsoDate, to: IsoDate): IsoDate {
  if (diffDays(from, iso) < 0) return from;
  if (diffDays(iso, to) < 0) return to;
  return iso;
}

// ---------------------------------------------------------------------------
// Zeitraster (Buckets) für Gantt, Ganglinien und Tabellen
// ---------------------------------------------------------------------------

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Zeitraster, die in der Oberflaeche angeboten werden.
 *
 * `day` bleibt im Typ - die Buckets werden intern weiterhin tageweise gebildet
 * und Bestandsdateien koennen den Wert enthalten. Als Auswahl taugt es nicht:
 * ueber einen Projektzeitraum von Monaten oder Jahren entstehen hunderte
 * Saeulen, die nichts mehr zeigen.
 */
export const SELECTABLE_GRANULARITIES: Granularity[] = ['week', 'month', 'quarter', 'year'];

/**
 * Passendes Zeitraster fuer eine Zeitspanne: so gewaehlt, dass das Ganze in
 * eine ueberschaubare Zahl von Saeulen faellt und die volle Breite ausfuellt.
 */
export function fittingGranularity(from: IsoDate, to: IsoDate): Granularity {
  const days = Math.max(1, diffDays(from, to));
  if (days <= 120) return 'week';
  if (days <= 800) return 'month';
  if (days <= 2600) return 'quarter';
  return 'year';
}

export const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: 'Tag',
  week: 'Woche',
  month: 'Monat',
  quarter: 'Quartal',
  year: 'Jahr',
};

export interface Bucket {
  key: string;
  label: string;
  start: IsoDate;
  end: IsoDate;
}

/** Montag der Kalenderwoche, in der `iso` liegt. */
export function startOfWeek(iso: IsoDate): IsoDate {
  const day = toDate(iso).getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(iso, delta);
}

export function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: IsoDate): IsoDate {
  const d = toDate(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function startOfQuarter(iso: IsoDate): IsoDate {
  const d = toDate(iso);
  const q = Math.floor(d.getUTCMonth() / 3) * 3;
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), q, 1)));
}

export function startOfYear(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 4)}-01-01`;
}

export function isoWeekNumber(iso: IsoDate): number {
  const d = toDate(iso);
  const target = new Date(d.getTime());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * MS_PER_DAY));
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Zerlegt [from, to] in Buckets der gewünschten Granularität. */
export function buildBuckets(from: IsoDate, to: IsoDate, granularity: Granularity): Bucket[] {
  const buckets: Bucket[] = [];
  if (diffDays(from, to) < 0) return buckets;

  let cursor: IsoDate;
  switch (granularity) {
    case 'day':
      cursor = from;
      break;
    case 'week':
      cursor = startOfWeek(from);
      break;
    case 'month':
      cursor = startOfMonth(from);
      break;
    case 'quarter':
      cursor = startOfQuarter(from);
      break;
    case 'year':
      cursor = startOfYear(from);
      break;
  }

  // Harte Obergrenze schützt vor absurden Zeiträumen (Tagesraster über Jahrzehnte).
  const LIMIT = 4000;
  while (diffDays(cursor, to) >= 0 && buckets.length < LIMIT) {
    const d = toDate(cursor);
    let end: IsoDate;
    let label: string;
    let key: string;

    switch (granularity) {
      case 'day':
        end = cursor;
        key = cursor;
        label = `${cursor.slice(8, 10)}.${cursor.slice(5, 7)}.`;
        break;
      case 'week':
        end = addDays(cursor, 6);
        key = `${cursor}`;
        label = `KW ${isoWeekNumber(cursor)}`;
        break;
      case 'month':
        end = endOfMonth(cursor);
        key = cursor.slice(0, 7);
        label = `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        break;
      case 'quarter': {
        const q = Math.floor(d.getUTCMonth() / 3);
        end = toIso(new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)));
        key = `${d.getUTCFullYear()}-Q${q + 1}`;
        label = `Q${q + 1} ${d.getUTCFullYear()}`;
        break;
      }
      case 'year':
        end = `${d.getUTCFullYear()}-12-31`;
        key = String(d.getUTCFullYear());
        label = String(d.getUTCFullYear());
        break;
    }

    buckets.push({ key, label, start: cursor, end });
    cursor = addDays(end, 1);
  }
  return buckets;
}

export function formatDateDe(iso: IsoDate | undefined): string {
  if (!iso || !isValidIso(iso)) return '-';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export function yearOf(iso: IsoDate): number {
  return Number(iso.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Dauer-Einheiten
// ---------------------------------------------------------------------------

/**
 * Eingabeeinheit für Dauern. Gespeichert wird immer in Arbeitstagen - die
 * Einheit ist reine Eingabehilfe und rechnet mit festen Faktoren um
 * (1 Woche = 5 AT, 1 Monat = 21 AT, 1 Jahr = 252 AT).
 */
export type DurationUnit = 'days' | 'weeks' | 'months' | 'years';

export const WORKDAYS_PER: Record<DurationUnit, number> = {
  days: 1,
  weeks: 5,
  months: 21,
  years: 252,
};

export const DURATION_UNIT_LABEL: Record<DurationUnit, string> = {
  days: 'AT',
  weeks: 'Wochen',
  months: 'Monate',
  years: 'Jahre',
};

/** Arbeitstage -> Anzeigewert in der gewählten Einheit. */
export function workdaysToUnit(workdays: number, unit: DurationUnit): number {
  const value = workdays / WORKDAYS_PER[unit];
  return Math.round(value * 100) / 100;
}

/** Anzeigewert -> Arbeitstage (mindestens 1). */
export function unitToWorkdays(value: number, unit: DurationUnit): number {
  return Math.max(1, Math.round(value * WORKDAYS_PER[unit]));
}

/** Sinnvolle Obergrenze des Sliders je Einheit. */
export function sliderMaxFor(unit: DurationUnit): number {
  switch (unit) {
    case 'days':
      return 250;
    case 'weeks':
      return 52;
    case 'months':
      return 36;
    case 'years':
      return 10;
  }
}

/** Schrittweite des Sliders je Einheit. */
export function sliderStepFor(unit: DurationUnit): number {
  return unit === 'days' ? 1 : 0.5;
}
