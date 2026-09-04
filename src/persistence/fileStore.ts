/**
 * Dateizugriff über die File System Access API.
 *
 * Ablauf: Datei einmalig wählen -> Handle bleibt in der Sitzung erhalten ->
 * jede Änderung wird entprellt automatisch in dieselbe Datei zurückgeschrieben.
 * Der Handle wird zusätzlich in IndexedDB abgelegt, damit nach einem Reload
 * dieselbe Datei mit einem Klick wieder verbunden werden kann.
 *
 * Datenintegrität hat Vorrang: schlägt ein Schreibvorgang fehl, wird der
 * Fehler nach oben gemeldet und im UI deutlich angezeigt - es wird nichts
 * stillschweigend verworfen.
 */
import type { Database, FileLock } from "../model/types";
import { migrate, type MigrationResult } from "../model/migrate";

const DB_NAME = "mpt";
const STORE_NAME = "handles";
const HANDLE_KEY = "current-file";

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

/**
 * Warum steht der Dateizugriff nicht zur Verfügung?
 *
 * Die File System Access API fehlt nicht nur in Safari und Firefox. Auch in
 * Chrome verschwindet sie, sobald die Seite nicht aus einem sicheren Kontext
 * kommt - und "sicher" heisst hier `https://` oder `localhost`, nicht
 * `http://192.168.…` und nicht die per Doppelklick geöffnete Datei
 * (`file://`). Genau das ist die häufigste Verwechslung: der Browser kann es,
 * die Seite darf es nur nicht.
 *
 * Deshalb wird der Grund unterschieden statt pauschal "Browser kann nicht" zu
 * melden - sonst sucht man den Fehler an der falschen Stelle.
 */
export type FileAccessStatus =
  | { kind: "available" }
  /** Per Doppelklick geöffnet (`file://`). */
  | { kind: "local-file" }
  /** `http://` auf einem anderen Host als localhost. */
  | { kind: "insecure"; origin: string }
  /** In einen fremden Rahmen eingebettet. */
  | { kind: "embedded" }
  /** Der Browser kennt die Schnittstelle nicht (Safari, Firefox). */
  | { kind: "unsupported" };

export function fileAccessStatus(): FileAccessStatus {
  if (typeof window === "undefined") return { kind: "unsupported" };
  if ("showOpenFilePicker" in window) return { kind: "available" };

  if (window.location.protocol === "file:") return { kind: "local-file" };
  if (!window.isSecureContext) return { kind: "insecure", origin: window.location.origin };
  // `window.top` ist bei fremder Herkunft nicht lesbar, der Vergleich selbst
  // aber erlaubt.
  if (window.self !== window.top) return { kind: "embedded" };
  return { kind: "unsupported" };
}

const PICKER_OPTIONS = {
  types: [
    {
      description: "MPT Datenbestand",
      accept: { "application/json": [".json"] },
    },
  ],
  excludeAcceptAllOption: false,
  multiple: false,
} as const;

// ---------------------------------------------------------------------------
// IndexedDB für den Datei-Handle
// ---------------------------------------------------------------------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberHandle(
  handle: FileSystemFileHandle | null,
): Promise<void> {
  try {
    const idb = await openIdb();
    const tx = idb.transaction(STORE_NAME, "readwrite");
    if (handle) tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    else tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    await new Promise((res) => {
      tx.oncomplete = res;
      tx.onerror = res;
    });
    idb.close();
  } catch {
    // Nicht kritisch - der Nutzer wählt die Datei dann erneut.
  }
}

export async function recallHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const idb = await openIdb();
    const tx = idb.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    const handle = await new Promise<FileSystemFileHandle | null>((resolve) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
    idb.close();
    return handle;
  } catch {
    return null;
  }
}

export async function hasWritePermission(
  handle: FileSystemFileHandle,
  request: boolean,
): Promise<boolean> {
  const opts = { mode: "readwrite" } as const;
  const anyHandle = handle as any;
  if ((await anyHandle.queryPermission?.(opts)) === "granted") return true;
  if (!request) return false;
  return (await anyHandle.requestPermission?.(opts)) === "granted";
}

// ---------------------------------------------------------------------------
// Öffnen / Speichern
// ---------------------------------------------------------------------------

export interface OpenResult {
  handle: FileSystemFileHandle;
  fileName: string;
  migration: MigrationResult;
}

export async function openDatabaseFile(): Promise<OpenResult | null> {
  if (!isFileSystemAccessSupported())
    throw new Error(
      "Dieser Browser unterstützt den direkten Dateizugriff nicht.",
    );
  const [handle] = await (window as any).showOpenFilePicker(PICKER_OPTIONS);
  if (!handle) return null;
  return readFromHandle(handle);
}

export async function readFromHandle(
  handle: FileSystemFileHandle,
): Promise<OpenResult> {
  const file = await handle.getFile();
  const text = await file.text();
  let raw: unknown = null;
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Die Datei "${file.name}" enthält kein gültiges JSON. Es wurde nichts verändert. (${(error as Error).message})`,
      );
    }
  }

  const migration = migrate(raw);
  // Vor einer echten Migration eine Sicherungskopie der Originaldatei ablegen.
  if (migration.migrated && text.trim().length > 0) {
    await writeBackup(handle, file.name, text, migration.fromVersion);
    migration.notes.push(
      `Sicherungskopie der Originaldatei wurde neben der Datei abgelegt.`,
    );
  }
  return { handle, fileName: file.name, migration };
}

async function writeBackup(
  handle: FileSystemFileHandle,
  fileName: string,
  content: string,
  fromVersion: number,
): Promise<void> {
  try {
    const parent: any = await (handle as any).getParent?.();
    const base = fileName.replace(/\.json$/i, "");
    const backupName = `${base}.v${fromVersion}.bak.json`;
    if (parent?.getFileHandle) {
      const backupHandle = await parent.getFileHandle(backupName, {
        create: true,
      });
      const writable = await backupHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    }
  } catch {
    // getParent() ist nicht überall verfügbar - dann Download als Fallback.
  }
  downloadText(
    content,
    fileName.replace(/\.json$/i, "") + `.v${fromVersion}.bak.json`,
  );
}

export async function createDatabaseFile(
  suggestedName = "projektplan.json",
): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported())
    throw new Error(
      "Dieser Browser unterstützt den direkten Dateizugriff nicht.",
    );
  const handle = await (window as any).showSaveFilePicker({
    suggestedName,
    types: PICKER_OPTIONS.types,
  });
  return handle ?? null;
}

export function serialize(db: Database): string {
  return JSON.stringify(
    { ...db, meta: { ...db.meta, updatedAt: new Date().toISOString() } },
    null,
    2,
  );
}

export async function writeDatabase(
  handle: FileSystemFileHandle,
  db: Database,
): Promise<void> {
  const granted = await hasWritePermission(handle, true);
  if (!granted)
    throw new Error("Schreibrechte für die Datei wurden nicht erteilt.");
  const writable = await handle.createWritable();
  try {
    await writable.write(serialize(db));
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      /* ignorieren */
    }
    throw error;
  }
}

/**
 * Liest nur den Sperrvermerk aus der Datei - ohne den Rest zu übernehmen.
 * Wird für die regelmäßige Prüfung genutzt, ob jemand anderes die Datei
 * inzwischen übernommen hat. Fehler sind hier absichtlich nicht fatal: eine
 * kurzzeitig nicht lesbare Datei (Synchronisation) darf die Arbeit nicht
 * unterbrechen.
 */
export async function readLockFromHandle(
  handle: FileSystemFileHandle,
): Promise<FileLock | null | undefined> {
  try {
    const text = await (await handle.getFile()).text();
    if (text.trim().length === 0) return null;
    const raw = JSON.parse(text) as { lock?: unknown };
    const lock = raw?.lock as FileLock | null | undefined;
    return lock && typeof lock === "object" && typeof lock.sessionId === "string"
      ? lock
      : null;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fallback ohne File System Access API
// ---------------------------------------------------------------------------

export function downloadText(
  content: string,
  fileName: string,
  mime = "application/json",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFileViaInput(): Promise<{
  name: string;
  text: string;
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text() });
    };
    input.click();
  });
}
