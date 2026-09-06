/**
 * Tastenkürzel - eine Quelle für Verhalten **und** Anzeige.
 *
 * Vorher stand jedes Kürzel zweimal im Code: einmal als Vergleich in `App.tsx`
 * und einmal als Text in einer Beschriftung. Erwartungsgemäß liefen beide
 * auseinander - der Knopf "Öffnen" versprach ein Strg+O, das es nie gab, und
 * die Befehlspalette schickte für die Ressourcen auf Alt+2, zuständig war
 * Alt+3. Hier steht beides an einer Stelle.
 *
 * **Warum `code` und `key` zusammen geprüft werden.** Unter macOS erzeugt die
 * Wahltaste ein Sonderzeichen: Alt+N liefert in `event.key` ein `"Dead"` (˜),
 * Alt+G ein `"©"`, Alt+1 ein `"¡"`. Ein Vergleich über `key` findet dort also
 * nichts - genau daran war auf dem Mac kein einziges Alt-Kürzel benutzbar.
 * `event.code` beschreibt dagegen die **physische** Taste und ist von Wahl-
 * taste und Belegung unabhängig; dafür läge es auf einer deutschen Tastatur
 * bei Y und Z falsch (dort liegt `KeyY` unter der Taste "Z"). Geprüft wird
 * deshalb beides, und die Alt-Kürzel meiden Y und Z ohnehin.
 *
 * **Was bewusst nicht belegt wird.** Browser- und Systemkürzel bleiben frei -
 * Strg/Cmd+T, N, W, Q, H, M, Alt+D, Alt+Pfeil, F5, Strg+Tab. Zwei Ausnahmen
 * sind Absicht und mit dem Nutzer abgestimmt: **Strg/Cmd+S** (in einer
 * Anwendung mit eigener Datei sucht die Hand dort das Speichern, nicht das
 * Sichern der Webseite) und **Strg/Cmd+K** (Befehlspalette, wie in den
 * meisten Werkzeugen dieser Art). `SHORTCUT_CONFLICTS` hält die Sperrliste;
 * ein Test prüft die Belegung dagegen.
 */

export type Platform = 'mac' | 'other';

/** Eine Tastenkombination. */
export interface Chord {
  /** Befehlstaste auf dem Mac, Strg sonst - nie beides zugleich. */
  mod?: boolean;
  /** Wahltaste (Mac) bzw. Alt. */
  alt?: boolean;
  shift?: boolean;
  /** Physische Taste, z.B. `KeyN` oder `Digit1`. */
  code: string;
  /** Zeichen als zweiter Weg, z.B. `n`. Fehlt bei Sondertasten. */
  key?: string;
  /** Gilt nur auf dieser Plattform. */
  only?: Platform;
}

export type ShortcutGroup = 'Datei' | 'Bearbeiten' | 'Ansicht' | 'Anlegen';

export interface Shortcut {
  /** Was das Kürzel tut - so steht es in der Anleitung. */
  label: string;
  group: ShortcutGroup;
  /**
   * Alle Kombinationen, die auslösen. Angezeigt wird die erste, die zur
   * Plattform passt - unter Windows also Strg+Y statt Umschalt+Strg+Z.
   */
  chords: Chord[];
  /**
   * Greift auch, während in einem Feld getippt wird. Nur für Kürzel, die dort
   * dasselbe bedeuten sollen wie sonst (Speichern, Befehle). Rückgängig
   * gehört ausdrücklich **nicht** dazu: im Textfeld ist Strg+Z die Rücknahme
   * des Tippfehlers, nicht die der letzten Planänderung.
   */
  whileTyping?: boolean;
}

export function detectPlatform(): Platform {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const uaData = (nav as unknown as { userAgentData?: { platform?: string } } | undefined)?.userAgentData;
  const raw = uaData?.platform || nav?.platform || nav?.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(raw) ? 'mac' : 'other';
}

/** Plattform dieses Rechners. Funktionen nehmen sie als Vorgabe. */
export const PLATFORM: Platform = detectPlatform();

// ---------------------------------------------------------------------------
// Die Belegung
// ---------------------------------------------------------------------------

const letter = (code: string, key: string, extra: Partial<Chord> = {}): Chord => ({ code, key, ...extra });

export const SHORTCUTS = {
  open: {
    label: 'Datei öffnen',
    group: 'Datei',
    // Alt+O statt Strg+O: Strg/Cmd+O öffnet im Browser eine Datei im Tab und
    // ersetzt damit die laufende Anwendung.
    chords: [letter('KeyO', 'o', { alt: true })],
  },
  save: {
    label: 'Jetzt speichern',
    group: 'Datei',
    chords: [letter('KeyS', 's', { mod: true })],
    whileTyping: true,
  },
  palette: {
    label: 'Befehle',
    group: 'Datei',
    chords: [letter('KeyK', 'k', { mod: true })],
    whileTyping: true,
  },
  undo: {
    label: 'Rückgängig',
    group: 'Bearbeiten',
    chords: [letter('KeyZ', 'z', { mod: true })],
  },
  redo: {
    label: 'Wiederholen',
    group: 'Bearbeiten',
    chords: [
      letter('KeyZ', 'z', { mod: true, shift: true }),
      // Cmd+Y ist auf dem Mac der Browser-Verlauf - dort nur die erste Form.
      letter('KeyY', 'y', { mod: true, only: 'other' }),
    ],
  },
  copyTask: {
    label: 'Aufgabe kopieren',
    group: 'Bearbeiten',
    chords: [letter('KeyC', 'c', { mod: true })],
  },
  pasteTask: {
    label: 'Aufgabe einfügen',
    group: 'Bearbeiten',
    chords: [letter('KeyV', 'v', { mod: true })],
  },
  viewNetwork: {
    label: 'Aufgaben · Netzplan',
    group: 'Ansicht',
    chords: [{ code: 'Digit1', key: '1', alt: true }],
  },
  viewGantt: {
    label: 'Aufgaben · Gantt',
    group: 'Ansicht',
    chords: [{ code: 'Digit2', key: '2', alt: true }],
  },
  viewResourceChart: {
    label: 'Ressourcen · Ganglinien',
    group: 'Ansicht',
    chords: [{ code: 'Digit3', key: '3', alt: true }],
  },
  viewResourceTable: {
    label: 'Ressourcen · Tabelle',
    group: 'Ansicht',
    chords: [{ code: 'Digit4', key: '4', alt: true }],
  },
  togglePlan: {
    label: 'Netzplan ⇄ Gantt',
    group: 'Ansicht',
    chords: [letter('KeyG', 'g', { alt: true })],
  },
  warnings: {
    label: 'Warnzentrum',
    group: 'Ansicht',
    chords: [letter('KeyW', 'w', { alt: true })],
  },
  guide: {
    label: 'Hilfe',
    group: 'Ansicht',
    chords: [letter('KeyH', 'h', { alt: true })],
  },
  newTask: {
    label: 'Neue Aufgabe',
    group: 'Anlegen',
    chords: [letter('KeyN', 'n', { alt: true })],
  },
  newVenture: {
    label: 'Neues Vorhaben',
    group: 'Anlegen',
    chords: [letter('KeyV', 'v', { alt: true })],
  },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/**
 * Ein Kürzel nachschlagen. Liefert den allgemeinen Typ statt der Literalform,
 * die `as const` erzeugt - sonst kennt der Aufrufer die optionalen Felder
 * nicht, sobald ein einzelner Eintrag sie nicht setzt.
 */
export function shortcut(id: ShortcutId): Shortcut {
  return SHORTCUTS[id];
}

/** Alle Kürzel in der Reihenfolge der Belegung - für die Anleitung. */
export const ALL_SHORTCUTS = Object.entries(SHORTCUTS) as [ShortcutId, Shortcut][];

/** Reihenfolge der Gruppen in der Anleitung. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = ['Datei', 'Bearbeiten', 'Ansicht', 'Anlegen'];

/**
 * Kombinationen, die dem Browser oder dem Betriebssystem gehören. Ein Test
 * hält die Belegung dagegen - abgesehen von den beiden abgestimmten Ausnahmen
 * Strg/Cmd+S und Strg/Cmd+K.
 */
export const SHORTCUT_CONFLICTS: Chord[] = [
  // Fenster und Tabs
  letter('KeyT', 't', { mod: true }),
  letter('KeyN', 'n', { mod: true }),
  letter('KeyW', 'w', { mod: true }),
  letter('KeyQ', 'q', { mod: true }),
  // Verlauf, Downloads, Ausblenden, Minimieren, Adressleiste, Drucken, Suchen
  letter('KeyH', 'h', { mod: true }),
  letter('KeyJ', 'j', { mod: true }),
  letter('KeyM', 'm', { mod: true }),
  letter('KeyL', 'l', { mod: true }),
  letter('KeyP', 'p', { mod: true }),
  letter('KeyF', 'f', { mod: true }),
  letter('KeyO', 'o', { mod: true }),
  letter('KeyD', 'd', { mod: true }),
  // Menü und Adressleiste unter Windows
  letter('KeyD', 'd', { alt: true, only: 'other' }),
  letter('KeyE', 'e', { alt: true, only: 'other' }),
  letter('KeyF', 'f', { alt: true, only: 'other' }),
  { code: 'ArrowLeft', alt: true },
  { code: 'ArrowRight', alt: true },
  { code: 'Home', alt: true },
  { code: 'F5' },
  { code: 'Tab', mod: true },
];

// ---------------------------------------------------------------------------
// Prüfen
// ---------------------------------------------------------------------------

/** Ist die Kombination auf dieser Plattform überhaupt vorgesehen? */
function chordApplies(chord: Chord, platform: Platform): boolean {
  return !chord.only || chord.only === platform;
}

function chordMatches(chord: Chord, event: KeyboardEvent, platform: Platform): boolean {
  if (!chordApplies(chord, platform)) return false;

  /*
   * Die Befehlstaste gilt auf dem Mac, Strg auf allen anderen - und immer nur
   * eine von beiden. Wer auf dem Mac Strg+S drückt, meint etwas anderes als
   * Cmd+S; das eine dem anderen gleichzusetzen erzeugte stille Doppeltreffer.
   */
  const modDown = platform === 'mac' ? event.metaKey : event.ctrlKey;
  const otherDown = platform === 'mac' ? event.ctrlKey : event.metaKey;
  if (Boolean(chord.mod) !== modDown || otherDown) return false;
  if (Boolean(chord.alt) !== event.altKey) return false;
  if (Boolean(chord.shift) !== event.shiftKey) return false;

  if (event.code === chord.code) return true;
  return Boolean(chord.key) && event.key.toLowerCase() === chord.key;
}

/** Löst dieses Tastenereignis das Kürzel aus? */
export function matches(shortcut: Shortcut, event: KeyboardEvent, platform: Platform = PLATFORM): boolean {
  return shortcut.chords.some((chord) => chordMatches(chord, event, platform));
}

// ---------------------------------------------------------------------------
// Anzeigen
// ---------------------------------------------------------------------------

/** Sondertasten, die anders heißen als ihr `code`. */
const KEY_LABEL: Record<string, string> = {
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '⏎',
  Tab: 'Tab',
};

function keyLabel(chord: Chord): string {
  if (KEY_LABEL[chord.code]) return KEY_LABEL[chord.code];
  if (chord.code.startsWith('Key')) return chord.code.slice(3);
  if (chord.code.startsWith('Digit')) return chord.code.slice(5);
  return chord.code;
}

/**
 * Die Kombination, die auf dieser Plattform angezeigt wird: bevorzugt eine
 * ausdrücklich für sie hinterlegte (Windows sieht bei "Wiederholen" lieber
 * Strg+Y als Umschalt+Strg+Z), sonst die erste passende.
 */
function shownChord(shortcut: Shortcut, platform: Platform): Chord {
  const passend = shortcut.chords.filter((c) => chordApplies(c, platform));
  return passend.find((c) => c.only === platform) ?? passend[0] ?? shortcut.chords[0];
}

/**
 * Die Tasten einzeln - für `<kbd>`-Folgen in der Anleitung.
 *
 * Auf dem Mac in der von Apple vorgegebenen Reihenfolge ⌃⌥⇧⌘ und ohne
 * Trennzeichen, sonst ausgeschrieben.
 */
export function shortcutParts(shortcut: Shortcut, platform: Platform = PLATFORM): string[] {
  const chord = shownChord(shortcut, platform);
  const parts: string[] = [];
  if (platform === 'mac') {
    if (chord.alt) parts.push('⌥');
    if (chord.shift) parts.push('⇧');
    if (chord.mod) parts.push('⌘');
  } else {
    if (chord.mod) parts.push('Strg');
    if (chord.alt) parts.push('Alt');
    if (chord.shift) parts.push('Umschalt');
  }
  parts.push(keyLabel(chord));
  return parts;
}

/** Das Kürzel als Text: `⌥N` auf dem Mac, `Alt+N` sonst. */
export function formatShortcut(shortcut: Shortcut, platform: Platform = PLATFORM): string {
  const parts = shortcutParts(shortcut, platform);
  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/** Beschriftung mit Kürzel in Klammern - für `title` an Knöpfen. */
export function withShortcut(text: string, shortcut: Shortcut, platform: Platform = PLATFORM): string {
  return `${text} (${formatShortcut(shortcut, platform)})`;
}
