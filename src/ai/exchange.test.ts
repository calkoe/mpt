/**
 * Tests des KI-Austauschs: Der Export muss vom Import wieder lesbar sein,
 * und der Diff muss Anlegen/Ändern/Löschen korrekt benennen.
 */
import { describe, expect, it } from 'vitest';
import { buildExportMarkdown, computeDiff, parseImport } from './exchange';
import { createDatabase, createDemoClient } from '../model/factory';

describe('KI-Austausch', () => {
  it('exportiert und importiert verlustfrei (Rundlauf)', () => {
    const db = createDatabase([createDemoClient()]);
    const markdown = buildExportMarkdown(db);
    const result = parseImport(markdown);

    expect(result.ok).toBe(true);
    expect(result.db!.clients[0].tasks).toHaveLength(db.clients[0].tasks.length);
    expect(result.db!.clients[0].tasks[0].title).toBe(db.clients[0].tasks[0].title);
  });

  it('findet den JSON-Block auch mit Begleittext des LLM', () => {
    const db = createDatabase([createDemoClient()]);
    const payload = JSON.stringify({ schemaVersion: db.schemaVersion, clients: db.clients });
    const answer = `Gerne! Ich habe zwei Aufgaben ergänzt.\n\n\`\`\`json\n${payload}\n\`\`\`\n\nViel Erfolg!`;

    const result = parseImport(answer);
    expect(result.ok).toBe(true);
    expect(result.db!.clients[0].tasks.length).toBeGreaterThan(0);
  });

  it('lehnt Text ohne verwertbares JSON ab', () => {
    expect(parseImport('Das kann ich leider nicht.').ok).toBe(false);
    expect(parseImport('').ok).toBe(false);
    expect(parseImport('```json\n{kaputt\n```').ok).toBe(false);
  });

  it('benennt Anlegen, Ändern und Löschen im Diff', () => {
    const before = createDatabase([createDemoClient()]);
    const after = JSON.parse(JSON.stringify(before)) as typeof before;

    after.clients[0].tasks[0].title = 'Neuer Titel';
    after.clients[0].tasks.push({ ...after.clients[0].tasks[1], id: 'neu1', title: 'Frisch' });
    const removed = after.clients[0].people.pop()!;

    const diff = computeDiff(before, after);
    expect(diff).toContainEqual(expect.objectContaining({ kind: 'add', scope: 'Aufgabe', label: 'Frisch' }));
    expect(diff).toContainEqual(expect.objectContaining({ kind: 'mod', scope: 'Aufgabe', label: 'Neuer Titel' }));
    expect(diff).toContainEqual(expect.objectContaining({ kind: 'del', scope: 'Person', label: removed.name }));
  });

  it('meldet keine Änderung bei identischen Beständen', () => {
    const db = createDatabase([createDemoClient()]);
    expect(computeDiff(db, JSON.parse(JSON.stringify(db)))).toHaveLength(0);
  });
});
