/**
 * Tests der Rechenkerne: Arbeitstage, Terminierung/CPM und Ressourcen.
 * Diese Logik ist die Grundlage aller Visualisierungen - sie muss stimmen.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addWorkdays,
  buildBuckets,
  diffDays,
  today,
  isWorkday,
  subDuration,
  workdaysBetween,
  workdaysIn,
  addDuration,
  yearOf,
} from './dates';
import { collectNeighbourhood, computeSchedule, wouldCreateCycle } from './schedule';
import {
  budgetCeiling,
  budgetDailyLoad,
  budgetSeries,
  EMPTY_FILTER,
  periodValueAt,
  personDailyLoad,
  personSeries,
} from './resources';
import { resourceWarnings, taskWarnings } from './validate';
import { createBudget, createClient, createDemoClient, createPerson, createTask, createVenture } from '../model/factory';
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
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' } });
    addTask(client, venture, {
      title: 'B',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 3, durationMax: 3, durationUnit: 'days' },
    });

    const schedule = computeSchedule(client, 'max');
    const b = schedule.ordered.find((s) => s.task.title === 'B')!;
    expect(b.start).toBe('2026-01-12'); // A endet Fr 09.01., B startet Mo 12.01.
    expect(b.end).toBe('2026-01-14');
  });

  it('nimmt bei mehreren Vorgängern das späteste Ende', () => {
    const { client, venture } = buildClient();
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2, durationUnit: 'days' } });
    const b = addTask(client, venture, { title: 'B', schedule: { anchor: 'date', start: MON, durationMin: 8, durationMax: 8, durationUnit: 'days' } });
    addTask(client, venture, {
      title: 'C',
      dependsOn: [a.id, b.id],
      schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1, durationUnit: 'days' },
    });

    const schedule = computeSchedule(client, 'max');
    const c = schedule.byId.get(client.tasks[2].id)!;
    const bEnd = schedule.byId.get(b.id)!.end;
    expect(bEnd).toBe('2026-01-14');
    expect(c.start).toBe('2026-01-15');
  });

  it('unterscheidet optimistisches und pessimistisches Szenario', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, { title: 'A', schedule: { anchor: 'date', start: MON, durationMin: 4, durationMax: 7, durationUnit: 'days' } });

    expect(computeSchedule(client, 'min').ordered[0].duration).toBe(4);
    expect(computeSchedule(client, 'max').ordered[0].duration).toBe(7);
    expect(computeSchedule(client, 'min').ordered[0].endPessimistic).toBe('2026-01-13');
  });

  it('markiert den kritischen Pfad und weist Puffer aus', () => {
    const { client, venture } = buildClient();
    const start = addTask(client, venture, { title: 'Start', schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2, durationUnit: 'days' } });
    const lang = addTask(client, venture, {
      title: 'Lang',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 10, durationMax: 10, durationUnit: 'days' },
    });
    const kurz = addTask(client, venture, {
      title: 'Kurz',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 2, durationMax: 2, durationUnit: 'days' },
    });
    addTask(client, venture, {
      title: 'Ende',
      dependsOn: [lang.id, kurz.id],
      schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1, durationUnit: 'days' },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(lang.id)!.critical).toBe(true);
    expect(schedule.byId.get(lang.id)!.slack).toBe(0);
    expect(schedule.byId.get(kurz.id)!.critical).toBe(false);
    expect(schedule.byId.get(kurz.id)!.slack).toBe(8);
  });

  it('misst den Puffer am Ende des gerechneten Szenarios', () => {
    /*
     * Im optimistischen Szenario muss der kritische Pfad kritisch bleiben.
     *
     * Gemessen wurde einmal gegen das **pessimistische** Projektende: dann
     * endete im optimistischen Fall jede Kette vor diesem Ende, jede Aufgabe
     * bekam denselben Puffer und der kritische Pfad war verschwunden. Der
     * ausgewiesene Puffer war in Wahrheit die Dauerunschärfe der längsten
     * Kette - im Beispielmandanten 66 AT auf jeder einzelnen Aufgabe.
     */
    const { client, venture } = buildClient();
    const a = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 20, durationUnit: 'days' },
    });
    const b = addTask(client, venture, {
      title: 'B',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 5, durationMax: 20, durationUnit: 'days' },
    });
    // Kurze Nebenaufgabe ohne Nachfolger - sie hat echten Puffer.
    const neben = addTask(client, venture, {
      title: 'Neben',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1, durationUnit: 'days' },
    });

    for (const scenario of ['min', 'max'] as const) {
      const schedule = computeSchedule(client, scenario);
      expect(`${scenario}: A kritisch=${schedule.byId.get(a.id)!.critical}`).toBe(`${scenario}: A kritisch=true`);
      expect(schedule.byId.get(b.id)!.slack).toBe(0);
      expect(schedule.byId.get(neben.id)!.slack).toBeGreaterThan(0);
    }

    // Die Achse reicht weiterhin bis zum pessimistischen Ende der letzten
    // Aufgabe - dort ist der Plan in jedem Fall vorbei, auch wenn optimistisch
    // gerechnet wird. Nur der Puffer misst sich nicht mehr daran.
    const optimistisch = computeSchedule(client, 'min');
    const letzte = optimistisch.byId.get(b.id)!;
    expect(optimistisch.projectEnd).toBe(letzte.endPessimistic);
    expect(diffDays(letzte.end, optimistisch.projectEnd)).toBeGreaterThan(0);
  });

  it('hat in jedem Szenario einen kritischen Pfad', () => {
    /*
     * Der Grund für diesen Test: der optimistische Fall war praktisch
     * ungeprüft. Von 46 Aufrufen von `computeSchedule` in den Tests rechneten
     * 44 pessimistisch, und die beiden übrigen sahen sich nur eine Dauer an -
     * nie Puffer oder kritischen Pfad. Dadurch blieb monatelang unbemerkt,
     * dass optimistisch **jede** Aufgabe Puffer auswies und der kritische Pfad
     * ganz fehlte.
     *
     * Geprüft wird deshalb am Beispielmandanten die Eigenschaft, die in jedem
     * Szenario gelten muss: irgendetwas bestimmt das Projektende, und was das
     * Projektende bestimmt, hat keinen Puffer.
     */
    const client = createDemoClient();
    for (const scenario of ['min', 'max'] as const) {
      const schedule = computeSchedule(client, scenario);
      const endlich = schedule.ordered.filter((st) => !st.openEnded);
      // diffDays(a, b) ist b - a: positiv heisst, b liegt später.
      const spaetestes = endlich.reduce((a, b) => (diffDays(a.end, b.end) > 0 ? b : a));
      expect(`${scenario}: ${spaetestes.task.title} Puffer ${spaetestes.slack}`).toBe(
        `${scenario}: Zweiter Standort Puffer 0`,
      );
      expect(endlich.some((st) => st.critical)).toBe(true);
      // Und nicht alles ist kritisch - sonst wäre die Aussage wertlos.
      expect(endlich.some((st) => st.slack > 0)).toBe(true);
    }
  });

  it('weist über ein Wochenende hinweg keinen Scheinpuffer aus', () => {
    // A endet Freitag, B startet Montag - die Kette ist durchgehend kritisch.
    const { client, venture } = buildClient();
    const a = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });
    const b = addTask(client, venture, {
      title: 'B',
      dependsOn: [a.id],
      schedule: { anchor: 'dependency', durationMin: 5, durationMax: 5, durationUnit: 'days' },
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
    const a = addTask(client, venture, { title: 'A', schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1, durationUnit: 'days' } });
    const b = addTask(client, venture, { title: 'B', schedule: { anchor: 'dependency', durationMin: 1, durationMax: 1, durationUnit: 'days' } });
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    addTask(client, venture, { title: 'Frei', schedule: { anchor: 'date', start: MON, durationMin: 1, durationMax: 1, durationUnit: 'days' } });

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

  it('rechnet Kalenderdauern kalendarisch, Arbeitstage in Arbeitstagen', () => {
    // Der Kern der Sache: fuenf Jahre ab dem 1. Januar enden am 31. Dezember
    // des fuenften Jahres - kein Abzug von Wochenenden.
    expect(addDuration('2026-01-01', 5, 'years')).toBe('2030-12-31');
    expect(addDuration('2026-01-01', 1, 'months')).toBe('2026-01-31');
    expect(addDuration('2026-01-01', 3, 'months')).toBe('2026-03-31');
    expect(addDuration('2026-01-05', 1, 'weeks')).toBe('2026-01-11');
    // Arbeitstage zaehlen weiterhin Mo-Fr: Montag + 5 AT endet am Freitag.
    expect(addDuration('2026-01-05', 5, 'days')).toBe('2026-01-09');

    // Rueckwaerts landet man wieder am Ausgangstag.
    expect(subDuration('2030-12-31', 5, 'years')).toBe('2026-01-01');
    expect(subDuration('2026-01-31', 1, 'months')).toBe('2026-01-01');
    expect(subDuration('2026-01-09', 5, 'days')).toBe('2026-01-05');
  });

  it('führt Dauerläufer bis zum Horizontende fort', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, { title: 'Normal', schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' } });
    const betrieb = addTask(client, venture, {
      title: 'Betrieb',
      schedule: { anchor: 'date', start: MON, durationMin: 0, durationMax: 0, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 10, durationMax: 10, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: '2026-01-01', durationMin: 200, durationMax: 200, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });
    task.costs = [{ id: 'c1', budgetId: budget.id, label: 'teuer', amount: 5000, actualAmount: 0, note: '', recurring: false, interval: 'month', every: 1 }];

    const options = { from: '2026-01-01', to: '2026-12-31', granularity: 'year' as const, personUnit: 'FTE' as const };
    const seriesOf = () => {
      const schedule = computeSchedule(client, 'max');
      const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
      return budgetSeries(budget, daily, options);
    };

    // Eine Planung ueber der Obergrenze ist noch keine Ueberschreitung -
    // gerissen wird ein Budget erst durch das Geld, das abfliesst.
    const planned = seriesOf();
    expect(planned.breaches).toHaveLength(0);
    expect(planned.yearly[0]).toMatchObject({ year: 2026, value: 5000 });

    task.costs[0].actualAmount = 5000;
    expect(seriesOf().breaches).toHaveLength(1);

    // Genau auf der Grenze ist die Grenze eingehalten.
    task.costs[0].actualAmount = 1000;
    expect(seriesOf().breaches).toHaveLength(0);
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
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 3, durationMax: 3, durationUnit: 'days' },
    });
    const b = addTask(client, venture, {
      title: 'B',
      schedule: { anchor: 'date', start: '2026-03-02', durationMin: 3, durationMax: 3, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 2, durationMax: 2, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: '2026-06-01', durationMin: 2, durationMax: 2, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });
    const ueberfaellig = addTask(client, venture, {
      title: 'Laeuft ueber',
      status: 'active',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: MON, durationMin: 10, durationMax: 10, durationUnit: 'days' },
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
      schedule: { anchor: 'date', start: '2026-01-01', durationMin: 200, durationMax: 200, durationUnit: 'days' },
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

  it('warnt bei Personen und Budgets ab 90 Prozent, aber nie bei genau 100', () => {
    const { client, venture } = buildClient();
    const person = createPerson('P');
    person.defaultFte = 1;
    client.people = [person];
    const budget = createBudget('B');
    budget.totalLimit = 1000;
    client.budgets = [budget];

    const task = addTask(client, venture, {
      title: 'A',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });
    // 0,95 FTE und 950 EUR abgerufen - beides unter der Grenze, aber ueber
    // 90 Prozent. Der geplante Betrag liegt daneben und darf nicht zaehlen.
    task.assignments = [{ id: 'a1', personId: person.id, mode: 'FTE', value: 0.95, periods: [] }];
    task.costs = [
      { id: 'c1', budgetId: budget.id, label: 'K', amount: 5000, actualAmount: 950, note: '', recurring: false, interval: 'month', every: 1 },
    ];

    const warnings = resourceWarnings(client, computeSchedule(client, 'max'));
    expect(warnings.get(person.id)?.some((w) => w.text.includes('Fast ausgelastet'))).toBe(true);
    expect(warnings.get(budget.id)?.some((w) => w.text.includes('95 %'))).toBe(true);

    // Genau ausgelastet ist der Idealfall und keine Meldung wert.
    task.assignments[0].value = 1;
    task.costs[0].actualAmount = 1000;
    const exact = resourceWarnings(client, computeSchedule(client, 'max'));
    expect(exact.get(person.id) ?? []).toHaveLength(0);
    expect(exact.get(budget.id) ?? []).toHaveLength(0);
  });
});

describe('Kalenderdauern in der Terminierung', () => {
  it('lässt eine Jahresaufgabe am Jahresende enden', () => {
    const { client, venture } = buildClient();
    const task = addTask(client, venture, {
      title: 'Rahmenvertrag',
      schedule: {
        anchor: 'date',
        start: '2026-01-01',
        durationMin: 5,
        durationMax: 5,
        durationUnit: 'years',
      },
    });

    const st = computeSchedule(client, 'max').byId.get(task.id)!;
    // Der 1.1.2026 ist ein Donnerstag, der Start bleibt also stehen.
    expect(st.start).toBe('2026-01-01');
    expect(st.end).toBe('2030-12-31');
    // In Arbeitstagen umgerechnet waeren es rund 1260 - genau die Zahl, die
    // hier NICHT verwendet werden darf.
    expect(st.unit).toBe('years');
  });
});

describe('Kritischer Pfad', () => {
  it('markiert die längste Kette und lässt der kurzen ihren Puffer', () => {
    const { client, venture } = buildClient();
    const start = addTask(client, venture, {
      title: 'Start',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });
    const lang = addTask(client, venture, {
      title: 'Lang',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 20, durationMax: 20, durationUnit: 'days' },
    });
    const kurz = addTask(client, venture, {
      title: 'Kurz',
      dependsOn: [start.id],
      schedule: { anchor: 'dependency', durationMin: 2, durationMax: 2, durationUnit: 'days' },
    });
    const ende = addTask(client, venture, {
      title: 'Ende',
      dependsOn: [lang.id, kurz.id],
      schedule: { anchor: 'dependency', durationMin: 3, durationMax: 3, durationUnit: 'days' },
    });

    const schedule = computeSchedule(client, 'max');
    expect(schedule.byId.get(start.id)!.critical).toBe(true);
    expect(schedule.byId.get(lang.id)!.critical).toBe(true);
    expect(schedule.byId.get(ende.id)!.critical).toBe(true);
    // Die kurze Kette hat echten Puffer und liegt deshalb nicht auf dem Pfad.
    expect(schedule.byId.get(kurz.id)!.critical).toBe(false);
    expect(schedule.byId.get(kurz.id)!.slack).toBeGreaterThan(0);
  });
});

describe('Wiederkehrende Kosten', () => {
  function budgetWith(task: Task, client: Client, cost: Partial<Task['costs'][number]>) {
    const budget = createBudget('B');
    client.budgets = [budget];
    task.costs = [
      {
        id: 'c1',
        budgetId: budget.id,
        label: 'Miete',
        amount: 100,
        actualAmount: 0,
        note: '',
        recurring: true,
        interval: 'quarter',
        every: 1,
        ...cost,
      },
    ];
    return budget;
  }

  it('bucht zum Rasterbeginn und nur innerhalb der Laufzeit', () => {
    const { client, venture } = buildClient();
    // Genau ein Halbjahr, sauber auf Quartalsgrenzen.
    const task = addTask(client, venture, {
      title: 'Betrieb',
      schedule: {
        anchor: 'date',
        start: '2026-01-01',
        durationMin: 6,
        durationMax: 6,
        durationUnit: 'months',
      },
    });
    const budget = budgetWith(task, client, {});

    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    const days = [...daily.keys()].sort();

    // Zwei Raten, jeweils am ersten Tag des Quartals - und keine im dritten.
    expect(days).toEqual(['2026-01-01', '2026-04-01']);
  });

  it('verschiebt die erste Rate auf den nächsten Rasterbeginn', () => {
    const { client, venture } = buildClient();
    const task = addTask(client, venture, {
      title: 'Betrieb',
      schedule: {
        anchor: 'date',
        start: '2026-02-10',
        durationMin: 7,
        durationMax: 7,
        durationUnit: 'months',
      },
    });
    const budget = budgetWith(task, client, {});

    const schedule = computeSchedule(client, 'max');
    const daily = budgetDailyLoad(client, schedule, EMPTY_FILTER).get(budget.id)!;
    expect([...daily.keys()].sort()).toEqual(['2026-04-01', '2026-07-01']);

    // ... und meldet, dass die Aufgabe quer zum Abrechnungsraster liegt.
    const warnings = taskWarnings(client, schedule).get(task.id) ?? [];
    expect(warnings.some((w) => w.text.includes('Raten'))).toBe(true);
  });
});

describe('Budget-Obergrenzen', () => {
  it('setzt die Obergrenze aus Basiswert und Zeiträumen zusammen', () => {
    const budget = createBudget('B');
    budget.totalLimit = 0;
    budget.limits = [
      { id: 'l1', from: '2026-01-01', to: '2026-12-31', value: 100 },
      { id: 'l2', from: '2027-01-01', to: '2027-12-31', value: 150 },
    ];

    // Beide Jahre im Blick: die Summe zählt.
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(250);
    // Nur das erste Jahr: nur dessen Grenze.
    expect(budgetCeiling(budget, '2026-01-01', '2026-12-31')).toBe(100);

    // Kommt ein Gesamtdeckel dazu, gilt der engere von beiden.
    budget.totalLimit = 200;
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(200);
    budget.totalLimit = 400;
    expect(budgetCeiling(budget, '2026-01-01', '2027-12-31')).toBe(250);
  });

  it('zieht die Zeitachse bis zu den gepflegten Grenzwerten', () => {
    const { client, venture } = buildClient();
    addTask(client, venture, {
      title: 'Kurz',
      schedule: { anchor: 'date', start: MON, durationMin: 5, durationMax: 5, durationUnit: 'days' },
    });

    const ohne = computeSchedule(client, 'max');
    const budget = createBudget('B');
    budget.limits = [{ id: 'l1', from: '2029-01-01', to: '2029-12-31', value: 1000 }];
    client.budgets = [budget];
    const mit = computeSchedule(client, 'max');

    // Ohne Grenzwert endet die Anzeige mit der Aufgabe, mit Grenzwert reicht
    // sie bis in das Jahr, fuer das etwas hinterlegt ist.
    expect(ohne.displayEnd < '2029-01-01').toBe(true);
    expect(mit.displayEnd).toBe('2029-12-31');
    expect(mit.horizonEnd >= '2029-12-31').toBe(true);
    // Der Anfang folgt weiter der Viertel-Regel und nicht dem 1. Januar der
    // Jahresgrenze - er liegt also nicht auf einem Jahresanfang.
    expect(mit.displayStart.slice(5)).not.toBe('01-01');
  });

  it('legt den heutigen Tag ins linke Viertel', () => {
    const { client, venture } = buildClient();
    // Erst in der Zukunft, damit kein alter Termin den Anfang bestimmt.
    addTask(client, venture, {
      title: 'Laeuft',
      schedule: {
        anchor: 'date',
        start: addDays(today(), 30),
        durationMin: 60,
        durationMax: 60,
        durationUnit: 'days',
      },
    });

    const { displayStart, displayEnd } = computeSchedule(client, 'max');
    const span = diffDays(displayStart, displayEnd);
    const past = diffDays(displayStart, today());
    // Ein Viertel Rueckblick, drei Viertel Ausblick - Toleranz fuer die
    // Rundung auf ganze Tage.
    expect(Math.abs(past / span - 0.25)).toBeLessThan(0.02);
  });
});
