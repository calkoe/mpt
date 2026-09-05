/**
 * Budgetrechnung in allen Konstellationen, die die Oberfläche tatsächlich
 * anzeigt. Hier darf sich kein Fehler einschleichen: an diesen Zahlen hängen
 * Freigaben, und ein falscher Betrag fällt niemandem auf, weil er plausibel
 * aussieht.
 *
 * Geprüft wird die ganze Kette, nicht nur einzelne Funktionen:
 *   Kostenposition -> Fälligkeiten -> Tageslast -> Buckets -> Summen -> Warnung
 *
 * Besonderes Augenmerk auf zwei Invarianten:
 *  1. Die **Vorschau der Abrufe** (`costDueDates`) zeigt genau die Tage, an
 *     denen `budgetDailyLoad` auch wirklich bucht.
 *  2. **"Keine Obergrenze" ist nicht null.** Eine Summe aus einer Grenze und
 *     keiner Grenze ist keine Grenze - alles andere erfindet eine Schranke.
 */
import { describe, expect, it } from 'vitest';
import type { Budget, Client, CostItem, Task, Venture } from '../model/types';
import { createBudget, createClient, createTask, createVenture } from '../model/factory';
import { computeSchedule } from './schedule';
import { nextWorkday, workdaysBetween } from './dates';
import {
  breakdownOfPoint,
  buildBreakdown,
  budgetCeiling,
  budgetDailyLoad,
  budgetSeries,
  costDueDates,
  EMPTY_FILTER,
  mergeDailyLoads,
  sumDailyLoad,
  totalBudgetOf,
} from './resources';
import { resourceWarnings, utilisationState } from './validate';

const YEAR = 2026;
/** Donnerstag, 1. Januar 2026 - ein Arbeitstag, damit nichts verschoben wird. */
const JAN_1 = '2026-01-01';

function cost(patch: Partial<CostItem> & { budgetId: string }): CostItem {
  return {
    id: `c-${Math.random().toString(36).slice(2, 8)}`,
    label: 'Position',
    amount: 1000,
    actualAmount: 0,
    note: '',
    recurring: false,
    interval: 'month',
    every: 1,
    ...patch,
  };
}

/**
 * Mandant mit einem Budget und einer Aufgabe fester Laufzeit.
 *
 * `end` ist hier nur eine bequeme Schreibweise für die Laufzeit - gespeichert
 * wird ausschliesslich die Dauer, das Modell kennt kein Enddatum mehr.
 */
function setup(options: {
  start?: string;
  end?: string;
  costs?: CostItem[];
  budget?: Partial<Budget>;
}): { client: Client; budget: Budget; task: Task; venture: Venture } {
  const client = createClient('T');
  const venture = createVenture('V');
  client.ventures = [venture];

  const budget = { ...createBudget('B'), ...options.budget };
  client.budgets = [budget];

  const start = options.start ?? JAN_1;
  const task = createTask(venture.id, 'A', start);
  const dauer = options.end ? workdaysBetween(nextWorkday(start), options.end) : 5;
  task.schedule = {
    anchor: 'date',
    start,
    durationMin: dauer,
    durationMax: dauer,
    durationUnit: 'days',
  };
  task.costs = (options.costs ?? []).map((c) => ({ ...c, budgetId: budget.id }));
  client.tasks = [task];

  return { client, budget, task, venture };
}

/** Tage, an denen für dieses Budget tatsächlich gebucht wird. */
function bookedDays(client: Client, budget: Budget): string[] {
  const schedule = computeSchedule(client, 'max');
  const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id) ?? new Map();
  return [...daily.keys()].sort();
}

describe('Budget: Fälligkeiten', () => {
  it('bucht Einmalkosten genau am Starttag', () => {
    const { client, budget } = setup({
      start: '2026-03-11',
      end: '2026-06-30',
      costs: [cost({ budgetId: '', amount: 5000 })],
    });
    expect(bookedDays(client, budget)).toEqual(['2026-03-11']);
  });

  it('bucht wiederkehrende Kosten am Rasteranfang und nur in der Laufzeit', () => {
    const { client, budget } = setup({
      start: JAN_1,
      end: '2026-06-30',
      costs: [cost({ budgetId: '', recurring: true, interval: 'month', every: 1 })],
    });
    expect(bookedDays(client, budget)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
    ]);
  });

  it('beachtet den Faktor: alle zwei Monate, alle zwei Quartale', () => {
    const zweimonatlich = setup({
      start: JAN_1,
      end: '2026-12-31',
      costs: [cost({ budgetId: '', recurring: true, interval: 'month', every: 2 })],
    });
    expect(bookedDays(zweimonatlich.client, zweimonatlich.budget)).toEqual([
      '2026-01-01',
      '2026-03-01',
      '2026-05-01',
      '2026-07-01',
      '2026-09-01',
      '2026-11-01',
    ]);

    const halbjaehrlich = setup({
      start: JAN_1,
      end: '2027-12-31',
      costs: [cost({ budgetId: '', recurring: true, interval: 'quarter', every: 2 })],
    });
    expect(bookedDays(halbjaehrlich.client, halbjaehrlich.budget)).toEqual([
      '2026-01-01',
      '2026-07-01',
      '2027-01-01',
      '2027-07-01',
    ]);
  });

  it('bucht am Starttag, wenn kein Rastertag in die Laufzeit fällt', () => {
    // Drei Wochen mitten im Quartal - ohne diesen Rückfall verschwände der
    // Betrag lautlos. `validate.ts` meldet die Schieflage zusätzlich.
    const { client, budget } = setup({
      start: '2026-02-09',
      end: '2026-02-27',
      costs: [cost({ budgetId: '', recurring: true, interval: 'quarter', every: 1 })],
    });
    expect(bookedDays(client, budget)).toEqual(['2026-02-09']);
  });

  it('führt Dauerläufer über den ganzen Horizont fort', () => {
    const { client, budget } = setup({
      start: JAN_1,
      costs: [cost({ budgetId: '', recurring: true, interval: 'year', every: 1 })],
    });
    // Ohne Enddatum und ohne Dauer: Dauerläufer.
    client.tasks[0].schedule = { anchor: 'date', start: JAN_1, durationMin: 0, durationMax: 0, durationUnit: 'days' };
    const days = bookedDays(client, budget);
    expect(days[0]).toBe(JAN_1);
    // Zehn Jahre Vorschau - die Anzahl darf nicht am Wachhund hängen.
    expect(days.length).toBeGreaterThanOrEqual(10);
    expect(days.length).toBeLessThan(15);
  });

  it('zeigt in der Vorschau genau die Tage, an denen auch gebucht wird', () => {
    // Diese Invariante ist der eigentliche Punkt: die Liste im Kosteneditor
    // darf nichts anderes behaupten als die Rechnung.
    for (const interval of ['month', 'quarter', 'year'] as const) {
      for (const start of ['2026-01-01', '2026-02-09', '2026-04-01']) {
        const item = cost({ budgetId: '', recurring: true, interval, every: 1 });
        const { client, budget } = setup({ start, end: '2027-12-31', costs: [item] });
        const schedule = computeSchedule(client, 'max');
        const st = schedule.byId.get(client.tasks[0].id)!;
        expect(costDueDates(client.tasks[0].costs[0], st.start, st.end, 100)).toEqual(
          bookedDays(client, budget),
        );
      }
    }
  });

  it('ignoriert Positionen ohne Betrag und ohne gültiges Budget', () => {
    const { client, budget } = setup({
      start: JAN_1,
      end: '2026-06-30',
      costs: [cost({ budgetId: '', amount: 0 }), cost({ budgetId: '', amount: 1000 })],
    });
    // Die Position mit Betrag 0 erzeugt keine Buchung.
    expect(bookedDays(client, budget)).toEqual([JAN_1]);

    client.tasks[0].costs.push(cost({ budgetId: 'gibt-es-nicht', amount: 9999 }));
    expect(bookedDays(client, budget)).toEqual([JAN_1]);
  });
});

describe('Budget: Summen und Buckets', () => {
  const build = () =>
    setup({
      start: JAN_1,
      end: '2026-12-31',
      costs: [cost({ budgetId: '', amount: 1000, actualAmount: 400, recurring: true, interval: 'month', every: 1 })],
    });

  it('summiert unabhängig vom Zeitraster zum selben Ergebnis', () => {
    const { client, budget } = build();
    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;

    const totals = (['week', 'month', 'quarter', 'year'] as const).map((granularity) => {
      const series = budgetSeries(budget, daily, {
        from: JAN_1,
        to: '2026-12-31',
        granularity,
        personUnit: 'FTE',
      });
      return {
        planned: Math.round(series.points.reduce((s, p) => s + p.value, 0)),
        actual: Math.round(series.points.reduce((s, p) => s + p.actual, 0)),
      };
    });

    // Zwölf Monatsraten à 1000 geplant, 400 abgerufen.
    for (const total of totals) {
      expect(total.planned).toBe(12_000);
      expect(total.actual).toBe(4_800);
    }
  });

  it('legt eine Rate in genau einen Bucket - auch an der Jahresgrenze', () => {
    const { client, budget } = setup({
      start: '2026-12-31',
      end: '2027-01-01',
      costs: [cost({ budgetId: '', amount: 500 })],
    });
    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const series = budgetSeries(budget, daily, {
      from: '2026-01-01',
      to: '2027-12-31',
      granularity: 'year',
      personUnit: 'FTE',
    });
    expect(series.points.map((p) => p.value)).toEqual([500, 0]);
  });

  it('führt geplant und abgerufen getrennt und kumuliert beide', () => {
    const { client, budget } = build();
    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const series = budgetSeries(budget, daily, {
      from: JAN_1,
      to: '2026-12-31',
      granularity: 'quarter',
      personUnit: 'FTE',
    });

    expect(series.points.map((p) => p.value)).toEqual([3000, 3000, 3000, 3000]);
    expect(series.points.map((p) => p.actual)).toEqual([1200, 1200, 1200, 1200]);
    // Beide Reihen steigen monoton und enden auf der Gesamtsumme.
    expect(series.cumulativeTotal).toBe(12_000);
    expect(series.cumulativeActualTotal).toBe(4_800);
    expect(series.points.map((p) => p.cumulative)).toEqual([3000, 6000, 9000, 12_000]);
  });

  it('summiert einen frei gewählten Zeitraum tagegenau', () => {
    const { client, budget } = build();
    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;

    // Erstes Quartal: drei Raten. Die Grenzen zählen beide mit.
    expect(sumDailyLoad(daily, '2026-01-01', '2026-03-31')).toEqual({ planned: 3000, actual: 1200 });
    // Ein Tag vor der Rate: nichts.
    expect(sumDailyLoad(daily, '2026-01-02', '2026-01-31')).toEqual({ planned: 0, actual: 0 });
    // Genau der Rastertag.
    expect(sumDailyLoad(daily, '2026-02-01', '2026-02-01')).toEqual({ planned: 1000, actual: 400 });
  });

  it('zählt nur Aufgaben, die dem Filter entsprechen', () => {
    const { client, budget, venture } = build();
    const schedule = computeSchedule(client, 'max');
    const fremd = { tagIds: [], ventureIds: ['anderes-vorhaben'] };
    expect(budgetDailyLoad(client, schedule, fremd).get(budget.id)?.size ?? 0).toBe(0);
    expect(
      budgetDailyLoad(client, schedule, { tagIds: [], ventureIds: [venture.id] }).get(budget.id)?.size,
    ).toBe(12);
  });
});

describe('Budget: Obergrenzen', () => {
  it('kombiniert Basiswert und Zeitraumwerte zur engeren Grenze', () => {
    const budget = createBudget('B');
    budget.limits = [
      { id: '1', from: '2026-01-01', to: '2026-12-31', value: 100 },
      { id: '2', from: '2027-01-01', to: '2027-12-31', value: 150 },
    ];

    // Nur Zeitraumwerte: die Summe der hineinragenden Scheiben.
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(250);
    expect(budgetCeiling(budget, '2026-01-01', '2026-12-31')).toBe(100);
    // Ein Ausschnitt innerhalb einer Scheibe erbt deren Grenze: ein
    // Jahresbudget darf auch in einem Quartal ausgeschöpft werden.
    expect(budgetCeiling(budget, '2026-01-01', '2026-03-31')).toBe(100);
    // Ausserhalb aller Scheiben gibt es keine Grenze.
    expect(budgetCeiling(budget, '2030-01-01', '2030-12-31')).toBe(0);

    // Mit Gesamtdeckel gilt der engere von beiden - in beide Richtungen.
    budget.totalLimit = 200;
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(200);
    budget.totalLimit = 400;
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(250);

    // Nur Gesamtdeckel, keine Scheiben.
    const nurDeckel = createBudget('D');
    nurDeckel.totalLimit = 900;
    expect(budgetCeiling(nurDeckel, '2026-01-01', '2026-12-31')).toBe(900);
    // Gar nichts gepflegt: keine Grenze, nicht "null Euro".
    expect(budgetCeiling(createBudget('X'), '2026-01-01', '2026-12-31')).toBe(0);
  });
});

describe('Gesamtbudget', () => {
  const mitDeckel = (): Budget => {
    const b = createBudget('Mit');
    b.totalLimit = 400;
    b.limits = [{ id: 'l', from: '2026-01-01', to: '2026-12-31', value: 250 }];
    return b;
  };

  it('summiert Grenzen, die für denselben Abschnitt gelten', () => {
    const a = mitDeckel();
    const b = createBudget('Zweites');
    b.totalLimit = 100;
    b.limits = [{ id: 'l', from: '2026-01-01', to: '2026-03-31', value: 60 }];

    const total = totalBudgetOf([a, b], '2026-01-01', '2026-12-31');
    /*
     * Im ersten Quartal haben beide eine Grenze - die Summe ist 310. Ab dem
     * zweiten hat "Zweites" keine Zeitraumgrenze mehr; damit hat auch die
     * Summe keine (0 = keine Grenze). Die eine Grenze von 250 dort stehen zu
     * lassen wäre falsch: das andere Budget dürfte in diesem Abschnitt
     * beliebig viel ausgeben.
     */
    expect(total.limits.map((l) => [l.from, l.to, l.value])).toEqual([
      ['2026-01-01', '2026-03-31', 310],
      ['2026-04-01', '2026-12-31', 0],
    ]);

    // Beide haben einen Gesamtdeckel, also hat ihn auch die Summe - und er
    // greift genau dort, wo keine Zeitraumgrenze mehr gilt.
    expect(total.totalLimit).toBe(500);
    expect(budgetCeiling(total, '2026-01-01', '2026-03-31')).toBe(310);
    expect(budgetCeiling(total, '2026-04-01', '2026-12-31')).toBe(500);
  });

  it('kennt keine Grenze, sobald einem Budget die Grenze fehlt', () => {
    // Der Kern der Sache: 250 + "unbegrenzt" ist nicht 250. Vorher behauptete
    // die Gesamtsicht genau das und hätte eine Überschreitung gemeldet, die
    // es gar nicht geben kann.
    const total = totalBudgetOf([mitDeckel(), createBudget('Ohne')], '2026-01-01', '2026-12-31');
    expect(total.totalLimit).toBe(0);
    expect(budgetCeiling(total, '2026-01-01', '2026-12-31')).toBe(0);
  });

  it('summiert die Kosten aller Budgets zu einer Reihe', () => {
    const client = createClient('T');
    const venture = createVenture('V');
    client.ventures = [venture];
    const a = createBudget('A');
    const b = createBudget('B');
    client.budgets = [a, b];

    const task = createTask(venture.id, 'A', JAN_1);
    const dauer = workdaysBetween(JAN_1, '2026-12-31');
    task.schedule = { anchor: 'date', start: JAN_1, durationMin: dauer, durationMax: dauer, durationUnit: 'days' };
    task.costs = [
      cost({ budgetId: a.id, amount: 1000, actualAmount: 500 }),
      cost({ budgetId: b.id, amount: 300, actualAmount: 100 }),
    ];
    client.tasks = [task];

    const schedule = computeSchedule(client, 'max');
    const loads = budgetDailyLoad(client, schedule, EMPTY_FILTER);
    const merged = mergeDailyLoads(loads.values());
    expect(sumDailyLoad(merged, '2026-01-01', '2026-12-31')).toEqual({ planned: 1300, actual: 600 });

    // Und über die Reihe gerechnet dasselbe.
    const series = budgetSeries(totalBudgetOf(client.budgets, JAN_1, '2026-12-31'), merged, {
      from: JAN_1,
      to: '2026-12-31',
      granularity: 'year',
      personUnit: 'FTE',
    });
    expect(series.cumulativeTotal).toBe(1300);
    expect(series.cumulativeActualTotal).toBe(600);
  });
});

describe('Budget: Auslastung und Warnungen', () => {
  it('trennt ok, knapp, genau und überschritten sauber', () => {
    expect(utilisationState(0, 0)).toBe('ok');
    expect(utilisationState(999, 0)).toBe('ok'); // ohne Grenze gibt es nichts zu melden
    expect(utilisationState(89, 100)).toBe('ok');
    expect(utilisationState(90, 100)).toBe('warn');
    expect(utilisationState(99.9, 100)).toBe('warn');
    expect(utilisationState(100, 100)).toBe('exact');
    expect(utilisationState(100.01, 100)).toBe('over');
    // Rundungsfehler duerfen keine Ueberschreitung erfinden.
    expect(utilisationState(0.1 + 0.2, 0.3)).toBe('exact');
    expect(utilisationState(250_000.0000001, 250_000)).toBe('exact');
  });

  it('meldet nur abgerufenes Geld, nie die Planung', () => {
    const { client, budget } = setup({
      start: JAN_1,
      end: '2026-12-31',
      budget: { limits: [{ id: 'l', from: '2026-01-01', to: '2026-12-31', value: 1000 }] },
      costs: [cost({ budgetId: '', amount: 5000, actualAmount: 0 })],
    });

    const warn = () => resourceWarnings(client, computeSchedule(client, 'max')).get(budget.id) ?? [];
    expect(warn()).toHaveLength(0);

    client.tasks[0].costs[0].actualAmount = 900; // 90 %
    expect(warn().some((w) => w.level === 'warn')).toBe(true);

    client.tasks[0].costs[0].actualAmount = 1000; // genau
    expect(warn()).toHaveLength(0);

    client.tasks[0].costs[0].actualAmount = 1001; // darüber
    expect(warn().some((w) => w.level === 'critical')).toBe(true);
  });

  it('meldet auch den Gesamtdeckel, aber erst am Abfluss', () => {
    const { client, budget } = setup({
      start: JAN_1,
      end: '2026-12-31',
      budget: { totalLimit: 1000 },
      costs: [cost({ budgetId: '', amount: 5000, actualAmount: 5000 })],
    });
    const warnings = resourceWarnings(client, computeSchedule(client, 'max')).get(budget.id) ?? [];
    expect(warnings.some((w) => w.level === 'critical' && w.text.includes('Gesamt'))).toBe(true);
  });

  it('zählt eine Überschreitung im Bucket erst beim Abruf', () => {
    const { client, budget } = setup({
      start: JAN_1,
      end: '2026-12-31',
      budget: { limits: [{ id: 'l', from: '2026-01-01', to: '2026-12-31', value: 1000 }] },
      costs: [cost({ budgetId: '', amount: 5000, actualAmount: 0 })],
    });
    const series = () => {
      const schedule = computeSchedule(client, 'max');
      const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
      return budgetSeries(budget, daily, {
        from: JAN_1,
        to: `${YEAR}-12-31`,
        granularity: 'year',
        personUnit: 'FTE',
      });
    };
    expect(series().breaches).toEqual([]);
    client.tasks[0].costs[0].actualAmount = 5000;
    expect(series().breaches).toEqual([String(YEAR)]);
  });
  /*
   * Die Auswertung darf dem Diagramm nie widersprechen. Sie erscheint an zwei
   * Stellen - unter einer Ganglinie und als Dialog über eine ganze Liste - und
   * beide muessen mit den Zahlen uebereinstimmen, die daneben stehen.
   */
  describe('Auswertung', () => {
    it('summiert sich auf dieselbe Zahl wie die Zeitraumsumme', () => {
      const { client, budget } = setup({
        start: JAN_1,
        end: '2026-12-31',
        costs: [
          cost({ budgetId: '', amount: 1200, actualAmount: 400, recurring: true, interval: 'month' }),
          cost({ budgetId: '', amount: 5000, actualAmount: 2500 }),
        ],
      });
      const schedule = computeSchedule(client, 'max');
      const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;

      const summe = sumDailyLoad(daily, JAN_1, '2026-12-31');
      const aus = buildBreakdown([{ resourceId: budget.id, name: budget.name, daily }], {
        label: 'Test',
        from: JAN_1,
        to: '2026-12-31',
        unit: 'EUR',
        ceiling: null,
      });

      expect(aus.planned).toBeCloseTo(summe.planned, 6);
      expect(aus.actual).toBeCloseTo(summe.actual, 6);
      // Die Zeilen selbst muessen dieselbe Summe ergeben.
      expect(aus.rows.reduce((s, r) => s + r.planned, 0)).toBeCloseTo(summe.planned, 6);
    });

    it('deckt sich mit dem Balken, auf den geklickt wurde', () => {
      const { client, budget } = setup({
        start: JAN_1,
        end: '2026-12-31',
        costs: [cost({ budgetId: '', amount: 300, actualAmount: 100, recurring: true, interval: 'month' })],
      });
      const schedule = computeSchedule(client, 'max');
      const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
      const series = budgetSeries(budget, daily, {
        from: JAN_1,
        to: `${YEAR}-12-31`,
        granularity: 'quarter',
        personUnit: 'FTE',
      });

      for (const point of series.points) {
        const aus = breakdownOfPoint(series, point);
        expect(aus.planned).toBeCloseTo(point.value, 9);
        expect(aus.actual).toBeCloseTo(point.actual, 9);
        expect(aus.rows).toHaveLength(point.parts.length);
        // Der Rahmen ist genau die Grenzwertlinie des Diagramms; ohne Grenze null.
        expect(aus.ceiling).toBe(point.limit > 0 ? point.limit : null);
        // Und dieselbe Zahl noch einmal ueber den Weg der Liste gerechnet.
        const direkt = buildBreakdown([{ resourceId: budget.id, name: budget.name, daily }], {
          label: point.bucket.label,
          from: point.bucket.start,
          to: point.bucket.end,
          unit: 'EUR',
          ceiling: null,
        });
        expect(direkt.planned).toBeCloseTo(point.value, 6);
      }
    });

    it('traegt die Obergrenze des Zeitraums als Rahmen, nicht null', () => {
      const { client, budget } = setup({
        start: JAN_1,
        end: '2026-12-31',
        budget: { limits: [{ id: 'l', from: '2026-01-01', to: '2026-12-31', value: 9000 }] },
        costs: [cost({ budgetId: '', amount: 1000 })],
      });
      const schedule = computeSchedule(client, 'max');
      const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
      const series = budgetSeries(budget, daily, {
        from: JAN_1,
        to: `${YEAR}-12-31`,
        granularity: 'year',
        personUnit: 'FTE',
      });

      const mitGrenze = breakdownOfPoint(series, series.points[0]);
      expect(mitGrenze.ceiling).toBe(9000);
      // Ein Jahr ohne Scheibe hat keine Grenze - und das ist nicht "0 Euro".
      const ohne = series.points.find((p) => p.limit === 0);
      if (ohne) expect(breakdownOfPoint(series, ohne).ceiling).toBeNull();
    });

    it('mittelt bei FTE ueber die Arbeitstage statt zu summieren', () => {
      // Zwei Beitraege an zwei Arbeitstagen einer Woche, je 1 FTE.
      const daily = new Map([
        ['2026-01-05', [{ taskId: 't1', value: 1 }]],
        ['2026-01-06', [{ taskId: 't1', value: 1 }]],
      ]);
      const woche = { from: '2026-01-05', to: '2026-01-09' };

      const alsFte = buildBreakdown([{ resourceId: 'p', name: 'P', daily }], { label: 'KW', ...woche, unit: 'FTE', ceiling: null });
      const alsPt = buildBreakdown([{ resourceId: 'p', name: 'P', daily }], { label: 'KW', ...woche, unit: 'PT', ceiling: null });

      // Fuenf Arbeitstage, zwei belegt: 2/5 FTE im Mittel, aber 2 Personentage.
      expect(alsFte.planned).toBeCloseTo(0.4, 9);
      expect(alsPt.planned).toBeCloseTo(2, 9);
    });

    it('fasst je Ressource und Aufgabe zusammen und laesst nichts draussen', () => {
      const daily = new Map([
        ['2026-03-02', [{ taskId: 'a', value: 10 }, { taskId: 'b', value: 5 }]],
        ['2026-03-03', [{ taskId: 'a', value: 7 }]],
        // Ausserhalb des Zeitraums - darf nicht mitzaehlen.
        ['2026-04-01', [{ taskId: 'a', value: 999 }]],
      ]);
      const aus = buildBreakdown(
        [
          { resourceId: 'r1', name: 'Eins', daily },
          { resourceId: 'r2', name: 'Zwei', daily },
        ],
        { label: 'Maerz', from: '2026-03-01', to: '2026-03-31', unit: 'EUR', ceiling: null },
      );

      expect(aus.rows).toHaveLength(4); // zwei Ressourcen x zwei Aufgaben
      expect(aus.planned).toBeCloseTo(2 * 22, 9);
      expect(aus.rows[0]).toMatchObject({ taskId: 'a', planned: 17 });
      expect(aus.rows.every((r) => r.planned !== 999)).toBe(true);
    });
  });
});
