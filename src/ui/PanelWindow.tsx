/**
 * Eine der beiden Ansichten in einem eigenen Browserfenster - **zusätzlich**
 * zum Hauptfenster, nicht statt seiner.
 *
 * Kein zweiter Tab und keine zweite Instanz: das Fenster wird per
 * `createPortal` aus **diesem** React-Baum heraus befüllt. Es ist derselbe
 * Store, derselbe Dateihandle, dieselbe Sperre - eine Änderung ist drüben im
 * selben Render sichtbar, und es gibt nichts abzugleichen. Ein zweiter Tab wäre
 * dagegen eine eigene Instanz, die sich mit der ersten um die Datei streiten
 * müsste (siehe persistence/lock.ts).
 *
 * Die Aufteilung: das ausgelagerte Fenster hält **einen** Modus, das
 * Hauptfenster weiterhin `ui.mode`. Wandert die Aufgabenansicht hinaus, springt
 * das Hauptfenster automatisch auf die Ressourcen - so arbeiten beide Fenster
 * nebeneinander statt eines leer zu stehen. Wer im Hauptfenster über die
 * Seitenleiste denselben Modus wählt, bekommt ihn zweimal; das ist erlaubt und
 * manchmal genau das Gewünschte (zwei Ausschnitte desselben Plans).
 *
 * Ausgelagert wird genau der Teil, der beim Umschalten zwischen "Aufgaben" und
 * "Ressourcen" ohnehin wechselt. Kopfzeile, Seitenleiste und Speicherstatus
 * bleiben im Hauptfenster - sie gehören zur Sitzung, nicht zur Ansicht.
 *
 * Drei Dinge muss ein Fremddokument mitbekommen, sonst sieht es kaputt aus oder
 * reagiert nicht:
 *   1. **Stile** - unser CSS steckt im Hauptdokument und gilt dort nicht mit.
 *   2. **Farbschema** - `data-theme` am Wurzelelement.
 *   3. **Tastenkürzel** - der globale Handler hängt am Hauptfenster.
 * Ereignisse, die an einzelnen Elementen hängen (Ziehen, Menüs), lösen ihr
 * Fenster selbst auf - siehe components/ownerWindow.ts.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../state/preferences';
import { useStore, type ViewMode } from '../state/store';
import { Button } from './components/controls';

/** Name des Fensters - dadurch wird ein noch offenes wiederverwendet. */
const WINDOW_NAME = 'mpt-ansicht';
const MOUNT_ID = 'mpt-detached-root';

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  tasks: 'Aufgaben',
  resources: 'Ressourcen',
};

/** Es gibt genau zwei Modi - der jeweils andere. */
export function otherMode(mode: ViewMode): ViewMode {
  return mode === 'tasks' ? 'resources' : 'tasks';
}

/** Ein geöffnetes Fenster samt Aufhängepunkt und der Ansicht, die es zeigt. */
export interface Detached {
  target: Window;
  mount: HTMLElement;
  mode: ViewMode;
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

interface DetachValue {
  /** Offenes Fenster, sonst null. */
  detached: Detached | null;
  /**
   * Diesen Modus ins eigene Fenster geben; öffnet es bei Bedarf. Meldet, ob es
   * geklappt hat - der Aufrufer schaltet das Hauptfenster nur dann um.
   */
  open: (mode: ViewMode) => boolean;
  /** Fenster schliessen. */
  close: () => void;
  /**
   * Das Fenster ist bereits weg (der Nutzer hat es geschlossen) - nur noch den
   * Zustand nachziehen. Ein `close()` darauf ginge ins Leere.
   */
  forget: () => void;
  /** Warum es nicht ging, sonst null. */
  problem: string | null;
}

const DetachContext = createContext<DetachValue | null>(null);
/** true innerhalb des ausgelagerten Fensters - dort kehrt der Knopf um. */
const InWindowContext = createContext(false);

const POPUP_BLOCKED = 'Das Fenster wurde vom Browser blockiert - Popups für diese Seite erlauben.';
const NO_ACCESS =
  'In diesem Browser lässt sich das Fenster nicht befüllen. Bei einer direkt geöffneten Datei (file://) ist das üblich - über einen Webserver oder die veröffentlichte Fassung geht es.';

/**
 * Öffnet und bestückt das Fenster **im Klick selbst**, nicht in einem Effekt:
 * `window.open` ist nur aus einer Nutzergeste heraus erlaubt, und ein Effekt
 * liefe unter Umständen erst danach. Ausserdem steht so sofort fest, ob es
 * überhaupt geklappt hat.
 */
export function useDetachState(): DetachValue {
  const [detached, setDetached] = useState<Detached | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  return {
    detached,
    problem,
    forget: () => setDetached(null),
    close: () => {
      detached?.target.close();
      setDetached(null);
    },
    open: (mode) => {
      // Steht das Fenster schon, wechselt nur seine Ansicht.
      if (detached && !detached.target.closed) {
        setDetached({ ...detached, mode });
        return true;
      }

      let target: Window | null = null;
      try {
        const width = Math.min(1440, Math.max(760, screen.availWidth - 120));
        const height = Math.min(920, Math.max(520, screen.availHeight - 140));
        target = window.open('', WINDOW_NAME, `popup=yes,width=${Math.round(width)},height=${Math.round(height)}`);
      } catch {
        target = null;
      }
      if (!target) {
        setProblem(POPUP_BLOCKED);
        return false;
      }

      /*
       * Auf `file://` ist das leere Fenster unter Umständen nicht vom selben
       * Ursprung - der Zugriff auf sein Dokument wirft dann. Lieber sauber
       * zurück als ein leeres Fenster stehen lassen.
       */
      try {
        const mount = prepare(target);
        setProblem(null);
        setDetached({ target, mount, mode });
        return true;
      } catch {
        target.close();
        setProblem(NO_ACCESS);
        return false;
      }
    },
  };
}

export function DetachProvider({ value, children }: { value: DetachValue; children: ReactNode }) {
  return <DetachContext.Provider value={value}>{children}</DetachContext.Provider>;
}

/** Welche Ansicht läuft gerade im eigenen Fenster? Für Anzeigen ausserhalb. */
export function useDetached(): Detached | null {
  return useContext(DetachContext)?.detached ?? null;
}

// ---------------------------------------------------------------------------
// Knopf in der Werkzeugleiste
// ---------------------------------------------------------------------------

/**
 * Klein und unauffällig: das eigene Fenster ist eine Möglichkeit, kein
 * Arbeitsschritt.
 *
 * Im Hauptfenster heisst der Knopf "diese Ansicht hinausgeben" - das
 * Hauptfenster zeigt danach die andere. Im ausgelagerten Fenster heisst
 * derselbe Knopf "zurückholen"; man muss dafür nicht erst hinüberwechseln.
 */
export function DetachButton({ mode }: { mode: ViewMode }) {
  const detach = useContext(DetachContext);
  const inWindow = useContext(InWindowContext);
  const { setUi } = useStore();
  if (!detach) return null;

  const send = () => {
    if (detach.open(mode)) setUi({ mode: otherMode(mode) });
  };
  const bringBack = () => {
    const returning = detach.detached?.mode;
    detach.close();
    if (returning) setUi({ mode: returning });
  };

  return (
    <Button
      size="sm"
      icon
      variant={detach.problem ? 'danger' : inWindow ? 'primary' : 'ghost'}
      onClick={inWindow ? bringBack : send}
      title={
        detach.problem ??
        (inWindow
          ? 'Ansicht zurück ins Hauptfenster holen'
          : `${VIEW_MODE_LABEL[mode]} in einem eigenen Fenster zeigen - das Hauptfenster wechselt dann auf ${VIEW_MODE_LABEL[otherMode(mode)]}. Dieselbe Sitzung, dieselbe Datei.`)
      }
    >
      {/* Ein Zeichen, zwei Zustände - hervorgehoben heisst "läuft drüben".
          Dieselbe Sprache wie beim Knopf für den kritischen Pfad. */}
      ⧉
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Das Fenster selbst
// ---------------------------------------------------------------------------

export function PanelWindow({
  detached,
  onClosed,
  onKeyDown,
  children,
}: {
  detached: Detached;
  /** Das Fenster ist weg (vom Nutzer geschlossen) - Ansicht zurückholen. */
  onClosed: () => void;
  /** Globale Tastenkürzel; ohne sie wäre drüben nichts per Tastatur bedienbar. */
  onKeyDown: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const { target, mount, mode } = detached;
  const { resolvedTheme } = usePreferences();

  useEffect(() => {
    if (target.closed) {
      onClosed();
      return;
    }
    /*
     * Wird das Fenster vom Nutzer geschlossen, muss die Ansicht zurück ins
     * Hauptfenster - sonst wäre sie einfach verschwunden.
     */
    const closed = () => onClosed();
    target.addEventListener('pagehide', closed);
    /*
     * Lädt oder schliesst das Hauptfenster, ist der React-Baum weg. Das
     * Kindfenster zeigte dann eine eingefrorene Oberfläche, die auf nichts mehr
     * reagiert - deshalb wird es mitgeschlossen.
     */
    const closeChild = () => target.close();
    window.addEventListener('pagehide', closeChild);

    return () => {
      target.removeEventListener('pagehide', closed);
      window.removeEventListener('pagehide', closeChild);
    };
    /*
     * Das Fenster wird hier NICHT geschlossen: das erledigt `close`. So
     * übersteht es auch das doppelte Ausführen von Effekten im StrictMode, ohne
     * sich selbst zu schliessen und neu zu öffnen.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Titel und Farbschema nachführen - beides ändert sich im Betrieb.
  useEffect(() => {
    if (!target.closed) target.document.title = `MPT · ${VIEW_MODE_LABEL[mode]}`;
  }, [target, mode]);

  useEffect(() => {
    if (target.closed) return;
    const root = target.document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [target, resolvedTheme]);

  useEffect(() => {
    if (target.closed) return;
    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener('keydown', onKeyDown);
  }, [target, onKeyDown]);

  return createPortal(<InWindowContext.Provider value>{children}</InWindowContext.Provider>, mount);
}

/**
 * Richtet das leere Fremddokument ein - Stile, Farbschema, Aufhängepunkt.
 * Wirft, wenn der Zugriff verwehrt ist; idempotent bei einem bereits
 * eingerichteten Fenster.
 */
function prepare(target: Window): HTMLElement {
  const doc = target.document;
  const existing = doc.getElementById(MOUNT_ID);
  if (existing) return existing;

  /*
   * Farbschema sofort setzen, nicht erst im Effekt: der lief nach dem ersten
   * Zeichnen, und im dunklen Theme blitzte das Fenster kurz weiss auf.
   */
  doc.documentElement.lang = 'de';
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
  doc.documentElement.style.colorScheme = document.documentElement.style.colorScheme || 'light';

  /*
   * Stile übernehmen. Im Einzeldatei-Bau steckt das gesamte CSS in `<style>`,
   * beim Entwickeln injiziert Vite ebenfalls `<style>` - beide Formen werden
   * mitgenommen, `<link>` der Vollständigkeit halber. Später nachgeladene
   * Stile (nur beim Entwickeln durch HMR) fehlen drüben, bis das Fenster einmal
   * neu geöffnet wird.
   */
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    doc.head.appendChild(node.cloneNode(true));
  }

  const mount = doc.createElement('div');
  mount.id = MOUNT_ID;
  mount.className = 'detached';
  doc.body.appendChild(mount);
  return mount;
}
