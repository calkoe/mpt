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
import type { Budget, Client, CostInterval, CostItem, Id, IsoDate, PeriodValue, Person, Task } from '../model/types';
import {
  addDays,
  buildBuckets,
  countWorkdays,
  countWorkdaysBetweenDays,
  diffDays,
  fromDay,
  periodEndOf,
  periodStartOf,
  toDate,
  toDay,
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
  /**
   * Anteile je Aufgabe, absteigend sortiert. Bei Budgets trägt jeder Anteil
   * zusätzlich seinen abgerufenen Teil - die Diagramme zeichnen daraus den
   * dunkleren Balken im helleren.
   */
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
  /**
   * Buckets mit Grenzwertüberschreitung. Bei Budgets zählt dafür der
   * **abgerufene** Betrag - eine Planung überschreitet nichts, sie plant nur.
   */
  breaches: string[];
  /** Endwert der kumulierten Linie - Gesamtmenge über den Zeitraum. */
  cumulativeTotal: number;
  /** Nur bei Budgets: Endwert der kumulierten Abrufe. */
  cumulativeActualTotal: number;
  /**
   * Nur bei Budgets: der über den Zeitraum insgesamt zulässige Betrag, aus
   * Basiswert und Zeitraumwerten zusammengesetzt (siehe `budgetCeiling`).
   * `0` = keine Obergrenze definiert.
   */
  ceiling: number;
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

/**
 * Erste Fälligkeit einer wiederkehrenden Kostenposition.
 *
 * Der Rastertag (Monats-, Quartals-, Jahresbeginn) des Aufgabenstarts liegt in
 * aller Regel davor - dann zählt der nächste. Gibt es innerhalb der Laufzeit
 * gar keinen, wird am Starttag gebucht.
 */
export function firstDueDate(start: IsoDate, end: IsoDate, cost: CostItem): IsoDate {
  if (cost.interval === 'day') return start;
  const aligned = periodStartOf(start, cost.interval);
  if (diffDays(start, aligned) === 0) return aligned;
  const next = nextPeriodStart(aligned, cost.interval);
  return diffDays(next, end) >= 0 ? next : start;
}

/** Beginn des folgenden Rasters. */
function nextPeriodStart(periodStart: IsoDate, interval: CostInterval): IsoDate {
  return periodStartOf(addDays(periodEndOf(periodStart, interval), 1), interval);
}

/**
 * Alle Fälligkeiten einer Kostenposition innerhalb einer Laufzeit.
 *
 * Dieselbe Rechnung wie in `budgetDailyLoad`, nur als Liste - damit die
 * Oberfläche zeigen kann, **wann** ein Rhythmus tatsächlich bucht. Ohne diese
 * Vorschau ist "alle 3 Monate" eine Behauptung, deren Wirkung man erst im
 * Diagramm sieht.
 */
export function costDueDates(cost: CostItem, start: IsoDate, end: IsoDate, max = 60): IsoDate[] {
  if (!cost.recurring) return [start];
  const dates: IsoDate[] = [];
  let cursor = firstDueDate(start, end, cost);
  while (diffDays(cursor, end) >= 0 && dates.length < max) {
    dates.push(cursor);
    const next = advance(cursor, cost);
    if (diffDays(cursor, next) <= 0) break;
    cursor = next;
  }
  return dates;
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

      /*
       * Wiederkehrende Kosten fallen nur **innerhalb der Laufzeit** an und
       * immer **am ersten Tag des Rasters** (Monats-, Quartals-, Jahresbeginn) -
       * sonst laegen die Raten quer zu den Auswertungszeitraeumen und eine
       * Quartalssumme enthielte mal drei, mal vier davon. Faellt kein Rastertag
       * in die Laufzeit, wird am Starttag gebucht statt lautlos zu
       * verschwinden; `validate.ts` meldet diese Schieflage.
       */
      let cursor = firstDueDate(st.start, st.end, cost);
      let guard = 0;
      while (diffDays(cursor, st.end) >= 0 && guard++ < 5000) {
        push(cursor);
        const next = advance(cursor, cost);
        // Kein Fortschritt (unsinniges Intervall) waere eine Endlosschleife.
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

/**
 * Der über einen Zeitraum insgesamt zulässige Betrag: Basiswert `totalLimit`
 * und die hineinragenden Zeitraumwerte `limits`. Sind beide gepflegt, gilt die
 * engere Grenze - ein Jahresbudget hebt den Gesamtdeckel nicht auf und
 * umgekehrt.
 */
export function budgetCeiling(budget: Budget, from: IsoDate, to: IsoDate): number {
  let periodSum = 0;
  for (const entry of budget.limits) {
    if (entry.value <= 0) continue;
    const startsAfter = entry.from && diffDays(to, entry.from) > 0;
    const endsBefore = entry.to && diffDays(entry.to, from) > 0;
    if (startsAfter || endsBefore) continue;
    periodSum += entry.value;
  }
  const total = budget.totalLimit > 0 ? budget.totalLimit : 0;
  if (total > 0 && periodSum > 0) return Math.min(total, periodSum);
  return total > 0 ? total : periodSum;
}

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

/**
 * Tageslasten den Zeiträumen zuordnen - **einmal je Reihe statt je Zeitraum**.
 *
 * Vorher lief jeder Zeitraum Tag für Tag durch und fragte die Tageskarte ab.
 * Über einen Zehnjahreshorizont waren das je Reihe rund 4.300 Schritte, obwohl
 * die Karte nur an wenigen hundert Tagen überhaupt etwas enthält. Jetzt wird
 * die Karte einmal durchlaufen und jeder Eintrag per binärer Suche in seinen
 * Zeitraum gelegt; Tage ausserhalb des Betrachtungszeitraums fallen dabei von
 * selbst weg.
 */
function binByBucket(daily: Map<IsoDate, Contribution[]>, buckets: Bucket[]): Contribution[][] {
  const bins: Contribution[][] = buckets.map(() => []);
  if (buckets.length === 0) return bins;

  const starts = buckets.map((b) => toDay(b.start));
  const lastEnd = toDay(buckets[buckets.length - 1].end);

  for (const [iso, list] of daily) {
    const day = toDay(iso);
    if (day < starts[0] || day > lastEnd) continue;
    // Letzter Zeitraum, dessen Beginn nicht hinter dem Tag liegt.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= day) lo = mid;
      else hi = mid - 1;
    }
    // Zwischen zwei Zeitraeumen kann eine Luecke liegen (Tagesraster ueber
    // Wochenenden) - solche Tage gehoeren in keinen und werden verworfen.
    if (day > toDay(buckets[lo].end)) continue;
    bins[lo].push(...list);
  }
  return bins;
}

function aggregateBucket(
  contributions: Contribution[],
  bucket: Bucket,
  mode: 'sum' | 'workdayAverage',
): { value: number; parts: Contribution[]; rawSum: number; actual: number; workdays: number } {
  const parts = new Map<Id, { value: number; actual: number }>();
  let sum = 0;
  let actual = 0;
  // Ohne Schleife - siehe countWorkdays().
  const workdays = countWorkdays(bucket.start, bucket.end);

  for (const c of contributions) {
    sum += c.value;
    actual += c.actual ?? 0;
    const entry = parts.get(c.taskId) ?? { value: 0, actual: 0 };
    entry.value += c.value;
    entry.actual += c.actual ?? 0;
    parts.set(c.taskId, entry);
  }

  const divisor = mode === 'workdayAverage' ? Math.max(1, workdays) : 1;
  const list = [...parts.entries()]
    .map(([taskId, entry]) => ({ taskId, value: entry.value / divisor, actual: entry.actual / divisor }))
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

// ---------------------------------------------------------------------------
// Gesamtsichten ("virtuelle" Ressourcen)
// ---------------------------------------------------------------------------

/**
 * Ids der beiden Gesamtsichten. Sie sind keine echten Ressourcen und dürfen
 * deshalb nie in einer Auswahl oder einer Zuordnung landen.
 */
export const TOTAL_BUDGET_ID = '__total_budget';
export const TOTAL_PEOPLE_ID = '__total_people';

export function isTotalResource(id: Id): boolean {
  return id === TOTAL_BUDGET_ID || id === TOTAL_PEOPLE_ID;
}

/**
 * Legt mehrere zeitraumabhängige Wertreihen übereinander und summiert sie.
 *
 * Nötig, weil `periodValueAt` den **ersten** passenden Eintrag liefert - für
 * eine Gesamtgrenze müssen aber alle gelten. Der Zeitraum wird dazu an jeder
 * vorkommenden Grenze geschnitten; in jedem Abschnitt ist die Summe konstant.
 *
 * `unboundedIsUnlimited` unterscheidet die beiden Anwendungsfälle: bei
 * **Obergrenzen** heisst ein fehlender Eintrag "keine Grenze", und die Summe
 * aus einer Grenze und keiner Grenze ist keine Grenze - sonst behauptete das
 * Gesamtbudget eine Schranke, die es nicht gibt. Bei **Verfügbarkeiten** heisst
 * derselbe Fall "nicht verfügbar", dort wird schlicht summiert.
 */
function mergePeriods(
  sources: { entries: { from?: IsoDate; to?: IsoDate; value: number }[]; fallback: number }[],
  from: IsoDate,
  to: IsoDate,
  unboundedIsUnlimited = false,
): PeriodValue[] {
  const cuts = new Set<IsoDate>([from]);
  const inside = (day: IsoDate) => diffDays(from, day) > 0 && diffDays(day, to) >= 0;
  for (const source of sources) {
    for (const entry of source.entries) {
      if (entry.from && inside(entry.from)) cuts.add(entry.from);
      if (entry.to) {
        const dayAfter = addDays(entry.to, 1);
        if (inside(dayAfter)) cuts.add(dayAfter);
      }
    }
  }

  const bounds = [...cuts].sort();
  return bounds.map((start, index) => {
    const values = sources.map((s) => periodValueAt(s.entries, start, s.fallback));
    // 0 steht im Modell fuer "keine Obergrenze" - siehe budgetCeiling.
    const unlimited = unboundedIsUnlimited && values.some((v) => v <= 0);
    return {
      id: `merged-${start}`,
      from: start,
      to: index + 1 < bounds.length ? addDays(bounds[index + 1], -1) : to,
      value: unlimited ? 0 : values.reduce((sum, v) => sum + v, 0),
    };
  });
}

/**
 * Das Gesamtbudget als eine Ressource: alle Kosten aller Budgets in einer
 * Ganglinie, die Obergrenzen aufsummiert. Beantwortet die Frage "wie steht es
 * um das Geld insgesamt?", die sich aus einzelnen Töpfen nicht ablesen lässt.
 */
export function totalBudgetOf(budgets: Budget[], from: IsoDate, to: IsoDate): Budget {
  // Fehlt auch nur einem Budget der Gesamtdeckel, gibt es keinen fuer die
  // Summe - dieselbe Ueberlegung wie bei den Zeitraumgrenzen.
  const someUnlimited = budgets.length === 0 || budgets.some((b) => b.totalLimit <= 0);
  return {
    id: TOTAL_BUDGET_ID,
    name: 'Gesamtbudget',
    kind: 'neutral',
    limits: mergePeriods(budgets.map((b) => ({ entries: b.limits, fallback: 0 })), from, to, true),
    totalLimit: someUnlimited ? 0 : budgets.reduce((sum, b) => sum + b.totalLimit, 0),
    tagIds: [],
  };
}

/** Alle Personen als eine Ressource - die Gesamtkapazität des Teams. */
export function totalPersonOf(people: Person[], from: IsoDate, to: IsoDate): Person {
  return {
    id: TOTAL_PEOPLE_ID,
    name: 'Alle Personen',
    role: '',
    availability: mergePeriods(
      people.map((p) => ({ entries: p.availability, fallback: p.defaultFte })),
      from,
      to,
    ),
    defaultFte: people.reduce((sum, p) => sum + p.defaultFte, 0),
    tagIds: [],
  };
}

/** Legt mehrere Tageslasten zu einer zusammen. */
export function mergeDailyLoads(
  maps: Iterable<Map<IsoDate, Contribution[]>>,
): Map<IsoDate, Contribution[]> {
  const merged = new Map<IsoDate, Contribution[]>();
  for (const map of maps) {
    for (const [day, list] of map) {
      const target = merged.get(day);
      if (target) target.push(...list);
      else merged.set(day, [...list]);
    }
  }
  return merged;
}

export function personSeries(
  person: Person,
  daily: Map<IsoDate, Contribution[]>,
  options: SeriesOptions,
): ResourceSeries {
  const buckets = buildBuckets(options.from, options.to, options.granularity);
  const bins = binByBucket(daily, buckets);
  const mode = options.personUnit === 'FTE' ? 'workdayAverage' : 'sum';
  let running = 0;
  const points: SeriesPoint[] = buckets.map((bucket, index) => {
    const { value, parts, rawSum, workdays } = aggregateBucket(bins[index], bucket, mode);
    // Grenzwert: verfügbare FTE (bei PT auf Personentage im Bucket hochgerechnet).
    const fte = periodValueAt(person.availability, bucket.start, person.defaultFte);
    const limit = options.personUnit === 'FTE' ? fte : fte * workdays;
    // Kumuliert wird immer in Personentagen - die ungeteilte Tagessumme.
    running += rawSum;
    return { bucket, value, limit, parts, cumulative: running, actual: 0, cumulativeActual: 0 };
  });

  return finalize(
    person.id,
    person.name,
    'person',
    options.personUnit,
    points,
    mode,
    daily,
    (day) => periodValueAt(person.availability, day, person.defaultFte),
    0,
  );
}

export function budgetSeries(budget: Budget, daily: Map<IsoDate, Contribution[]>, options: SeriesOptions): ResourceSeries {
  const buckets = buildBuckets(options.from, options.to, options.granularity);
  const bins = binByBucket(daily, buckets);
  let running = 0;
  let runningActual = 0;
  const points: SeriesPoint[] = buckets.map((bucket, index) => {
    const { value, parts, actual } = aggregateBucket(bins[index], bucket, 'sum');
    const limit = periodValueAt(budget.limits, bucket.start, 0);
    running += value;
    runningActual += actual;
    return { bucket, value, limit, parts, cumulative: running, actual, cumulativeActual: runningActual };
  });

  return finalize(
    budget.id,
    budget.name,
    'budget',
    'EUR',
    points,
    'sum',
    daily,
    (day) => periodValueAt(budget.limits, day, 0),
    budgetCeiling(budget, options.from, options.to),
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
  ceiling: number,
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

  /*
   * Kalenderjahressummen direkt aus den Tageswerten - unabhängig vom Raster.
   *
   * Bewusst **nicht** Tag für Tag: der abgedeckte Zeitraum reicht bei
   * Dauerläufern über zehn Jahre, das wäre ein zweiter vollständiger Durchlauf
   * je Reihe. Stattdessen einmal über die (dünn besetzte) Tageskarte für die
   * Summen und eine Formel für die Arbeitstage je Jahr.
   */
  const yearBuckets = new Map<number, { sum: number; workdays: number }>();
  if (points.length > 0) {
    const firstDay = toDay(points[0].bucket.start);
    const lastDay = toDay(points[points.length - 1].bucket.end);

    // Arbeitstage je Jahr, auf den abgedeckten Zeitraum zugeschnitten.
    for (let year = yearOf(fromDay(firstDay)); year <= yearOf(fromDay(lastDay)); year++) {
      const from = Math.max(firstDay, toDay(`${year}-01-01`));
      const to = Math.min(lastDay, toDay(`${year}-12-31`));
      if (to < from) continue;
      yearBuckets.set(year, { sum: 0, workdays: countWorkdaysBetweenDays(from, to) });
    }

    // Summen aus den tatsächlich belegten Tagen.
    for (const [iso, list] of daily) {
      const day = toDay(iso);
      if (day < firstDay || day > lastDay) continue;
      const entry = yearBuckets.get(yearOf(iso));
      if (!entry) continue;
      for (const c of list) entry.sum += c.value;
    }
  }
  const yearly = [...yearBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => ({
      year,
      value: mode === 'workdayAverage' ? e.sum / Math.max(1, e.workdays) : e.sum,
      limit: limitAt(`${year}-06-15`) * (mode === 'sum' && kind === 'person' ? e.workdays : 1),
    }));

  /*
   * Ueberschreitungen: bei Budgets zaehlt der abgerufene Betrag. Eine Planung
   * ueber der Obergrenze ist eine Absicht, kein Verstoss - erst das Geld, das
   * tatsaechlich abfliesst, reisst ein Budget. Genau auf der Grenze ist die
   * Grenze eingehalten und nicht ueberschritten (siehe `utilisationState`).
   */
  const loadOf = (p: SeriesPoint) => (kind === 'budget' ? p.actual : p.value);
  const breaches = points
    .filter((p) => p.limit > 0 && loadOf(p) > p.limit * (1 + 1e-9))
    .map((p) => p.bucket.key);
  const last = points[points.length - 1];
  return {
    resourceId: id,
    name,
    kind,
    unit,
    points,
    total,
    peak,
    yearly,
    breaches,
    cumulativeTotal: last?.cumulative ?? 0,
    cumulativeActualTotal: last?.cumulativeActual ?? 0,
    ceiling,
  };
}

/**
 * Summiert eine Tageslast über einen Zeitraum. Für die Summenblöcke unter den
 * Listen: dort wird ein Jahr, Quartal oder Monat gewählt, und die Reihen des
 * Diagramms haben ein anderes Raster.
 */
export function sumDailyLoad(
  daily: Map<IsoDate, Contribution[]>,
  from: IsoDate,
  to: IsoDate,
): { planned: number; actual: number } {
  let planned = 0;
  let actual = 0;
  /*
   * Über die vorhandenen Einträge, nicht über jeden Tag des Zeitraums: die
   * Karte ist dünn besetzt, der Zeitraum kann Jahre umfassen. Damit entfällt
   * auch die frühere Notbremse gegen zu lange Schleifen.
   */
  const fromDayNo = toDay(from);
  const toDayNo = toDay(to);
  for (const [iso, list] of daily) {
    const day = toDay(iso);
    if (day < fromDayNo || day > toDayNo) continue;
    for (const c of list) {
      planned += c.value;
      actual += c.actual ?? 0;
    }
  }
  return { planned, actual };
}

/** Verfügbare Kapazität einer Person im Zeitraum, in Personentagen. */
export function availableWorkdays(person: Person, from: IsoDate, to: IsoDate): number {
  let total = 0;
  for (const day of workdaysIn(from, to)) {
    total += periodValueAt(person.availability, day, person.defaultFte);
  }
  return total;
}

/** Formatierung für Anzeigezwecke. */
export function formatValue(value: number, unit: PersonUnit | 'EUR'): string {
  if (unit === 'EUR') {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
  }
  if (unit === 'FTE') return `${value.toFixed(2)} FTE`;
  return `${value.toFixed(1)} PT`;
}
