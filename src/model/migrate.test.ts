/**
 * Tests der Migration/Normalisierung. Kernanforderung: alte oder beschädigte
 * Datenstände dürfen nie zu Datenverlust oder einem Absturz führen.
 */
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { createDatabase, createDemoClient } from './factory';
import { CURRENT_SCHEMA_VERSION, isOpenEnded } from './types';
import { computeSchedule } from '../engine/schedule';
import { isVentureDone } from '../engine/validate';

describe('Migration', () => {
  it('lässt einen aktuellen Datenbestand unverändert', () => {
    const db = createDatabase([createDemoClient()]);
    const result = migrate(JSON.parse(JSON.stringify(db)));
    expect(result.db.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.db.clients[0].tasks).toHaveLength(db.clients[0].tasks.length);
    expect(result.migrated).toBe(false);
  });

  it('fängt leere und unbrauchbare Eingaben ab', () => {
    expect(migrate(null).db.clients).toHaveLength(0);
    expect(migrate('kaputt').db.clients).toHaveLength(0);
    expect(migrate({}).db.clients).toHaveLength(1); // Standardmandant wird angelegt
  });

  it('ergänzt fehlende Felder mit Defaults', () => {
    const result = migrate({
      schemaVersion: 1,
      clients: [{ id: 'c1', name: 'Alt', ventures: [{ id: 'v1', name: 'V' }], tasks: [{ id: 't1', ventureId: 'v1', title: 'A' }] }],
    });
    const task = result.db.clients[0].tasks[0];
    expect(task.schedule.durationMin).toBeGreaterThanOrEqual(1);
    expect(task.schedule.durationMax).toBeGreaterThanOrEqual(task.schedule.durationMin);
    expect(task.status).toBe('open');
    expect(task.checklist).toEqual([]);
  });

  it('übernimmt eine alte Einzel-Dauer in die Spanne', () => {
    const result = migrate({
      schemaVersion: 1,
      clients: [
        {
          id: 'c1',
          name: 'Alt',
          ventures: [{ id: 'v1', name: 'V' }],
          tasks: [{ id: 't1', ventureId: 'v1', title: 'A', schedule: { anchor: 'date', start: '2026-01-05', duration: 8 } }],
        },
      ],
    });
    const schedule = result.db.clients[0].tasks[0].schedule;
    expect(schedule.durationMin).toBe(8);
    expect(schedule.durationMax).toBe(8);
  });

  it('entfernt tote Verweise, statt zu scheitern', () => {
    const result = migrate({
      schemaVersion: 1,
      clients: [
        {
          id: 'c1',
          name: 'X',
          ventures: [{ id: 'v1', name: 'V' }],
          people: [],
          budgets: [],
          tags: [],
          conditions: [],
          tasks: [
            {
              id: 't1',
              ventureId: 'v1',
              title: 'A',
              dependsOn: ['gibt-es-nicht'],
              tagIds: ['weg'],
              conditionIds: ['weg'],
              assignments: [{ id: 'a1', personId: 'weg', mode: 'FTE', value: 1 }],
              costs: [{ id: 'k1', budgetId: 'weg', amount: 10 }],
            },
          ],
        },
      ],
    });
    const task = result.db.clients[0].tasks[0];
    expect(task.dependsOn).toEqual([]);
    expect(task.tagIds).toEqual([]);
    expect(task.assignments).toEqual([]);
    expect(task.costs).toEqual([]);
  });

  it('ordnet Aufgaben ohne gültiges Vorhaben einem Auffang-Vorhaben zu', () => {
    const result = migrate({
      schemaVersion: 1,
      clients: [{ id: 'c1', name: 'X', ventures: [], tasks: [{ id: 't1', ventureId: 'weg', title: 'A' }] }],
    });
    const client = result.db.clients[0];
    expect(client.ventures).toHaveLength(1);
    expect(client.tasks[0].ventureId).toBe(client.ventures[0].id);
  });

  it('meldet neuere Schemaversionen, verwirft die Daten aber nicht', () => {
    const result = migrate({ schemaVersion: 999, clients: [{ id: 'c1', name: 'Zukunft', tasks: [], ventures: [] }] });
    expect(result.notes.join(' ')).toMatch(/neueren Version/);
    expect(result.db.clients[0].name).toBe('Zukunft');
  });

  it('hebt Dauerlaeufer von Schema 1 auf "keine Dauer" (Schema 2)', () => {
    const result = migrate({
      schemaVersion: 1,
      clients: [
        {
          id: 'c1',
          name: 'Alt',
          ventures: [{ id: 'v1', name: 'V' }],
          tasks: [
            { id: 't1', ventureId: 'v1', title: 'Betrieb', schedule: { anchor: 'date', durationMin: 1, durationMax: 1, openEnded: true } },
            { id: 't2', ventureId: 'v1', title: 'Normal', schedule: { anchor: 'date', durationMin: 4, durationMax: 6, openEnded: false } },
          ],
        },
      ],
    });

    const [betrieb, normal] = result.db.clients[0].tasks;
    // Kein Kennzeichen mehr, sondern schlicht keine Dauer.
    expect(isOpenEnded(betrieb.schedule)).toBe(true);
    expect(betrieb.schedule.durationMax).toBe(0);
    expect(isOpenEnded(normal.schedule)).toBe(false);
    expect(normal.schedule.durationMax).toBe(6);
    // Das neue Meilenstein-Kennzeichen wird ergaenzt.
    expect(betrieb.milestone).toBe(false);
    expect(result.migrated).toBe(true);
  });

  it('hebt Schema 2 auf 3: Freitext, Vorhaben, Tags, Budgetart, Bedarfe, Kosten', () => {
    const result = migrate({
      schemaVersion: 2,
      clients: [
        {
          id: 'c1',
          name: 'Alt',
          tags: [{ id: 'tg1', name: 'Extern', color: '#4f7cff' }],
          ventures: [{ id: 'v1', name: 'V', description: 'faellt weg', done: true }],
          people: [{ id: 'p1', name: 'P', defaultFte: 1 }],
          budgets: [{ id: 'b1', name: 'B', totalLimit: 100 }],
          tasks: [
            {
              id: 't1',
              ventureId: 'v1',
              title: 'A',
              status: 'blocked',
              notes: 'geht verloren',
              schedule: { anchor: 'date', durationMin: 3, durationMax: 3 },
              assignments: [{ id: 'a1', personId: 'p1', mode: 'FTE', value: 0.5 }],
              costs: [{ id: 'k1', budgetId: 'b1', label: 'K', amount: 500, recurring: false, interval: 'month', every: 1 }],
            },
          ],
        },
      ],
    });

    const client = result.db.clients[0];
    const task = client.tasks[0];

    // Die Kette laeuft bis zur aktuellen Version durch, nicht nur einen Schritt.
    expect(result.db.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // Freitext und Vorhabenbeschreibung sind weg, der Abschlussschalter auch.
    expect('notes' in task).toBe(false);
    expect('description' in client.ventures[0]).toBe(false);
    expect('done' in client.ventures[0]).toBe(false);
    // "Blockiert" wird zu "Offen" - nicht zu "Betrieb", das hiesse erledigt.
    expect(task.status).toBe('open');
    // Neue Felder mit Defaults.
    expect(task.layout).toBeUndefined();
    expect(client.people[0].tagIds).toEqual([]);
    expect(client.budgets[0].kind).toBe('neutral');
    expect(client.budgets[0].tagIds).toEqual([]);
    expect(task.assignments[0].periods).toEqual([]);
    expect(task.costs[0].actualAmount).toBe(0);
    // Bestehendes bleibt unangetastet.
    expect(task.assignments[0].value).toBe(0.5);
    expect(task.costs[0].amount).toBe(500);
  });

  it('leitet den Vorhabenstatus aus den Aufgaben ab', () => {
    const client = createDemoClient();
    const betrieb = client.ventures[1];
    // Der Beispielmandant hat im Vorhaben "Betrieb" genau eine Dauerlaeufer-Aufgabe.
    expect(isVentureDone(client, betrieb.id)).toBe(false);
    for (const t of client.tasks.filter((x) => x.ventureId === betrieb.id)) t.status = 'operations';
    // "Betrieb" zaehlt wie abgeschlossen.
    expect(isVentureDone(client, betrieb.id)).toBe(true);
  });

  it('entfernt tote Tag-Verweise an Personen und Budgets', () => {
    const result = migrate({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      clients: [
        {
          id: 'c1',
          name: 'X',
          tags: [{ id: 'tg1', name: 'Echt', color: '#4f7cff' }],
          ventures: [],
          tasks: [],
          people: [{ id: 'p1', name: 'P', tagIds: ['tg1', 'weg'] }],
          budgets: [{ id: 'b1', name: 'B', tagIds: ['weg'] }],
        },
      ],
    });
    expect(result.db.clients[0].people[0].tagIds).toEqual(['tg1']);
    expect(result.db.clients[0].budgets[0].tagIds).toEqual([]);
  });

  it('ergaenzt das Notizfeld an Kostenpositionen (Schema 3 -> 4)', () => {
    const result = migrate({
      schemaVersion: 3,
      clients: [
        {
          id: 'c1',
          name: 'X',
          ventures: [{ id: 'v1', name: 'V' }],
          tasks: [
            {
              id: 't1',
              ventureId: 'v1',
              title: 'A',
              costs: [
                { id: 'k1', budgetId: 'b1', label: 'K', amount: 100, actualAmount: 40, recurring: false, interval: 'month', every: 1 },
              ],
            },
          ],
          budgets: [{ id: 'b1', name: 'B' }],
        },
      ],
    });
    const cost = result.db.clients[0].tasks[0].costs[0];
    expect(cost.note).toBe('');
    // Geplant und abgerufen bleiben unangetastet.
    expect(cost.amount).toBe(100);
    expect(cost.actualAmount).toBe(40);
  });

  it('erklaert bestehende Dauern zu Arbeitstagen (Schema 4 -> 5)', () => {
    const result = migrate({
      schemaVersion: 4,
      clients: [
        {
          id: 'c1',
          name: 'X',
          ventures: [{ id: 'v1', name: 'V' }],
          tasks: [
            {
              id: 't1',
              ventureId: 'v1',
              title: 'A',
              schedule: { anchor: 'date', start: '2026-01-05', durationMin: 10, durationMax: 15 },
            },
          ],
        },
      ],
    });
    const schedule = result.db.clients[0].tasks[0].schedule;
    // Die Zahlen bleiben, sie heissen ab jetzt nur ausdruecklich Arbeitstage -
    // alles andere wuerde bestehende Plaene stillschweigend verschieben.
    expect(schedule.durationMin).toBe(10);
    expect(schedule.durationMax).toBe(15);
    expect(schedule.durationUnit).toBe('days');
  });

  it('verwirft unvollstaendige Sperrvermerke, statt die Datei zu blockieren', () => {
    expect(migrate({ schemaVersion: CURRENT_SCHEMA_VERSION, clients: [], lock: { holder: 'X' } }).db.lock).toBeNull();
    const gueltig = migrate({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      clients: [],
      lock: { sessionId: 's1', holder: 'Anna', heartbeatAt: '2026-01-01T10:00:00.000Z' },
    });
    expect(gueltig.db.lock?.holder).toBe('Anna');
  });

  it('liefert einen rechenbaren Bestand - der Demomandant terminiert sauber', () => {
    const db = createDatabase([createDemoClient()]);
    const schedule = computeSchedule(db.clients[0], 'max');
    expect(schedule.cycles).toHaveLength(0);
    expect(schedule.ordered.length).toBe(db.clients[0].tasks.length);
    expect(schedule.ordered.some((s) => s.critical)).toBe(true);
  });
});
