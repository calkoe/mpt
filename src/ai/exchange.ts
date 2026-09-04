/**
 * KI-Austausch.
 *
 * Export: eine Markdown-Datei, die ein LLM direkt versteht - Schemabeschreibung,
 * Spielregeln und der vollständige Datenbestand als JSON-Block.
 * Import: der zurückgegebene Text wird nach dem JSON-Block durchsucht, migriert
 * und als Diff gegen den aktuellen Stand angezeigt. Übernommen wird erst nach
 * Bestätigung.
 */
import type { Client, Database, Id } from "../model/types";
import { CURRENT_SCHEMA_VERSION } from "../model/types";
import { migrate } from "../model/migrate";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildExportMarkdown(db: Database): string {
  const payload = {
    schemaVersion: db.schemaVersion,
    meta: db.meta,
    clients: db.clients,
  };
  return `# MPT Datenbestand zur Bearbeitung

Du bekommst den vollständigen Datenbestand eines minimalistischen
Projektmanagement-Tools. Ändere ihn gemäß der Anweisung des Nutzers und gib
das Ergebnis zurück.

## Spielregeln

1. Gib **genau einen** JSON-Block (\`\`\`json ... \`\`\`) mit dem **vollständigen**
   Datenbestand zurück - keine Teil-Patches, keine zusätzlichen Erklärungen
   innerhalb des Blocks.
2. \`schemaVersion\` bleibt ${CURRENT_SCHEMA_VERSION}.
3. **Bestehende \`id\`-Werte niemals ändern.** Neue Objekte bekommen neue,
   eindeutige String-Ids (z.B. \`tsk_neu1\`).
4. Verweise (\`dependsOn\`, \`parallelWith\`, \`ventureId\`, \`personId\`, \`budgetId\`,
   \`tagIds\`, \`conditionIds\`, \`ventureConditions\`) müssen auf existierende Ids
   innerhalb **desselben Mandanten** zeigen.
5. Keine Zyklen in \`dependsOn\`.
6. Datumsangaben immer als \`YYYY-MM-DD\`. Es gibt keine Uhrzeiten.
7. Dauern (\`durationMin\`, \`durationMax\`) sind **Arbeitstage** (Mo-Fr), ganze
   Zahlen >= 0, und \`durationMax >= durationMin\`. Eine Dauer von \`0\` bedeutet
   "kein Enddatum" - die Aufgabe ist ein Dauerläufer.

## Datenmodell (Kurzfassung)

- \`clients[]\` - Mandanten, vollständig voneinander getrennte Datenräume.
  - \`ventures[]\` - Vorhaben: \`{ id, name, description, done }\`. Bündeln Aufgaben.
  - \`tasks[]\` - Aufgaben:
    - \`ventureId\` - genau ein Vorhaben.
    - \`title\`, \`description\` (kurz), \`notes\` (Freitext), \`checklist[] {id,text,done}\`.
    - \`status\` - \`open\` | \`active\` | \`blocked\` | \`done\`.
    - \`milestone\` - \`true\` bei Meilensteinen (im Plan hervorgehoben).
    - \`schedule\`:
      - \`anchor: "date"\` -> fester Start in \`start\`.
      - \`anchor: "dependency"\` -> Start = spätestes Ende der \`dependsOn\` + 1 Arbeitstag.
      - \`durationMin\`/\`durationMax\` - Dauerspanne in Arbeitstagen.
      - \`end\` - optionales festes Ende (nur bei \`anchor: "date"\`).
      - Dauerläufer haben schlicht kein Enddatum: \`durationMin\` und
        \`durationMax\` sind \`0\` und \`end\` fehlt (z.B. "Betrieb Infrastruktur X").
    - \`dependsOn[]\` - Vorgänger (Ende->Start).
    - \`parallelWith[]\` - diese Aufgaben müssen laufen, solange die Aufgabe läuft.
    - \`ventureConditions[]\` - Vorhaben, die abgeschlossen sein müssen (nur Warnung).
    - \`conditionIds[]\` - ungetrackte Bedingungen (nur Warnung).
    - \`tagIds[]\`.
    - \`assignments[]\` - \`{ id, personId, mode: "PT"|"FTE", value }\`.
      PT = Personentage gesamt, FTE = Anteil pro Woche (0..1), gleichverteilt über die Laufzeit.
    - \`costs[]\` - \`{ id, budgetId, label, amount, recurring, interval, every }\`.
      \`interval\`: \`day|week|month|quarter|year\`, \`every\` = Faktor N (z.B. every 3, interval month = alle 3 Monate).
  - \`people[]\` - \`{ id, name, role, defaultFte, availability[] }\`; \`availability\` sind
    zeitraumabhängige Werte \`{ id, from?, to?, value }\`.
  - \`budgets[]\` - \`{ id, name, totalLimit, limits[] }\`; \`limits\` analog in Euro.
  - \`tags[]\` - \`{ id, name, color }\`; \`color\` ist ein Hexwert und bleibt stabil.
  - \`conditions[]\` - \`{ id, name, met }\`.

## Aktueller Datenbestand

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ParseResult {
  ok: boolean;
  db?: Database;
  error?: string;
  notes: string[];
}

/** Holt den JSON-Block aus einer LLM-Antwort (mit oder ohne Markdown-Fence). */
export function parseImport(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed)
    return { ok: false, error: "Kein Inhalt eingefügt.", notes: [] };

  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(
    (m) => m[1].trim(),
  );
  const candidates = fenced.length > 0 ? fenced : [];

  // Fallback: größtes {...}-Fragment.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first)
    candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const raw = JSON.parse(candidate);
      const result = migrate(raw);
      if (result.db.clients.length === 0) continue;
      return { ok: true, db: result.db, notes: result.notes };
    } catch {
      continue;
    }
  }
  return {
    ok: false,
    error:
      "Im eingefügten Text wurde kein gültiger JSON-Datenbestand gefunden. Erwartet wird ein ```json-Block mit dem vollständigen Bestand.",
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type DiffKind = "add" | "del" | "mod";

export interface DiffEntry {
  kind: DiffKind;
  scope: string;
  label: string;
  detail?: string;
}

const ENTITY_LABELS: Record<string, string> = {
  ventures: "Vorhaben",
  tasks: "Aufgabe",
  people: "Person",
  budgets: "Budget",
  tags: "Tag",
  conditions: "Bedingung",
};

type EntityKey =
  | "ventures"
  | "tasks"
  | "people"
  | "budgets"
  | "tags"
  | "conditions";
const ENTITY_KEYS: EntityKey[] = [
  "ventures",
  "tasks",
  "people",
  "budgets",
  "tags",
  "conditions",
];

function nameOf(entity: any): string {
  return entity?.title ?? entity?.name ?? entity?.id ?? "?";
}

/** Vergleicht zwei Datenbestände auf Entitätsebene. */
export function computeDiff(current: Database, next: Database): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const currentClients = new Map(current.clients.map((c) => [c.id, c]));
  const nextClients = new Map(next.clients.map((c) => [c.id, c]));

  for (const [id, client] of nextClients) {
    if (!currentClients.has(id)) {
      entries.push({
        kind: "add",
        scope: "Mandant",
        label: client.name,
        detail: summarize(client),
      });
    }
  }
  for (const [id, client] of currentClients) {
    if (!nextClients.has(id)) {
      entries.push({
        kind: "del",
        scope: "Mandant",
        label: client.name,
        detail: summarize(client),
      });
    }
  }

  for (const [id, nextClient] of nextClients) {
    const currentClient = currentClients.get(id);
    if (!currentClient) continue;
    if (currentClient.name !== nextClient.name) {
      entries.push({
        kind: "mod",
        scope: "Mandant",
        label: nextClient.name,
        detail: `Name: "${currentClient.name}" -> "${nextClient.name}"`,
      });
    }
    for (const key of ENTITY_KEYS) {
      entries.push(...diffCollection(currentClient, nextClient, key));
    }
  }

  return entries;
}

function diffCollection(a: Client, b: Client, key: EntityKey): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const scope = ENTITY_LABELS[key];
  const before = new Map<Id, any>(
    (a[key] as { id: Id }[]).map((e) => [e.id, e]),
  );
  const after = new Map<Id, any>(
    (b[key] as { id: Id }[]).map((e) => [e.id, e]),
  );

  for (const [id, entity] of after) {
    if (!before.has(id)) {
      entries.push({ kind: "add", scope, label: nameOf(entity) });
    } else {
      const changes = changedFields(before.get(id), entity);
      if (changes.length > 0) {
        entries.push({
          kind: "mod",
          scope,
          label: nameOf(entity),
          detail: changes.join(", "),
        });
      }
    }
  }
  for (const [id, entity] of before) {
    if (!after.has(id))
      entries.push({ kind: "del", scope, label: nameOf(entity) });
  }
  return entries;
}

function changedFields(a: any, b: any): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const key of keys) {
    if (key === "id") continue;
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key]))
      changed.push(key);
  }
  return changed;
}

function summarize(client: Client): string {
  return `${client.ventures.length} Vorhaben, ${client.tasks.length} Aufgaben, ${client.people.length} Personen, ${client.budgets.length} Budgets`;
}
