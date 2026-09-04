/**
 * Erzeugung neuer Entitäten und des Beispieldatenbestands.
 * Alle Defaults an einer Stelle, damit UI und KI-Import identisch anlegen.
 */
import {
  CURRENT_SCHEMA_VERSION,
  type Budget,
  type ChecklistItem,
  type Client,
  type Condition,
  type CostItem,
  type Database,
  type Id,
  type IsoDate,
  type PeriodValue,
  type Person,
  type PersonAssignment,
  type Tag,
  type Task,
  type Venture,
} from './types';
import { addDays, nextWorkday, today } from '../engine/dates';
// Version wird an genau einer Stelle gepflegt: `version` in package.json.
import { APP_VERSION } from '../version';

let counter = 0;
export function newId(prefix = 'id'): Id {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

/**
 * Tag-Farbpalette. Farben werden bei der erstmaligen Verwendung eines Tags fest
 * vergeben und bleiben danach stabil - sie sind in beiden Themes lesbar.
 */
export const TAG_PALETTE = [
  '#4f7cff',
  '#e2665a',
  '#2fae86',
  '#d99b2e',
  '#8b5cf6',
  '#0ea5b7',
  '#dd6bab',
  '#7c8b3f',
  '#c2703c',
  '#5a6f9e',
];

export function nextTagColor(existing: Tag[]): string {
  const used = new Set(existing.map((t) => t.color));
  return TAG_PALETTE.find((c) => !used.has(c)) ?? TAG_PALETTE[existing.length % TAG_PALETTE.length];
}

export function createVenture(name = 'Neues Vorhaben'): Venture {
  return { id: newId('ven'), name };
}

export function createTask(ventureId: Id, title = 'Neue Aufgabe', start?: IsoDate): Task {
  return {
    id: newId('tsk'),
    ventureId,
    title,
    description: '',
    checklist: [],
    status: 'open',
    milestone: false,
    schedule: {
      anchor: 'date',
      start: nextWorkday(start ?? today()),
      durationMin: 5,
      durationMax: 5,
    },
    dependsOn: [],
    parallelWith: [],
    ventureConditions: [],
    conditionIds: [],
    tagIds: [],
    assignments: [],
    costs: [],
  };
}

/** Folgeaufgabe: hängt terminlich am Vorgänger und erbt Vorhaben und Tags. */
export function createFollowUp(source: Task, title = 'Folgeaufgabe'): Task {
  const task = createTask(source.ventureId, title);
  task.schedule = { ...task.schedule, anchor: 'dependency', start: undefined };
  task.dependsOn = [source.id];
  task.tagIds = [...source.tagIds];
  return task;
}

/**
 * Vorgängeraufgabe. Erbt Vorhaben und Tags und behält einen festen Start -
 * die Verknüpfung setzt der Aufrufer, weil dabei auch der Nachfolger auf den
 * Abhängigkeitsanker umgestellt werden muss.
 */
export function createPredecessor(source: Task, title = 'Vorgänger'): Task {
  const task = createTask(source.ventureId, title);
  task.tagIds = [...source.tagIds];
  return task;
}

/**
 * Kopie einer Aufgabe.
 *
 * Übernommen wird alles Inhaltliche - Beschreibung, Checkliste, Termine,
 * Ressourcen, Kosten, Tags und Bedingungen. Auch die Vorgänger bleiben, damit
 * die Kopie an derselben Stelle im Netz hängt. Nicht übernommen werden die
 * Nachfolger (die zeigen weiter auf das Original) und die Handverschiebung im
 * Netzplan; die Kopie startet leicht versetzt daneben.
 *
 * Alle enthaltenen Ids werden neu vergeben, sonst teilten sich Original und
 * Kopie ihre Zuordnungen.
 */
export function duplicateTask(source: Task, title = `${source.title} (Kopie)`): Task {
  return {
    ...structuredClone(source),
    id: newId('tsk'),
    title,
    layout: { dx: 24, dy: 24 },
    checklist: source.checklist.map((c) => ({ ...c, id: newId('chk') })),
    assignments: source.assignments.map((a) => ({
      ...a,
      id: newId('asg'),
      periods: a.periods.map((p) => ({ ...p, id: newId('prd') })),
    })),
    costs: source.costs.map((c) => ({ ...c, id: newId('cst') })),
  };
}

export function createPerson(name = 'Neue Person'): Person {
  return { id: newId('per'), name, role: '', availability: [], defaultFte: 1, tagIds: [] };
}

export function createBudget(name = 'Neues Budget'): Budget {
  return { id: newId('bud'), name, kind: 'neutral', limits: [], totalLimit: 0, tagIds: [] };
}

export function createTag(name: string, existing: Tag[]): Tag {
  return { id: newId('tag'), name, color: nextTagColor(existing) };
}

export function createCondition(name = 'Neue Bedingung'): Condition {
  return { id: newId('cnd'), name, met: false };
}

export function createAssignment(personId: Id): PersonAssignment {
  return { id: newId('asg'), personId, mode: 'FTE', value: 0.5, periods: [] };
}

export function createCost(budgetId: Id): CostItem {
  return {
    id: newId('cst'),
    budgetId,
    label: 'Kostenposition',
    amount: 1000,
    actualAmount: 0,
    note: '',
    recurring: false,
    interval: 'month',
    every: 1,
  };
}

export function createChecklistItem(text = ''): ChecklistItem {
  return { id: newId('chk'), text, done: false };
}

export function createPeriodValue(value: number, from?: IsoDate, to?: IsoDate): PeriodValue {
  return { id: newId('prd'), from, to, value };
}

export function createClient(name = 'Neuer Mandant'): Client {
  return { id: newId('cli'), name, ventures: [], tasks: [], people: [], budgets: [], tags: [], conditions: [] };
}

export function createDatabase(clients?: Client[]): Database {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { createdAt: now, updatedAt: now, appVersion: APP_VERSION },
    clients: clients ?? [createDemoClient()],
    checkpoints: [],
    lock: null,
  };
}

/**
 * Beispielmandant. Zeigt alle Konzepte einmal: feste und abhängige Termine,
 * Dauerläufer, Parallelität, ungetrackte Bedingung, PT- und FTE-Bindung,
 * einmalige und wiederkehrende Kosten.
 */
export function createDemoClient(): Client {
  const client = createClient('Beispiel GmbH');
  const start = nextWorkday(today());

  const vPlanung = createVenture('Plattform-Aufbau');
  const vBetrieb = createVenture('Betrieb');
  client.ventures = [vPlanung, vBetrieb];

  const anna = createPerson('Anna Berger');
  anna.role = 'Projektleitung';
  anna.defaultFte = 1;
  const bo = createPerson('Bo Lindqvist');
  bo.role = 'Entwicklung';
  bo.defaultFte = 0.8;
  bo.availability = [createPeriodValue(0.8, undefined, `${new Date().getFullYear()}-12-31`), createPeriodValue(0.5, `${new Date().getFullYear() + 1}-01-01`)];
  client.people = [anna, bo];

  const invest = createBudget('Investitionsbudget');
  invest.kind = 'investment';
  invest.limits = [createPeriodValue(250_000, `${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`)];
  invest.totalLimit = 400_000;
  const betriebBudget = createBudget('Betriebskosten');
  betriebBudget.kind = 'order';
  client.budgets = [invest, betriebBudget];

  const tagInfra = createTag('Infrastruktur', client.tags);
  client.tags.push(tagInfra);
  const tagSoftware = createTag('Software', client.tags);
  client.tags.push(tagSoftware);
  const tagExtern = createTag('Extern', client.tags);
  client.tags.push(tagExtern);

  const freigabe = createCondition('Freigabe durch Lenkungskreis');
  client.conditions = [freigabe];

  const konzept = createTask(vPlanung.id, 'Grobkonzept erstellen', start);
  konzept.description = 'Zielbild, Architekturskizze und Grobplanung.';
  konzept.schedule.durationMin = 8;
  konzept.schedule.durationMax = 12;
  konzept.status = 'active';
  konzept.tagIds = [tagSoftware.id];
  konzept.assignments = [{ ...createAssignment(anna.id), mode: 'FTE', value: 0.6 }];
  konzept.checklist = [
    { ...createChecklistItem('Anforderungen gesammelt'), done: true },
    createChecklistItem('Architekturskizze abgestimmt'),
  ];

  const beschaffung = createTask(vPlanung.id, 'Hardware beschaffen');
  beschaffung.schedule = { anchor: 'dependency', durationMin: 15, durationMax: 25 };
  beschaffung.dependsOn = [konzept.id];
  beschaffung.tagIds = [tagInfra.id, tagExtern.id];
  beschaffung.conditionIds = [freigabe.id];
  beschaffung.costs = [{ ...createCost(invest.id), label: 'Serverhardware', amount: 120_000 }];

  const aufbau = createTask(vPlanung.id, 'Plattform aufbauen');
  aufbau.schedule = { anchor: 'dependency', durationMin: 20, durationMax: 30 };
  aufbau.dependsOn = [beschaffung.id];
  aufbau.tagIds = [tagInfra.id];
  aufbau.assignments = [
    { ...createAssignment(bo.id), mode: 'FTE', value: 0.8 },
    { ...createAssignment(anna.id), mode: 'PT', value: 10 },
  ];

  const migration = createTask(vPlanung.id, 'Daten migrieren');
  migration.schedule = { anchor: 'dependency', durationMin: 5, durationMax: 10 };
  migration.dependsOn = [aufbau.id];
  migration.tagIds = [tagSoftware.id];
  migration.assignments = [{ ...createAssignment(bo.id), mode: 'PT', value: 12 }];

  const betrieb = createTask(vBetrieb.id, 'Betrieb Infrastruktur');
  betrieb.description = 'Dauerläufer - hat schlicht kein Enddatum.';
  betrieb.schedule = { anchor: 'dependency', durationMin: 0, durationMax: 0 };
  betrieb.dependsOn = [aufbau.id];
  betrieb.tagIds = [tagInfra.id];
  betrieb.ventureConditions = [vPlanung.id];
  betrieb.assignments = [{ ...createAssignment(bo.id), mode: 'FTE', value: 0.2 }];
  betrieb.costs = [
    { ...createCost(betriebBudget.id), label: 'Hosting', amount: 3_500, recurring: true, interval: 'month', every: 1 },
    { ...createCost(betriebBudget.id), label: 'Wartungsvertrag', amount: 18_000, recurring: true, interval: 'year', every: 1 },
  ];

  // Parallelität: während der Migration muss der Betrieb laufen.
  migration.parallelWith = [betrieb.id];

  const schulung = createTask(vPlanung.id, 'Schulung durchführen');
  schulung.schedule = { anchor: 'dependency', durationMin: 3, durationMax: 5 };
  schulung.dependsOn = [migration.id];
  schulung.tagIds = [tagExtern.id];
  schulung.costs = [{ ...createCost(invest.id), label: 'Externer Trainer', amount: 8_000 }];

  const doku = createTask(vPlanung.id, 'Dokumentation');
  doku.schedule = { anchor: 'date', start: addDays(start, 30), durationMin: 4, durationMax: 6 };
  doku.tagIds = [tagSoftware.id];
  doku.assignments = [{ ...createAssignment(anna.id), mode: 'PT', value: 5 }];

  // Meilenstein: kurze Aufgabe, die im Netzplan hervorgehoben wird und im
  // Gantt eine senkrechte Linie erzeugt.
  const abnahme = createTask(vPlanung.id, 'Abnahme und Inbetriebnahme');
  abnahme.schedule = { anchor: 'dependency', durationMin: 1, durationMax: 1 };
  abnahme.dependsOn = [migration.id];
  abnahme.milestone = true;
  abnahme.tagIds = [tagSoftware.id];

  client.tasks = [konzept, beschaffung, aufbau, migration, abnahme, betrieb, schulung, doku];
  return client;
}
