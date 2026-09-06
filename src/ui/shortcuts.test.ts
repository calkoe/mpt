/**
 * Tastenkürzel auf beiden Plattformen.
 *
 * Der Anlass steht in `shortcuts.ts`: unter macOS erzeugt die Wahltaste ein
 * Sonderzeichen, und ein Vergleich über `event.key` findet dort nichts. Auf
 * einem Mac war deshalb kein einziges Alt-Kürzel benutzbar - ohne dass
 * irgendetwas gemeldet hätte, dass eine Taste ins Leere geht.
 *
 * Windows lässt sich hier nicht ausprobieren, die Ereignisse aber schon:
 * beide Plattformen laufen durch dieselben Prüfungen.
 */
import { describe, expect, it } from 'vitest';
import {
  formatShortcut,
  matches,
  SHORTCUTS,
  SHORTCUT_CONFLICTS,
  shortcutParts,
  withShortcut,
  type Chord,
  type Platform,
  type Shortcut,
} from './shortcuts';

/** Ein Tastenereignis, wie der Browser es liefert. */
function press(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

/** Kennzeichnung einer Kombination - für Doppelbelegung und Sperrliste. */
function chordKey(chord: Chord): string {
  return `${chord.mod ? 'mod+' : ''}${chord.alt ? 'alt+' : ''}${chord.shift ? 'shift+' : ''}${chord.code}`;
}

const ALLE = Object.entries(SHORTCUTS) as [string, Shortcut][];

describe('Tastenkürzel', () => {
  it('erkennt Alt-Kürzel auf dem Mac trotz Sonderzeichen', () => {
    /*
     * Genau diese Ereignisse liefert Chrome unter macOS: die Wahltaste macht
     * aus N ein "Dead" (˜) und aus 1 ein "¡". Der frühere Vergleich über
     * `key` ging hier leer aus.
     */
    expect(matches(SHORTCUTS.newTask, press({ code: 'KeyN', key: 'Dead', altKey: true }), 'mac')).toBe(true);
    expect(matches(SHORTCUTS.viewNetwork, press({ code: 'Digit1', key: '¡', altKey: true }), 'mac')).toBe(true);
    expect(matches(SHORTCUTS.togglePlan, press({ code: 'KeyG', key: '©', altKey: true }), 'mac')).toBe(true);
    expect(matches(SHORTCUTS.guide, press({ code: 'KeyH', key: '˙', altKey: true }), 'mac')).toBe(true);
  });

  it('erkennt dieselben Kürzel unter Windows über das Zeichen', () => {
    // Dort trägt `key` den Buchstaben; `code` stimmt zusätzlich.
    expect(matches(SHORTCUTS.newTask, press({ code: 'KeyN', key: 'n', altKey: true }), 'other')).toBe(true);
    expect(matches(SHORTCUTS.viewResourceTable, press({ code: 'Digit4', key: '4', altKey: true }), 'other')).toBe(true);
  });

  it('kommt ohne code aus, wenn nur das Zeichen ankommt', () => {
    // Manche Eingabemethoden melden keinen code - dann trägt das Zeichen.
    expect(matches(SHORTCUTS.newTask, press({ code: '', key: 'N', altKey: true }), 'other')).toBe(true);
  });

  it('trennt Befehlstaste und Strg nach Plattform', () => {
    const cmdZ = press({ code: 'KeyZ', key: 'z', metaKey: true });
    const strgZ = press({ code: 'KeyZ', key: 'z', ctrlKey: true });

    expect(matches(SHORTCUTS.undo, cmdZ, 'mac')).toBe(true);
    expect(matches(SHORTCUTS.undo, strgZ, 'mac')).toBe(false);
    expect(matches(SHORTCUTS.undo, strgZ, 'other')).toBe(true);
    expect(matches(SHORTCUTS.undo, cmdZ, 'other')).toBe(false);
  });

  it('lässt Cmd+Y auf dem Mac dem Browser', () => {
    // Cmd+Y öffnet dort den Verlauf; wiederholt wird mit Umschalt+Cmd+Z.
    const y = press({ code: 'KeyY', key: 'y', metaKey: true });
    expect(matches(SHORTCUTS.redo, y, 'mac')).toBe(false);
    expect(matches(SHORTCUTS.redo, press({ code: 'KeyZ', key: 'z', metaKey: true, shiftKey: true }), 'mac')).toBe(true);

    const strgY = press({ code: 'KeyY', key: 'y', ctrlKey: true });
    expect(matches(SHORTCUTS.redo, strgY, 'other')).toBe(true);
    expect(matches(SHORTCUTS.redo, press({ code: 'KeyZ', key: 'z', ctrlKey: true, shiftKey: true }), 'other')).toBe(true);
  });

  it('unterscheidet rückgängig und wiederholen an der Umschalttaste', () => {
    const shiftZ = press({ code: 'KeyZ', key: 'z', metaKey: true, shiftKey: true });
    expect(matches(SHORTCUTS.undo, shiftZ, 'mac')).toBe(false);
    expect(matches(SHORTCUTS.redo, shiftZ, 'mac')).toBe(true);
  });

  it('löst nicht aus, wenn eine weitere Taste mitgedrückt ist', () => {
    // Cmd+Alt+N ist nicht "Neue Aufgabe" - sonst fingen Kürzel anderer
    // Programme Aktionen in MPT aus.
    expect(matches(SHORTCUTS.newTask, press({ code: 'KeyN', key: 'Dead', altKey: true, metaKey: true }), 'mac')).toBe(false);
    expect(matches(SHORTCUTS.save, press({ code: 'KeyS', key: 's', metaKey: true, ctrlKey: true }), 'mac')).toBe(false);
    expect(matches(SHORTCUTS.save, press({ code: 'KeyS', key: 's', ctrlKey: true, altKey: true }), 'other')).toBe(false);
  });

  it('belegt keine Kombination doppelt', () => {
    for (const platform of ['mac', 'other'] as Platform[]) {
      const gesehen = new Map<string, string>();
      for (const [id, shortcut] of ALLE) {
        for (const chord of shortcut.chords) {
          if (chord.only && chord.only !== platform) continue;
          const key = chordKey(chord);
          const anderer = gesehen.get(key);
          expect(`${platform} ${key}: ${anderer ?? id}`).toBe(`${platform} ${key}: ${id}`);
          gesehen.set(key, id);
        }
      }
    }
  });

  it('hält sich von Browser- und Systemkürzeln fern', () => {
    /*
     * Zwei Ausnahmen sind Absicht und abgestimmt: Strg/Cmd+S speichert die
     * eigene Datei statt der Webseite, Strg/Cmd+K öffnet die Befehlspalette.
     * Alles andere muss dem Browser gehören.
     */
    const erlaubt = new Set(['save', 'palette']);
    const gesperrt = new Set(SHORTCUT_CONFLICTS.map(chordKey));

    for (const [id, shortcut] of ALLE) {
      if (erlaubt.has(id)) continue;
      for (const chord of shortcut.chords) {
        expect(`${id}: ${chordKey(chord)} gesperrt=${gesperrt.has(chordKey(chord))}`).toBe(
          `${id}: ${chordKey(chord)} gesperrt=false`,
        );
      }
    }
  });

  it('schreibt die Kürzel plattformgerecht', () => {
    expect(formatShortcut(SHORTCUTS.newTask, 'mac')).toBe('⌥N');
    expect(formatShortcut(SHORTCUTS.newTask, 'other')).toBe('Alt+N');
    expect(formatShortcut(SHORTCUTS.save, 'mac')).toBe('⌘S');
    expect(formatShortcut(SHORTCUTS.save, 'other')).toBe('Strg+S');
    // Wiederholen zeigt je Plattform die dort übliche Form.
    expect(formatShortcut(SHORTCUTS.redo, 'mac')).toBe('⇧⌘Z');
    expect(formatShortcut(SHORTCUTS.redo, 'other')).toBe('Strg+Y');
    expect(formatShortcut(SHORTCUTS.viewGantt, 'mac')).toBe('⌥2');

    expect(shortcutParts(SHORTCUTS.redo, 'mac')).toEqual(['⇧', '⌘', 'Z']);
    expect(shortcutParts(SHORTCUTS.redo, 'other')).toEqual(['Strg', 'Y']);

    expect(withShortcut('Neue Aufgabe', SHORTCUTS.newTask, 'mac')).toBe('Neue Aufgabe (⌥N)');
  });

  it('beschreibt jedes Kürzel für die Anleitung', () => {
    // Ohne Beschriftung und Gruppe fiele ein Kürzel aus der Hilfeseite heraus.
    for (const [id, shortcut] of ALLE) {
      expect(`${id}: ${shortcut.label.length > 0 && shortcut.chords.length > 0}`).toBe(`${id}: true`);
    }
  });
});
