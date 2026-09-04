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
import { useStore } from './state/store';
import { usePreferences } from './state/preferences';
import { createTask, createVenture, duplicateTask } from './model/factory';
import { isFileSystemAccessSupported, recallHandle } from './persistence/fileStore';
import { APP_VERSION, PROJECT_URL } from './version';

type Overlay = 'palette' | 'warnings' | 'guide';

export function App() {
  const store = useStore();
  const { prefs, setPrefs } = usePreferences();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [recalled, setRecalled] = useState<FileSystemFileHandle | null>(null);

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

  const isTyping = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
  };

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOverlay('palette');
        return;
      }
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        store.undo();
        return;
      }
      if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.saveNow();
        return;
      }
      if (event.key === 'Escape' && store.ui.pickTarget) {
        store.setUi({ pickTarget: null });
        return;
      }

      /*
       * Aufgaben kopieren. Bewusst eine eigene Ablage statt der System-
       * Zwischenablage: die Aufgabe wird als Objekt uebernommen, nicht als
       * Text, und Kopieren in einem Textfeld soll weiterhin Text kopieren.
       */
      if (mod && event.key.toLowerCase() === 'c' && !isTyping() && store.ui.selectedTaskId) {
        const task = store.client.tasks.find((t) => t.id === store.ui.selectedTaskId);
        if (task) {
          event.preventDefault();
          clipboard.current = task.id;
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'v' && !isTyping() && clipboard.current) {
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

      if (!event.altKey || isTyping()) return;

      switch (event.key.toLowerCase()) {
        // Alt+1..4 springen direkt in die vier gängigen Ansichten.
        case '1':
          event.preventDefault();
          store.setUi({ mode: 'tasks' });
          setPrefs({ taskView: 'network' });
          break;
        case '2':
          event.preventDefault();
          store.setUi({ mode: 'tasks' });
          setPrefs({ taskView: 'gantt' });
          break;
        case '3':
          event.preventDefault();
          store.setUi({ mode: 'resources' });
          setPrefs({ resourceView: 'chart' });
          break;
        case '4':
          event.preventDefault();
          store.setUi({ mode: 'resources' });
          setPrefs({ resourceView: 'table' });
          break;
        case 'g':
          event.preventDefault();
          store.setUi({ mode: 'tasks' });
          setPrefs({ taskView: prefs.taskView === 'network' ? 'gantt' : 'network' });
          break;
        case 'w':
          event.preventDefault();
          setOverlay('warnings');
          break;
        case 'h':
          event.preventDefault();
          setOverlay('guide');
          break;
        case 'n': {
          event.preventDefault();
          const ventureId = store.ui.ventureId ?? store.client.ventures[0]?.id;
          if (!ventureId) return;
          const task = createTask(ventureId);
          store.commitClient('Aufgabe angelegt', (c) => {
            c.tasks.push(task);
          });
          store.setUi({ mode: 'tasks', selectedTaskId: task.id, ventureId });
          break;
        }
        case 'v': {
          event.preventDefault();
          const venture = createVenture();
          store.commitClient('Vorhaben angelegt', (c) => {
            c.ventures.push(venture);
          });
          store.setUi({ ventureId: venture.id, selectedTaskId: null });
          break;
        }
      }
    },
    [prefs.taskView, setPrefs, store],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const closeOverlay = () => setOverlay(null);

  return (
    <div className="app">
      <TopBar
        onOpenPalette={() => setOverlay('palette')}
        onOpenWarnings={() => setOverlay('warnings')}
        onOpenGuide={() => setOverlay('guide')}
        recalled={recalled}
        onRecalledHandled={() => setRecalled(null)}
      />
      <BrowserNotice />
      <Sidebar />
      <main className="app__main main">
        {store.ui.mode === 'tasks' ? <TaskOverview /> : <ResourceOverview />}
      </main>
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
  );
}
