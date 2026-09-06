/**
 * App-Rahmen: Raster, globale Tastenkürzel, Overlays und die Umschaltung der
 * beiden rechten Ansichten.
 *
 * Overlays (Befehlspalette, Warnzentrum, Anleitung) liegen hier und nicht in
 * der Kopfzeile, weil sie auch über Tastenkürzel erreichbar sind.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CommandPalette } from './ui/CommandPalette';
import { Sidebar } from './ui/Sidebar';
import { TopBar } from './ui/TopBar';
import { BrowserNotice } from './ui/BrowserNotice';
import { TaskOverview } from './ui/tasks/TaskOverview';
import { ResourceOverview } from './ui/resources/ResourceOverview';
import { GuideDialog } from './ui/dialogs/GuideDialog';
import { WarningCenter } from './ui/dialogs/WarningCenter';
import { DetachProvider, PanelWindow, useDetachState } from './ui/PanelWindow';
import { useStore, type ViewMode } from './state/store';
import { usePreferences } from './state/preferences';
import { createTask, createVenture, duplicateTask } from './model/factory';
import { isFileSystemAccessSupported, recallHandle } from './persistence/fileStore';
import { APP_VERSION, PROJECT_URL } from './version';
import { matches, shortcut, type ShortcutId } from './ui/shortcuts';

type Overlay = 'palette' | 'warnings' | 'guide';

export function App() {
  const store = useStore();
  const { prefs, setPrefs } = usePreferences();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [recalled, setRecalled] = useState<FileSystemFileHandle | null>(null);
  /*
   * Ansicht in einem eigenen Fenster. Der Zustand liegt hier, weil der Knopf
   * unten in den Werkzeugleisten sitzt, das Fenster aber den ganzen rechten
   * Bereich aufnimmt - siehe ui/PanelWindow.tsx.
   */
  const detach = useDetachState();

  // Nur für den einmaligen Blick beim Start - siehe unten.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  /** Zuletzt mit Strg+C gemerkte Aufgabe (nur die Id, der Rest wird frisch gelesen). */
  const clipboard = useRef<string | null>(null);

  // Zuletzt verwendete Datei anbieten (Handle liegt in IndexedDB).
  useEffect(() => {
    if (!isFileSystemAccessSupported()) return;
    void recallHandle().then((handle) => {
      if (handle) setRecalled(handle);
    });
  }, []);

  /*
   * Anleitung beim Start. Sie erscheint jedes Mal, solange mit dem
   * Beispielbestand gearbeitet wird - wer noch keine eigene Datei hat, ist
   * neu und braucht sie. Sobald eine eigene Datei geöffnet oder angelegt
   * wurde (`guideSeen`), bleibt sie weg und ist nur noch über "Hilfe" bzw.
   * Alt+H erreichbar.
   *
   * Die leere Abhängigkeitsliste ist Absicht: die Entscheidung fällt einmal
   * beim Start, nicht erneut, sobald `guideSeen` mitten in der Sitzung
   * umspringt (sonst ginge der Dialog beim Öffnen einer Datei wieder auf).
   */
  useEffect(() => {
    if (!prefsRef.current.guideSeen) setOverlay('guide');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Wird gerade Text eingegeben? Gefragt wird das Ziel des Ereignisses, nicht
   * `document.activeElement`: derselbe Handler laeuft auch im ausgelagerten
   * Fenster, und dort zeigte das Hauptdokument auf ein ganz anderes Element.
   */
  const isTyping = (event: KeyboardEvent) => {
    const el = event.target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  };

  /*
   * Ist Text markiert? Dann gehoert Kopieren dem Browser. Ohne diese Frage
   * schluckte MPT das Kopieren einer markierten Stelle im Plan und legte
   * stattdessen die gewaehlte Aufgabe in seine eigene Ablage.
   */
  const hasSelection = (event: KeyboardEvent) => {
    const view = (event.target as HTMLElement | null)?.ownerDocument?.defaultView ?? window;
    const selection = view.getSelection?.();
    return Boolean(selection && !selection.isCollapsed);
  };

  /**
   * Das Oeffnen einer Datei lebt in der Kopfzeile (mit Sperrpruefung, Hinweisen
   * und Fehleranzeige). Fuer Alt+O meldet sie ihre Funktion hier an - direkt
   * aufgerufen aus dem Tastendruck heraus, damit die Nutzergeste erhalten
   * bleibt: der Dateiwaehler des Browsers oeffnet sonst nicht.
   */
  const openFileRef = useRef<(() => void) | null>(null);

  /*
   * Overlays liegen immer im Hauptfenster. Kommt das Kürzel aus der
   * ausgelagerten Ansicht, wird das Hauptfenster mit nach vorn geholt - sonst
   * ginge die Befehlspalette hinter dem zweiten Fenster auf.
   */
  const openOverlay = useCallback((next: Overlay) => {
    setOverlay(next);
    window.focus();
  }, []);

  /*
   * Alle Kuerzel kommen aus `ui/shortcuts.ts` - dieselbe Quelle, aus der auch
   * die Beschriftungen stammen. Verglichen wird ueber die physische Taste und
   * das Zeichen zugleich; warum, steht dort ausfuehrlich.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const typing = isTyping(event);
      /*
       * Waehrend getippt wird, greifen nur Kuerzel, die im Feld dasselbe
       * bedeuten (Speichern, Befehle). Rueckgaengig gehoert nicht dazu: dort
       * ist Strg+Z die Ruecknahme des Tippfehlers - vorher nahm MPT
       * stattdessen die letzte Planaenderung zurueck.
       */
      const hit = (id: ShortcutId) => {
        const sc = shortcut(id);
        if (typing && !sc.whileTyping) return false;
        return matches(sc, event);
      };

      if (hit('palette')) {
        event.preventDefault();
        openOverlay('palette');
        return;
      }
      if (hit('save')) {
        event.preventDefault();
        void store.saveNow();
        return;
      }
      if (hit('open')) {
        event.preventDefault();
        openFileRef.current?.();
        return;
      }
      // Reihenfolge: Wiederholen vor Rueckgaengig - Umschalt+Cmd+Z traegt
      // beide Bedingungen, und die engere gewinnt.
      if (hit('redo')) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (hit('undo')) {
        event.preventDefault();
        store.undo();
        return;
      }
      if (event.key === 'Escape' && store.ui.pickTarget) {
        store.setUi({ pickTarget: null });
        return;
      }

      /*
       * Aufgaben kopieren. Bewusst eine eigene Ablage statt der System-
       * Zwischenablage: die Aufgabe wird als Objekt uebernommen, nicht als
       * Text. Markierter Text und Textfelder behalten deshalb ihr Kopieren.
       */
      if (hit('copyTask') && !hasSelection(event) && store.ui.selectedTaskId) {
        const task = store.client.tasks.find((t) => t.id === store.ui.selectedTaskId);
        if (task) {
          event.preventDefault();
          clipboard.current = task.id;
        }
        return;
      }
      if (hit('pasteTask') && clipboard.current) {
        const source = store.client.tasks.find((t) => t.id === clipboard.current);
        if (!source) return;
        event.preventDefault();
        const copy = duplicateTask(source);
        store.commitClient('Aufgabe kopiert', (c) => {
          c.tasks.push(copy);
        });
        // Den Vorhabenfilter nicht anfassen: steht er auf "Alle Vorhaben",
        // wuerde das Einfuegen die Ansicht sonst unerwartet einschraenken.
        store.setUi({ mode: 'tasks', selectedTaskId: copy.id });
        return;
      }

      // Alt+1..4 springen direkt in die vier gaengigen Ansichten.
      if (hit('viewNetwork')) {
        event.preventDefault();
        store.setUi({ mode: 'tasks' });
        setPrefs({ taskView: 'network' });
        return;
      }
      if (hit('viewGantt')) {
        event.preventDefault();
        store.setUi({ mode: 'tasks' });
        setPrefs({ taskView: 'gantt' });
        return;
      }
      if (hit('viewResourceChart')) {
        event.preventDefault();
        store.setUi({ mode: 'resources' });
        setPrefs({ resourceView: 'chart' });
        return;
      }
      if (hit('viewResourceTable')) {
        event.preventDefault();
        store.setUi({ mode: 'resources' });
        setPrefs({ resourceView: 'table' });
        return;
      }
      if (hit('togglePlan')) {
        event.preventDefault();
        store.setUi({ mode: 'tasks' });
        setPrefs({ taskView: prefs.taskView === 'network' ? 'gantt' : 'network' });
        return;
      }
      if (hit('warnings')) {
        event.preventDefault();
        openOverlay('warnings');
        return;
      }
      if (hit('guide')) {
        event.preventDefault();
        openOverlay('guide');
        return;
      }
      if (hit('newTask')) {
        event.preventDefault();
        const ventureId = store.ui.ventureId ?? store.client.ventures[0]?.id;
        if (!ventureId) return;
        const task = createTask(ventureId);
        store.commitClient('Aufgabe angelegt', (c) => {
          c.tasks.push(task);
        });
        store.setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId });
        return;
      }
      if (hit('newVenture')) {
        event.preventDefault();
        const venture = createVenture();
        store.commitClient('Vorhaben angelegt', (c) => {
          c.ventures.push(venture);
        });
        store.setUi({ ventureId: venture.id, selectedTaskId: null });
      }
    },
    [openOverlay, prefs.taskView, setPrefs, store],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const closeOverlay = () => setOverlay(null);

  /*
   * Beide Fenster zeigen eine echte Ansicht. Das Hauptfenster folgt wie immer
   * `ui.mode`; das ausgelagerte Fenster haelt seinen eigenen Modus. Beim
   * Hinausgeben schaltet das Hauptfenster automatisch auf den anderen - siehe
   * ui/PanelWindow.tsx.
   */
  const viewOf = (mode: ViewMode) => (mode === 'tasks' ? <TaskOverview /> : <ResourceOverview />);

  return (
    <DetachProvider value={detach}>
      <div className="app">
        <TopBar
          onOpenPalette={() => setOverlay('palette')}
          onOpenWarnings={() => setOverlay('warnings')}
          onOpenGuide={() => setOverlay('guide')}
          onProvideOpen={(fn) => {
            openFileRef.current = fn;
          }}
          recalled={recalled}
          onRecalledHandled={() => setRecalled(null)}
        />
        <BrowserNotice />
        <Sidebar />
        <main className="app__main main">{viewOf(store.ui.mode)}</main>

        {/*
          Das zweite Fenster. Es rendert per Portal, hat also keinen Platz im
          Raster; schliesst der Nutzer es von Hand, kommt seine Ansicht ins
          Hauptfenster zurueck.
        */}
        {detach.detached && (
          <PanelWindow
            detached={detach.detached}
            onClosed={() => {
              const returning = detach.detached?.mode;
              detach.forget();
              if (returning) store.setUi({ mode: returning });
            }}
            onKeyDown={onKeyDown}
          >
            {viewOf(detach.detached.mode)}
          </PanelWindow>
        )}
        {overlay === 'palette' && <CommandPalette onClose={closeOverlay} />}
        {overlay === 'warnings' && <WarningCenter onClose={closeOverlay} />}
        {overlay === 'guide' && <GuideDialog onClose={closeOverlay} />}

        {/*
          Version und Projektlink klein unten rechts. Der Link ist die einzige
          Ausnahme vom Grundsatz "keine externen Referenzen": er wird erst beim
          Anklicken aufgerufen, nichts wird beim Laden nachgeladen.
        */}
        <div className="versiontag" title={`MPT Version ${APP_VERSION}`}>
          <span className="mono">v{APP_VERSION}</span> ·{' '}
          <a className="versiontag__link" href={PROJECT_URL} target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
        </div>
      </div>
    </DetachProvider>
  );
}
