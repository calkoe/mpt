/**
 * Datenmodell des MPT.
 *
 * Alles, was persistiert wird, hängt an `Database`. Ein Datenbestand enthält
 * mehrere Mandanten; ein Mandant ist ein vollständig unabhängiger Datenraum
 * (keine Verknüpfung von Aufgaben oder Ressourcen über Mandantengrenzen).
 *
 * Achtung bei Änderungen: jede Änderung am Schema erfordert eine Erhöhung von
 * CURRENT_SCHEMA_VERSION und einen Migrationsschritt in `model/migrate.ts`.
 */

/** Datum als `YYYY-MM-DD`. Es gibt keine Uhrzeiten - kleinste Einheit ist ein Tag. */
export type IsoDate = string;
/** Zeitstempel als ISO-8601-String inkl. Zeit (nur für Metadaten/Checkpoints). */
export type IsoDateTime = string;

export type Id = string;

export const CURRENT_SCHEMA_VERSION = 7;

// ---------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------

/**
 * `operations` = Betrieb: die Aufgabe ist inhaltlich fertig, bindet aber
 * dauerhaft Ressourcen (Wartung, Hosting, Support). Fachlich zählt sie wie
 * `done` - siehe `isSettled()`.
 */
export type TaskStatus = "open" | "active" | "operations" | "done";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Offen",
  active: "In Arbeit",
  operations: "Betrieb",
  done: "Abgeschlossen",
};

/**
 * Gilt die Aufgabe als erledigt? `done` und `operations` verhalten sich
 * gegenüber Nachfolgern, Vorhabenstatus und Terminwarnungen gleich - der
 * Unterschied liegt allein darin, dass `operations` weiter Ressourcen bindet.
 *
 * Einzige Quelle der Wahrheit; nie direkt auf `=== 'done'` prüfen.
 */
export function isSettled(status: TaskStatus): boolean {
  return status === "done" || status === "operations";
}

/**
 * Terminierung einer Aufgabe.
 *
 * `anchor` legt fest, woraus sich der Start ergibt:
 *  - 'date'       : fester Starttermin (`start`)
 *  - 'dependency' : Start = spätestes Ende aller Vorgänger + 1 Arbeitstag
 *
 * Die Dauer ist eine Spanne (`durationMin` .. `durationMax`), gezählt in der
 * Einheit `durationUnit`. Bei fester Dauer sind beide Werte gleich. Wird
 * stattdessen ein `end` gesetzt, leitet die Engine die Dauer daraus ab (nur bei
 * anchor === 'date' möglich).
 *
 * **Die Einheit entscheidet, wie gerechnet wird** (siehe `addDuration()`):
 * Arbeitstage zählen Mo-Fr, alle anderen Einheiten sind Kalenderzeit. Eine
 * Aufgabe über 5 Jahre, die am 01.01. beginnt, endet damit am 31.12. des
 * fünften Jahres - ohne Abzug von Wochenenden.
 *
 * Dauerläufer haben schlicht kein Enddatum: weder eine Dauer (`durationMax`
 * ist 0) noch ein festes `end`. Es gibt dafür bewusst kein eigenes Kennzeichen -
 * siehe `isOpenEnded()`.
 */
export interface TaskSchedule {
  anchor: "date" | "dependency";
  /** Nur relevant bei anchor === 'date'. */
  start?: IsoDate;
  /** Optionales festes Ende; überschreibt die Dauer, wenn gesetzt. */
  end?: IsoDate;
  /** Optimistische Dauer in `durationUnit`; 0 = kein Enddatum. */
  durationMin: number;
  /** Pessimistische Dauer in `durationUnit` (>= durationMin); 0 = kein Enddatum. */
  durationMax: number;
  /** Einheit der beiden Dauern. */
  durationUnit: DurationUnit;
}

/**
 * Einheit einer Aufgabendauer.
 *
 * `days` sind **Arbeitstage** (Mo-Fr, keine Feiertage). Alle anderen Einheiten
 * sind Kalenderzeit und werden nicht in Arbeitstage umgerechnet - sonst
 * verschöbe sich das Ende einer Mehrjahresaufgabe um Monate.
 */
export type DurationUnit = "days" | "weeks" | "months" | "quarters" | "years";

export const DURATION_UNIT_LABEL: Record<DurationUnit, string> = {
  days: "AT",
  weeks: "Wochen",
  months: "Monate",
  quarters: "Quartale",
  years: "Jahre",
};

/**
 * Dauerläufer: die Aufgabe hat kein Enddatum - keine Dauer und kein festes
 * Ende. Einzige Quelle der Wahrheit für diese Eigenschaft; nirgends wird ein
 * gespeichertes Kennzeichen dafür gehalten.
 */
export function isOpenEnded(schedule: TaskSchedule): boolean {
  return schedule.durationMax <= 0 && !schedule.end;
}

/** Relative Verschiebung eines Netzplan-Knotens gegenüber dem Auto-Layout. */
export interface NodeOffset {
  dx: number;
  dy: number;
}

export type PersonAssignmentMode = "PT" | "FTE";

/**
 * Bindung einer Personalressource an eine Aufgabe.
 *
 * `value` ist der Grundwert und gilt über die ganze Aufgabenlaufzeit. Einzelne
 * Zeiträume in `periods` überschreiben ihn - dieselbe Mechanik wie bei
 * `Person.availability` und `Budget.limits`, ausgewertet über `periodValueAt()`.
 * Zeiträume ausserhalb der Aufgabenlaufzeit werden beim Rechnen zugeschnitten
 * und gemeldet.
 */
export interface PersonAssignment {
  id: Id;
  personId: Id;
  /** 'PT' = Personentage gesamt, 'FTE' = konstanter Anteil pro Woche (0..1). */
  mode: PersonAssignmentMode;
  value: number;
  /** Abweichende Bedarfe je Zeitraum; leer = überall `value`. */
  periods: PeriodValue[];
}

export type CostInterval = "day" | "week" | "month" | "quarter" | "year";

export const COST_INTERVAL_LABEL: Record<CostInterval, string> = {
  day: "Tag(e)",
  week: "Woche(n)",
  month: "Monat(e)",
  quarter: "Quartal(e)",
  year: "Jahr(e)",
};

/**
 * Kostenposition einer Aufgabe.
 * `recurring === false` -> einmalig zum Aufgabenstart.
 * `recurring === true`  -> alle `every` * `interval`, solange die Aufgabe läuft.
 */
export interface CostItem {
  id: Id;
  budgetId: Id;
  label: string;
  /** Geplanter Betrag in Euro (pro Fälligkeit). */
  amount: number;
  /** Tatsächlich abgerufener Betrag in Euro (pro Fälligkeit); 0 = noch nichts. */
  actualAmount: number;
  /** Kurze Notiz zu dieser Zuordnung - Bestellnummer, Stand der Abrechnung … */
  note: string;
  recurring: boolean;
  interval: CostInterval;
  /** Faktor N, z.B. every=3, interval='month' => alle 3 Monate. */
  every: number;
}

export interface ChecklistItem {
  id: Id;
  text: string;
  done: boolean;
  /**
   * Wann abgehakt wurde. Fehlt bei allem, was vor Schema 6 erledigt wurde -
   * dort ist der Zeitpunkt schlicht nicht bekannt und wird auch nicht erfunden.
   */
  doneAt?: IsoDateTime;
}

/**
 * Fortschritt aus der Checkliste, z.B. 7 von 10.
 *
 * Nur für Aufgaben **in Arbeit** und nur, wenn es überhaupt Punkte gibt: an
 * einer offenen Aufgabe wäre "0/10" keine Auskunft, sondern Rauschen, und an
 * einer abgeschlossenen sagt der Status schon alles. Einzige Quelle der
 * Wahrheit für Netzplan und Gantt.
 */
export function checklistProgress(task: Task): { done: number; total: number } | null {
  if (task.status !== "active" || task.checklist.length === 0) return null;
  return { done: task.checklist.filter((c) => c.done).length, total: task.checklist.length };
}

export interface Task {
  id: Id;
  ventureId: Id;
  title: string;
  /** Kurzbeschreibung, immer sichtbar. */
  description: string;
  checklist: ChecklistItem[];
  status: TaskStatus;
  /** Meilenstein: im Netzplan hervorgehoben, im Gantt eine Linie am Ende. */
  milestone: boolean;
  /**
   * Handverschiebung im Netzplan, **relativ** zur automatisch berechneten
   * Position. Dadurch bleibt das Auto-Layout aktiv: ändern sich
   * Abhängigkeiten, wandert der Knoten mit und behält seinen Versatz.
   * Fehlt das Feld, sitzt der Knoten genau auf der berechneten Position.
   */
  layout?: NodeOffset;
  schedule: TaskSchedule;
  /** Ende->Start-Vorgänger. */
  dependsOn: Id[];
  /** Parallelitäts-Anforderung: diese Aufgaben müssen laufen, solange diese läuft. */
  parallelWith: Id[];
  /** Vorhaben, die abgeschlossen sein müssen (reine Warnung, keine Terminwirkung). */
  ventureConditions: Id[];
  /** Ungetrackte Bedingungen (reine Warnung). */
  conditionIds: Id[];
  tagIds: Id[];
  assignments: PersonAssignment[];
  costs: CostItem[];
}

// ---------------------------------------------------------------------------
// Vorhaben, Ressourcen, Stammdaten
// ---------------------------------------------------------------------------

/**
 * Vorhaben. Ob es abgeschlossen ist, wird **nicht gespeichert**, sondern aus
 * den Aufgaben abgeleitet (alle erledigt oder im Betrieb) - siehe
 * `isVentureDone()` in `engine/validate.ts`. Ein gespeicherter Schalter
 * daneben würde unweigerlich auseinanderlaufen.
 *
 * Die Reihenfolge im Array ist die Anzeigereihenfolge und per Ziehen änderbar.
 */
export interface Venture {
  id: Id;
  name: string;
}

/** Zeitraumabhängiger Wert. `from`/`to` leer => unbegrenzt in diese Richtung. */
export interface PeriodValue {
  id: Id;
  from?: IsoDate;
  to?: IsoDate;
  value: number;
}

export interface Person {
  id: Id;
  name: string;
  role: string;
  /** Verfügbare FTE je Zeitraum. Ohne Eintrag gilt `defaultFte`. */
  availability: PeriodValue[];
  defaultFte: number;
  tagIds: Id[];
}

/** Art eines Budgets - trennt die Gesamtsummen in der Übersicht. */
export type BudgetKind = "neutral" | "order" | "investment";

export const BUDGET_KIND_LABEL: Record<BudgetKind, string> = {
  neutral: "Neutral",
  order: "Beauftragung",
  investment: "Investment",
};

export interface Budget {
  id: Id;
  name: string;
  kind: BudgetKind;
  /** Obergrenzen in Euro je Zeitraum (typisch: ein Eintrag pro Kalenderjahr). */
  limits: PeriodValue[];
  /** Obergrenze gesamt über die ganze Laufzeit; 0 = keine. */
  totalLimit: number;
  tagIds: Id[];
}

export interface Tag {
  id: Id;
  name: string;
  /** Feste Farbe, wird bei der erstmaligen Verwendung vergeben. */
  color: string;
}

/** Ungetrackte Bedingung: entweder erfüllt oder nicht. */
export interface Condition {
  id: Id;
  name: string;
  met: boolean;
}

/**
 * Freie Notiz auf der Netzplanfläche.
 *
 * Bewusst ohne Verknüpfung zu einer Aufgabe: sie hält fest, was zwischen den
 * Aufgaben steht - eine offene Frage, eine Annahme, ein Merkposten. Wäre sie an
 * eine Aufgabe gebunden, wäre sie deren Beschreibung, und die gibt es schon.
 *
 * Position in Zeichenkoordinaten des Netzplans (nicht in Bildschirmpixeln), sie
 * überlebt also Zoomen und Verschieben. Eine Notiz ohne Text gibt es nicht -
 * leer geschrieben heißt gelöscht.
 */
export interface Note {
  id: Id;
  text: string;
  x: number;
  y: number;
}

export interface Client {
  id: Id;
  name: string;
  ventures: Venture[];
  tasks: Task[];
  people: Person[];
  budgets: Budget[];
  tags: Tag[];
  conditions: Condition[];
  notes: Note[];
}

// ---------------------------------------------------------------------------
// Versionierung
// ---------------------------------------------------------------------------

export interface Checkpoint {
  id: Id;
  at: IsoDateTime;
  label: string;
  /** Vollständiger Snapshot aller Mandanten zum Zeitpunkt `at`. */
  clients: Client[];
}

// ---------------------------------------------------------------------------
// Sperrvermerk für gemeinsame Ablagen
// ---------------------------------------------------------------------------

/**
 * Sperrvermerk direkt in der Datei, damit eine auf einem Netzlaufwerk oder in
 * SharePoint liegende Datei nicht von zwei Personen gleichzeitig beschrieben
 * wird. Bewusst ohne Sperrdatei daneben: das Verfahren muss auch dann tragen,
 * wenn nur diese eine Datei synchronisiert wird.
 *
 * Der Halter schreibt regelmäßig `heartbeatAt` fort. Bleibt das aus - etwa
 * weil der Browser einfach geschlossen wurde oder abgestürzt ist - läuft die
 * Sperre nach `LOCK_TIMEOUT_MS` von selbst ab und darf übernommen werden.
 * Dadurch kann die Datei nie dauerhaft blockiert bleiben.
 */
export interface FileLock {
  /** Zufällige Id der schreibenden Sitzung (Browser-Tab). */
  sessionId: string;
  /** Frei wählbarer Anzeigename des Halters. */
  holder: string;
  acquiredAt: IsoDateTime;
  /** Letztes Lebenszeichen; älter als LOCK_TIMEOUT_MS = abgelaufen. */
  heartbeatAt: IsoDateTime;
}

/** Nach dieser Zeit ohne Lebenszeichen gilt eine Sperre als verwaist. */
export const LOCK_TIMEOUT_MS = 3 * 60 * 1000;
/** Abstand zwischen zwei Lebenszeichen; deutlich kleiner als das Zeitlimit. */
export const LOCK_HEARTBEAT_MS = 45 * 1000;

export interface Database {
  schemaVersion: number;
  meta: {
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
    appVersion: string;
  };
  clients: Client[];
  /** Ringpuffer, max. MAX_CHECKPOINTS Einträge, neueste zuerst. */
  checkpoints: Checkpoint[];
  /** Aktueller Sperrvermerk; null/fehlend = frei. */
  lock?: FileLock | null;
}

export const MAX_CHECKPOINTS = 50;
/** Mindestabstand zwischen zwei Checkpoints in Millisekunden. */
export const CHECKPOINT_MIN_INTERVAL_MS = 10 * 60 * 1000;
