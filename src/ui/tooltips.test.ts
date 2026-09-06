/**
 * "Jedes Eingabefeld trägt ein `title`."
 *
 * Die Regel steht über `Field` in `components/controls.tsx` - eine Regel im
 * Kommentar hält aber nur so lange, wie jemand daran denkt. Deshalb prüft
 * dieser Test die Quelltexte selbst: jedes Bedienelement, in das ein Wert
 * eingegeben wird, muss eine Erklärung mitbringen.
 *
 * Geprüft wird bewusst am Quelltext und nicht am gerenderten Baum: die
 * Editoren hängen an Store und Preferences, und ein halbes Dutzend
 * Testdoppel würde am Ende weniger abdecken als dieser Blick auf die Stellen
 * selbst.
 */
import { describe, expect, it } from 'vitest';

/** Bedienelemente, in die ein Wert eingegeben wird. */
const EINGABEN = [
  'TextInput',
  'TextArea',
  'NumberField',
  'NumberSlider',
  'AmountInput',
  'DateInput',
  'Combobox',
  'Switch',
  'PeriodPicker',
  'select',
];

/**
 * Stellen, die bewusst ohne Erklärung bleiben - jede mit Begründung.
 * `Segmented` steht hier nicht: dort erklärt entweder die Gruppe oder jede
 * einzelne Möglichkeit, geprüft wird das weiter unten.
 */
const AUSNAHMEN: Record<string, string> = {
  // Das Zahlenfeld im Regler erbt die Erklärung vom Regler darum herum.
  'components/controls.tsx:NumberField': 'steckt im NumberSlider, der schon erklärt ist',
  // Die Suche der Befehlspalette erklärt sich durch den Dialog selbst.
  'CommandPalette.tsx:TextInput': 'Suchfeld der Befehlspalette',
};

/*
 * Alle Oberflächendateien als Text. Über Vites `import.meta.glob` statt über
 * das Dateisystem: das kommt ohne Node-Typen aus und nimmt genau die Dateien,
 * die auch gebündelt werden.
 */
const QUELLEN = import.meta.glob('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Das öffnende Tag ab `start` - bis zum `>`, das nicht in einer Zeichenkette
 * oder in einem eingebetteten Ausdruck steht. Ein einfaches `indexOf('>')`
 * bräche bei jedem `=>` in einem Rückruf ab.
 *
 * `start` zeigt hinter den Tagnamen **samt Typargument**: `<Segmented<Status>`
 * endet sonst schon am spitzen Klammerpaar der Generik - dann sähe der Test
 * ein leeres Tag und meldete jeden erklärten Umschalter als unerklärt.
 */
function offeningTag(quelle: string, start: number): string {
  let tiefe = 0;
  let quote: string | null = null;
  for (let i = start; i < quelle.length; i++) {
    const c = quelle[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') tiefe++;
    else if (c === '}') tiefe--;
    else if (c === '>' && tiefe === 0) return quelle.slice(start, i + 1);
  }
  return quelle.slice(start);
}

interface Fund {
  ort: string;
  tag: string;
  inhalt: string;
}

function eingabenIn(pfad: string, quelle: string): Fund[] {
  const kurz = pfad.replace(/^\.\//, '');
  const funde: Fund[] = [];
  const muster = new RegExp(`<(${EINGABEN.join('|')})(?=[\\s/>])`, 'g');
  for (const treffer of quelle.matchAll(muster)) {
    funde.push({
      ort: `${kurz}:${treffer[1]}`,
      tag: treffer[1],
      inhalt: offeningTag(quelle, treffer.index + treffer[0].length),
    });
  }
  return funde;
}

const DATEIEN = Object.keys(QUELLEN).sort();

describe('Tooltips', () => {
  it('findet die Eingabefelder überhaupt', () => {
    // Schlägt die Suche fehl, wäre der Test darunter grün, ohne etwas zu prüfen.
    const alle = DATEIEN.flatMap((p) => eingabenIn(p, QUELLEN[p]));
    expect(alle.length).toBeGreaterThan(40);
  });

  it('erklärt jedes Eingabefeld', () => {
    const ohne: string[] = [];
    for (const pfad of DATEIEN) {
      for (const fund of eingabenIn(pfad, QUELLEN[pfad])) {
        if (AUSNAHMEN[fund.ort]) continue;
        if (!/\stitle[=\s]/.test(fund.inhalt)) ohne.push(fund.ort);
      }
    }
    expect(ohne).toEqual([]);
  });

  it('erklärt bei Umschaltern die Gruppe oder jede Möglichkeit', () => {
    /*
     * Ein `Segmented` setzt denselben Wert wie ein Feld, nur mit festen
     * Möglichkeiten. Es genügt eine Erklärung der Gruppe - oder eine je
     * Option, wenn die Unterschiede erklärungsbedürftig sind.
     */
    const ohne: string[] = [];
    for (const pfad of DATEIEN) {
      const quelle = QUELLEN[pfad];
      const kurz = pfad.replace(/^\.\//, '');
      if (kurz === 'components/controls.tsx') continue; // die Komponente selbst
      for (const treffer of quelle.matchAll(/<Segmented(?:<[^>]*>)?(?=[\s/>])/g)) {
        const tag = offeningTag(quelle, treffer.index + treffer[0].length);
        if (!/\stitle[=\s]/.test(tag) && !/title:/.test(tag)) {
          ohne.push(`${kurz}:${quelle.slice(0, treffer.index).split('\n').length}`);
        }
      }
    }
    expect(ohne).toEqual([]);
  });

  it('schreibt Erklärungen, die etwas erklären', () => {
    /*
     * Zwei Fallen, die eine Erklärung wertlos machen: sie wiederholt die
     * Beschriftung, oder sie besteht aus einem einzigen Wort. Geprüft wird
     * deshalb die Länge - kurz genug für einen Tooltip, lang genug für eine
     * Aussage über die Wirkung.
     */
    const zuKurz: string[] = [];
    const zuLang: string[] = [];
    for (const pfad of DATEIEN) {
      for (const fund of eingabenIn(pfad, QUELLEN[pfad])) {
        const text = /\stitle="([^"]+)"/.exec(fund.inhalt)?.[1];
        if (!text) continue;
        if (text.length < 30) zuKurz.push(`${fund.ort}: "${text}"`);
        if (text.length > 220) zuLang.push(`${fund.ort}: ${text.length} Zeichen`);
      }
    }
    expect(zuKurz).toEqual([]);
    expect(zuLang).toEqual([]);
  });
});
