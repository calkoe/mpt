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
import {
  DURATION_UNIT_LABEL,
  isOpenEnded,
  isSettled,
  type Client,
  type DurationUnit,
  type Id,
  type IsoDate,
  type Task,
} from '../model/types';
import {
  addDays,
  addDuration,
  countWorkdays,
  diffDays,
  isPlausibleIso,
  maxDate,
  minDate,
  nextWorkday,
  prevWorkday,
  subDuration,
  today,
  workdaysBetween,
} from './dates';

export type Scenario = 'min' | 'max';

export interface ScheduledTask {
  task: Task;
  /** Früheste Lage. */
  start: IsoDate;
  end: IsoDate;
  /** Dauer im gewählten Szenario, gezählt in `unit`. */
  duration: number;
  /** Einheit der Dauer - Arbeitstage oder Kalenderzeit. */
  unit: DurationUnit;
  /** Tatsächliche Arbeitstage zwischen Start und Ende - für Anzeige und Puffer. */
  workdays: number;
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

/**
 * Wie weit Dauerläufer über das Projektende hinaus **dargestellt** werden.
 * Gerechnet wird weiter bis `horizonEnd` (zehn Jahre), gezeigt wird nur dieses
 * Stück - danach steht das Unendlichzeichen. Beide Diagramme skalieren auf
 * diesen Wert, sonst quetscht ein einzelner Dauerläufer das ganze Projekt in
 * den linken Rand.
 */
export const DISPLAY_TAIL_DAYS = 40;

/**
 * Wo der heutige Tag im Bild sitzt: im linken Viertel. Ein Viertel Rückblick,
 * drei Viertel Ausblick - man plant nach vorn, aber was gerade eben war,
 * gehört zur Einordnung dazu. Aus diesem Verhältnis ergibt sich der Vorlauf:
 * ein Drittel der Strecke von heute bis zum Ende der Anzeige.
 */
export const DISPLAY_PAST_SHARE = 1 / 3;

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
  /**
   * Ende des sinnvoll darstellbaren Zeitraums: Projektende plus ein kurzes
   * Stück für die Dauerläufer. Für Achsen und Zoomstufen ist das der
   * maßgebliche Wert, nicht `horizonEnd`.
   */
  displayEnd: IsoDate;
  /**
   * Beginn der Zeitachsen: etwas vor heute bzw. vor dem frühesten Termin.
   * Zusammen mit `displayEnd` beschreibt das genau den Ausschnitt, auf den
   * sich die Diagramme beim Öffnen einstellen.
   */
  displayStart: IsoDate;
}

/**
 * Dauer einer Aufgabe im Szenario, gezählt in `task.schedule.durationUnit`.
 * Dauerläufer haben keine Dauer; für sie liefert die Funktion 1, damit der
 * Balken einen Anfang hat - das Ende setzt `computeSchedule` später auf den
 * Horizont.
 */
export function durationOf(task: Task, scenario: Scenario): number {
  const { durationMin, durationMax } = task.schedule;
  const min = Math.max(1, Math.round(durationMin || 1));
  const max = Math.max(min, Math.round(durationMax || min));
  return scenario === 'min' ? min : max;
}

/**
 * Dauer einer terminierten Aufgabe zum Anzeigen. Arbeitstage werden als solche
 * benannt, Kalenderdauern in ihrer eigenen Einheit - "3 Monate" ist die
 * Angabe, die jemand gemacht hat; "63 AT" wäre eine Umrechnung, die er nie
 * gemeint hat.
 */
export function formatDuration(st: ScheduledTask): string {
  if (st.unit === 'days') return `${st.duration} AT`;
  return `${st.duration} ${DURATION_UNIT_LABEL[st.unit]} · ${st.workdays} AT`;
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
      // Unfertige Eingaben (Jahr "2" beim Tippen von 2027) dürfen die
      // Berechnung nicht über Jahrtausende laufen lassen - siehe isPlausibleIso.
      const fixed = isPlausibleIso(task.schedule.start) ? task.schedule.start : undefined;
      start = nextWorkday(fixed ?? defaultStart);
      // Auch bei festem Start zählt die Tiefe für die Netzplan-Ebenen.
      for (const d of deps) depth = Math.max(depth, (byId.get(d)?.depth ?? 0) + 1);
    }

    // Das Ende ergibt sich immer aus Beginn und Dauer - siehe TaskSchedule.
    const unit = task.schedule.durationUnit;
    const duration = durationOf(task, scenario);
    const end = addDuration(start, duration, unit);
    const endOptimistic = addDuration(start, durationOf(task, 'min'), unit);
    const endPessimistic = addDuration(start, durationOf(task, 'max'), unit);

    byId.set(task.id, {
      task,
      start,
      end,
      duration,
      unit,
      workdays: workdaysBetween(start, end),
      endOptimistic,
      endPessimistic,
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
  /*
   * Zwei Enden, die man nicht verwechseln darf:
   *
   *  - `projectEnd` ist die **äußere Kante des Plans**: das späteste
   *    pessimistische Ende. Danach richten sich Achsen und das Ausbleichen der
   *    Dauerläufer - dort ist der Plan in jedem Fall vorbei.
   *  - `latestEnd` ist das späteste Ende **im gerechneten Szenario**. Nur
   *    daran darf die Rückwärtsrechnung messen.
   *
   * Beides gleichzusetzen hat den optimistischen Fall unbrauchbar gemacht:
   * dort endet jede Kette früher als ihr pessimistisches Ende, also bekam
   * *jede* Aufgabe denselben Puffer (in den Beispieldaten 66 AT) und der
   * kritische Pfad verschwand ganz. Ausgewiesen wurde damit nicht der Puffer
   * im Plan, sondern die Dauerunschärfe der längsten Kette.
   */
  let horizonStart: IsoDate | undefined;
  let projectEnd: IsoDate | undefined;
  let latestEnd: IsoDate | undefined;
  for (const st of byId.values()) {
    horizonStart = horizonStart && diffDays(horizonStart, st.start) > 0 ? horizonStart : st.start;
    if (st.openEnded) continue;
    projectEnd = maxDate(projectEnd, st.endPessimistic);
    latestEnd = maxDate(latestEnd, st.end);
  }
  horizonStart = horizonStart ?? defaultStart;
  projectEnd = projectEnd ?? addDays(horizonStart, 30);
  const scenarioEnd = latestEnd ?? projectEnd;

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
      // Endaufgabe: spätestes Ende ist das Projektende dieses Szenarios.
      st.lateEnd = scenarioEnd;
    } else {
      /*
       * Die späteste Lage wird vom **frühesten** Nachfolger bestimmt: sobald
       * einer von ihnen anfangen muss, ist Schluss. Vorher stand hier ein
       * Vergleich, der stattdessen den spätesten Nachfolger nahm - dadurch
       * bekam jede Aufgabe Puffer und der kritische Pfad verschwand.
       */
      let earliest: IsoDate | undefined;
      for (const s of successors) {
        // Ein Kalendertag vor dem spätesten Start des Nachfolgers, auf den
        // vorherigen Arbeitstag gezogen - sonst entsteht über Wochenenden ein
        // Scheinpuffer von einem Tag.
        const candidate = prevWorkday(addDays(s.lateStart, -1));
        earliest = earliest === undefined || diffDays(candidate, earliest) > 0 ? candidate : earliest;
      }
      st.lateEnd = earliest ?? scenarioEnd;
    }
    // lateStart aus lateEnd und Dauer zurückrechnen - in derselben Einheit,
    // in der auch vorwärts gerechnet wurde.
    st.lateStart = subDuration(st.lateEnd, st.duration, st.unit);
    st.slack = Math.max(0, workdaysBetween(st.start, st.lateStart) - 1);
    st.critical = st.slack === 0;
  }

  // --- Zyklische Aufgaben als Platzhalter aufnehmen ----------------------
  for (const id of cycles) {
    const task = tasks.find((t) => t.id === id);
    if (!task) continue;
    const fixed = isPlausibleIso(task.schedule.start) ? task.schedule.start : undefined;
    const start = nextWorkday(fixed ?? horizonStart);
    const duration = durationOf(task, scenario);
    const end = addDuration(start, duration, task.schedule.durationUnit);
    byId.set(id, {
      task,
      start,
      end,
      duration,
      unit: task.schedule.durationUnit,
      workdays: workdaysBetween(start, end),
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

  /*
   * Auch gepflegte Grenzwerte spannen die Zeitachse auf.
   *
   * Wer für 2028 ein Budget hinterlegt, dort aber noch keine Aufgabe geplant
   * hat, sah bisher gar nichts: die Achsen richteten sich allein nach den
   * Aufgaben und endeten lange davor. Verfügbarkeiten und Obergrenzen sind
   * jedoch genauso Planungsdaten und gehören ins Bild.
   */
  const defined = definedPeriodRange(client);
  let displayEnd = hasOpenEnded ? addDays(projectEnd, DISPLAY_TAIL_DAYS) : projectEnd;
  displayEnd = maxDate(displayEnd, defined.to)!;

  /*
   * Vorlauf so, dass heute im linken Viertel liegt. Beginnt eine Aufgabe noch
   * früher, gewinnen die Daten - lieber rutscht der heutige Tag nach rechts,
   * als dass etwas aus dem Bild fällt.
   *
   * Gepflegte Zeiträume ziehen den Anfang bewusst **nicht** zurück: eine
   * Jahresobergrenze beginnt immer am 1. Januar und schöbe damit jeden Plan
   * auf den Jahresanfang, egal wie weit das Jahr fortgeschritten ist. Nach
   * hinten dehnen sie den Zeitraum sehr wohl (siehe `displayEnd`) - dort war
   * das Problem: ein Budget für 2028 ohne Aufgaben blieb sonst unsichtbar.
   */
  const now = today();
  const ahead = Math.max(1, diffDays(now, displayEnd));
  const leadIn = addDays(now, -Math.round(ahead * DISPLAY_PAST_SHARE));
  const displayStart = diffDays(leadIn, horizonStart) > 0 ? leadIn : horizonStart;
  // Gerechnet wird mindestens bis zum Ende der Anzeige, sonst fehlen die
  // Buckets, in denen nur ein Grenzwert steht.
  horizonEnd = maxDate(horizonEnd, displayEnd)!;

  return { byId, ordered, cycles, horizonStart, horizonEnd, projectEnd, displayEnd, displayStart };
}

/**
 * Äusserste Grenzen aller gepflegten Zeiträume (Budget-Obergrenzen und
 * Verfügbarkeiten). Offene Enden zählen nicht mit - sie gelten ohnehin überall.
 */
function definedPeriodRange(client: Client): { from?: IsoDate; to?: IsoDate } {
  let from: IsoDate | undefined;
  let to: IsoDate | undefined;
  const lists = [...client.budgets.map((b) => b.limits), ...client.people.map((p) => p.availability)];
  for (const list of lists) {
    for (const entry of list) {
      if (entry.value <= 0) continue;
      if (isPlausibleIso(entry.from)) from = minDate(from, entry.from);
      if (isPlausibleIso(entry.to)) to = maxDate(to, entry.to);
    }
  }
  return { from, to };
}

/**
 * Ermittelt alle Aufgaben, die von `rootId` aus in maximal `depth` Schritten
 * über Abhängigkeiten (in beide Richtungen) erreichbar sind.
 * `depth === Infinity` liefert den gesamten zusammenhängenden Graphen.
 */
/**
 * Wie weit ist eine Aufgabe? Als Anteil 0..1, bezogen auf **heute**.
 *
 * Gemessen an ihrer eigenen Laufzeit in Arbeitstagen: noch nicht begonnen ist
 * 0, der geplante Endtermin vorbei ist 1. Erledigt und Betrieb sind fachlich
 * abgeschlossen (siehe `isSettled`) und damit voll - bei einem Dauerläufer
 * wäre ein Zeitanteil gegen den Zehnjahreshorizont ohnehin ohne Aussage.
 *
 * Steht hier und nicht in einer Ansicht: der Fortschritt erscheint am
 * Netzplan-Knoten **und** in "Wer arbeitet woran?". Zwei Rechnungen für
 * dieselbe Zahl laufen früher oder später auseinander.
 */
export function taskProgress(task: Task | undefined, st: ScheduledTask | undefined): number {
  if (!task || !st) return 0;
  if (isSettled(task.status)) return 1;
  const heute = today();
  if (diffDays(heute, st.start) > 0) return 0;
  if (diffDays(st.end, heute) > 0) return 1;
  const gesamt = countWorkdays(st.start, st.end);
  if (gesamt <= 0) return 0;
  return Math.min(1, Math.max(0, countWorkdays(st.start, heute) / gesamt));
}

/** Der geplante Endtermin liegt hinter uns und die Aufgabe ist noch offen. */
export function isOverdue(task: Task | undefined, st: ScheduledTask | undefined): boolean {
  if (!task || !st || isSettled(task.status)) return false;
  return diffDays(st.end, today()) > 0;
}

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
