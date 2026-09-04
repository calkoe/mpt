/**
 * Tests der Dateisperre. Die entscheidende Eigenschaft: eine Datei darf nie
 * dauerhaft blockiert bleiben, auch wenn der Browser einfach geschlossen wird.
 */
import { describe, expect, it } from 'vitest';
import { LOCK_TIMEOUT_MS, type Database, type FileLock } from '../model/types';
import { claimLock, inspectLock, releaseLock, SESSION_ID } from './lock';

const NOW = Date.parse('2026-09-04T12:00:00.000Z');

function lockAt(offsetMs: number, sessionId = 'fremd'): FileLock {
  const at = new Date(NOW - offsetMs).toISOString();
  return { sessionId, holder: 'Anna', acquiredAt: at, heartbeatAt: at };
}

function emptyDb(lock: FileLock | null = null): Database {
  return {
    schemaVersion: 2,
    meta: { createdAt: '', updatedAt: '', appVersion: '1.0.0' },
    clients: [],
    checkpoints: [],
    lock,
  };
}

describe('Dateisperre', () => {
  it('erkennt eine freie Datei', () => {
    expect(inspectLock(null, NOW).kind).toBe('free');
    expect(inspectLock(undefined, NOW).kind).toBe('free');
  });

  it('erkennt die eigene Sperre', () => {
    expect(inspectLock(lockAt(0, SESSION_ID), NOW).kind).toBe('own');
  });

  it('hält eine frische fremde Sperre für gültig', () => {
    const status = inspectLock(lockAt(30_000), NOW);
    expect(status.kind).toBe('held');
  });

  it('gibt eine Sperre ohne Lebenszeichen wieder frei', () => {
    // Genau der Fall "Browser wurde einfach geschlossen".
    const status = inspectLock(lockAt(LOCK_TIMEOUT_MS + 1000), NOW);
    expect(status.kind).toBe('stale');
  });

  it('behandelt einen unlesbaren Zeitstempel als abgelaufen', () => {
    const broken: FileLock = { sessionId: 'x', holder: 'Y', acquiredAt: 'quatsch', heartbeatAt: 'quatsch' };
    expect(inspectLock(broken, NOW).kind).toBe('stale');
  });

  it('setzt und entfernt den eigenen Vermerk', () => {
    const claimed = claimLock(emptyDb(), new Date(NOW));
    expect(claimed.lock?.sessionId).toBe(SESSION_ID);
    expect(releaseLock(claimed).lock).toBeNull();
  });

  it('behält den ursprünglichen Zeitpunkt beim Auffrischen', () => {
    const first = claimLock(emptyDb(), new Date(NOW));
    const second = claimLock(first, new Date(NOW + 60_000));
    expect(second.lock?.acquiredAt).toBe(first.lock?.acquiredAt);
    expect(second.lock?.heartbeatAt).not.toBe(first.lock?.heartbeatAt);
  });

  it('räumt eine fremde Sperre nicht weg', () => {
    const foreign = emptyDb(lockAt(10_000));
    expect(releaseLock(foreign).lock).not.toBeNull();
  });
});
