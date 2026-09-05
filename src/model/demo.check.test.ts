/**
 * Der Beispielbestand ist das Erste, was jemand sieht - er darf keine
 * vermeidbaren Warnungen erzeugen. Insbesondere muessen wiederkehrende Kosten
 * auf dem Abrechnungsraster liegen.
 */
import { describe, expect, it } from 'vitest';
import { createDemoClient } from './factory';
import { computeSchedule } from '../engine/schedule';
import { resourceWarnings, taskWarnings } from '../engine/validate';

describe('Beispielbestand', () => {
  const client = createDemoClient();
  const schedule = computeSchedule(client, 'max');

  it('erzeugt keine Warnungen über das Abrechnungsraster', () => {
    const all = [...taskWarnings(client, schedule).values()].flat();
    const raster = all.filter((w) => w.text.includes('Raten'));
    expect(raster.map((w) => w.text)).toEqual([]);
  });

  it('hat gepflegte Grenzwerte bei allen Budgets und Personen', () => {
    // Ohne Grenzwerte zeigt die Auslastung nichts an - genau daran soll der
    // Beispielbestand die Auswertungen vorführen.
    expect(client.budgets.every((b) => b.limits.length > 0 || b.totalLimit > 0)).toBe(true);
    expect(client.people.every((p) => p.availability.length > 0)).toBe(true);
  });

  it('zeigt sowohl geplante als auch abgerufene Beträge', () => {
    const costs = client.tasks.flatMap((t) => t.costs);
    expect(costs.some((c) => c.actualAmount > 0)).toBe(true);
    expect(costs.some((c) => c.actualAmount === 0)).toBe(true);
  });

  it('bleibt rechenbar - keine Zyklen, alle Aufgaben terminiert', () => {
    expect(schedule.cycles).toEqual([]);
    expect(schedule.byId.size).toBe(client.tasks.length);
    // Die Ressourcenwarnungen dürfen laufen, ohne zu werfen.
    expect(() => resourceWarnings(client, schedule)).not.toThrow();
  });
});
