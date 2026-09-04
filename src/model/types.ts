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

export const CURRENT_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------

export type TaskStatus = "open" | "active" | "blocked" | "done";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Offen",
  active: "In Arbeit",
  blocked: "Blockiert",
  done: "Abgeschlossen",
};

/**
 * Terminierung einer Aufgabe.
 *
 * `anchor` legt fest, woraus sich der Start ergibt:
 *  - 'date'       : fester Starttermin (`start`)
 *  - 'dependency' : Start = spätestes Ende aller Vorgänger + 1 Arbeitstag
 *
 * Die Dauer ist eine Spanne in Arbeitstagen (`durationMin` .. `durationMax`).
 * Bei fester Dauer sind beide Werte gleich. Wird stattdessen ein `end` gesetzt,
 * leitet die Engine die Dauer daraus ab (nur bei anchor === 'date' möglich).
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
  /** Optimistische Dauer in Arbeitstagen; 0 = kein Enddatum. */
  durationMin: number;
  /** Pessimistische Dauer in Arbeitstagen (>= durationMin); 0 = kein Enddatum. */
  durationMax: number;
}

/**
 * Dauerläufer: die Aufgabe hat kein Enddatum - keine Dauer und kein festes
 * Ende. Einzige Quelle der Wahrheit für diese Eigenschaft; nirgends wird ein
 * gespeichertes Kennzeichen dafür gehalten.
 */
export function isOpenEnded(schedule: TaskSchedule): boolean {
  return schedule.durationMax <= 0 && !schedule.end;
}

export type PersonAssignmentMode = "PT" | "FTE";

/** Bindung einer Personalressource an eine Aufgabe. */
export interface PersonAssignment {
  id: Id;
  personId: Id;
  /** 'PT' = Personentage gesamt, 'FTE' = konstanter Anteil pro Woche (0..1). */
  mode: PersonAssignmentMode;
  value: number;
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
  /** Betrag in Euro (pro Fälligkeit). */
  amount: number;
  recurring: boolean;
  interval: CostInterval;
  /** Faktor N, z.B. every=3, interval='month' => alle 3 Monate. */
  every: number;
}

export interface ChecklistItem {
  id: Id;
  text: string;
  done: boolean;
}

export interface Task {
  id: Id;
  ventureId: Id;
  title: string;
  /** Kurzbeschreibung, immer sichtbar. */
  description: string;
  /** Umfangreiches Freitextfeld, immer sichtbar. */
  notes: string;
  checklist: ChecklistItem[];
  status: TaskStatus;
  /** Meilenstein: im Netzplan hervorgehoben, im Gantt eine Linie am Ende. */
  milestone: boolean;
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

export interface Venture {
  id: Id;
  name: string;
  description: string;
  done: boolean;
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
}

export interface Budget {
  id: Id;
  name: string;
  /** Obergrenzen in Euro je Zeitraum (typisch: ein Eintrag pro Kalenderjahr). */
  limits: PeriodValue[];
  /** Obergrenze gesamt über die ganze Laufzeit; 0 = keine. */
  totalLimit: number;
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

export interface Client {
  id: Id;
  name: string;
  ventures: Venture[];
  tasks: Task[];
  people: Person[];
  budgets: Budget[];
  tags: Tag[];
  conditions: Condition[];
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
