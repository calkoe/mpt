/**
 * Tests der Rechenkerne: Arbeitstage, Terminierung/CPM und Ressourcen.
 * Diese Logik ist die Grundlage aller Visualisierungen - sie muss stimmen.
 */
import { describe, expect, it } from 'vitest';
import {
  addWorkdays,
  buildBuckets,
  isWorkday,
  unitToWorkdays,
  workdaysBetween,
  workdaysIn,
  workdaysToUnit,
  yearOf,
} from './dates';
import { collectNeighbourhood, computeSchedule, wouldCreateCycle } from './schedule';
import { budgetDailyLoad, budgetSeries, EMPTY_FILTER, periodValueAt, personDailyLoad, personSeries } from './resources';
import { resourceWarnings, taskWarnings } from './validate';
import { createBudget, createClient, createPerson, createTask, createVenture } from '../model/factory';
import type { Client, Task } from '../model/types';

// Montag, 5. Januar 2026
const MON = '2026-01-05';

function buildClient(): { client: Client; venture: string } {
  const client = createClient('Test');
  const venture = createVenture('V');
  client.ventures = [venture];
  return { client, venture: venture.id };
}

function addTask(client: Client, ventureId: string, patch: Partial<Task> & { title: string }): Task {
  const task = createTask(ventureId, patch.title, MON);
  Object.assign(task, patch);
  if (patch.schedule) task.schedule = { ...task.schedule, ...patch.schedule };
  client.tasks.push(task);
  return task;
}

describe('Arbeitstags-Mathematik', () => {
  it('erkennt Wochenenden', () => {
    expect(isWorkday('2026-01-05')).toBe(true); // Montag
    expect(isWorkday('2026-01-10')).toBe(false); // Samstag
    expect(isWorkday('2026-01-11')).toBe(false); // Sonntag
  });

  it('zählt den Starttag mit', () => {
    expect(addWorkdays(MON, 1)).toBe('2026-01-05');
    expect(addWorkdays(MON, 5)).toBe('2026-01-09'); // Mo-Fr
  });

  it('überspringt Wochenenden', () => {
    expect(addWorkdays(MON, 6)).toBe('2026-01-12'); // nächster Montag
    expect(addWorkdays(MON, 10)).toBe('2026-01-16');
  });

  it('startet auf dem nächsten Arbeitstag, wenn der Start am Wochenende liegt', () => {
    expect(addWorkdays('2026-01-10', 1)).toBe('2026-01-12');
  });

  it('rechnet Dauern aus zwei Datumsangaben zurück', () => {
    expect(workdaysBetween(MON, '2026-01-09')).toBe(5);
    expect(workdaysBetween(MON, '2026-01-12')).toBe(6);
    expect(workdaysIn(MON, '2026-01-11')).toHaveLength(5);
  });

  it('bildet Buckets je Granularität', () => {
    expect(buildBuckets('2026-01-01', '2026-03-31', 'month')).toHaveLength(3);
    expect(buildBuckets('2026-01-01', '2026-12-31', 'quarter')).toHaveLength(4);
    expect(buildBuckets('2026-01-01', '2027-12-31', 'year')).toHaveLength(2);
  });
});

describe('Terminierung', () => {
  it('setzt Nachfolger auf den Arbeitstag nach dem Vorgängerende', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 } });
    addTask(client, venture, {
      title: 'B',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 3, durationMax: 3 },
    });

    const schedule = computeSchedule(client, 'max');
    const b = schedule.ordered.find((s) => s.task.title === 'B')!;
    expect(b.start).toBe('2026-01-12'); // A endet Fr 09.01., B startet Mo 12.01.
    expect(b.end).toBe('2026-01-14');
  });

  it('nimmt bei mehreren Vorgängern das späteste Ende', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2 } });
    const b = addTask(client, venture, { title: 'B', schedule: { anchor: 'date', start: MON, durationMin: 8, durationMax: 8 } });
    addTask(client, venture, {
      title: 'C',
      dependsOn: [a.id, b.id],
      schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1 },
    });

    const schedule = computeSchedule(client, 'max');
    const c = schedule.byId.get(client.tasks[2].id)!;
    const bEnd = schedule.byId.get(b.id)!.end;
    expect(bEnd).toBe('2026-01-14');
    expect(c.start).toBe('2026-01-15');
  });

  it('unterscheidet optimistisches und pessimistisches Szenario', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 4, durationMax: 7 } });

    expect(computeSchedule(client, 'min').ordered[0].duration).toBe(4);
    expect(computeSchedule(client, 'max').ordered[0].duration).toBe(7);
    expect(computeSchedule(client, 'min').ordered[0].endPessimistic).toBe('2026-01-13');
  });

  it('leitet die Dauer aus einem festen Ende ab', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, end: '2026-01-09', durationMin: 99, durationMax: 99 },
    });
    expect(computeSchedule(client, 'max').ordered[0].duration).toBe(5);
  });

  it('markiert den kritischen Pfad und weist Puffer aus', () => {
    const { client, venture } = buildClient();
    const start = addTask(client, venture, { title: 'Start', schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2 } });
    const lang = addTask(client, venture, {
      title: 'Lang',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 10, durationMax: 10 },
    });
    const kurz = addTask(client, venture, {
      title: 'Kurz',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 2, durationMax: 2 },
    });
    addTask(client, venture, {
      title: 'Ende',
      dependsOn: [lang.id, kurz.id],
      schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1 },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(lang.id)!.critical).toBe(true);
    expect(schedule.byId.get(lang.id)!.slack).toBe(0);
    expect(schedule.byId.get(kurz.id)!.critical).toBe(false);
    expect(schedule.byId.get(kurz.id)!.slack).toBe(8);
  });

  it('weist über ein Wochenende hinweg keinen Scheinpuffer aus', () => {
    // A endet Freitag, B startet Montag - die Kette ist durchgehend kritisch.
    const { client, venture } = buildClient();
    const a = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    const b = addTask(client, venture, {
      title: 'B',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 5, durationMax: 5 },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(a.id)!.end).toBe('2026-01-09'); // Freitag
    expect(schedule.byId.get(b.id)!.start).toBe('2026-01-12'); // Montag
    expect(schedule.byId.get(a.id)!.slack).toBe(0);
    expect(schedule.byId.get(a.id)!.critical).toBe(true);
    expect(schedule.byId.get(b.id)!.slack).toBe(0);
  });

  it('erkennt Zyklen und terminiert die übrigen Aufgaben trotzdem', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1 } });
    const b = addTask(client, venture, { title: 'B', schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1 } });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    addTask(client, venture, { title: 'Frei', schedule: { anchor: 'date', start: MON, durationMin: 1, durationMax: 1 } });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.cycles).toHaveLength(2);
    expect(schedule.byId.get(a.id)!.cyclic).toBe(true);
    expect(schedule.ordered.map((s) => s.task.title)).toContain('Frei');
    expect(taskWarnings(client, schedule).get(a.id)?.[0].text).toMatch(/zyklus/i);
  });

  it('verhindert zyklenbildende Auswahlen', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A' });
    const b = addTask(client, venture, { title: 'B', dependsOn: [a.id] });
    expect(wouldCreateCycle(client.tasks, a.id, b.id)).toBe(true);
    expect(wouldCreateCycle(client.tasks, b.id, a.id)).toBe(false);
    expect(wouldCreateCycle(client.tasks, a.id, a.id)).toBe(true);
  });

  it('rechnet zwischen Dauer-Einheiten hin und her', () => {
    expect(unitToWorkdays(2, 'weeks')).toBe(10);
    expect(unitToWorkdays(1, 'months')).toBe(21);
    expect(unitToWorkdays(1, 'years')).toBe(252);
    // Unter einem ganzen Arbeitstag wird auf 1 aufgerundet.
    expect(unitToWorkdays(0, 'weeks')).toBe(1);
    expect(workdaysToUnit(10, 'weeks')).toBe(2);
    expect(workdaysToUnit(21, 'months')).toBe(1);
    // Rundlauf bleibt stabil.
    expect(unitToWorkdays(workdaysToUnit(63, 'months'), 'months')).toBe(63);
  });

  it('führt Dauerläufer bis zum Horizontende fort', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, { title: 'Normal', schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 } });
    const betrieb = addTask(client, venture, {
      title: 'Betrieb',
      schedule: { anchor: 'date', start: MON, durationMin: 0, durationMax: 0 },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(betrieb.id)!.end).toBe(schedule.horizonEnd);
    expect(schedule.byId.get(betrieb.id)!.openEnded).toBe(true);

    // Der Horizont reicht rund zehn Jahre über das Projektende hinaus, damit
    // die dauerhafte Ressourcenwirkung sichtbar bleibt.
    const yearsAhead = (yearOf(schedule.horizonEnd) - yearOf(schedule.projectEnd));
    expect(yearsAhead).toBeGreaterThanOrEqual(9);
  });

  it('sammelt Nachbarschaften bis zur gewünschten Tiefe', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A' });
    const b = addTask(client, venture, { title: 'B', dependsOn: [a.id] });
    const c = addTask(client, venture, { title: 'C', dependsOn: [b.id] });

    expect(collectNeighbourhood(client.tasks, b.id, 1).size).toBe(3);
    expect(collectNeighbourhood(client.tasks, a.id, 1)).toEqual(new Set([a.id, b.id]));
    expect(collectNeighbourhood(client.tasks, a.id, 2)).toEqual(new Set([a.id, b.id, c.id]));
  });
});

describe('Ressourcen', () => {
  it('verteilt PT gleichmäßig und übernimmt FTE direkt', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    client.people = [person];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 10, durationMax: 10 },
    });
    task.assignments = [
      { id: 'a1', personId: person.id, mode: 'PT', value: 5, periods: [] },
      { id: 'a2', personId: person.id, mode: 'FTE', value: 0.5, periods: [] },
    ];

    const schedule = computeSchedule(client, 'max');
    const daily = personDailyLoad(client, schedule, EMPTY_FILTER).get(person.id)!;
    // 5 PT auf 10 Arbeitstage = 0,5/Tag, plus 0,5 FTE = 1,0
    expect(daily.get(MON)!.reduce((s, c) => s + c.value, 0)).toBeCloseTo(1.0, 6);

    const series = personSeries(person, daily, {
      from: MON,
      to: '2026-01-16',
      granularity: 'week',
      personUnit: 'FTE',
    });
    expect(series.points[0].value).toBeCloseTo(1.0, 6);
    // Grenzwert = verfügbare FTE der Person
    expect(series.points[0].limit).toBeCloseTo(1, 6);
  });

  it('summiert PT je Bucket statt zu mitteln', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    client.people = [person];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    task.assignments = [{ id: 'a1', personId: person.id, mode: 'PT', value: 5, periods: [] }];

    const schedule = computeSchedule(client, 'max');
    const daily = personDailyLoad(client, schedule, EMPTY_FILTER).get(person.id)!;
    const series = personSeries(person, daily, { from: MON, to: '2026-01-09', granularity: 'week', personUnit: 'PT' });
    expect(series.points[0].value).toBeCloseTo(5, 6);
  });

  it('bucht Einmalkosten am Start und wiederkehrende Kosten im Intervall', () => {
    const { client, venture } = buildClient();
    const budget = createBudget('B');
    client.budgets = [budget];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: '2026-01-01', durationMin: 200, durationMax: 200 },
    });
    task.costs = [
      { id: 'c1', budgetId: budget.id, label: 'einmalig', amount: 1000, actualAmount: 0, note: '', recurring: false, interval: 'month', every: 1 },
      { id: 'c2', budgetId: budget.id, label: 'quartalsweise', amount: 500, actualAmount: 0, note: '', recurring: true, interval: 'month', every: 3 },
    ];

    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const series = budgetSeries(budget, daily, { from: '2026-01-01', to: '2026-12-31', granularity: 'month', personUnit: 'FTE' });

    // Januar: 1000 einmalig + 500 erste Rate
    expect(series.points[0].value).toBeCloseTo(1500, 6);
    // Februar: nichts, April: nächste Rate
    expect(series.points[1].value).toBeCloseTo(0, 6);
    expect(series.points[3].value).toBeCloseTo(500, 6);
  });

  it('meldet Grenzwertüberschreitungen, ohne die Eingabe zu blockieren', () => {
    const { client, venture } = buildClient();
    const budget = createBudget('B');
    budget.limits = [{ id: 'l1', from: '2026-01-01', to: '2026-12-31', value: 1000 }];
    client.budgets = [budget];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    task.costs = [{ id: 'c1', budgetId: budget.id, label: 'teuer', amount: 5000, actualAmount: 0, note: '', recurring: false, interval: 'month', every: 1 }];

    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const series = budgetSeries(budget, daily, { from: '2026-01-01', to: '2026-12-31', granularity: 'year', personUnit: 'FTE' });
    expect(series.breaches).toHaveLength(1);
    expect(series.yearly[0]).toMatchObject({ year: 2026, value: 5000 });
  });

  it('respektiert zeitraumabhängige Werte', () => {
    const entries = [
      { id: '1', from: '2026-01-01', to: '2026-12-31', value: 1 },
      { id: '2', from: '2027-01-01', value: 0.5 },
    ];
    expect(periodValueAt(entries, '2026-06-01', 9)).toBe(1);
    expect(periodValueAt(entries, '2027-06-01', 9)).toBe(0.5);
    expect(periodValueAt(entries, '2025-06-01', 9)).toBe(9);
  });

  it('filtert nach Tags', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    client.people = [person];
    client.tags = [{ id: 'tag1', name: 'Infra', color: '#000000' }];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    task.assignments = [{ id: 'a1', personId: person.id, mode: 'FTE', value: 1, periods: [] }];

    const schedule = computeSchedule(client, 'max');
    const withoutMatch = personDailyLoad(client, schedule, { tagIds: ['tag1'], ventureIds: [] }).get(person.id)!;
    expect(withoutMatch.size).toBe(0);

    task.tagIds = ['tag1'];
    const withMatch = personDailyLoad(client, schedule, { tagIds: ['tag1'], ventureIds: [] }).get(person.id)!;
    expect(withMatch.size).toBeGreaterThan(0);
  });
});

describe('Warnungen', () => {
  it('warnt bei verletzter Parallelität', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 3, durationMax: 3 },
    });
    const b = addTask(client, venture, {
      title: 'B',
      schedule: { anchor: 'date', start: '2026-03-02', durationMin: 3, durationMax: 3 },
    });
    a.parallelWith = [b.id];

    const schedule = computeSchedule(client, 'max');
    const warnings = taskWarnings(client, schedule).get(a.id) ?? [];
    expect(warnings.some((w) => w.text.includes('Parallelität verletzt'))).toBe(true);
  });

  it('warnt bei unerfüllter Bedingung, ohne den Termin zu verschieben', () => {
    const { client, venture } = buildClient();
    client.conditions = [{ id: 'c1', name: 'Freigabe', met: false }];
    const task = addTask(client, venture, {
      title: 'A',
      conditionIds: ['c1'],
      schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2 },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(task.id)!.start).toBe(MON);
    // Bezugstag liegt nach dem Start - die Bedingung ist faellig.
    expect(
      taskWarnings(client, schedule, '2026-01-06').get(task.id)?.some((w) => w.text.includes('Freigabe')),
    ).toBe(true);
  });

  it('schweigt bei Bedingungen, deren Aufgabe erst viel spaeter anlaeuft', () => {
    const { client, venture } = buildClient();
    client.conditions = [{ id: 'c1', name: 'Freigabe', met: false }];
    const task = addTask(client, venture, {
      title: 'Betrieb',
      conditionIds: ['c1'],
      schedule: { anchor: 'date', start: '2026-06-01', durationMin: 2, durationMax: 2 },
    });

    const schedule = computeSchedule(client, 'max');
    // Ein halbes Jahr vorher ist die offene Bedingung noch kein Problem ...
    expect(taskWarnings(client, schedule, MON).get(task.id) ?? []).toHaveLength(0);
    // ... kurz vor dem Start dagegen schon, zunaechst als Hinweis.
    const soon = taskWarnings(client, schedule, '2026-05-25').get(task.id) ?? [];
    expect(soon.some((w) => w.level === 'info' && w.text.includes('Freigabe'))).toBe(true);
  });

  it('warnt, wenn Status und Termin nicht zusammenpassen', () => {
    const { client, venture } = buildClient();
    const offen = addTask(client, venture, {
      title: 'Laeuft nicht an',
      status: 'open',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    const ueberfaellig = addTask(client, venture, {
      title: 'Laeuft ueber',
      status: 'active',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });

    const schedule = computeSchedule(client, 'max');
    // Der Starttag ist erreicht, der Status steht aber noch auf "Offen".
    const amStart = taskWarnings(client, schedule, MON).get(offen.id) ?? [];
    expect(amStart.some((w) => w.text.includes('Start war am'))).toBe(true);

    // Nach dem Ende (Freitag) ist "In Arbeit" zu wenig.
    const danach = taskWarnings(client, schedule, '2026-01-12').get(ueberfaellig.id) ?? [];
    expect(danach.some((w) => w.text.includes('Ende war am'))).toBe(true);

    // Abgeschlossen ist nach dem Ende in Ordnung.
    ueberfaellig.status = 'done';
    const erledigt = taskWarnings(client, computeSchedule(client, 'max'), '2026-01-12').get(ueberfaellig.id) ?? [];
    expect(erledigt.some((w) => w.text.includes('Ende war am'))).toBe(false);
  });

  it('verteilt Bedarfszeitraeume und schneidet sie auf die Aufgabe zu', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    person.defaultFte = 1;
    client.people = [person];
    // Zehn Arbeitstage: Mo 05.01. bis Fr 16.01.2026.
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 10, durationMax: 10 },
    });
    task.assignments = [
      {
        id: 'a1',
        personId: person.id,
        mode: 'FTE',
        value: 0.2,
        periods: [
          // Erste Woche abweichend, zweite Woche faellt auf den Grundwert.
          { id: 'p1', from: MON, to: '2026-01-09', value: 1 },
          // Liegt komplett hinter der Aufgabe - darf nicht wirken.
          { id: 'p2', from: '2026-06-01', to: '2026-06-30', value: 1 },
        ],
      },
    ];

    const schedule = computeSchedule(client, 'max');
    const daily = personDailyLoad(client, schedule, EMPTY_FILTER).get(person.id)!;
    expect(daily.get(MON)!.reduce((s, c) => s + c.value, 0)).toBeCloseTo(1, 6);
    // Zweite Woche: kein Zeitraum greift -> Grundwert.
    expect(daily.get('2026-01-12')!.reduce((s, c) => s + c.value, 0)).toBeCloseTo(0.2, 6);
    // Ausserhalb der Aufgabe wird nichts gebucht.
    expect(daily.get('2026-06-01')).toBeUndefined();

    // ... und der unwirksame Zeitraum wird gemeldet.
    const warnings = taskWarnings(client, schedule, MON).get(task.id) ?? [];
    expect(warnings.some((w) => w.text.includes('ausserhalb der Aufgabe'))).toBe(true);
  });

  it('fuehrt eine monoton steigende kumulierte Reihe mit', () => {
    const { client, venture } = buildClient();
    const budget = createBudget('B');
    client.budgets = [budget];
    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: '2026-01-01', durationMin: 200, durationMax: 200 },
    });
    task.costs = [
      { id: 'c1', budgetId: budget.id, label: 'monatlich', amount: 100, actualAmount: 60, note: '', recurring: true, interval: 'month', every: 1 },
    ];

    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const series = budgetSeries(budget, daily, {
      from: '2026-01-01',
      to: '2026-12-31',
      granularity: 'month',
      personUnit: 'FTE',
    });

    const cum = series.points.map((p) => p.cumulative);
    // Nie fallend.
    expect(cum.every((v, i) => i === 0 || v >= cum[i - 1])).toBe(true);
    // Endwert = Summe aller Buckets.
    expect(series.cumulativeTotal).toBeCloseTo(series.points.reduce((s, p) => s + p.value, 0), 6);
    // Abrufe laufen getrennt mit und liegen unter der Planung.
    const lastActual = series.points[series.points.length - 1].cumulativeActual;
    expect(lastActual).toBeGreaterThan(0);
    expect(lastActual).toBeLessThan(series.cumulativeTotal);
  });

  it('warnt bei Personen und Budgets schon ab 90 Prozent Auslastung', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    person.defaultFte = 1;
    client.people = [person];
    const budget = createBudget('B');
    budget.totalLimit = 1000;
    client.budgets = [budget];

    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5 },
    });
    // 0,95 FTE und 950 EUR - beides unter der Grenze, aber ueber 90 Prozent.
    task.assignments = [{ id: 'a1', personId: person.id, mode: 'FTE', value: 0.95, periods: [] }];
    task.costs = [
      { id: 'c1', budgetId: budget.id, label: 'K', amount: 950, actualAmount: 0, note: '', recurring: false, interval: 'month', every: 1 },
    ];

    const warnings = resourceWarnings(client, computeSchedule(client, 'max'));
    expect(warnings.get(person.id)?.some((w) => w.text.includes('Fast ausgelastet'))).toBe(true);
    expect(warnings.get(budget.id)?.some((w) => w.text.includes('95 %'))).toBe(true);
  });
});
