/**
 * Terminberechnung und kritischer Pfad.
 *
 * Ablauf:
 *  1. Topologische Sortierung über die Ende->Start-Abhängigkeiten (Zyklen werden
 *     erkannt und aus der Berechnung genommen).
 *  2. Vorwärtsrechnung: früheste Lage jeder Aufgabe im gewählten Szenario
 *     ('min' = optimistisch, 'max' = pessimistisch).
 *  3. Rückwärtsrechnung vom Projektende: späteste Lage und Gesamtpuffer.
 *  4. Kritischer Pfad = alle Aufgaben mit Puffer 0.
 *
 * Ungetrackte Bedingungen und nicht abgeschlossene Vorhaben verschieben bewusst
 * KEINE Termine (sonst wäre gar keine Planung möglich) - sie erzeugen nur
 * Warnungen, siehe `engine/validate.ts`.
 */
import { isOpenEnded, type Client, type Id, type IsoDate, type Task } from '../model/types';
import { addDays, addWorkdays, diffDays, maxDate, nextWorkday, prevWorkday, today, workdaysBetween } from './dates';

export type Scenario = 'min' | 'max';

export interface ScheduledTask {
  task: Task;
  /** Früheste Lage. */
  start: IsoDate;
  end: IsoDate;
  /** Dauer in Arbeitstagen im gewählten Szenario. */
  duration: number;
  /** Ende im jeweils anderen Szenario - Basis für den Unschärfebalken. */
  endOptimistic: IsoDate;
  endPessimistic: IsoDate;
  /** Späteste Lage aus der Rückwärtsrechnung. */
  lateStart: IsoDate;
  lateEnd: IsoDate;
  /** Gesamtpuffer in Arbeitstagen. */
  slack: number;
  critical: boolean;
  /** Abhängigkeitstiefe (0 = keine Vorgänger). */
  depth: number;
  /** Aufgabe ist Teil eines Abhängigkeitszyklus und wurde nicht terminiert. */
  cyclic: boolean;
  /** Dauerläufer: Ende ist nur der Horizont, kein echter Endtermin. */
  openEnded: boolean;
}

export interface ScheduleResult {
  /** Ergebnis je Aufgaben-Id. */
  byId: Map<Id, ScheduledTask>;
  /** Terminierte Aufgaben in topologischer Reihenfolge. */
  ordered: ScheduledTask[];
  /** Aufgaben-Ids, die in einem Zyklus hängen. */
  cycles: Id[];
  /** Betrachtungszeitraum über alle Aufgaben. */
  horizonStart: IsoDate;
  horizonEnd: IsoDate;
  projectEnd: IsoDate;
}

/**
 * Dauer einer Aufgabe im Szenario, in Arbeitstagen. Dauerläufer haben keine
 * Dauer; für sie liefert die Funktion 1, damit der Balken einen Anfang hat -
 * das Ende setzt `computeSchedule` später auf den Horizont.
 */
export function durationOf(task: Task, scenario: Scenario): number {
  const { durationMin, durationMax } = task.schedule;
  const min = Math.max(1, Math.round(durationMin || 1));
  const max = Math.max(min, Math.round(durationMax || min));
  return scenario === 'min' ? min : max;
}

/** Existiert der Vorgänger noch und liegt er im selben Mandanten? */
function validDeps(task: Task, known: Set<Id>): Id[] {
  return task.dependsOn.filter((id) => known.has(id) && id !== task.id);
}

/**
 * Topologische Sortierung (Kahn). Aufgaben in Zyklen bleiben übrig und werden
 * separat zurückgegeben.
 */
function topoSort(tasks: Task[]): { order: Task[]; cycles: Id[] } {
  const known = new Set(tasks.map((t) => t.id));
  const indegree = new Map<Id, number>();
  const dependents = new Map<Id, Id[]>();

  for (const t of tasks) {
    const deps = validDeps(t, known);
    indegree.set(t.id, deps.length);
    for (const d of deps) {
      const list = dependents.get(d) ?? [];
      list.push(t.id);
      dependents.set(d, list);
    }
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const queue = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  const order: Task[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = byId.get(id);
    if (task) order.push(task);
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  const cycles = tasks.filter((t) => !order.includes(t)).map((t) => t.id);
  return { order, cycles };
}

/**
 * Prüft, ob eine neue Abhängigkeit `taskId` -> `dependencyId` einen Zyklus
 * erzeugen würde. Wird im UI genutzt, um solche Auswahlen gar nicht erst
 * anzubieten.
 */
export function wouldCreateCycle(tasks: Task[], taskId: Id, dependencyId: Id): boolean {
  if (taskId === dependencyId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<Id>();
  const stack: Id[] = [dependencyId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = byId.get(cur);
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}

/**
 * Wie weit Dauerläufer über das Projektende hinaus fortgeschrieben werden.
 * Zehn Jahre, damit die dauerhafte Wirkung auf Personen und Budgets in den
 * Ganglinien und Jahressummen tatsächlich sichtbar wird.
 */
const OPEN_ENDED_HORIZON_DAYS = 365 * 10;

/**
 * Berechnet Termine, Puffer und kritischen Pfad für alle Aufgaben eines
 * Mandanten. `ventureId` filtert optional auf ein Vorhaben - die Berechnung
 * läuft aber immer über ALLE Aufgaben des Mandanten, damit vorhaben-
 * übergreifende Abhängigkeiten korrekt terminiert werden.
 */
export function computeSchedule(client: Client, scenario: Scenario = 'max'): ScheduleResult {
  const tasks = client.tasks;
  const { order, cycles } = topoSort(tasks);
  const byId = new Map<Id, ScheduledTask>();
  const known = new Set(tasks.map((t) => t.id));
  const cycleSet = new Set(cycles);

  const defaultStart = nextWorkday(today());

  // --- Vorwärtsrechnung -------------------------------------------------
  for (const task of order) {
    const deps = validDeps(task, known).filter((d) => !cycleSet.has(d));
    let start: IsoDate;
    let depth = 0;

    if (task.schedule.anchor === 'dependency' && deps.length > 0) {
      let latestEnd: IsoDate | undefined;
      for (const d of deps) {
        const dep = byId.get(d);
        if (!dep) continue;
        latestEnd = maxDate(latestEnd, dep.end);
        depth = Math.max(depth, dep.depth + 1);
      }
      start = latestEnd ? nextWorkday(addDays(latestEnd, 1)) : defaultStart;
    } else {
      start = nextWorkday(task.schedule.start ?? defaultStart);
      // Auch bei festem Start zählt die Tiefe für die Netzplan-Ebenen.
      for (const d of deps) depth = Math.max(depth, (byId.get(d)?.depth ?? 0) + 1);
    }

    // Explizites Enddatum gewinnt gegenüber der Dauer (nur bei festem Start).
    let duration = durationOf(task, scenario);
    let durationMin = durationOf(task, 'min');
    let durationMax = durationOf(task, 'max');
    if (task.schedule.anchor === 'date' && task.schedule.end && diffDays(start, task.schedule.end) >= 0) {
      duration = workdaysBetween(start, task.schedule.end);
      durationMin = duration;
      durationMax = duration;
    }

    const end = addWorkdays(start, duration);
    byId.set(task.id, {
      task,
      start,
      end,
      duration,
      endOptimistic: addWorkdays(start, durationMin),
      endPessimistic: addWorkdays(start, durationMax),
      lateStart: start,
      lateEnd: end,
      slack: 0,
      critical: false,
      depth,
      cyclic: false,
      openEnded: isOpenEnded(task.schedule),
    });
  }

  // --- Horizont ----------------------------------------------------------
  let horizonStart: IsoDate | undefined;
  let projectEnd: IsoDate | undefined;
  for (const st of byId.values()) {
    horizonStart = horizonStart && diffDays(horizonStart, st.start) > 0 ? horizonStart : st.start;
    if (!st.openEnded) projectEnd = maxDate(projectEnd, st.endPessimistic);
  }
  horizonStart = horizonStart ?? defaultStart;
  projectEnd = projectEnd ?? addDays(horizonStart, 30);

  // Dauerläufer laufen bis zum Ende des Betrachtungszeitraums weiter.
  const hasOpenEnded = [...byId.values()].some((s) => s.openEnded);
  let horizonEnd = projectEnd;
  if (hasOpenEnded) {
    horizonEnd = maxDate(horizonEnd, addDays(projectEnd, OPEN_ENDED_HORIZON_DAYS))!;
  }
  for (const st of byId.values()) {
    if (st.openEnded) {
      st.end = horizonEnd;
      st.endOptimistic = horizonEnd;
      st.endPessimistic = horizonEnd;
      st.lateEnd = horizonEnd;
    }
  }

  // --- Rückwärtsrechnung ----------------------------------------------
  const dependentsOf = new Map<Id, Id[]>();
  for (const t of order) {
    for (const d of validDeps(t, known)) {
      if (cycleSet.has(d)) continue;
      const list = dependentsOf.get(d) ?? [];
      list.push(t.id);
      dependentsOf.set(d, list);
    }
  }

  for (let i = order.length - 1; i >= 0; i--) {
    const st = byId.get(order[i].id);
    if (!st) continue;
    const successors = (dependentsOf.get(st.task.id) ?? [])
      .map((id) => byId.get(id))
      .filter((s): s is ScheduledTask => Boolean(s) && s!.task.schedule.anchor === 'dependency');

    if (st.openEnded) {
      st.lateEnd = horizonEnd;
      st.lateStart = st.start;
      st.slack = 0;
      continue;
    }

    if (successors.length === 0) {
      // Endaufgabe: spätestes Ende ist das Projektende.
      st.lateEnd = projectEnd;
    } else {
      let earliest: IsoDate | undefined;
      for (const s of successors) {
        // Ein Kalendertag vor dem spätesten Start des Nachfolgers, auf den
        // vorherigen Arbeitstag gezogen - sonst entsteht über Wochenenden ein
        // Scheinpuffer von einem Tag.
        const candidate = prevWorkday(addDays(s.lateStart, -1));
        earliest = earliest && diffDays(earliest, candidate) > 0 ? candidate : (earliest ?? candidate);
      }
      st.lateEnd = earliest ?? projectEnd;
    }
    // lateStart aus lateEnd und Dauer zurückrechnen.
    st.lateStart = shiftWorkdaysBack(st.lateEnd, st.duration);
    st.slack = Math.max(0, workdaysBetween(st.start, st.lateStart) - 1);
    st.critical = st.slack === 0;
  }

  // --- Zyklische Aufgaben als Platzhalter aufnehmen ----------------------
  for (const id of cycles) {
    const task = tasks.find((t) => t.id === id);
    if (!task) continue;
    const start = nextWorkday(task.schedule.start ?? horizonStart);
    const duration = durationOf(task, scenario);
    const end = addWorkdays(start, duration);
    byId.set(id, {
      task,
      start,
      end,
      duration,
      endOptimistic: end,
      endPessimistic: end,
      lateStart: start,
      lateEnd: end,
      slack: 0,
      critical: false,
      depth: 0,
      cyclic: true,
      openEnded: isOpenEnded(task.schedule),
    });
  }

  const ordered = order.map((t) => byId.get(t.id)!).filter(Boolean);
  return { byId, ordered, cycles, horizonStart, horizonEnd, projectEnd };
}

/** Startdatum, sodass [start, end] genau `duration` Arbeitstage umfasst. */
function shiftWorkdaysBack(end: IsoDate, duration: number): IsoDate {
  let cur = end;
  let remaining = Math.max(1, duration) - 1;
  while (remaining > 0) {
    cur = addDays(cur, -1);
    const day = new Date(`${cur}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return cur;
}

/**
 * Ermittelt alle Aufgaben, die von `rootId` aus in maximal `depth` Schritten
 * über Abhängigkeiten (in beide Richtungen) erreichbar sind.
 * `depth === Infinity` liefert den gesamten zusammenhängenden Graphen.
 */
export function collectNeighbourhood(tasks: Task[], rootId: Id | null, depth: number): Set<Id> {
  const result = new Set<Id>();
  if (!rootId) {
    for (const t of tasks) result.add(t.id);
    return result;
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const successors = new Map<Id, Id[]>();
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      const list = successors.get(d) ?? [];
      list.push(t.id);
      successors.set(d, list);
    }
  }

  let frontier: Id[] = [rootId];
  result.add(rootId);
  for (let step = 0; step < depth && frontier.length > 0; step++) {
    const next: Id[] = [];
    for (const id of frontier) {
      const t = byId.get(id);
      if (!t) continue;
      for (const n of [...t.dependsOn, ...(successors.get(id) ?? [])]) {
        if (!result.has(n) && byId.has(n)) {
          result.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return result;
}
