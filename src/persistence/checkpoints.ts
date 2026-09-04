/**
 * Checkpoints: Snapshots des gesamten Mandantenbestands im selben JSON.
 *
 * Regel laut Konzept: bei jeder Änderung wird ein Checkpoint erzeugt, aber
 * höchstens alle 10 Minuten einer; die letzten 50 sind abrufbar (Ringpuffer).
 * Ein manuell ausgelöster Checkpoint ignoriert das Zeitfenster.
 */
import { CHECKPOINT_MIN_INTERVAL_MS, MAX_CHECKPOINTS, type Checkpoint, type Database } from '../model/types';
import { newId } from '../model/factory';

export function shouldCreateCheckpoint(db: Database, now = Date.now()): boolean {
  const latest = db.checkpoints[0];
  if (!latest) return true;
  const age = now - new Date(latest.at).getTime();
  return Number.isNaN(age) || age >= CHECKPOINT_MIN_INTERVAL_MS;
}

/**
 * Legt einen Checkpoint des Zustands VOR der Änderung an. Der Snapshot wird
 * tief kopiert, damit spätere Mutationen ihn nicht verändern.
 */
export function pushCheckpoint(db: Database, label: string, snapshotOf: Database = db): Database {
  const checkpoint: Checkpoint = {
    id: newId('cp'),
    at: new Date().toISOString(),
    label,
    clients: structuredClone(snapshotOf.clients),
  };
  return { ...db, checkpoints: [checkpoint, ...db.checkpoints].slice(0, MAX_CHECKPOINTS) };
}

/** Stellt einen Checkpoint wieder her; der aktuelle Stand wird zuvor gesichert. */
export function restoreCheckpoint(db: Database, checkpointId: string): Database {
  const checkpoint = db.checkpoints.find((c) => c.id === checkpointId);
  if (!checkpoint) return db;
  const withBackup = pushCheckpoint(db, 'Vor Wiederherstellung', db);
  return { ...withBackup, clients: structuredClone(checkpoint.clients) };
}

export function describeCheckpoint(checkpoint: Checkpoint): string {
  const taskCount = checkpoint.clients.reduce((sum, c) => sum + c.tasks.length, 0);
  const clientCount = checkpoint.clients.length;
  return `${clientCount} Mandant${clientCount === 1 ? '' : 'en'}, ${taskCount} Aufgabe${taskCount === 1 ? '' : 'n'}`;
}

export function formatCheckpointTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
