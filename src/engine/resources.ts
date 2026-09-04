/**
 * Ressourcen-Ganglinien.
 *
 * Grundidee: jede Aufgabe erzeugt eine Tageslast auf ihren Ressourcen.
 *  - Personen: 1 FTE == 1 Personentag pro Arbeitstag.
 *      FTE-Zuordnung -> value je Arbeitstag der Laufzeit.
 *      PT-Zuordnung  -> value / Arbeitstage der Laufzeit je Arbeitstag.
 *  - Budgets: Einmalkosten am Starttag, wiederkehrende Kosten alle
 *      `every * interval` ab Starttag, solange die Aufgabe läuft.
 *
 * Die Tageswerte werden anschließend in Buckets (Tag/Woche/Monat/Quartal/Jahr)
 * aggregiert: FTE als Mittelwert über die Arbeitstage des Buckets, PT und Euro
 * als Summe.
 */
import type { Budget, Client, CostItem, Id, IsoDate, Person, Task } from '../model/types';
import {
  addDays,
  buildBuckets,
  diffDays,
  isWorkday,
  toDate,
  toIso,
  workdaysIn,
  yearOf,
  type Bucket,
  type Granularity,
} from './dates';
import type { ScheduleResult } from './schedule';

export type PersonUnit = 'FTE' | 'PT';

export interface ResourceFilter {
  /** Nur Aufgaben mit mindestens einem dieser Tags; leer = alle. */
  tagIds: Id[];
  /** Nur Aufgaben dieser Vorhaben; leer = alle. */
  ventureIds: Id[];
}

export const EMPTY_FILTER: ResourceFilter = { tagIds: [], ventureIds: [] };

export function taskMatchesFilter(task: Task, filter: ResourceFilter): boolean {
  if (filter.tagIds.length > 0 && !task.tagIds.some((t) => filter.tagIds.includes(t))) return false;
  if (filter.ventureIds.length > 0 && !filter.ventureIds.includes(task.ventureId)) return false;
  return true;
}

/** Beitrag einer einzelnen Aufgabe zu einer Ressource an einem Tag. */
export interface Contribution {
  taskId: Id;
  value: number;
  /**
   * Nur bei Budgets belegt: der tatsächlich abgerufene Anteil. `value` ist
   * immer der geplante Betrag, damit alle bestehenden Auswertungen unverändert
   * die Planung zeigen.
   */
  actual?: number;
}

export interface SeriesPoint {
  bucket: Bucket;
  /** Aggregierter Gesamtwert im Bucket. */
  value: number;
  /** Grenzwert im Bucket (0 = keiner definiert). */
  limit: number;
  /** Anteile je Aufgabe, absteigend sortiert. */
  parts: Contribution[];
  /**
   * Laufende Summe vom Beginn des Zeitraums bis einschliesslich dieses
   * Buckets. Bei Budgets in Euro, bei Personen in Personentagen - FTE ist eine
   * Rate und liesse sich nicht sinnvoll aufsummieren. Die Linie steigt
   * monoton; ihre Steigung zeigt den Bedarf je Zeiteinheit.
   */
  cumulative: number;
  /** Nur bei Budgets: tatsächlich abgerufener Betrag im Bucket. */
  actual: number;
  /** Nur bei Budgets: laufende Summe der Abrufe. */
  cumulativeActual: number;
}

export interface ResourceSeries {
  resourceId: Id;
  name: string;
  kind: 'person' | 'budget';
  unit: PersonUnit | 'EUR';
  points: SeriesPoint[];
  /** Summe (PT/EUR) bzw. Mittelwert (FTE) über alle Buckets. */
  total: number;
  /** Höchster Bucket-Wert - für die Skalierung der Diagramme. */
  peak: number;
  /** Kalenderjahressummen (bei FTE: Mittelwert über die Arbeitstage des Jahres). */
  yearly: { year: number; value: number; limit: number }[];
  /** Buckets mit Grenzwertüberschreitung. */
  breaches: string[];
  /** Endwert der kumulierten Linie - Gesamtmenge über den Zeitraum. */
  cumulativeTotal: number;
}

// ---------------------------------------------------------------------------
// Tageslasten
// ---------------------------------------------------------------------------

/** Tageslast je Person: Map personId -> Map isoDate -> Contribution[] */
export function personDailyLoad(
  client: Client,
  schedule: ScheduleResult,
  filter: ResourceFilter,
): Map<Id, Map<IsoDate, Contribution[]>> {
  const result = new Map<Id, Map<IsoDate, Contribution[]>>();
  for (const person of client.people) result.set(person.id, new Map());

  for (const task of client.tasks) {
    if (!taskMatchesFilter(task, filter)) continue;
    const st = schedule.byId.get(task.id);
    if (!st || st.cyclic) continue;
    const days = workdaysIn(st.start, st.end);
    if (days.length === 0) continue;

    for (const a of task.assignments) {
      const target = result.get(a.personId);
      if (!target) continue;

      /*
       * Der Bedarf je Tag: der Grundwert, sofern kein Zeitraum greift.
       * Zeiträume ausserhalb der Aufgabenlaufzeit haben keine Wirkung - es
       * werden ohnehin nur die Arbeitstage der Aufgabe durchlaufen, der
       * Zuschnitt geschieht also von selbst. Gemeldet wird das in
       * `validate.ts`.
       */
      const rateAt = (day: IsoDate) =>
        a.periods.length > 0 ? periodValueAt(a.periods, day, a.value) : a.value;

      if (a.mode === 'FTE') {
        for (const day of days) {
          const perDay = rateAt(day);
          if (!Number.isFinite(perDay) || perDay === 0) continue;
          const list = target.get(day) ?? [];
          list.push({ taskId: task.id, value: perDay });
          target.set(day, list);
        }
        continue;
      }

      /*
       * Personentage sind eine Gesamtmenge, keine Rate. Mit Zeiträumen wird
       * die Summe je Zeitraum auf dessen Tage verteilt; ohne Zeiträume wie
       * bisher gleichmässig über die ganze Laufzeit.
       */
      if (a.periods.length === 0) {
        const perDay = a.value / days.length;
        if (!Number.isFinite(perDay) || perDay === 0) continue;
        for (const day of days) {
          const list = target.get(day) ?? [];
          list.push({ taskId: task.id, value: perDay });
          target.set(day, list);
        }
        continue;
      }

      for (const period of a.periods) {
        const inPeriod = days.filter(
          (d) => (!period.from || diffDays(period.from, d) >= 0) && (!period.to || diffDays(d, period.to) >= 0),
        );
        const perDay = period.value / Math.max(1, inPeriod.length);
        if (inPeriod.length === 0 || !Number.isFinite(perDay) || perDay === 0) continue;
        for (const day of inPeriod) {
          const list = target.get(day) ?? [];
          list.push({ taskId: task.id, value: perDay });
          target.set(day, list);
        }
      }
    }
  }
  return result;
}

/** Nächster Fälligkeitstag einer wiederkehrenden Kostenposition. */
function advance(iso: IsoDate, cost: CostItem): IsoDate {
  const every = Math.max(1, Math.round(cost.every || 1));
  const d = toDate(iso);
  switch (cost.interval) {
    case 'day':
      return addDays(iso, every);
    case 'week':
      return addDays(iso, 7 * every);
    case 'month':
      return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + every, d.getUTCDate())));
    case 'quarter':
      return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * every, d.getUTCDate())));
    case 'year':
      return toIso(new Date(Date.UTC(d.getUTCFullYear() + every, d.getUTCMonth(), d.getUTCDate())));
  }
}

/** Tageslast je Budget: Map budgetId -> Map isoDate -> Contribution[] */
export function budgetDailyLoad(
  client: Client,
  schedule: ScheduleResult,
  filter: ResourceFilter,
): Map<Id, Map<IsoDate, Contribution[]>> {
  const result = new Map<Id, Map<IsoDate, Contribution[]>>();
  for (const b of client.budgets) result.set(b.id, new Map());

  for (const task of client.tasks) {
    if (!taskMatchesFilter(task, filter)) continue;
    const st = schedule.byId.get(task.id);
    if (!st || st.cyclic) continue;

    for (const cost of task.costs) {
      const target = result.get(cost.budgetId);
      if (!target || !Number.isFinite(cost.amount) || cost.amount === 0) continue;

      const push = (day: IsoDate) => {
        const list = target.get(day) ?? [];
        list.push({ taskId: task.id, value: cost.amount, actual: cost.actualAmount });
        target.set(day, list);
      };

      if (!cost.recurring) {
        push(st.start);
        continue;
      }
      let cursor = st.start;
      let guard = 0;
      while (diffDays(cursor, st.end) >= 0 && guard++ < 5000) {
        push(cursor);
        const next = advance(cursor, cost);
        if (diffDays(cursor, next) <= 0) break;
        cursor = next;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Grenzwerte
// ---------------------------------------------------------------------------

/** Zeitraumabhängiger Wert an einem Tag; `fallback`, wenn kein Eintrag greift. */
export function periodValueAt(entries: { from?: IsoDate; to?: IsoDate; value: number }[], day: IsoDate, fallback: number): number {
  for (const e of entries) {
    const afterStart = !e.from || diffDays(e.from, day) >= 0;
    const beforeEnd = !e.to || diffDays(day, e.to) >= 0;
    if (afterStart && beforeEnd) return e.value;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregateBucket(
  daily: Map<IsoDate, Contribution[]>,
  bucket: Bucket,
  mode: 'sum' | 'workdayAverage',
): { value: number; parts: Contribution[]; rawSum: number; actual: number; workdays: number } {
  const parts = new Map<Id, number>();
  let sum = 0;
  let actual = 0;
  let workdays = 0;
  let cur = bucket.start;
  while (diffDays(cur, bucket.end) >= 0) {
    if (isWorkday(cur)) workdays++;
    for (const c of daily.get(cur) ?? []) {
      sum += c.value;
      actual += c.actual ?? 0;
      parts.set(c.taskId, (parts.get(c.taskId) ?? 0) + c.value);
    }
    cur = addDays(cur, 1);
  }
  const divisor = mode === 'workdayAverage' ? Math.max(1, workdays) : 1;
  const list = [...parts.entries()]
    .map(([taskId, value]) => ({ taskId, value: value / divisor }))
    .sort((a, b) => b.value - a.value);
  // `rawSum` ist die ungeteilte Summe - genau die wird kumuliert, damit auch
  // bei FTE eine sinnvolle Groesse (Personentage) entsteht.
  return { value: sum / divisor, parts: list, rawSum: sum, actual, workdays };
}

export interface SeriesOptions {
  from: IsoDate;
  to: IsoDate;
  granularity: Granularity;
  /** Nur für Personen: FTE (Mittelwert) oder PT (Summe). */
  personUnit: PersonUnit;
}

export function personSeries(
  person: Person,
  daily: Map<IsoDate, Contribution[]>,
  options: SeriesOptions,
): ResourceSeries {
  const buckets = buildBuckets(options.from, options.to, options.granularity);
  const mode = options.personUnit === 'FTE' ? 'workdayAverage' : 'sum';
  let running = 0;
  const points: SeriesPoint[] = buckets.map((bucket) => {
    const { value, parts, rawSum } = aggregateBucket(daily, bucket, mode);
    // Grenzwert: verfügbare FTE (bei PT auf Personentage im Bucket hochgerechnet).
    const fte = periodValueAt(person.availability, bucket.start, person.defaultFte);
    const workdays = workdaysIn(bucket.start, bucket.end).length;
    const limit = options.personUnit === 'FTE' ? fte : fte * workdays;
    // Kumuliert wird immer in Personentagen - die ungeteilte Tagessumme.
    running += rawSum;
    return { bucket, value, limit, parts, cumulative: running, actual: 0, cumulativeActual: 0 };
  });

  return finalize(person.id, person.name, 'person', options.personUnit, points, mode, daily, (day) =>
    periodValueAt(person.availability, day, person.defaultFte),
  );
}

export function budgetSeries(budget: Budget, daily: Map<IsoDate, Contribution[]>, options: SeriesOptions): ResourceSeries {
  const buckets = buildBuckets(options.from, options.to, options.granularity);
  let running = 0;
  let runningActual = 0;
  const points: SeriesPoint[] = buckets.map((bucket) => {
    const { value, parts, actual } = aggregateBucket(daily, bucket, 'sum');
    const limit = periodValueAt(budget.limits, bucket.start, 0);
    running += value;
    runningActual += actual;
    return { bucket, value, limit, parts, cumulative: running, actual, cumulativeActual: runningActual };
  });

  return finalize(budget.id, budget.name, 'budget', 'EUR', points, 'sum', daily, (day) =>
    periodValueAt(budget.limits, day, 0),
  );
}

function finalize(
  id: Id,
  name: string,
  kind: 'person' | 'budget',
  unit: PersonUnit | 'EUR',
  points: SeriesPoint[],
  mode: 'sum' | 'workdayAverage',
  daily: Map<IsoDate, Contribution[]>,
  limitAt: (day: IsoDate) => number,
): ResourceSeries {
  const peak = points.reduce((m, p) => Math.max(m, p.value, p.limit), 0);

  // Bei FTE wird nur über Zeiträume mit tatsächlicher Last gemittelt. Sonst
  // würde der lange Horizont für Dauerläufer (zehn Jahre) den Mittelwert
  // gegen null ziehen und nichts mehr aussagen.
  const active = points.filter((p) => p.value > 1e-9);
  const total =
    mode === 'sum'
      ? points.reduce((s, p) => s + p.value, 0)
      : active.length > 0
        ? active.reduce((s, p) => s + p.value, 0) / active.length
        : 0;

  // Kalenderjahressummen direkt aus den Tageswerten - unabhängig vom Raster.
  const yearBuckets = new Map<number, { sum: number; workdays: number }>();
  for (const p of points) {
    let cur = p.bucket.start;
    while (diffDays(cur, p.bucket.end) >= 0) {
      const y = yearOf(cur);
      const entry = yearBuckets.get(y) ?? { sum: 0, workdays: 0 };
      if (isWorkday(cur)) entry.workdays++;
      for (const c of daily.get(cur) ?? []) entry.sum += c.value;
      yearBuckets.set(y, entry);
      cur = addDays(cur, 1);
    }
  }
  const yearly = [...yearBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => ({
      year,
      value: mode === 'workdayAverage' ? e.sum / Math.max(1, e.workdays) : e.sum,
      limit: limitAt(`${year}-06-15`) * (mode === 'sum' && kind === 'person' ? e.workdays : 1),
    }));

  const breaches = points.filter((p) => p.limit > 0 && p.value > p.limit + 1e-9).map((p) => p.bucket.key);
  const cumulativeTotal = points.length > 0 ? points[points.length - 1].cumulative : 0;
  return { resourceId: id, name, kind, unit, points, total, peak, yearly, breaches, cumulativeTotal };
}

/** Formatierung für Anzeigezwecke. */
export function formatValue(value: number, unit: PersonUnit | 'EUR'): string {
  if (unit === 'EUR') {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
  }
  if (unit === 'FTE') return `${value.toFixed(2)} FTE`;
  return `${value.toFixed(1)} PT`;
}
