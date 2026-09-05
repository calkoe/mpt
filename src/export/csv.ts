/**
 * CSV-Export des gesamten Datenbestands.
 *
 * Ziel ist eine Datei, die man in Excel oder Calc sofort lesen kann - kein
 * Austauschformat für Maschinen (dafür gibt es den JSON- und den KI-Export).
 * Deshalb:
 *  - Semikolon als Trenner und BOM voran, damit Excel in deutscher Einstellung
 *    Spalten und Umlaute ohne Nachfragen richtig erkennt,
 *  - Ids nur dort, wo sie zum Nachvollziehen nötig sind; sonst Klartextnamen,
 *  - berechnete Termine mit ausgegeben, weil genau die im Werkzeug sichtbar
 *    sind und ohne sie eine Zeile nicht nachvollziehbar wäre,
 *  - mehrere Abschnitte in einer Datei, durch Leerzeile und Überschrift
 *    getrennt.
 */
import type { Client, Database, Task } from '../model/types';
import { COST_INTERVAL_LABEL, DURATION_UNIT_LABEL, isOpenEnded, TASK_STATUS_LABEL } from '../model/types';
import { formatDateDe } from '../engine/dates';
import { computeSchedule, type Scenario } from '../engine/schedule';
import { isVentureDone } from '../engine/validate';

const SEPARATOR = ';';
const BOM = '﻿';

/** Ein Feld für CSV maskieren. */
function cell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'number') {
    // Deutsches Dezimalkomma - sonst zerlegt Excel Zahlen in zwei Spalten.
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
  }
  const text = value.replace(/\r?\n/g, ' ');
  return /[";]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: (string | number | boolean | undefined | null)[]): string {
  return values.map(cell).join(SEPARATOR);
}

interface Section {
  title: string;
  header: string[];
  rows: (string | number | boolean | undefined | null)[][];
}

function renderSections(sections: Section[]): string {
  return sections
    .filter((s) => s.rows.length > 0)
    .map((s) => [`# ${s.title}`, row(s.header), ...s.rows.map(row)].join('\r\n'))
    .join('\r\n\r\n');
}

/** Gesamten Datenbestand als CSV. `scenario` bestimmt die berechneten Termine. */
export function databaseToCsv(db: Database, scenario: Scenario = 'max'): string {
  const parts = db.clients.map((client) => clientToCsv(client, scenario));
  return BOM + parts.join('\r\n\r\n');
}

function clientToCsv(client: Client, scenario: Scenario): string {
  const schedule = computeSchedule(client, scenario);
  const ventureName = (id: string) => client.ventures.find((v) => v.id === id)?.name ?? '';
  const taskTitle = (id: string) => client.tasks.find((t) => t.id === id)?.title ?? '(gelöscht)';
  const names = (ids: string[], resolve: (id: string) => string) => ids.map(resolve).join(', ');

  const tasks: Section = {
    title: `Aufgaben - Mandant "${client.name}"`,
    header: [
      'Vorhaben',
      'Aufgabe',
      'Status',
      'Meilenstein',
      'Start',
      'Ende',
      'Dauer (AT)',
      'Dauer min',
      'Dauer max',
      'Dauereinheit',
      'Puffer (AT)',
      'Kritischer Pfad',
      'Startanker',
      'Abhängig von',
      'Parallel mit',
      'Bedingungen',
      'Tags',
      'Personen',
      'Kosten (EUR)',
      'Beschreibung',
    ],
    rows: client.tasks.map((task) => {
      const st = schedule.byId.get(task.id);
      const open = isOpenEnded(task.schedule);
      return [
        ventureName(task.ventureId),
        task.title,
        TASK_STATUS_LABEL[task.status],
        task.milestone,
        st ? formatDateDe(st.start) : '',
        open ? 'kein Enddatum' : st ? formatDateDe(st.end) : '',
        open ? '' : st?.duration,
        open ? '' : task.schedule.durationMin,
        open ? '' : task.schedule.durationMax,
        open ? '' : DURATION_UNIT_LABEL[task.schedule.durationUnit],
        open ? '' : st?.slack,
        st?.critical && !open,
        task.schedule.anchor === 'date' ? 'festes Datum' : 'Vorgänger',
        names(task.dependsOn, taskTitle),
        names(task.parallelWith, taskTitle),
        [
          ...task.ventureConditions.map((id) => `Vorhaben: ${ventureName(id)}`),
          ...task.conditionIds.map((id) => client.conditions.find((c) => c.id === id)?.name ?? ''),
        ].join(', '),
        names(task.tagIds, (id) => client.tags.find((t) => t.id === id)?.name ?? ''),
        task.assignments
          .map((a) => `${client.people.find((p) => p.id === a.personId)?.name ?? '?'}: ${a.value} ${a.mode}`)
          .join(', '),
        totalCost(task),
        task.description,
      ];
    }),
  };

  const costs: Section = {
    title: `Kostenpositionen - Mandant "${client.name}"`,
    header: ['Aufgabe', 'Budget', 'Bezeichnung', 'Betrag (EUR)', 'Wiederkehrend', 'Intervall'],
    rows: client.tasks.flatMap((task) =>
      task.costs.map((cost) => [
        task.title,
        client.budgets.find((b) => b.id === cost.budgetId)?.name ?? '',
        cost.label,
        cost.amount,
        cost.recurring,
        cost.recurring ? `alle ${cost.every} ${COST_INTERVAL_LABEL[cost.interval]}` : 'einmalig',
      ]),
    ),
  };

  const people: Section = {
    title: `Personen - Mandant "${client.name}"`,
    header: ['Person', 'Rolle', 'FTE (Standard)', 'Abweichende Verfügbarkeit'],
    rows: client.people.map((person) => [
      person.name,
      person.role,
      person.defaultFte,
      person.availability.map((a) => `${a.from ?? '...'} bis ${a.to ?? '...'}: ${a.value} FTE`).join(', '),
    ]),
  };

  const budgets: Section = {
    title: `Budgets - Mandant "${client.name}"`,
    header: ['Budget', 'Gesamtobergrenze (EUR)', 'Obergrenzen je Zeitraum'],
    rows: client.budgets.map((budget) => [
      budget.name,
      budget.totalLimit,
      budget.limits.map((l) => `${l.from ?? '...'} bis ${l.to ?? '...'}: ${l.value} EUR`).join(', '),
    ]),
  };

  const ventures: Section = {
    title: `Vorhaben - Mandant "${client.name}"`,
    header: ['Vorhaben', 'Abgeschlossen', 'Aufgaben'],
    rows: client.ventures.map((venture) => [
      venture.name,
      isVentureDone(client, venture.id),
      client.tasks.filter((t) => t.ventureId === venture.id).length,
    ]),
  };

  const conditions: Section = {
    title: `Bedingungen - Mandant "${client.name}"`,
    header: ['Bedingung', 'Erfüllt', 'Betroffene Aufgaben'],
    rows: client.conditions.map((condition) => [
      condition.name,
      condition.met,
      client.tasks.filter((t) => t.conditionIds.includes(condition.id)).length,
    ]),
  };

  return renderSections([ventures, tasks, costs, people, budgets, conditions]);
}

/** Summe aller Kostenpositionen einer Aufgabe (ohne Wiederholungen). */
function totalCost(task: Task): number {
  return task.costs.reduce((sum, cost) => sum + cost.amount, 0);
}
