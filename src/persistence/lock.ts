/**
 * Sperrvermerk für gemeinsam genutzte Ablagen (SharePoint, OneDrive,
 * Netzlaufwerk).
 *
 * Verfahren und warum es so gewählt ist:
 *  - Der Vermerk steht IN der Datei (`db.lock`), nicht in einer Sperrdatei
 *    daneben. Nur so trägt er auch dann, wenn ausschließlich diese eine Datei
 *    synchronisiert oder weitergegeben wird.
 *  - Der Halter schreibt regelmäßig ein Lebenszeichen fort (`heartbeatAt`).
 *  - Bleibt das Lebenszeichen aus - Browser geschlossen, Rechner abgestürzt,
 *    Tab eingefroren - läuft die Sperre nach `LOCK_TIMEOUT_MS` ab und darf von
 *    jedem übernommen werden. Eine Datei kann dadurch nie dauerhaft blockiert
 *    bleiben; genau das ist der Fall, den ein reines "gesperrt/nicht gesperrt"
 *    nicht abdecken würde.
 *  - Beim regulären Schließen wird die Sperre zusätzlich sofort freigegeben,
 *    damit niemand unnötig auf den Ablauf warten muss.
 *
 * Bewusste Grenze: das ist eine kooperative Sperre. Sie verhindert das
 * versehentliche gleichzeitige Bearbeiten, nicht das vorsätzliche.
 */
import { LOCK_TIMEOUT_MS, type Database, type FileLock } from '../model/types';

/** Eigene Sitzungs-Id - pro Tab einmalig. */
export const SESSION_ID = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const HOLDER_KEY = 'mpt.lockHolder';

/**
 * Anzeigename des Halters. Frei wählbar und rein informativ - er landet in der
 * Datei, damit ein Kollege sieht, wer sie gerade offen hat.
 */
export function holderName(): string {
  try {
    return localStorage.getItem(HOLDER_KEY) || 'Unbenannt';
  } catch {
    return 'Unbenannt';
  }
}

export function setHolderName(name: string): void {
  try {
    localStorage.setItem(HOLDER_KEY, name.trim() || 'Unbenannt');
  } catch {
    /* Ohne localStorage bleibt der Name sitzungslokal. */
  }
}

export type LockStatus =
  | { kind: 'free' }
  | { kind: 'own' }
  /** Fremde, noch gültige Sperre. */
  | { kind: 'held'; lock: FileLock; ageMs: number }
  /** Fremde, abgelaufene Sperre - darf übernommen werden. */
  | { kind: 'stale'; lock: FileLock; ageMs: number };

export function inspectLock(lock: FileLock | null | undefined, now = Date.now()): LockStatus {
  if (!lock) return { kind: 'free' };
  if (lock.sessionId === SESSION_ID) return { kind: 'own' };
  const heartbeat = Date.parse(lock.heartbeatAt);
  // Ein unlesbarer Zeitstempel gilt als abgelaufen - lieber übernehmbar als
  // für immer gesperrt.
  const ageMs = Number.isFinite(heartbeat) ? now - heartbeat : Number.POSITIVE_INFINITY;
  return ageMs > LOCK_TIMEOUT_MS ? { kind: 'stale', lock, ageMs } : { kind: 'held', lock, ageMs };
}

/** Setzt den eigenen Sperrvermerk (bzw. frischt ihn auf). */
export function claimLock(db: Database, now = new Date()): Database {
  const iso = now.toISOString();
  const previous = db.lock?.sessionId === SESSION_ID ? db.lock : null;
  return {
    ...db,
    lock: {
      sessionId: SESSION_ID,
      holder: holderName(),
      acquiredAt: previous?.acquiredAt ?? iso,
      heartbeatAt: iso,
    },
  };
}

/** Entfernt den eigenen Sperrvermerk. Fremde Sperren bleiben unberührt. */
export function releaseLock(db: Database): Database {
  if (db.lock && db.lock.sessionId !== SESSION_ID) return db;
  return { ...db, lock: null };
}

/** Lesbare Altersangabe für Meldungen. */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return 'unbekannt lange';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'weniger als einer Minute';
  if (minutes < 60) return `${minutes} Minute${minutes === 1 ? '' : 'n'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} Stunde${hours === 1 ? '' : 'n'}`;
  const days = Math.floor(hours / 24);
  return `${days} Tag${days === 1 ? '' : 'en'}`;
}
