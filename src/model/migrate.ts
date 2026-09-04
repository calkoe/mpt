/**
 * Migration und Normalisierung geladener Datenbestände.
 *
 * Wichtig: alte Dateien dürfen NIE kaputtgehen. Der Ablauf beim Laden ist
 *   1. `migrate()` hebt das Schema Schritt für Schritt auf CURRENT_SCHEMA_VERSION,
 *   2. `normalizeDatabase()` repariert fehlende Felder und entfernt tote Verweise.
 *
 * Regeln für neue Schemaversionen:
 *   - CURRENT_SCHEMA_VERSION in `types.ts` erhöhen,
 *   - eine Funktion `(db) => db` in MIGRATIONS mit dem Key der ALTEN Version
 *     ergänzen (z.B. `1: (db) => ...` hebt von 1 auf 2),
 *   - niemals eine bestehende Migration nachträglich verändern.
 * Vor der Migration legt `persistence/fileStore.ts` automatisch eine
 * Sicherungskopie der Originaldatei an.
 */
import {
  CURRENT_SCHEMA_VERSION,
  MAX_CHECKPOINTS,
  type Budget,
  type BudgetKind,
  type Client,
  type Condition,
  type CostItem,
  type Database,
  type FileLock,
  type NodeOffset,
  type PeriodValue,
  type Person,
  type Tag,
  type Task,
  type TaskStatus,
  type Venture,
} from './types';
import { createDatabase, nextTagColor, newId } from './factory';
import { APP_VERSION } from '../version';
import { isValidIso, today } from '../engine/dates';

type AnyRecord = Record<string, any>;

// Kleine Lesehelfer. Stehen bewusst vor den Migrationsschritten, weil auch
// diese unbekannte Rohdaten auswerten.
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const dateOrUndef = (v: unknown): string | undefined => (isValidIso(v) ? v : undefined);

/** Migrationsschritte: Key = Ausgangsversion. */
const MIGRATIONS: Record<number, (db: AnyRecord) => AnyRecord> = {
  /**
   * 1 -> 2: Dauerläufer haben kein eigenes Kennzeichen mehr, sondern schlicht
   * kein Enddatum - erkennbar an einer Dauer von 0. Zusätzlich kommt das
   * Meilenstein-Kennzeichen dazu.
   */
  1: (db) => ({
    ...db,
    schemaVersion: 2,
    clients: arr(db.clients).map((client) => ({
      ...client,
      tasks: arr(client?.tasks).map((task) => {
        const schedule = { ...(task?.schedule ?? {}) };
        if (schedule.openEnded === true) {
          schedule.durationMin = 0;
          schedule.durationMax = 0;
          schedule.end = undefined;
        }
        delete schedule.openEnded;
        return { ...task, milestone: bool(task?.milestone), schedule };
      }),
    })),
  }),

  /**
   * 2 -> 3: grosser Schnitt. Freitext und Vorhabenbeschreibung entfallen, der
   * Abschlussstatus des Vorhabens wird abgeleitet statt gespeichert, Personen
   * und Budgets werden taggbar, Budgets bekommen eine Art, Bedarfe eine
   * Zeitraumliste und Kosten einen zweiten Betrag.
   *
   * `blocked` wird bewusst zu `open` und nicht zu `operations`: der neue
   * Zustand "Betrieb" zaehlt wie abgeschlossen. Alte blockierte Aufgaben
   * wuerden dadurch stillschweigend als erledigt gelten - das waere eine
   * inhaltliche Aussage, die die Datei nie getroffen hat.
   */
  2: (db) => ({
    ...db,
    schemaVersion: 3,
    clients: arr(db.clients).map((client) => ({
      ...client,
      ventures: arr(client?.ventures).map((venture) => ({
        id: venture?.id,
        name: venture?.name,
      })),
      people: arr(client?.people).map((person) => ({ ...person, tagIds: arr(person?.tagIds) })),
      budgets: arr(client?.budgets).map((budget) => ({
        ...budget,
        kind: budget?.kind ?? 'neutral',
        tagIds: arr(budget?.tagIds),
      })),
      tasks: arr(client?.tasks).map((task) => {
        const next = { ...task };
        delete next.notes;
        next.status = task?.status === 'blocked' ? 'open' : task?.status;
        next.assignments = arr(task?.assignments).map((a) => ({ ...a, periods: arr(a?.periods) }));
        next.costs = arr(task?.costs).map((c) => ({ ...c, actualAmount: num(c?.actualAmount, 0) }));
        return next;
      }),
    })),
  }),

  /** 3 -> 4: Kostenpositionen bekommen ein Notizfeld. */
  3: (db) => ({
    ...db,
    schemaVersion: 4,
    clients: arr(db.clients).map((client) => ({
      ...client,
      tasks: arr(client?.tasks).map((task) => ({
        ...task,
        costs: arr(task?.costs).map((c) => ({ ...c, note: str(c?.note) })),
      })),
    })),
  }),
};

export interface MigrationResult {
  db: Database;
  /** Ausgangsversion der geladenen Datei. */
  fromVersion: number;
  migrated: boolean;
  /** Was repariert oder ergänzt wurde - wird dem Nutzer angezeigt. */
  notes: string[];
}

export function migrate(raw: unknown): MigrationResult {
  const notes: string[] = [];
  if (!raw || typeof raw !== 'object') {
    notes.push('Datei war leer oder unlesbar - es wurde ein leerer Datenbestand angelegt.');
    return { db: createDatabase([]), fromVersion: 0, migrated: false, notes };
  }

  let db = raw as AnyRecord;
  const fromVersion = typeof db.schemaVersion === 'number' ? db.schemaVersion : 0;

  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    notes.push(
      `Die Datei stammt aus einer neueren Version (Schema ${fromVersion}, unterstützt wird ${CURRENT_SCHEMA_VERSION}). Unbekannte Felder bleiben erhalten, können aber nicht bearbeitet werden.`,
    );
  }

  let version = fromVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      notes.push(`Kein Migrationsschritt von Schema ${version} - Daten werden nur normalisiert.`);
      break;
    }
    db = step(db);
    version = typeof db.schemaVersion === 'number' ? db.schemaVersion : version + 1;
    notes.push(`Schema von ${version - 1} auf ${version} migriert.`);
  }

  const normalized = normalizeDatabase(db, notes);
  return { db: normalized, fromVersion, migrated: fromVersion !== CURRENT_SCHEMA_VERSION, notes };
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

const STATUSES: TaskStatus[] = ['open', 'active', 'operations', 'done'];
const BUDGET_KINDS: BudgetKind[] = ['neutral', 'order', 'investment'];

export function normalizeDatabase(raw: AnyRecord, notes: string[] = []): Database {
  const now = new Date().toISOString();
  const clients = arr(raw.clients).map((c) => normalizeClient(c, notes));
  if (clients.length === 0) {
    clients.push({
      id: newId('cli'),
      name: 'Standard',
      ventures: [],
      tasks: [],
      people: [],
      budgets: [],
      tags: [],
      conditions: [],
    });
    notes.push('Kein Mandant vorhanden - "Standard" wurde angelegt.');
  }

  const checkpoints = arr(raw.checkpoints)
    .map((cp) => ({
      id: str(cp?.id) || newId('cp'),
      at: str(cp?.at) || now,
      label: str(cp?.label, 'Checkpoint'),
      clients: arr(cp?.clients).map((c) => normalizeClient(c, [])),
    }))
    .slice(0, MAX_CHECKPOINTS);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      createdAt: str(raw.meta?.createdAt, now),
      updatedAt: now,
      appVersion: APP_VERSION,
    },
    clients,
    checkpoints,
    lock: normalizeLock(raw.lock),
  };
}

/** Unvollständige Sperrvermerke gelten als "nicht gesperrt". */
function normalizeLock(raw: unknown): FileLock | null {
  const lock = raw as AnyRecord | null;
  if (!lock || typeof lock !== 'object') return null;
  const sessionId = str(lock.sessionId);
  const heartbeatAt = str(lock.heartbeatAt);
  if (!sessionId || !heartbeatAt) return null;
  return {
    sessionId,
    holder: str(lock.holder, 'Unbekannt'),
    acquiredAt: str(lock.acquiredAt, heartbeatAt),
    heartbeatAt,
  };
}

function normalizeClient(raw: AnyRecord, notes: string[]): Client {
  const id = str(raw?.id) || newId('cli');
  const ventures: Venture[] = arr(raw?.ventures).map((v) => ({
    id: str(v?.id) || newId('ven'),
    name: str(v?.name, 'Vorhaben'),
  }));

  const tags: Tag[] = [];
  for (const t of arr(raw?.tags)) {
    const tag: Tag = {
      id: str(t?.id) || newId('tag'),
      name: str(t?.name, 'Tag'),
      color: /^#[0-9a-fA-F]{6}$/.test(str(t?.color)) ? str(t.color) : nextTagColor(tags),
    };
    tags.push(tag);
  }

  const people: Person[] = arr(raw?.people).map((p) => ({
    id: str(p?.id) || newId('per'),
    name: str(p?.name, 'Person'),
    role: str(p?.role),
    defaultFte: clamp(num(p?.defaultFte, 1), 0, 10),
    availability: arr(p?.availability).map(normalizePeriod),
    // Tag-Ids werden weiter unten gefiltert, sobald die Tags bekannt sind.
    tagIds: arr(p?.tagIds).map(String),
  }));

  const budgets: Budget[] = arr(raw?.budgets).map((b) => ({
    id: str(b?.id) || newId('bud'),
    name: str(b?.name, 'Budget'),
    kind: BUDGET_KINDS.includes(b?.kind) ? b.kind : 'neutral',
    totalLimit: Math.max(0, num(b?.totalLimit, 0)),
    limits: arr(b?.limits).map(normalizePeriod),
    tagIds: arr(b?.tagIds).map(String),
  }));

  const conditions: Condition[] = arr(raw?.conditions).map((c) => ({
    id: str(c?.id) || newId('cnd'),
    name: str(c?.name, 'Bedingung'),
    met: bool(c?.met),
  }));

  const ventureIds = new Set(ventures.map((v) => v.id));
  const personIds = new Set(people.map((p) => p.id));
  const budgetIds = new Set(budgets.map((b) => b.id));
  const tagIds = new Set(tags.map((t) => t.id));

  // Tote Tag-Verweise entfernen. Geht erst hier, weil die Tags oben erst
  // aufgebaut werden.
  for (const person of people) person.tagIds = person.tagIds.filter((t) => tagIds.has(t));
  for (const budget of budgets) budget.tagIds = budget.tagIds.filter((t) => tagIds.has(t));
  const conditionIds = new Set(conditions.map((c) => c.id));

  const rawTasks = arr(raw?.tasks);
  const taskIds = new Set(rawTasks.map((t) => str(t?.id)).filter(Boolean));

  const tasks: Task[] = rawTasks.map((t) => {
    let ventureId = str(t?.ventureId);
    if (!ventureIds.has(ventureId)) {
      if (ventures.length === 0) {
        const fallback: Venture = { id: newId('ven'), name: 'Ohne Vorhaben' };
        ventures.push(fallback);
        ventureIds.add(fallback.id);
        notes.push('Aufgaben ohne gültiges Vorhaben wurden dem Vorhaben "Ohne Vorhaben" zugeordnet.');
      }
      ventureId = ventures[0].id;
    }

    // Dauer 0 ist gültig und bedeutet "kein Enddatum" (Dauerläufer).
    const durationMin = Math.max(0, Math.round(num(t?.schedule?.durationMin, num(t?.schedule?.duration, 5))));
    const durationMax = Math.max(durationMin, Math.round(num(t?.schedule?.durationMax, durationMin)));
    const anchor = t?.schedule?.anchor === 'dependency' ? 'dependency' : 'date';
    const dependsOn = arr(t?.dependsOn).map(String).filter((d) => taskIds.has(d) && d !== str(t?.id));

    return {
      id: str(t?.id) || newId('tsk'),
      ventureId,
      title: str(t?.title, 'Aufgabe'),
      description: str(t?.description),
      checklist: arr(t?.checklist).map((c) => ({
        id: str(c?.id) || newId('chk'),
        text: str(c?.text),
        done: bool(c?.done),
      })),
      status: STATUSES.includes(t?.status) ? t.status : 'open',
      milestone: bool(t?.milestone),
      layout: normalizeOffset(t?.layout),
      schedule: {
        anchor,
        start: anchor === 'date' ? (dateOrUndef(t?.schedule?.start) ?? today()) : dateOrUndef(t?.schedule?.start),
        end: dateOrUndef(t?.schedule?.end),
        durationMin,
        durationMax,
      },
      dependsOn,
      parallelWith: arr(t?.parallelWith).map(String).filter((d) => taskIds.has(d) && d !== str(t?.id)),
      ventureConditions: arr(t?.ventureConditions).map(String).filter((v) => ventureIds.has(v)),
      conditionIds: arr(t?.conditionIds).map(String).filter((c) => conditionIds.has(c)),
      tagIds: arr(t?.tagIds).map(String).filter((tg) => tagIds.has(tg)),
      assignments: arr(t?.assignments)
        .filter((a) => personIds.has(str(a?.personId)))
        .map((a) => ({
          id: str(a?.id) || newId('asg'),
          personId: str(a.personId),
          mode: a?.mode === 'PT' ? ('PT' as const) : ('FTE' as const),
          value: Math.max(0, num(a?.value, 0)),
          periods: arr(a?.periods).map(normalizePeriod),
        })),
      costs: arr(t?.costs)
        .filter((c) => budgetIds.has(str(c?.budgetId)))
        .map(
          (c): CostItem => ({
            id: str(c?.id) || newId('cst'),
            budgetId: str(c.budgetId),
            label: str(c?.label, 'Kosten'),
            amount: num(c?.amount, 0),
            actualAmount: Math.max(0, num(c?.actualAmount, 0)),
            note: str(c?.note),
            recurring: bool(c?.recurring),
            interval: ['day', 'week', 'month', 'quarter', 'year'].includes(c?.interval) ? c.interval : 'month',
            every: Math.max(1, Math.round(num(c?.every, 1))),
          }),
        ),
    };
  });

  return { id, name: str(raw?.name, 'Mandant'), ventures, tasks, people, budgets, tags, conditions };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Zeitraumwert - dieselbe Form bei Verfügbarkeit, Obergrenzen und Bedarfen. */
function normalizePeriod(raw: AnyRecord): PeriodValue {
  return {
    id: str(raw?.id) || newId('prd'),
    from: dateOrUndef(raw?.from),
    to: dateOrUndef(raw?.to),
    value: Math.max(0, num(raw?.value, 0)),
  };
}

/** Netzplan-Versatz; unbrauchbare Werte gelten als "kein Versatz". */
function normalizeOffset(raw: unknown): NodeOffset | undefined {
  const offset = raw as AnyRecord | null;
  if (!offset || typeof offset !== 'object') return undefined;
  const dx = num(offset.dx, 0);
  const dy = num(offset.dy, 0);
  return dx === 0 && dy === 0 ? undefined : { dx, dy };
}
