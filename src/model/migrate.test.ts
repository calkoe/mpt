/**
 * Tests der Migration/Normalisierung. Kernanforderung: alte oder beschädigte
 * Datenstände dürfen nie zu Datenverlust oder einem Absturz führen.
 */
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { createDatabase, createDemoClient } from './factory';
import { CURRENT_SCHEMA_VERSION, isOpenEnded } from './types';
import { computeSchedule } from '../engine/schedule';

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
    expect(task.notes).toBe('');
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
