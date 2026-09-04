/**
 * Zentraler Zustand.
 *
 * Aufteilung:
 *  - `data`  : der persistierte Datenbestand inkl. Undo/Redo-Historie.
 *  - `ui`    : Auswahl, Ansichtsmodus, Filter (nicht Teil von Undo, aber teils
 *              in localStorage gespiegelt).
 *
 * Änderungen laufen ausschließlich über `commit(label, recipe)`. Das Rezept
 * bekommt eine tiefe Kopie der Mandanten und mutiert sie frei - der Store
 * kümmert sich um Undo-Historie, Checkpoints und Autosave. Dadurch gibt es
 * keine zentrale Action-Liste, die bei jeder neuen Funktion mitwachsen muss.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LOCK_HEARTBEAT_MS, type Client, type Database, type Id } from '../model/types';
import { createClient, createDatabase } from '../model/factory';
import { pushCheckpoint, shouldCreateCheckpoint } from '../persistence/checkpoints';
import {
  isFileSystemAccessSupported,
  readLockFromHandle,
  rememberHandle,
  serialize,
  writeDatabase,
} from '../persistence/fileStore';
import { claimLock, inspectLock, releaseLock } from '../persistence/lock';

const UNDO_LIMIT = 200;
const COALESCE_MS = 1200;
const AUTOSAVE_DEBOUNCE_MS = 700;

export type SaveState =
  | { kind: 'no-file' }
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  /** Datei ist von jemand anderem gesperrt - es wird nichts geschrieben. */
  | { kind: 'readonly'; message: string };

export type ViewMode = 'tasks' | 'resources';

export interface UiState {
  clientId: Id | null;
  ventureId: Id | null;
  mode: ViewMode;
  selectedTaskId: Id | null;
  selectedResourceId: Id | null;
  /** Aktives Feld, in das per Klick in der Visualisierung übernommen wird. */
  pickTarget: null | { field: 'dependsOn' | 'parallelWith'; taskId: Id };
}

interface DataState {
  db: Database;
  past: Client[][];
  future: Client[][];
  lastCoalesceKey: string | null;
  lastCommitAt: number;
  dirty: boolean;
}

type DataAction =
  | { type: 'commit'; recipe: (clients: Client[]) => void; label: string; coalesceKey?: string; checkpoint: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; db: Database; dirty: boolean }
  | { type: 'markSaved' };

/**
 * Harte Invariante: es gibt immer mindestens einen Mandanten. Die gesamte
 * Oberfläche greift auf den aktiven Mandanten zu - ohne diese Garantie
 * stürzt ein leerer Datenbestand (z.B. direkt nach "Neu") ab.
 */
function withAtLeastOneClient(db: Database): Database {
  if (db.clients.length > 0) return db;
  return { ...db, clients: [createClient('Mandant')] };
}

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case 'commit': {
      const draft = structuredClone(state.db.clients);
      action.recipe(draft);

      const now = Date.now();
      const coalesce =
        action.coalesceKey !== undefined &&
        action.coalesceKey === state.lastCoalesceKey &&
        now - state.lastCommitAt < COALESCE_MS &&
        state.past.length > 0;

      const past = coalesce ? state.past : [...state.past, state.db.clients].slice(-UNDO_LIMIT);

      let db: Database = { ...state.db, clients: draft };
      if (action.checkpoint && !coalesce && shouldCreateCheckpoint(state.db, now)) {
        db = pushCheckpoint(db, action.label, state.db);
      }

      return {
        db,
        past,
        future: [],
        lastCoalesceKey: action.coalesceKey ?? null,
        lastCommitAt: now,
        dirty: true,
      };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        db: { ...state.db, clients: previous },
        past: state.past.slice(0, -1),
        future: [state.db.clients, ...state.future].slice(0, UNDO_LIMIT),
        lastCoalesceKey: null,
        dirty: true,
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        db: { ...state.db, clients: next },
        past: [...state.past, state.db.clients].slice(-UNDO_LIMIT),
        future: state.future.slice(1),
        lastCoalesceKey: null,
        dirty: true,
      };
    }
    case 'replace':
      return {
        db: withAtLeastOneClient(action.db),
        past: [],
        future: [],
        lastCoalesceKey: null,
        lastCommitAt: 0,
        dirty: action.dirty,
      };
    case 'markSaved':
      return { ...state, dirty: false };
  }
}

function uiReducer(state: UiState, patch: Partial<UiState>): UiState {
  return { ...state, ...patch };
}

export interface StoreValue {
  db: Database;
  client: Client;
  ui: UiState;
  setUi: (patch: Partial<UiState>) => void;
  /** Ändert die Daten. `coalesceKey` fasst schnelle Folgeänderungen zu einem Undo-Schritt zusammen. */
  commit: (label: string, recipe: (clients: Client[]) => void, options?: { coalesceKey?: string; checkpoint?: boolean }) => void;
  /** Ändert nur den aktiven Mandanten - Kurzform für den Normalfall. */
  commitClient: (label: string, recipe: (client: Client) => void, options?: { coalesceKey?: string; checkpoint?: boolean }) => void;
  replaceDatabase: (db: Database, options?: { dirty?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  fileName: string | null;
  /**
   * Verbindet eine Datei. `readOnly` wird gesetzt, wenn die Datei von einer
   * anderen Sitzung gesperrt ist - dann wird nichts zurückgeschrieben.
   */
  attachFile: (handle: FileSystemFileHandle, fileName: string, options?: { readOnly?: boolean }) => void;
  detachFile: () => void;
  saveNow: () => Promise<void>;
  supportsFileSystem: boolean;
  /** Datei ist nur zum Lesen verbunden (fremde Sperre). */
  readOnly: boolean;
  /** Hebt eine fremde Sperre auf und schreibt ab sofort wieder mit. */
  takeOverLock: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(dataReducer, undefined, () => ({
    db: createDatabase(),
    past: [],
    future: [],
    lastCoalesceKey: null,
    lastCommitAt: 0,
    dirty: false,
  }));

  const [ui, setUi] = useReducer(uiReducer, {
    clientId: null,
    ventureId: null,
    mode: 'tasks',
    selectedTaskId: null,
    selectedResourceId: null,
    pickTarget: null,
  } satisfies UiState);

  const [handle, setHandle] = useState<FileSystemFileHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'no-file' });
  const [readOnly, setReadOnly] = useState(false);

  // Aktiven Mandanten immer gültig halten.
  const client = useMemo(() => {
    const found = data.db.clients.find((c) => c.id === ui.clientId);
    return found ?? data.db.clients[0];
  }, [data.db.clients, ui.clientId]);

  useEffect(() => {
    if (client && ui.clientId !== client.id) setUi({ clientId: client.id, ventureId: null, selectedTaskId: null });
  }, [client, ui.clientId]);

  // --- Browser-Navigation ------------------------------------------------
  // Jede Ansichtsänderung landet als eigener History-Eintrag, damit die
  // Zurück-Taste des Browsers immer zur vorherigen Ansicht führt. `fromPopstate`
  // verhindert, dass das Zurückspringen selbst wieder einen Eintrag erzeugt.
  const fromPopstate = useRef(false);
  const lastPushed = useRef<string>('');

  useEffect(() => {
    const onPopstate = (event: PopStateEvent) => {
      const state = (event.state as { mptUi?: UiState } | null)?.mptUi;
      if (!state) return;
      fromPopstate.current = true;
      lastPushed.current = JSON.stringify(state);
      setUi(state);
    };
    window.addEventListener('popstate', onPopstate);
    return () => window.removeEventListener('popstate', onPopstate);
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(ui);
    if (serialized === lastPushed.current) return;

    if (fromPopstate.current) {
      fromPopstate.current = false;
      lastPushed.current = serialized;
      return;
    }
    // Der allererste Zustand ersetzt den bestehenden Eintrag, alle weiteren
    // legen einen neuen an.
    const method = lastPushed.current === '' ? 'replaceState' : 'pushState';
    lastPushed.current = serialized;
    try {
      window.history[method]({ mptUi: ui }, '');
    } catch {
      // In Sandboxes ohne History-Zugriff bleibt die Anwendung voll bedienbar.
    }
  }, [ui]);

  const commit = useCallback<StoreValue['commit']>((label, recipe, options) => {
    dispatch({
      type: 'commit',
      recipe,
      label,
      coalesceKey: options?.coalesceKey,
      checkpoint: options?.checkpoint !== false,
    });
  }, []);

  const commitClient = useCallback<StoreValue['commitClient']>(
    (label, recipe, options) => {
      const id = client?.id;
      if (!id) return;
      commit(
        label,
        (clients) => {
          const target = clients.find((c) => c.id === id);
          if (target) recipe(target);
        },
        options,
      );
    },
    [client?.id, commit],
  );

  const replaceDatabase = useCallback<StoreValue['replaceDatabase']>((db, options) => {
    dispatch({ type: 'replace', db, dirty: options?.dirty ?? false });
  }, []);

  const attachFile = useCallback<StoreValue['attachFile']>((newHandle, name, options) => {
    const isReadOnly = options?.readOnly === true;
    setHandle(newHandle);
    setFileName(name);
    setReadOnly(isReadOnly);
    setSaveState(
      isReadOnly
        ? { kind: 'readonly', message: 'Die Datei ist von einer anderen Sitzung in Bearbeitung.' }
        : { kind: 'clean' },
    );
    void rememberHandle(newHandle);
  }, []);

  const detachFile = useCallback(() => {
    setHandle(null);
    setFileName(null);
    setReadOnly(false);
    setSaveState({ kind: 'no-file' });
    void rememberHandle(null);
  }, []);

  const takeOverLock = useCallback(() => {
    setReadOnly(false);
    setSaveState({ kind: 'dirty' });
  }, []);

  // --- Autosave ----------------------------------------------------------
  const timerRef = useRef<number | null>(null);
  const writingRef = useRef(false);
  const pendingRef = useRef(false);

  /**
   * Schreibt den Bestand zurück und frischt dabei den eigenen Sperrvermerk auf.
   * Der Vermerk wird nur beim Schreiben gesetzt, nicht im Zustand gehalten -
   * so kann eine importierte oder geladene fremde Sperre nie versehentlich
   * mitgeschrieben werden.
   */
  const performWrite = useCallback(async () => {
    if (!handle || readOnly) return;
    if (writingRef.current) {
      pendingRef.current = true;
      return;
    }
    writingRef.current = true;
    setSaveState({ kind: 'saving' });
    try {
      await writeDatabase(handle, claimLock(data.db));
      dispatch({ type: 'markSaved' });
      setSaveState({ kind: 'saved', at: Date.now() });
    } catch (error) {
      setSaveState({
        kind: 'error',
        message: (error as Error).message || 'Unbekannter Fehler beim Speichern.',
      });
    } finally {
      writingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void performWrite();
      }
    }
  }, [handle, readOnly, data.db]);

  useEffect(() => {
    if (!handle || readOnly || !data.dirty) return;
    setSaveState((prev) => (prev.kind === 'error' ? prev : { kind: 'dirty' }));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void performWrite(), AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [data.db, data.dirty, handle, readOnly, performWrite]);

  // --- Sperre am Leben halten -------------------------------------------
  // Regelmäßiges Lebenszeichen, damit andere sehen, dass die Datei noch in
  // Bearbeitung ist. Gleichzeitig die Gegenprobe: hat jemand die Sperre
  // übernommen, wird sofort auf "nur lesen" umgeschaltet, statt seine
  // Änderungen zu überschreiben.
  useEffect(() => {
    if (!handle || readOnly) return;
    const beat = async () => {
      const foreign = await readLockFromHandle(handle);
      if (foreign === undefined) return; // Datei gerade nicht lesbar - später erneut.
      const status = inspectLock(foreign);
      if (status.kind === 'held') {
        setReadOnly(true);
        setSaveState({
          kind: 'readonly',
          message: `"${status.lock.holder}" hat die Datei übernommen. Es wird nichts mehr geschrieben.`,
        });
        return;
      }
      await performWrite();
    };
    const id = window.setInterval(() => void beat(), LOCK_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [handle, readOnly, performWrite]);

  // Sperre beim Schließen freigeben. Der Versuch ist bewusst "best effort" -
  // ein abgebrochener Schreibvorgang ist unkritisch, weil die Sperre ohnehin
  // von selbst abläuft (siehe persistence/lock.ts).
  useEffect(() => {
    if (!handle || readOnly) return;
    const release = () => {
      void writeDatabase(handle, releaseLock(data.db)).catch(() => undefined);
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, [handle, readOnly, data.db]);

  // Warnen, wenn ungespeicherte Änderungen verloren gingen.
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (data.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [data.dirty]);

  const value: StoreValue = {
    db: data.db,
    client,
    ui,
    setUi,
    commit,
    commitClient,
    replaceDatabase,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    canUndo: data.past.length > 0,
    canRedo: data.future.length > 0,
    saveState: handle ? saveState : data.dirty ? { kind: 'dirty' } : { kind: 'no-file' },
    fileName,
    attachFile,
    detachFile,
    saveNow: performWrite,
    supportsFileSystem: isFileSystemAccessSupported(),
    readOnly,
    takeOverLock,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore muss innerhalb von <StoreProvider> verwendet werden.');
  return value;
}

/** Serialisierung für Downloads/KI-Export. */
export function databaseToJson(db: Database): string {
  return serialize(db);
}
