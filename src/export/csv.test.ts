/**
 * Tests des CSV-Exports. Wichtig ist weniger die exakte Zeile als dass die
 * Datei in Excel als Tabelle ankommt: BOM, Semikolon, maskierte Felder.
 */
import { describe, expect, it } from 'vitest';
import { createDatabase, createDemoClient } from '../model/factory';
import { databaseToCsv } from './csv';

describe('CSV-Export', () => {
  const csv = databaseToCsv(createDatabase([createDemoClient()]));

  it('beginnt mit einem BOM, damit Excel Umlaute erkennt', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Grobkonzept');
  });

  it('enthält alle Abschnitte', () => {
    for (const section of ['Aufgaben', 'Kostenpositionen', 'Personen', 'Budgets', 'Vorhaben', 'Bedingungen']) {
      expect(csv).toContain(`# ${section}`);
    }
  });

  it('maskiert Felder mit Semikolon oder Anführungszeichen', () => {
    const db = createDatabase([createDemoClient()]);
    db.clients[0].tasks[0].title = 'A; mit "Zitat"';
    const out = databaseToCsv(db);
    expect(out).toContain('"A; mit ""Zitat"""');
  });

  it('schreibt bei Dauerläufern kein Enddatum', () => {
    const db = createDatabase([createDemoClient()]);
    const runner = db.clients[0].tasks.find((t) => t.schedule.durationMax === 0);
    expect(runner).toBeDefined();
    expect(databaseToCsv(db)).toContain('kein Enddatum');
  });

  it('kennzeichnet Meilensteine', () => {
    const db = createDatabase([createDemoClient()]);
    expect(db.clients[0].tasks.some((t) => t.milestone)).toBe(true);
    expect(databaseToCsv(db)).toContain('Meilenstein');
  });
});
