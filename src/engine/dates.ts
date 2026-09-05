/**
 * Datums- und Arbeitstags-Mathematik.
 *
 * Alle Daten sind reine Kalendertage (`YYYY-MM-DD`) ohne Zeitzone. Intern wird
 * mit UTC gerechnet, damit Sommerzeit-Übergänge keine Rolle spielen. Dauern
 * zählen ausschließlich Arbeitstage (Mo-Fr); Feiertage werden bewusst nicht
 * berücksichtigt.
 *
 * **Gerechnet wird mit Tagesnummern, nicht mit Zeichenketten.** Eine
 * Tagesnummer ist der Abstand in Tagen zum 1.1.1970. Der Grund ist gemessen:
 * jedes `new Date('2026-01-01')` kostet Zeit, und die Auswertungen laufen über
 * Zeiträume von zehn Jahren und mehr - `diffDays` allein lag bei 0,41 µs je
 * Aufruf, eine Tagesschleife über den Anzeigehorizont bei 3,4 ms. Über die
 * Umrechnung liegt ein kleiner Zwischenspeicher, weil dieselben Datumswerte
 * beim Zeichnen immer wieder auftauchen.
 *
 * Nach aussen bleibt alles beim Alten: Parameter und Rückgaben sind ISO-Daten.
 * Wer selbst eine Tagesschleife braucht, nimmt `toDay`/`fromDay` und rechnet
 * dazwischen mit Zahlen.
 */
import type { DurationUnit, IsoDate } from '../model/types';

export const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Tagesnummern
// ---------------------------------------------------------------------------

/**
 * Zwischenspeicher in beide Richtungen. Beim Zeichnen eines Diagramms werden
 * dieselben Tage vielfach umgerechnet; ohne Speicher entsteht jedes Mal ein
 * `Date`. Die Obergrenze verhindert, dass der Speicher über eine lange Sitzung
 * unbegrenzt wächst - dreissig Jahre Kalendertage passen bequem hinein.
 */
const CACHE_LIMIT = 20_000;
const dayByIso = new Map<string, number>();
const isoByDay = new Map<number, IsoDate>();

/** ISO-Datum als Tagesnummer (Tage seit 1970-01-01, UTC). */
export function toDay(iso: IsoDate): number {
  const hit = dayByIso.get(iso);
  if (hit !== undefined) return hit;
  const [y, m, d] = iso.split('-').map(Number);
  const day = Math.round(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / MS_PER_DAY);
  if (dayByIso.size > CACHE_LIMIT) dayByIso.clear();
  dayByIso.set(iso, day);
  return day;
}

/** Tagesnummer zurück als ISO-Datum. */
export function fromDay(day: number): IsoDate {
  const hit = isoByDay.get(day);
  if (hit !== undefined) return hit;
  const date = new Date(day * MS_PER_DAY);
  const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
  if (isoByDay.size > CACHE_LIMIT) isoByDay.clear();
  isoByDay.set(day, iso);
  return iso;
}

/**
 * Wochentag einer Tagesnummer, 0 = Sonntag wie bei `Date.getUTCDay()`.
 * Der 1.1.1970 war ein Donnerstag, daher der Versatz von 4.
 */
export function weekdayOfDay(day: number): number {
  return ((day % 7) + 11) % 7;
}

export function isWorkdayNumber(day: number): boolean {
  const wd = weekdayOfDay(day);
  return wd !== 0 && wd !== 6;
}

/**
 * Anzahl Arbeitstage zwischen zwei Tagesnummern (beide inklusive) - ohne
 * Schleife. Ganze Wochen liefern je fünf Arbeitstage, der Rest wird einzeln
 * geprüft. Ersetzt Zählschleifen, die vorher über Jahre hinweg Tag für Tag
 * liefen.
 */
export function countWorkdaysBetweenDays(from: number, to: number): number {
  if (to < from) return 0;
  const total = to - from + 1;
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  for (let d = from + fullWeeks * 7; d <= to; d++) {
    if (isWorkdayNumber(d)) count++;
  }
  return count;
}

/** Anzahl Arbeitstage im Intervall [start, end], beide inklusive. */
export function countWorkdays(start: IsoDate, end: IsoDate): number {
  return countWorkdaysBetweenDays(toDay(start), toDay(end));
}

/**
 * Grenzen, innerhalb derer Datumsangaben verarbeitet werden.
 *
 * Ein Datum ausserhalb entsteht praktisch nur durch eine unfertige Eingabe -
 * beim Tippen von "2027" steht kurzzeitig das Jahr 2 im Feld. Ohne diese
 * Grenze rechnete die Engine anschliessend über zwei Jahrtausende und die
 * Oberfläche bliebe stehen.
 */
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2999;

/** Liegt das Datum in einem Bereich, mit dem sinnvoll gerechnet werden kann? */
export function isPlausibleIso(value: unknown): value is IsoDate {
  if (!isValidIso(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

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
  return fromDay(toDay(iso) + days);
}

/** Differenz in Kalendertagen (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toDay(b) - toDay(a);
}

export function isWeekend(iso: IsoDate): boolean {
  return !isWorkdayNumber(toDay(iso));
}

export function isWorkday(iso: IsoDate): boolean {
  return isWorkdayNumber(toDay(iso));
}

/** Nächster Arbeitstag ab `iso` (inklusive). */
export function nextWorkday(iso: IsoDate): IsoDate {
  let day = toDay(iso);
  while (!isWorkdayNumber(day)) day++;
  return fromDay(day);
}

/** Vorheriger Arbeitstag ab `iso` (inklusive). */
export function prevWorkday(iso: IsoDate): IsoDate {
  let day = toDay(iso);
  while (!isWorkdayNumber(day)) day--;
  return fromDay(day);
}

/**
 * Endtag einer Aufgabe, die am `start` beginnt und `duration` Arbeitstage dauert.
 * Der Starttag zählt mit: duration = 1 => Ende === Start (auf Arbeitstag gerundet).
 */
export function addWorkdays(start: IsoDate, duration: number): IsoDate {
  const d = Math.max(1, Math.round(duration));
  let day = toDay(start);
  while (!isWorkdayNumber(day)) day++;
  let remaining = d - 1;
  while (remaining > 0) {
    day++;
    if (isWorkdayNumber(day)) remaining--;
  }
  return fromDay(day);
}

/** Anzahl Arbeitstage von `start` bis `end` (beide inklusive, mind. 1). */
export function workdaysBetween(start: IsoDate, end: IsoDate): number {
  const from = toDay(start);
  const to = toDay(end);
  if (to < from) return 1;
  return Math.max(1, countWorkdaysBetweenDays(from, to));
}

/**
 * Liste aller Arbeitstage im Intervall [start, end].
 *
 * Wer nur die **Anzahl** braucht, nimmt `countWorkdays()` - das kommt ohne
 * Schleife und ohne Zeichenketten aus.
 */
export function workdaysIn(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const to = toDay(end);
  for (let day = toDay(start); day <= to; day++) {
    if (isWorkdayNumber(day)) out.push(fromDay(day));
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

/**
 * Kalenderjahr einer ISO-Woche. Am Jahreswechsel weicht es vom Kalenderjahr
 * des Datums ab: der 1. Januar kann noch zur letzten Woche des Vorjahres
 * gehören. Massgeblich ist der Donnerstag der Woche.
 */
export function isoWeekYear(iso: IsoDate): number {
  const thursday = addDays(startOfWeek(iso), 3);
  return yearOf(thursday);
}

/** Montag der `week`-ten Kalenderwoche des ISO-Jahres `year`. */
export function isoWeekStart(year: number, week: number): IsoDate {
  // Die Woche mit dem 4. Januar ist immer die erste des Jahres.
  const first = startOfWeek(`${year}-01-04`);
  return addDays(first, (Math.max(1, week) - 1) * 7);
}

/** 52 oder 53 - der 28. Dezember liegt immer in der letzten Woche des Jahres. */
export function weeksInIsoYear(year: number): number {
  return isoWeekNumber(`${year}-12-28`);
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

/** Zeitstempel kurz und deutsch: "04.09.2026, 14:30". */
export function formatDateTimeDe(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function yearOf(iso: IsoDate): number {
  return Number(iso.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Dauern
// ---------------------------------------------------------------------------

/**
 * Ende eines Zeitraums, der am `start` beginnt und `amount` Einheiten dauert.
 * Der Starttag zählt mit.
 *
 * Arbeitstage zählen Mo-Fr. **Alle anderen Einheiten sind Kalenderzeit** und
 * werden bewusst nicht in Arbeitstage umgerechnet: eine Aufgabe über fünf
 * Jahre, die am 01.01. beginnt, endet am 31.12. des fünften Jahres. Rechnete
 * man sie in 252 Arbeitstage je Jahr um, endete sie fast anderthalb Jahre zu
 * früh - und niemand meint das, wenn er "fünf Jahre" sagt.
 */
export function addDuration(start: IsoDate, amount: number, unit: DurationUnit): IsoDate {
  const n = Math.max(1, Math.round(amount));
  if (unit === 'days') return addWorkdays(start, n);
  const d = toDate(start);
  const after = (() => {
    switch (unit) {
      case 'weeks':
        return new Date(d.getTime() + n * 7 * MS_PER_DAY);
      case 'months':
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
      case 'quarters':
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, d.getUTCDate()));
      case 'years':
        return new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
    }
  })();
  // Der Tag vor dem gleichen Kalendertag der Folgeperiode - so ist der Zeitraum
  // an beiden Enden geschlossen (01.01. + 1 Jahr => 31.12.).
  return addDays(toIso(after), -1);
}

/** Umkehrung von `addDuration`: Beginn eines Zeitraums, der am `end` endet. */
export function subDuration(end: IsoDate, amount: number, unit: DurationUnit): IsoDate {
  const n = Math.max(1, Math.round(amount));
  if (unit === 'days') return shiftWorkdaysBack(end, n);
  const d = toDate(addDays(end, 1));
  const before = (() => {
    switch (unit) {
      case 'weeks':
        return new Date(d.getTime() - n * 7 * MS_PER_DAY);
      case 'months':
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate()));
      case 'quarters':
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3 * n, d.getUTCDate()));
      case 'years':
        return new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate()));
    }
  })();
  return toIso(before);
}

/** Startdatum, sodass [start, end] genau `duration` Arbeitstage umfasst. */
export function shiftWorkdaysBack(end: IsoDate, duration: number): IsoDate {
  let cur = end;
  let remaining = Math.max(1, Math.round(duration)) - 1;
  while (remaining > 0) {
    cur = addDays(cur, -1);
    if (isWorkday(cur)) remaining--;
  }
  return cur;
}

/** Sinnvolle Obergrenze des Reglers je Einheit. */
export function sliderMaxFor(unit: DurationUnit): number {
  switch (unit) {
    case 'days':
      return 250;
    case 'weeks':
      return 52;
    case 'months':
      return 36;
    case 'quarters':
      return 20;
    case 'years':
      return 10;
  }
}

/**
 * Grenzen eines Kalenderrasters um einen Tag herum. Wird für das Einrasten im
 * Gantt und für die Prüfung wiederkehrender Kosten gebraucht.
 */
export function periodStartOf(iso: IsoDate, granularity: Granularity): IsoDate {
  switch (granularity) {
    case 'day':
      return iso;
    case 'week':
      return startOfWeek(iso);
    case 'month':
      return startOfMonth(iso);
    case 'quarter':
      return startOfQuarter(iso);
    case 'year':
      return startOfYear(iso);
  }
}

/** Letzter Tag des Rasters, in dem `iso` liegt. */
export function periodEndOf(iso: IsoDate, granularity: Granularity): IsoDate {
  switch (granularity) {
    case 'day':
      return iso;
    case 'week':
      return addDays(startOfWeek(iso), 6);
    case 'month':
      return endOfMonth(iso);
    case 'quarter': {
      const q = toDate(startOfQuarter(iso));
      return toIso(new Date(Date.UTC(q.getUTCFullYear(), q.getUTCMonth() + 3, 0)));
    }
    case 'year':
      return `${iso.slice(0, 4)}-12-31`;
  }
}
