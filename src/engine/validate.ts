/**
 * Warnungen. Grundsatz laut Konzept: nie blockieren, nie mit Fehlerdialogen
 * stören - farblich markieren und im Tooltip erklären, was nicht stimmt.
 */
import {
  isSettled,
  TASK_STATUS_LABEL,
  type Client,
  type CostItem,
  type Id,
  type Task,
} from '../model/types';
import { diffDays, formatDateDe, periodEndOf, periodStartOf, today } from './dates';
import type { ScheduledTask, ScheduleResult } from './schedule';
import { budgetDailyLoad, budgetSeries, EMPTY_FILTER, periodValueAt, personDailyLoad } from './resources';

/**
 * Dringlichkeit einer Meldung. Die Reihenfolge ist bedeutsam - `worstLevel()`
 * verlässt sich darauf.
 *
 *  - `critical` : eine Grenze ist überschritten (überlastet, Budget gerissen).
 *  - `warn`     : es wird eng, aber noch nichts verletzt.
 *  - `info`     : Hinweis, noch nicht fällig.
 */
export type WarningLevel = 'critical' | 'warn' | 'info';

const LEVEL_RANK: Record<WarningLevel, number> = { critical: 2, warn: 1, info: 0 };

/** Schwerste Stufe einer Menge von Meldungen; `null` bei leerer Menge. */
export function worstLevel(warnings: Warning[]): WarningLevel | null {
  let worst: WarningLevel | null = null;
  for (const w of warnings) {
    if (!worst || LEVEL_RANK[w.level] > LEVEL_RANK[worst]) worst = w.level;
  }
  return worst;
}

export interface Warning {
  level: WarningLevel;
  /** Betroffene Aufgabe bzw. Ressource. */
  targetId: Id;
  targetKind: 'task' | 'person' | 'budget';
  text: string;
}

/**
 * Ab diesem Anteil der verfügbaren Kapazität wird gewarnt - also schon vor der
 * Überschreitung, solange noch Zeit zum Gegensteuern bleibt.
 */
export const UTILISATION_WARN_RATIO = 0.9;

/**
 * Auslastungszustand einer Grenze.
 *
 *  - `over`  : überschritten,
 *  - `exact` : genau ausgeschöpft - **kein** Grund zur Warnung. Ein Budget,
 *              das punktgenau aufgeht, ist der Idealfall und wird deshalb
 *              eigens (blau) dargestellt statt gemeldet,
 *  - `warn`  : ab 90 % und darunter noch Luft,
 *  - `ok`    : unauffällig oder gar keine Grenze gepflegt.
 */
export type UtilisationState = 'ok' | 'warn' | 'exact' | 'over';

export function utilisationState(load: number, limit: number): UtilisationState {
  if (limit <= 0) return 'ok';
  // Toleranz relativ zur Grenze: bei Eurobeträgen summieren sich sonst
  // Rundungsfehler zu einer Scheinüberschreitung von Bruchteilen eines Cents.
  const tolerance = Math.max(1e-9, Math.abs(limit) * 1e-9);
  if (Math.abs(load - limit) <= tolerance) return 'exact';
  if (load > limit) return 'over';
  return load / limit >= UTILISATION_WARN_RATIO ? 'warn' : 'ok';
}

/**
 * Ist ein Vorhaben abgeschlossen? Wird **abgeleitet** und nicht gespeichert:
 * alle Aufgaben sind erledigt oder im Betrieb, und es gibt überhaupt welche.
 * Ein gespeicherter Schalter daneben würde vom Aufgabenstand abweichen, sobald
 * jemand eine Aufgabe wieder öffnet.
 */
export function isVentureDone(client: Client, ventureId: Id): boolean {
  const tasks = client.tasks.filter((t) => t.ventureId === ventureId);
  return tasks.length > 0 && tasks.every((t) => isSettled(t.status));
}

/**
 * So viele Kalendertage vor dem Start gilt eine offene Startbedingung als
 * "demnächst fällig" und wird als Hinweis gemeldet.
 */
export const CONDITION_LEAD_DAYS = 21;

/**
 * Ist eine offene Startbedingung schon relevant?
 *  'now'   - Start erreicht: echte Warnung,
 *  'soon'  - Start in den nächsten Wochen: Hinweis,
 *  'later' - liegt weit in der Zukunft: nichts melden.
 */
function conditionDueness(st: ScheduledTask | undefined, now: string): 'now' | 'soon' | 'later' {
  // Ohne Terminierung fehlt der Bezugspunkt - dann lieber melden.
  if (!st) return 'now';
  const daysUntilStart = diffDays(now, st.start);
  if (daysUntilStart <= 0) return 'now';
  return daysUntilStart <= CONDITION_LEAD_DAYS ? 'soon' : 'later';
}

/**
 * Alle Warnungen zu Aufgaben eines Mandanten. `now` ist überschreibbar, damit
 * die terminbezogenen Prüfungen testbar bleiben.
 */
export function taskWarnings(client: Client, schedule: ScheduleResult, now = today()): Map<Id, Warning[]> {
  const result = new Map<Id, Warning[]>();
  const taskById = new Map(client.tasks.map((t) => [t.id, t]));
  const ventureById = new Map(client.ventures.map((v) => [v.id, v]));
  const conditionById = new Map(client.conditions.map((c) => [c.id, c]));

  const add = (id: Id, warning: Warning) => {
    const list = result.get(id) ?? [];
    list.push(warning);
    result.set(id, list);
  };

  for (const task of client.tasks) {
    const st = schedule.byId.get(task.id);

    if (st?.cyclic) {
      add(task.id, {
        level: 'critical',
        targetId: task.id,
        targetKind: 'task',
        text: 'Abhängigkeitszyklus - diese Aufgabe kann nicht terminiert werden.',
      });
    }

    /*
     * Startbedingungen melden sich erst, wenn sie fällig sind. Eine Bedingung,
     * deren Aufgabe erst in Monaten anläuft, ist noch kein Problem - würde man
     * sie sofort melden, stünde der halbe Plan dauerhaft auf Gelb und die
     * echten Probleme gingen darin unter.
     */
    const due = conditionDueness(st, now);
    if (due !== 'later') {
      const level: WarningLevel = due === 'now' ? 'warn' : 'info';
      const when = st ? ` (Start ${formatDateDe(st.start)})` : '';

      for (const cid of task.conditionIds) {
        const cond = conditionById.get(cid);
        if (cond && !cond.met) {
          add(task.id, {
            level,
            targetId: task.id,
            targetKind: 'task',
            text: `Bedingung nicht erfüllt: ${cond.name}${when}`,
          });
        }
      }

      for (const vid of task.ventureConditions) {
        const venture = ventureById.get(vid);
        if (venture && !isVentureDone(client, venture.id)) {
          add(task.id, {
            level,
            targetId: task.id,
            targetKind: 'task',
            text: `Vorhaben "${venture.name}" ist noch nicht abgeschlossen${when}`,
          });
        }
      }
    }

    // Parallelität: läuft A, müssen B und C im selben Zeitraum laufen.
    if (st && !st.cyclic) {
      for (const pid of task.parallelWith) {
        const other = taskById.get(pid);
        const otherSt = schedule.byId.get(pid);
        if (!other || !otherSt) continue;
        const overlaps = diffDays(st.start, otherSt.end) >= 0 && diffDays(otherSt.start, st.end) >= 0;
        if (!overlaps) {
          add(task.id, {
            level: 'warn',
            targetId: task.id,
            targetKind: 'task',
            text: `Parallelität verletzt: "${other.title}" läuft nicht während dieser Aufgabe (${formatDateDe(otherSt.start)} - ${formatDateDe(otherSt.end)}).`,
          });
        }
      }
    }

    // Nachfolger abgeschlossen, Vorgänger nicht
    if (isSettled(task.status)) {
      for (const dep of task.dependsOn) {
        const pred = taskById.get(dep);
        if (pred && !isSettled(pred.status)) {
          add(task.id, {
            level: 'info',
            targetId: task.id,
            targetKind: 'task',
            text: `Abgeschlossen, obwohl Vorgänger "${pred.title}" offen ist.`,
          });
        }
      }
    }

    // Verwaiste Verweise
    for (const dep of task.dependsOn) {
      if (!taskById.has(dep)) {
        add(task.id, {
          level: 'info',
          targetId: task.id,
          targetKind: 'task',
          text: 'Verweist auf eine gelöschte Vorgänger-Aufgabe.',
        });
      }
    }

    if (task.schedule.durationMin > task.schedule.durationMax) {
      add(task.id, {
        level: 'warn',
        targetId: task.id,
        targetKind: 'task',
        text: 'Minimale Dauer ist größer als die maximale Dauer.',
      });
    }

    /*
     * Bedarfszeiträume müssen innerhalb der Aufgabenlaufzeit liegen. Die
     * Berechnung schneidet sie ohnehin zu - ohne Meldung würde der Aufwand
     * aber stillschweigend verschwinden, und genau das fällt beim Planen
     * niemandem auf.
     */
    if (st && !st.cyclic) {
      const personName = new Map(client.people.map((p) => [p.id, p.name]));
      for (const assignment of task.assignments) {
        for (const period of assignment.periods) {
          const startsAfterEnd = period.from && diffDays(st.end, period.from) > 0;
          const endsBeforeStart = period.to && diffDays(period.to, st.start) > 0;
          if (!startsAfterEnd && !endsBeforeStart) continue;
          add(task.id, {
            level: 'warn',
            targetId: task.id,
            targetKind: 'task',
            text:
              `Bedarfszeitraum von "${personName.get(assignment.personId) ?? 'Person'}" ` +
              `(${period.from ? formatDateDe(period.from) : 'offen'} - ${period.to ? formatDateDe(period.to) : 'offen'}) ` +
              `liegt ausserhalb der Aufgabe (${formatDateDe(st.start)} - ${formatDateDe(st.end)}) und wirkt nicht.`,
          });
        }
      }
    }

    /*
     * Wiederkehrende Kosten werden am ersten Tag ihres Rasters abgerufen
     * (Monats-, Quartals-, Jahresbeginn). Passt die Aufgabe nicht auf dieses
     * Raster, sind die Raten quer zur Aufgabe: eine quartalsweise Abrechnung
     * in einer Aufgabe, die Mitte Februar beginnt, bucht ihre erste Rate erst
     * im April - und die Summen des ersten Quartals sehen aus, als koste die
     * Aufgabe nichts. Das ist keine Kleinigkeit, sondern verzerrt die
     * Auswertung, deshalb wird es gemeldet.
     */
    if (st && !st.cyclic) {
      for (const cost of task.costs) {
        if (!cost.recurring || cost.interval === 'day') continue;
        const misfit = rasterMisfit(st, cost);
        if (!misfit) continue;
        add(task.id, {
          level: 'warn',
          targetId: task.id,
          targetKind: 'task',
          text:
            `"${cost.label}" wird ${INTERVAL_ADVERB[cost.interval]} abgerufen, ` +
            `die Aufgabe ${misfit} nicht auf dieser Grenze. Die Raten liegen dadurch quer zu den Auswertungszeiträumen.`,
        });
      }
    }

    // Statuspflege gegen den Terminplan abgleichen.
    for (const warning of statusWarnings(task, st, now)) add(task.id, warning);
  }

  return result;
}

/** Wie oft eine wiederkehrende Kostenposition faellig wird - als Adverb. */
const INTERVAL_ADVERB: Record<CostItem['interval'], string> = {
  day: 'täglich',
  week: 'wöchentlich',
  month: 'monatlich',
  quarter: 'quartalsweise',
  year: 'jährlich',
};

/**
 * Beschreibt, an welchem Ende eine Aufgabe nicht auf dem Abrechnungsraster
 * liegt - oder `null`, wenn beide Enden passen. Dauerläufer haben kein echtes
 * Ende und werden deshalb nur am Start geprüft.
 */
function rasterMisfit(st: ScheduledTask, cost: CostItem): string | null {
  const startFits = diffDays(periodStartOf(st.start, cost.interval), st.start) === 0;
  const endFits = st.openEnded || diffDays(st.end, periodEndOf(st.end, cost.interval)) === 0;
  if (startFits && endFits) return null;
  if (!startFits && !endFits) return 'beginnt und endet';
  return startFits ? 'endet' : 'beginnt';
}

/**
 * Passt der Status zum Terminplan?
 *  - Der Start ist erreicht, die Aufgabe steht aber noch auf "Offen" - dann
 *    läuft sie faktisch nicht an.
 *  - Das Ende ist vorbei und die Aufgabe ist weder abgeschlossen noch im
 *    Betrieb - dann läuft sie über.
 * Dauerläufer haben kein Ende und werden deshalb nur auf den Start geprüft.
 */
function statusWarnings(task: Task, st: ScheduledTask | undefined, now: string): Warning[] {
  // Ohne Terminierung (Zyklus) gibt es keinen Termin, gegen den zu prüfen wäre.
  if (!st || st.cyclic) return [];

  const warnings: Warning[] = [];

  if (task.status === 'open' && diffDays(st.start, now) >= 0) {
    warnings.push({
      level: 'warn',
      targetId: task.id,
      targetKind: 'task',
      text: `Start war am ${formatDateDe(st.start)}, Status ist aber "${TASK_STATUS_LABEL.open}" - erwartet wird "${TASK_STATUS_LABEL.active}".`,
    });
  }

  if (!isSettled(task.status) && !st.openEnded && diffDays(st.end, now) > 0) {
    warnings.push({
      level: 'warn',
      targetId: task.id,
      targetKind: 'task',
      text: `Ende war am ${formatDateDe(st.end)}, Status ist aber "${TASK_STATUS_LABEL[task.status]}" - erwartet wird "${TASK_STATUS_LABEL.done}".`,
    });
  }

  return warnings;
}

/** Grenzwertüberschreitungen bei Personen und Budgets (Tagesbasis). */
export function resourceWarnings(client: Client, schedule: ScheduleResult): Map<Id, Warning[]> {
  const result = new Map<Id, Warning[]>();
  const add = (id: Id, warning: Warning) => {
    const list = result.get(id) ?? [];
    list.push(warning);
    result.set(id, list);
  };

  // Personen: den Tag mit der höchsten Auslastung suchen und ab 90 % melden.
  const people = personDailyLoad(client, schedule, EMPTY_FILTER);
  for (const person of client.people) {
    const daily = people.get(person.id);
    if (!daily) continue;
    let worstDay: string | null = null;
    let worstLoad = 0;
    let worstRatio = 0;
    for (const [day, parts] of daily) {
      const load = parts.reduce((s, p) => s + p.value, 0);
      const limit = periodValueAt(person.availability, day, person.defaultFte);
      // Genau ausgelastet ist kein Problem, sondern das Ziel - siehe
      // `utilisationState`.
      const state = utilisationState(load, limit);
      if ((state === 'warn' || state === 'over') && load / limit > worstRatio) {
        worstRatio = load / limit;
        worstLoad = load;
        worstDay = day;
      }
    }
    if (worstDay) {
      const limit = periodValueAt(person.availability, worstDay, person.defaultFte);
      const over = utilisationState(worstLoad, limit) === 'over';
      add(person.id, {
        // Überschritten ist etwas anderes als knapp - das muss man auf einen
        // Blick unterscheiden können.
        level: over ? 'critical' : 'warn',
        targetId: person.id,
        targetKind: 'person',
        text:
          `${over ? 'Überlastet' : 'Fast ausgelastet'}: am ${formatDateDe(worstDay)} ` +
          `${worstLoad.toFixed(2)} von ${limit.toFixed(2)} FTE gebunden (${formatPercent(worstRatio)}).`,
      });
    }
  }

  const budgets = budgetDailyLoad(client, schedule, EMPTY_FILTER);
  for (const budget of client.budgets) {
    const daily = budgets.get(budget.id);
    if (!daily) continue;
    const series = budgetSeries(budget, daily, {
      from: schedule.horizonStart,
      to: schedule.horizonEnd,
      granularity: 'year',
      personUnit: 'FTE',
    });
    /*
     * Gemeldet wird ausschliesslich das **abgerufene** Geld.
     *
     * Eine Planung über der Obergrenze ist eine Absicht - genau dafür plant
     * man ja: um zu sehen, dass es so nicht aufgeht. Eine Warnung daraus zu
     * machen hiesse, jeden Entwurf sofort rot zu färben. Erst was tatsächlich
     * abfliesst, reisst ein Budget.
     */
    for (const point of series.points) {
      const state = utilisationState(point.actual, point.limit);
      if (state === 'ok' || state === 'exact') continue;
      add(budget.id, {
        level: state === 'over' ? 'critical' : 'warn',
        targetId: budget.id,
        targetKind: 'budget',
        text:
          `${point.bucket.label}: ${formatEuro(point.actual)} von ${formatEuro(point.limit)} ` +
          `${state === 'over' ? 'abgerufen - Obergrenze überschritten' : 'abgerufen'} ` +
          `(${formatPercent(point.actual / point.limit)}).`,
      });
    }

    const ceiling = series.ceiling;
    const spent = series.cumulativeActualTotal;
    const totalState = utilisationState(spent, ceiling);
    if (totalState === 'warn' || totalState === 'over') {
      add(budget.id, {
        level: totalState === 'over' ? 'critical' : 'warn',
        targetId: budget.id,
        targetKind: 'budget',
        text:
          `Gesamt: ${formatEuro(spent)} von ${formatEuro(ceiling)} ` +
          `${totalState === 'over' ? 'abgerufen - Gesamtobergrenze überschritten' : 'abgerufen'} ` +
          `(${formatPercent(spent / ceiling)}).`,
      });
    }
  }

  return result;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

function formatEuro(value: number): string {
  return `${Math.round(value).toLocaleString('de-DE')} EUR`;
}

/** Kurzfassung für Tooltips. */
export function warningText(warnings: Warning[] | undefined): string {
  if (!warnings || warnings.length === 0) return '';
  return warnings.map((w) => `- ${w.text}`).join('\n');
}

/** Aufgaben, die aktuell blockiert sind (für Statusfarben im Netzplan). */
export function isBlockedByConditions(client: Client, task: Task): boolean {
  const conditionById = new Map(client.conditions.map((c) => [c.id, c]));
  const ventureById = new Map(client.ventures.map((v) => [v.id, v]));
  return (
    task.conditionIds.some((id) => conditionById.get(id)?.met === false) ||
    task.ventureConditions.some((id) => {
      const venture = ventureById.get(id);
      return venture ? !isVentureDone(client, venture.id) : false;
    })
  );
}
