# Architektur des MPT

Einstiegspunkt für alle, die am Code arbeiten – Menschen wie Agents. Wer etwas ändert, liest zuerst
diese Datei und danach die Kopfkommentare der betroffenen Module.

**Verbindliche Regeln stehen in [agend.md](agend.md)** – dort sind die fachlichen Anforderungen und
alle 35 beantworteten Entscheidungsfragen dokumentiert. Bei Widersprüchen gilt `agend.md`.

---

## 1. Leitplanken

Diese Punkte sind Produktentscheidungen, keine Implementierungsdetails. Sie dürfen nicht ohne
Rücksprache aufgeweicht werden:

| Regel                                  | Konsequenz für den Code                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auslieferung als **eine** `index.html` | Keine Laufzeit-Downloads, keine CDN-Referenzen, keine externen Fonts. Alles wird einkompiliert.                                                                                         |
| **Kein Backend**                       | Keine `fetch`-Aufrufe gegen fremde Hosts. Persistenz ausschließlich über die lokale Datei.                                                                                              |
| **Kein Speichern-Knopf**               | Jede Eingabe läuft über `commit()` und wirkt sofort; Autosave übernimmt den Rest.                                                                                                       |
| **Nie blockieren**                     | Ungültige Zustände erzeugen Warnungen (farblich + Tooltip), nie Fehlerdialoge oder gesperrte Eingaben. Einzige Ausnahme: zyklenbildende Abhängigkeiten werden gar nicht erst angeboten. |
| **Alte Dateien bleiben lesbar**        | Jede Schemaänderung braucht eine Migration. Siehe Abschnitt 7.                                                                                                                          |
| **Minimale Klickzahl**                 | Neue Entitäten entstehen inline über die Combobox („neu anlegen"), nicht über separate Dialoge.                                                                                         |
| **Wiederverwendung vor Neubau**        | Bedienelemente kommen aus `ui/components/controls.tsx`, Farben aus den CSS-Variablen. Keine lokalen Sonderfarben, keine eigenen Button-Varianten.                                       |

## 2. Schichten

```
                    ┌──────────────────────────────────────────┐
   ui/              │  React-Komponenten (nur Darstellung)     │
                    └───────────────┬──────────────────────────┘
                                    │ liest
                    ┌───────────────▼──────────────────────────┐
   state/           │  Store (Undo/Redo) · Preferences · Derived│
                    └───────┬──────────────────────┬───────────┘
                            │ mutiert              │ berechnet
              ┌─────────────▼──────────┐  ┌────────▼───────────┐
   model/     │  Datenmodell + Migration│  │ engine/ (reine     │
   persistence│  + Dateizugriff         │  │ Funktionen)        │
              └─────────────────────────┘  └────────────────────┘
```

**Wichtigste Eigenschaft:** `engine/` enthält ausschließlich reine Funktionen ohne React-Bezug.
Deshalb ist die gesamte Fachlogik ohne DOM testbar – und genau dort liegen die Tests.

## 3. Module im Einzelnen

### `src/model/`

| Datei        | Inhalt                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`   | Alle persistierten Typen und `CURRENT_SCHEMA_VERSION`. **Einzige Quelle der Wahrheit für die Datenstruktur.**                  |
| `factory.ts` | Erzeugung neuer Entitäten mit Defaults, Tag-Farbpalette, Beispielmandant. Neue Entitäten immer hier anlegen, nie inline im UI. |
| `migrate.ts` | `migrate()` = Schema-Hochstufung + `normalizeDatabase()` = Reparatur. Siehe Abschnitt 7.                                       |

### `src/engine/` – reine Fachlogik

| Datei          | Inhalt                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dates.ts`     | Arbeitstags-Mathematik (Mo–Fr), Bucket-Bildung für alle Zeitraster, deutsche Formatierung. Rechnet intern in UTC, um Sommerzeit zu umgehen.                                            |
| `schedule.ts`  | `computeSchedule()`: topologische Sortierung → Vorwärtsrechnung → Rückwärtsrechnung → kritischer Pfad. Außerdem `wouldCreateCycle()` und `collectNeighbourhood()` (Tiefengrad-Filter). |
| `resources.ts` | Tageslasten je Person/Budget, Aggregation in Buckets, Grenzwerte, Jahressummen.                                                                                                        |
| `validate.ts`  | Alle Warnungen (Parallelität, Bedingungen, Status gegen Termin, Auslastung ab 90 %, Zyklen).                                                                                           |
| `layout.ts`    | Netzplan-Layout (Ebenen nach Tiefe, Baryzentrum gegen Kantenkreuzungen) und Kurvenpfade.                                                                                               |

**Terminierungsregeln in Kurzform:**

- `anchor: 'date'` → Start ist gesetzt. `anchor: 'dependency'` → Start = spätestes Vorgängerende + 1 Arbeitstag.
- Dauer ist eine Spanne (`durationMin`/`durationMax`); das Szenario (`'min'`/`'max'`) wählt den Rechenwert.
- Ein explizites `end` überschreibt die Dauer (nur bei festem Start).
- **Dauerläufer haben schlicht kein Enddatum**: `durationMax === 0` und kein `end`. Es gibt dafür kein
  eigenes Kennzeichen im Schema – `isOpenEnded(schedule)` in `model/types.ts` ist die einzige Quelle
  der Wahrheit. Ende = Horizontende (zehn Jahre über das Projektende hinaus), Puffer 0, nicht Teil der
  Projektendbestimmung.
- Bedingungen und Vorhaben-Startbedingungen **verschieben keine Termine** – sonst wäre keine Planung möglich.

**Wann warnt `validate.ts`?** Eine Warnung, die dauerhaft steht, wird ignoriert. Deshalb sind die
Prüfungen an die Fälligkeit gebunden:

- Offene Startbedingungen melden sich erst, wenn der Start erreicht ist (`warn`) oder in den nächsten
  `CONDITION_LEAD_DAYS` liegt (`info`) – vorher gar nicht.
- Der Status wird gegen den Terminplan geprüft: Start erreicht, aber noch „Offen" → Warnung; Ende
  vorbei, aber nicht „Abgeschlossen" → Warnung.
- Personen und Budgets warnen ab `UTILISATION_WARN_RATIO` (90 %), nicht erst bei Überschreitung.
- `taskWarnings(client, schedule, now)` nimmt den Bezugstag als Parameter – nur so sind die
  terminbezogenen Prüfungen testbar.

### `src/state/`

| Datei             | Inhalt                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `store.tsx`       | Datenbestand, Undo/Redo, Checkpoints, Autosave, Datei-Sperre. Zentrale API siehe unten.                                         |
| `preferences.tsx` | Ansichts-Einstellungen in localStorage (Theme, Zeitraster, Szenario, Tiefengrad …). Nicht Teil von Undo.                        |
| `useDerived.ts`   | Memoisierte Ableitungen: Terminierung, Warnungen, sichtbare Aufgaben. **Komponenten rufen nie selbst `computeSchedule()` auf.** |

### `src/persistence/`

| Datei            | Inhalt                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `fileStore.ts`   | File System Access API, Handle-Ablage in IndexedDB, Backup vor Migration, Download-Fallback. |
| `lock.ts`        | Sperrvermerk für gemeinsame Ablagen. Reine Funktionen, deshalb vollständig testbar.          |
| `checkpoints.ts` | Ringpuffer: max. 50 Snapshots, frühestens alle 10 Minuten ein neuer.                         |

**Die Datei-Sperre** verhindert, dass zwei Sitzungen dieselbe Datei auf einem geteilten Laufwerk
überschreiben. Wichtig beim Weiterentwickeln:

- Der Vermerk steht **in** der Datei (`db.lock`), nicht daneben – nur so übersteht er das
  Synchronisieren einer einzelnen Datei.
- Der Halter frischt `heartbeatAt` alle `LOCK_HEARTBEAT_MS` auf, indem der Store die Datei neu
  schreibt. Vor jedem Lebenszeichen liest er die Sperre der Datei zurück; hat jemand übernommen,
  schaltet er sofort auf Nur-Lesen statt zu überschreiben.
- Nach `LOCK_TIMEOUT_MS` ohne Lebenszeichen gilt die Sperre als verwaist und darf übernommen werden.
  **Diese Eigenschaft ist der Kern des Verfahrens** – ohne sie bliebe eine Datei nach einem
  Browser-Absturz für immer gesperrt. Beim Freigeben über `pagehide` handelt es sich nur um eine
  Beschleunigung, verlassen darf man sich darauf nicht.
- `claimLock()` wird ausschließlich beim Schreiben angewandt, nie im Zustand gehalten – sonst könnte
  eine geladene fremde Sperre versehentlich weitergeschrieben werden.

### `src/export/`

| Datei    | Inhalt                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `png.ts` | Serialisiert ein SVG mit aufgelösten Farben auf ein Canvas. Deckelt übergroße Grafiken auf den sichtbaren Ausschnitt. |
| `csv.ts` | Gesamter Bestand als Abschnitts-CSV (Semikolon + BOM, damit Excel es ohne Import-Assistent öffnet).  |

Beim PNG-Export müssen **alle** zeichnerisch relevanten Eigenschaften als Attribut am Element stehen –
im Bild gibt es weder CSS-Variablen noch Stylesheets. `COPIED_PROPERTIES` in `png.ts` ist die Liste
dafür; wer eine neue SVG-Eigenschaft per CSS setzt, ergänzt sie dort. Achtung: `none` muss mitkopiert
werden (`fill: none` an Kanten), sonst füllt das Bild sie schwarz aus.

### `src/ui/`

| Bereich                                             | Inhalt                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `components/controls.tsx`                           | **Das Design-System.** Button, ConfirmButton, Segmented, Switch, NumberSlider, Combobox, Chip, Modal, Field, Badge. |
| `components/SplitStack.tsx`                         | Randloser Zweier-Stapel mit verschiebbarem horizontalem Trenner (Verhältnis in den Preferences).      |
| `components/useZoomPan.ts`                          | Zoom und Verschieben für SVG-Flächen: Mausrad, Ziehen, Einpassen, Heranzoomen auf ein Objekt.        |
| `components/useElementSize.ts`                      | Misst eine Fläche per ResizeObserver – für SVGs, die die verfügbare Höhe ausfüllen sollen.           |
| `components/taskPalette.ts`                         | Blau-/Türkistöne je Aufgabe für die gestapelten Ganglinien. Bewusst getrennt von der Tag-Palette.    |
| `components/ExportPngButton.tsx`                    | Sitzt an der jeweiligen Grafik, weil nur dort eindeutig ist, welches SVG gemeint ist.                |
| `Sidebar.tsx` / `TopBar.tsx` / `CommandPalette.tsx` | Rahmen der Anwendung.                                                                                |
| `tasks/`                                            | Aufgabenübersicht: `NetworkChart`, `GanttChart`, `ResourceRailLayer`, `TaskEditor`.                  |
| `resources/`                                        | Ressourcenübersicht: `ResourceChart`, `ResourceTable`, `ResourceEditors`.                            |
| `dialogs/`                                          | Checkpoint-Verlauf, KI-Austausch, Warnzentrum, Tag-Verwaltung, Kurzanleitung.                        |
| `ErrorBoundary.tsx`                                 | Verhindert den weißen Bildschirm bei unerwarteten Zuständen.                                         |

**Löschen** läuft immer über `ConfirmButton`: der erste Klick versetzt denselben Knopf in einen
blinkenden Bestätigungszustand, der zweite Klick innerhalb von 3 Sekunden führt die Aktion aus.
Keine Modals – das Konzept verlangt wenige Klicks.

**Browser-Navigation:** der gesamte UI-Zustand (`ui` im Store) wird in die History-API gespiegelt.
Jede Ansichtsänderung erzeugt einen History-Eintrag, `popstate` stellt ihn wieder her. Wer neuen
Ansichtszustand einführt, legt ihn in `UiState` ab – dann ist er automatisch Teil der Navigation.

**Overlays** (Befehlspalette, Warnzentrum, Kurzanleitung) liegen in `App.tsx`, nicht in der Kopfzeile:
sie sind auch per Tastenkürzel erreichbar und gehören deshalb keinem einzelnen Bedienelement.

**Werkzeugleisten (`.panel__head`) bleiben immer einzeilig.** Eine umbrechende zweite Zeile schiebt
die Visualisierung darunter weg; passt nicht alles hin, wird waagerecht gescrollt. Neue Bedienelemente
dort also knapp beschriften. Warnungen kommen in einen `.headwarn`-Streifen – das einzige Element in
einer Leiste, das schrumpfen und selbst scrollen darf, damit die Knöpfe rechts erreichbar bleiben.

**Was ein Objekt als Ganzes betrifft, steht in der Werkzeugleiste, nicht im Formular:** Warnungen und
Löschknöpfe von Aufgaben (`TaskEditorHeader`) und Ressourcen (`ResourceEditorHeader`) sitzen oben im
`.panel__head` und nicht am Ende eines langen Editors, den man erst scrollen müsste.

**Die Fehlergrenze (`ErrorBoundary`) liegt ganz außen um die Provider herum.** Auch
`PreferencesProvider` kann scheitern – `localStorage` und `matchMedia` sind z. B. in Safari auf
`file://` eingeschränkt. Lag die Grenze innerhalb, endete so ein Fehler in einer weißen Seite ohne
jeden Hinweis. Alles, was auf Browser-APIs zugreift, gehört zusätzlich in ein `try`.

**Flächenfüllende SVGs brauchen eine definite Höhe in der gesamten Elternkette.** Ein Diagramm, das
seine Fläche misst und sich passend hoch zeichnet, schaukelt sich in einem inhaltsabhängig hohen
Container endlos auf – siehe `.resource-grid { height: 100% }` in `app.css`.

## 4. Die zentrale Änderungs-API

Alle Datenänderungen laufen über den Store. Es gibt bewusst **keine** wachsende Action-Liste:

```tsx
const { commitClient } = useStore();

commitClient(
  "Titel geändert", // Label – erscheint im Checkpoint-Verlauf
  (client) => {
    client.tasks[0].title = "Neu";
  }, // Rezept, mutiert eine tiefe Kopie
  { coalesceKey: `title-${task.id}` }, // optional: fasst schnelle Folgeänderungen zusammen
);
```

- `commitClient(label, recipe)` – ändert den aktiven Mandanten (Normalfall).
- `commit(label, recipe)` – bekommt alle Mandanten (für Mandantenverwaltung).
- **`coalesceKey` ist Pflicht bei jeder Texteingabe**, sonst entsteht pro Tastendruck ein Undo-Schritt.
- `{ checkpoint: false }` unterdrückt einen Checkpoint für rein technische Änderungen.

Der Store kümmert sich automatisch um: tiefe Kopie, Undo-Historie, Checkpoint-Erzeugung, Autosave.

## 5. Version

Die Version wird an **genau einer Stelle** gepflegt: `version` in `package.json`.

- `vite.config.ts` und `vitest.config.ts` spritzen sie über `define` als
  `__APP_VERSION__` ein.
- `src/version.ts` liest die Konstante und exportiert `APP_VERSION` (plus den
  Urheberrechtsvermerk). **Nirgends sonst eine Versionszahl hinschreiben** – eine
  zweite, von Hand gepflegte Konstante gab es hier schon einmal, und sie lief
  erwartungsgemäß auseinander.
- Die Anwendung zeigt sie klein unten rechts, damit sie in einer Fehlermeldung
  ablesbar ist.

**Veröffentlichen:**

```bash
# 1. Version in package.json anheben, Änderung committen
# 2. Tag setzen und pushen
git tag v1.3.0 && git push origin v1.3.0
```

Der Workflow `.github/workflows/build.yml` veröffentlicht **nur** bei einem Tag
`vN.N.N`, der auf main sitzt, zur Version in `package.json` passt und höher ist
als der letzte Tag. `dist/` steht in `.gitignore`; die ausgelieferte
`index.html` kann damit ausschließlich aus einem solchen Lauf stammen. Pushes
ohne Tag laufen weiterhin durch Typen, Tests und Build – sie veröffentlichen
nur nichts.

## 6. Styling

Zwei Dateien, mehr nicht:

- `styles/theme.css` – **nur Variablen.** Jede Farbe existiert in Light und Dark unter demselben Namen.
- `styles/app.css` – Layout und Komponentenklassen, flach benannt (`.btn`, `.btn--ghost`, `.panel__head`).

Beim Ergänzen von UI: erst prüfen, ob eine Klasse existiert. Inline-`style` ist nur für berechnete Werte
zulässig (Positionen, Breiten, Tag-Farben) – nie für Farben aus der Palette.

## 7. Schema ändern – die vollständige Checkliste

Ein bestehender Datenbestand darf durch ein Update **nie** unbrauchbar werden:

1. Feld in `model/types.ts` ergänzen.
2. `CURRENT_SCHEMA_VERSION` um 1 erhöhen.
3. In `model/migrate.ts` unter `MIGRATIONS` einen Eintrag mit dem Key der **alten** Version anlegen
   (z. B. `1: (db) => …` hebt von 1 auf 2). **Bestehende Migrationen niemals nachträglich ändern.**
4. In `normalizeDatabase()` einen Default für das neue Feld setzen, damit auch Dateien ohne
   Migrationspfad funktionieren.
5. Die Schemabeschreibung in `ai/exchange.ts` (`buildExportMarkdown`) ergänzen – sonst kennt das LLM
   das Feld nicht und löscht es beim Rückspielen.
6. Test in `model/migrate.test.ts` ergänzen, der eine Datei der alten Version lädt.

Die Sicherungskopie vor der Migration erzeugt `fileStore.readFromHandle()` automatisch.

## 8. Tests

```bash
npm test          # einmalig
npm run test:watch
```

- `src/engine/engine.test.ts` – Arbeitstage, Terminierung, kritischer Pfad, Ressourcen, Warnungen.
- `src/model/migrate.test.ts` – Migration, Normalisierung, Robustheit gegen kaputte Dateien.
- `src/ai/exchange.test.ts` – Export/Import-Rundlauf und Diff.
- `src/persistence/lock.test.ts` – Sperre: eigene/fremde/abgelaufene Vermerke, kaputte Zeitstempel.
- `src/export/csv.test.ts` – Abschnitte, Maskierung, BOM.

Neue Fachlogik gehört in `engine/` und braucht dort einen Test. UI-Komponenten werden bewusst nicht
getestet – die Logik liegt darunter.

## 9. Sprache und Kontrast

- **Echte Umlaute** in allen Texten, Kommentaren und Bezeichnern – keine `ae`/`oe`/`ue`-Ersatzschreibung.
- Die Farbwerte in `styles/theme.css` sind auf **WCAG-Kontraste gerechnet**: Text mindestens 4.5:1
  gegen `--surface` *und* `--surface-2`, Bedienelement-Grenzen mindestens 3:1 gegen `--surface`.
  Wer eine Farbe ändert, rechnet den Kontrast nach – nicht nach Augenmaß anpassen.
  (Ausgenommen sind reine Diagramm-Rasterlinien, die bewusst dezent bleiben.)

## 10. Bekannte Grenzen

Bewusst nicht umgesetzt (Stand v1.2.0), damit niemand danach sucht:

- Kein Ist-Tracking (kein Fortschritt in %, keine gebuchten Stunden oder Ist-Kosten) – reine Planung.
- Keine Feiertagskalender – gerechnet wird mit Mo–Fr.
- Keine manuelle Positionierung der Netzplan-Knoten; das Layout ergibt sich stets neu aus dem Graphen
  (Zoom und Verschieben sind vorhanden, Knotenpositionen werden nicht gespeichert).
- Kein Lag/Puffer an Abhängigkeiten – Unschärfe wird über die Dauerspanne abgebildet.
- Keine Mehrsprachigkeit, kein Mobile-Layout.
- Dauer-Einheiten rechnen mit festen Faktoren (1 Woche = 5 AT, 1 Monat = 21 AT, 1 Jahr = 252 AT);
  gespeichert wird immer in Arbeitstagen.
- Die Datei-Sperre ist **kooperativ**: sie verhindert versehentliches gleichzeitiges Schreiben, nicht
  vorsätzliches. Wer „Sperre übernehmen" drückt, schreibt mit; dann gewinnt, wer zuletzt speichert.
- Im Gantt lassen sich nur Aufgaben mit **festem Starttermin** ziehen. Bei Abhängigkeitsanker ergibt
  sich der Termin aus dem Netz – ein Ziehen hätte dort keine definierte Bedeutung.
- Der PNG-Export einer sehr breiten Grafik (Gantt mit Dauerläufern) enthält nur den sichtbaren
  Ausschnitt; ein Bild über 5000 Zeichenkoordinaten Breite wäre nicht mehr brauchbar.
- **Automatisches Speichern setzt Chrome/Edge UND einen sicheren Kontext voraus.** Die File System
  Access API fehlt nicht nur in Safari und Firefox, sie verschwindet in Chrome auch auf `file://`
  (Doppelklick) und auf `http://` abseits von `localhost`. `fileAccessStatus()` in
  `persistence/fileStore.ts` unterscheidet die Fälle, `BrowserNotice` nennt den konkreten Grund -
  eine pauschale Meldung "Browser kann das nicht" schickt sonst auf die falsche Fährte.
