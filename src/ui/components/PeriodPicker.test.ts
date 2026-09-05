/**
 * Zeitraumauswahl - die Rasterlogik.
 *
 * Getestet wird die eine Eigenschaft, an der sie steht und fällt: **was der
 * Wähler anzeigt, muss auf genau das gespeicherte Datum zurückführen.** Hält
 * das nicht, zeigt er einen Zeitpunkt an, in dem die Aufgabe gar nicht liegt -
 * und genau das ist einmal passiert (ein Septembertermin erschien als "KW 9",
 * weil im Index die Monatszahl stand).
 *
 * Die Prüfung läuft über ganze Jahre statt über ausgesuchte Tage: Wochen- und
 * Jahresgrenzen fallen auseinander, und die Fälle, die dabei schiefgehen,
 * sucht man sich von Hand nicht aus.
 */
import { describe, expect, it } from 'vitest';
import { addDays, isoWeekNumber, isoWeekYear, startOfWeek } from '../../engine/dates';
import { boundsOf, fitsScale, scaleOfStart, selectionOfStart } from './PeriodPicker';

/** Alle Tage von `from` bis `to`, beide inklusive. */
function everyDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Drei Jahre mit unterschiedlicher Wochenlage; 2026 hat 53 ISO-Wochen.
const DAYS = everyDay('2025-01-01', '2027-12-31');

describe('PeriodPicker', () => {
  it('führt jede passende Stufe genau auf das Datum zurück', () => {
    for (const day of DAYS) {
      const scale = scaleOfStart(day);
      if (scale === 'custom') continue;
      const bounds = boundsOf(selectionOfStart(day, scale));
      expect(`${day} als ${scale} -> ${bounds.from}`).toBe(`${day} als ${scale} -> ${day}`);
    }
  });

  it('nennt immer das gröbste passende Raster', () => {
    expect(scaleOfStart('2026-01-01')).toBe('year');
    // Quartalsanfang, aber nicht Jahresanfang.
    expect(scaleOfStart('2026-04-01')).toBe('quarter');
    expect(scaleOfStart('2026-07-01')).toBe('quarter');
    expect(scaleOfStart('2026-10-01')).toBe('quarter');
    // Monatsanfang, aber kein Quartalsanfang.
    expect(scaleOfStart('2026-05-01')).toBe('month');
    // Montag, aber kein Monatsanfang.
    expect(scaleOfStart('2026-09-07')).toBe('week');
    // Ein Montag, der zugleich Monatsanfang ist, gilt als Monat - nicht als KW.
    expect(startOfWeek('2026-06-01')).toBe('2026-06-01');
    expect(scaleOfStart('2026-06-01')).toBe('month');
  });

  it('lässt taggenaue Termine als solche stehen', () => {
    // Ein Dienstag mitten im Monat passt auf kein Raster.
    expect(scaleOfStart('2026-09-08')).toBe('custom');
    expect(fitsScale('2026-09-08')).toBe(false);
    expect(fitsScale('2026-09-07')).toBe(true);
    expect(fitsScale(undefined)).toBe(false);
  });

  it('rechnet die Kalenderwoche und nicht die Monatszahl', () => {
    // Der Fehler, der das hier ausgelöst hat: September wurde zu KW 9.
    const auswahl = selectionOfStart('2026-09-07', 'week');
    expect(auswahl.index).toBe(isoWeekNumber('2026-09-07'));
    expect(auswahl.index).toBe(37);
    expect(auswahl.year).toBe(isoWeekYear('2026-09-07'));
  });

  it('hält beim Wechsel der Stufe den Zeitpunkt, nur gröber', () => {
    const tag = '2026-09-07';
    expect(boundsOf(selectionOfStart(tag, 'week')).from).toBe('2026-09-07');
    expect(boundsOf(selectionOfStart(tag, 'month')).from).toBe('2026-09-01');
    expect(boundsOf(selectionOfStart(tag, 'quarter')).from).toBe('2026-07-01');
    expect(boundsOf(selectionOfStart(tag, 'year')).from).toBe('2026-01-01');
  });

  it('kommt über den Jahreswechsel hinweg mit der ISO-Woche zurecht', () => {
    /*
     * Der 28.12.2026 ist ein Montag und gehört noch zu 2026 (das Jahr hat 53
     * Wochen). Der 03.01.2028 ist ebenfalls ein Montag, gehört aber zur KW 1
     * von 2028 - das Wochenjahr weicht hier vom Kalenderjahr ab, und genau
     * dort verrutscht so eine Auswahl gern.
     */
    for (const montag of ['2025-12-29', '2026-12-28', '2027-01-04', '2027-12-27']) {
      expect(startOfWeek(montag)).toBe(montag);
      const auswahl = selectionOfStart(montag, 'week');
      expect(auswahl.year).toBe(isoWeekYear(montag));
      expect(auswahl.index).toBe(isoWeekNumber(montag));
      expect(boundsOf(auswahl).from).toBe(montag);
    }
  });

  it('deckt für jedes Datum genau eine Stufe ab und keine zwei', () => {
    // Jeder Tag bekommt eine Stufe; sie ist eindeutig und stabil.
    const gezaehlt = new Map<string, number>();
    for (const day of DAYS) {
      const scale = scaleOfStart(day);
      gezaehlt.set(scale, (gezaehlt.get(scale) ?? 0) + 1);
      expect(scaleOfStart(day)).toBe(scale);
    }
    // Drei Jahresanfänge, je drei weitere Quartalsanfänge, der Rest Monate.
    expect(gezaehlt.get('year')).toBe(3);
    expect(gezaehlt.get('quarter')).toBe(9);
    expect(gezaehlt.get('month')).toBe(24);
    expect(gezaehlt.get('week')).toBeGreaterThan(100);
  });
});
