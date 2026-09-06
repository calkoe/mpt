/**
 * Kurzanleitung beim ersten Start.
 *
 * Die Grafiken sind absichtlich handgezeichnete SVGs statt Screenshots: sie
 * bleiben in beiden Themes lesbar, altern nicht mit der Oberfläche und kosten
 * die Einzeldatei nur ein paar Kilobyte.
 *
 * Wann der Dialog erscheint, entscheidet `state/preferences.tsx`
 * (`guideSeen`): sobald eine eigene Datei geöffnet oder angelegt wurde, kommt
 * er nicht mehr von selbst - über die Kopfzeile aber jederzeit wieder.
 */
import type { ReactNode } from 'react';
import { Modal } from '../components/controls';
import { ALL_SHORTCUTS, shortcutParts, SHORTCUT_GROUPS } from '../shortcuts';

interface Step {
  title: string;
  text: string;
  figure: ReactNode;
}

const STEPS: Step[] = [
  {
    title: '1 · Datei wählen',
    text:
      'Oben links "Öffnen" oder "Neu". Ab dann schreibt MPT jede Änderung automatisch in genau diese ' +
      'JSON-Datei auf deiner Festplatte. Es gibt keinen Speichern-Knopf und keinen Server. ' +
      'Das Schreiben funktioniert nur in Chrome oder Edge am Rechner.',
    figure: <FileFigure />,
  },
  {
    title: '2 · Aufgaben verketten',
    text:
      'Aufgaben brauchen entweder ein festes Startdatum oder einen Vorgänger. Fahre im Netzplan über eine ' +
      'Aufgabe: links und rechts erscheint ein grünes "+", das direkt einen Vorgänger bzw. Nachfolger anlegt.',
    figure: <ChainFigure />,
  },
  {
    title: '3 · Dauer statt Enddatum',
    text:
      'Eine Dauer wird als Spanne angegeben - "4 bis 7 Tage". Der Umschalter oben rechnet den ganzen Plan ' +
      'optimistisch oder pessimistisch. Dauer 0 heißt: kein Enddatum, die Aufgabe läuft dauerhaft weiter.',
    figure: <SpanFigure />,
  },
  {
    title: '4 · Ressourcen anhängen',
    text:
      'Personen, Budgets, Tags und Bedingungen entstehen beim Tippen - Namen eingeben, "neu anlegen" wählen. ' +
      'Unter dem Plan zeigt die Leiste, was an den sichtbaren Aufgaben hängt.',
    figure: <RailFigure />,
  },
  {
    title: '5 · Prüfen',
    text:
      '"Kritischer Pfad" hebt die Kette ohne Puffer hervor. Das Warnzentrum oben sammelt alles, was nicht ' +
      'zusammenpasst: überfällige Aufgaben, offene Bedingungen, Personen und Budgets ab 90 % Auslastung.',
    figure: <CheckFigure />,
  },
];

export function GuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="MPT in fünf Schritten" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Alles läuft in diesem Browser-Tab. Es gibt kein Konto, keine Cloud und keine Übertragung -
        deine Daten liegen ausschließlich in der Datei, die du selbst auswählst.
      </p>

      <div className="guide">
        {STEPS.map((step) => (
          <section key={step.title} className="guide__step">
            <div className="guide__figure">{step.figure}</div>
            <div>
              <h3 className="guide__title">{step.title}</h3>
              <p className="guide__text">{step.text}</p>
            </div>
          </section>
        ))}
      </div>

      <ShortcutHelp />

      <p className="faint" style={{ marginBottom: 0 }}>
        Diese Anleitung lässt sich über "Hilfe" in der Kopfzeile jederzeit erneut öffnen.
      </p>
    </Modal>
  );
}

/**
 * Tasten und Tooltips.
 *
 * Die Liste wird aus der Belegung erzeugt (`ui/shortcuts.ts`) und zeigt sie so,
 * wie sie auf **diesem** Rechner gilt: auf dem Mac ⌘⌥⇧, sonst ausgeschrieben.
 * Eine von Hand gepflegte Aufzählung stand hier vorher - und nannte Tasten,
 * die es teils gar nicht gab.
 */
function ShortcutHelp() {
  return (
    <section className="guide__keys">
      <h3 className="guide__title">Tasten und Tooltips</h3>
      <p className="guide__text">
        Jedes Eingabefeld erklärt sich selbst: kurz mit der Maus darüber stehen bleiben. Der Hinweis
        sagt, was der Wert setzt und was daraus im Plan folgt - etwa welche Zahl in die Auslastung
        eingeht und welche in die Kosten.
      </p>

      <div className="guide__shortcuts">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group} className="col">
            <div className="guide__group">{group}</div>
            {ALL_SHORTCUTS.filter(([, sc]) => sc.group === group).map(([id, sc]) => (
              <div key={id} className="guide__key">
                <span className="guide__combo">
                  {shortcutParts(sc).map((part) => (
                    <kbd key={part}>{part}</kbd>
                  ))}
                </span>
                {/* Kein Abschneiden: eine halbe Beschriftung neben einer
                    Taste ist schlimmer als eine zweite Zeile. */}
                <span>{sc.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Grafiken. Bewusst schlicht und ohne Text, damit sie klein bleiben und in
// beiden Themes funktionieren - die Farben kommen aus den Theme-Variablen.
// ---------------------------------------------------------------------------

const FIG = { width: 132, height: 76 };

function Figure({ children }: { children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${FIG.width} ${FIG.height}`} width="100%" height="100%" aria-hidden="true">
      {children}
    </svg>
  );
}

function FileFigure() {
  return (
    <Figure>
      <rect x="14" y="10" width="46" height="56" rx="5" fill="var(--surface)" stroke="var(--border-strong)" />
      <path d="M46 10 L60 24 L46 24 Z" fill="var(--surface-3)" stroke="var(--border-strong)" />
      <rect x="22" y="34" width="26" height="3" rx="1.5" fill="var(--text-faint)" />
      <rect x="22" y="42" width="20" height="3" rx="1.5" fill="var(--text-faint)" />
      <path d="M68 38 L92 38" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#guide-arrow)" />
      <rect x="96" y="24" width="24" height="28" rx="4" fill="var(--accent-soft)" stroke="var(--accent)" />
      <circle cx="108" cy="38" r="4" fill="var(--accent)" />
      <defs>
        <marker id="guide-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
        </marker>
      </defs>
    </Figure>
  );
}

function ChainFigure() {
  return (
    <Figure>
      <rect x="8" y="26" width="34" height="24" rx="4" fill="var(--surface)" stroke="var(--border-strong)" />
      <rect x="8" y="26" width="3" height="24" rx="1.5" fill="var(--status-done)" />
      <rect x="56" y="26" width="34" height="24" rx="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.6" />
      <rect x="56" y="26" width="3" height="24" rx="1.5" fill="var(--status-active)" />
      <path d="M42 38 L54 38" stroke="var(--border-strong)" strokeWidth="1.6" />
      {/* Das grüne Plus, wie es beim Überfahren erscheint. */}
      <circle cx="99" cy="38" r="9" fill="var(--ok)" />
      <path d="M99 33.5 V42.5 M94.5 38 H103.5" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" />
      <rect x="112" y="30" width="14" height="16" rx="3" fill="var(--surface-2)" stroke="var(--border)" strokeDasharray="3 2" />
    </Figure>
  );
}

function SpanFigure() {
  return (
    <Figure>
      <line x1="10" y1="20" x2="122" y2="20" stroke="var(--grid-line-strong)" />
      <rect x="18" y="30" width="44" height="14" rx="3" fill="var(--accent)" />
      <rect x="62" y="30" width="26" height="14" rx="3" fill="var(--accent)" opacity="0.35" />
      <text x="18" y="60" fontSize="9" fill="var(--text-faint)">
        min
      </text>
      <text x="72" y="60" fontSize="9" fill="var(--text-faint)">
        max
      </text>
      <path d="M18 50 L88 50" stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="2 2" />
      <path d="M100 30 L100 44" stroke="var(--info)" strokeWidth="2" />
      <text x="105" y="41" fontSize="12" fill="var(--info)">
        ∞
      </text>
    </Figure>
  );
}

function RailFigure() {
  return (
    <Figure>
      <rect x="12" y="8" width="30" height="20" rx="4" fill="var(--surface)" stroke="var(--border-strong)" />
      <rect x="56" y="8" width="30" height="20" rx="4" fill="var(--surface)" stroke="var(--border-strong)" />
      <line x1="6" y1="40" x2="126" y2="40" stroke="var(--grid-line-strong)" />
      <path d="M27 28 C27 36 20 34 20 46" stroke="var(--border-strong)" strokeDasharray="3 2" fill="none" />
      <path d="M71 28 C71 36 64 34 64 46" stroke="var(--border-strong)" strokeDasharray="3 2" fill="none" />
      <rect x="8" y="46" width="34" height="18" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
      <circle cx="16" cy="55" r="3.5" fill="var(--accent)" />
      <rect x="48" y="46" width="34" height="18" rx="4" fill="var(--surface-2)" stroke="var(--border)" />
      <rect x="53" y="52" width="7" height="6" rx="1" fill="var(--ok)" />
      <rect x="88" y="46" width="34" height="18" rx="4" fill="var(--warn-soft)" stroke="var(--warn)" />
      <rect x="93" y="51.5" width="7" height="7" rx="1.5" fill="none" stroke="var(--warn)" strokeWidth="1.5" />
    </Figure>
  );
}

function CheckFigure() {
  return (
    <Figure>
      <rect x="8" y="14" width="28" height="16" rx="3" fill="var(--surface)" stroke="var(--critical)" strokeWidth="1.6" />
      <rect x="52" y="14" width="28" height="16" rx="3" fill="var(--surface)" stroke="var(--critical)" strokeWidth="1.6" />
      <path d="M36 22 L50 22" stroke="var(--critical)" strokeWidth="2" />
      <rect x="52" y="42" width="28" height="16" rx="3" fill="var(--surface)" stroke="var(--border-strong)" />
      <path d="M36 24 C44 26 44 48 50 50" stroke="var(--border-strong)" fill="none" />
      <path d="M96 18 L110 44 L82 44 Z" fill="var(--warn-soft)" stroke="var(--warn)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M96 27 V34" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="96" cy="39" r="1.4" fill="var(--warn)" />
    </Figure>
  );
}
