Entwicklen wir das "MinimalistischeProjektManagementTool".
Ziel ist es ein minimalistisches und effektives tool zum Projektmanagement zu entwerfen.
Es soll vollstänig im Browser laufen
Es gibt kein backend
Alle Daten werden auf dem client Lokal in einer json gehalten welche ausgewählt werden kann
Es besteht im auslieferungszustand aus einer einzigen .html datei
Die verwendung von externen librays ist zulössig (solange wir hier kein CORS problem etc bekommen)
Extrem großer wert wird auf einfachheit, klarheit und effiziens des UIs gelegt.
Die anzahl an klicks und Schritten ist zu minimieren.
Überwall wo möglich stehen auswahlfelder und/oder autovervolständigung zur verfügung.
Das design ist profesionell und elegant
Ein umschalten zwischen dark und light mode ist vorgsehen
es wird in einem it repro gehostete, eien CI/CD zur erstellung der .html ist umgesetzt
es ist vollständig auch mit der tastatur bedienbar via tabs und pfeiltasten
es steht ein KI import/export zu verfügng (es exopriert die aktuelle json mit anweisungen zur modifikation durch ein llm zum spären import)
der datenbestand enthält eine klare versionierung, bei jeder änderung wird ein checkpoint erstellt Imaximal alle 10 min die letzten 50 xheckpoints sind abrufbar.
zahlen sind mit einachen slidern oder binäre auswahlverfahren mit eleganzten togle auswahlflächen umgesetzt.
Bei lücken oder mängeln in meinem konzept orietire dich an gängigen Projektmanagement best practices wie Ganz charts und netzplänen.
Notwenige honzufügen/bearbeiten/speichern buttens sind nicht vollumfänglich beschrieben, ergänze diese wo passend.
Acht auf eine einheitliche designsprache und wiederverwendung von buttons und code.
verwende react.
pflege ändrungen in dieser agend.md file von nun an, außerdem eine doku über die code struktur als einstrigspunkt für andere agents.
verwende den plan mode und mehre agents
tags erhalten bei der erstmaligen verwendung eine farbe, aufgaben mit diesem tag bekommen die farbe in der visualisierung.
bei updates sollen alte datenstände nicjt kopput gehen sonden migrierbar sein, achte darauf.
elsetlle iene ansprechene readme für github.
mit ctrl-Z sind alle änderungen rückgängig zu machen (in der menueleiste oben gibts es zdem pflee vor und zurück dafür)

---

num zum fachlichen.
Kernkomponente ist die "Aufgabe".
Eine aufgabe kann einen zetlichen start und endpunkt und eine dauer (interval von bis) haben (ich kann intuitiv eines der drei möglichkeiten eingeben, der rest wird relativ berechnet).
Auch eine abhängigkeit zum start von einer oder mehrerer anderen aufgabe ist möglich, hierbei verfügt die aufgabe über keinen eigenen zeoitlichen startpunkt sonder ei auswertungen wird dann der relative endzeitpunkt der voraufgaben genommen
Aus eine abhängigkeit der "Paralelität" ist möglich, heiß solange Aufgabe A ausgeführt werden soll muss Aufgabe B und C laufen (wird später bei den ressourcen wichtig)
Wie grade beschrieben sind as dauerläufer aufgaben z.B. "Betreib von Infrastrukur X"
Aufgaben verfügen über einen titel und ein beschreibungsfeld, in dem beschreibungsfeld ist es auch möglich eine einfach checkliste anzulegen.
Aufgaben binden ressourcen, es gibt zwei typen: Personalressourcen und Kosten.
Personalressourcen sind am ende Zeitfaktoren welche an der Ressource "Person" hängt
Diese werden entwerder via PT (Personentage) oder via FTE(Anteil pro woche 0.0 - 1.0) an die Aufgabe gebunden.
Kosten werden in Euro an die Aufgabe gehangen, Kasten hängen an der Ressource Budget.
Kosten können einmal in der aufgabe sein oder wiederkehrend sein solange die aufgabe läuft im intervall x.
Außerdem gibt es noch Abhänigkeiten von aufgaben an ungetrackte Bedingungen, diese sind entweder erfüllt oder nicht erfüllt.
personen und budgets können bei der anwahl falls es diese noch nicht gibt intuitiv direkt bei der aufgabenerstellung angelegt werden.
Aufgaben können einen oder mehrer Tags erhalten.
achte auf intuotve elemnte, klicke ich z.b. auf das feld "aufgabe abhängi von" kann ich auch oben in der visualisierung einfach auf die aufgabe klicken.
Außerdem sehe button vor wie "folgeaufgabe erstellen".
Die visualiserung bietet auch auswerte möglichleiten, z.b. wird der kritsiche pfad dargestellt, eine gewichtung nach zeit, buteg ressourcen etc, ist möglich. Auch abhängigkeiten sind ind er visualiserung zu erkennen.
aufgaben verfügen zudem pber ein umfangreiches freitextfeld.

---

zum ui (seitenleiste links):
im linken viertel des Bildschirms gibt es eine seitenleiste.
Diese liste "Vorhaben" als blöcke, vorhaben stellen eine sammlung von Aufgaben dar.
Vorhaben haben einen status "abgeschlossen oder nciht abgeschlossen" aufgaben können vorhaben als starbedingung haben".
Das gewählte vorhaben beinfluss den gesammten rechten teil des buldschirms.
Oben bei den vorhaben gibt es noch ein dropdown "Mandanten" diese auswahl trennt den gweamaten datenbestand in der geladneen json zwischen unabhängigen projekten"
unten gibt es die möglichket den rechten bildschirmbereich umzuschalten zwischen:

- Aufgabenübersicht
- Ressourcehnübersicht

---

zum ui (bilschirm rechts) modus Aufgabenübersicht:
oben wird ein gut designter Netzplan der aufgaben mit ihrem status, und abhängigkeiten dargestellt, eine umschaltung zu einem Gant-chart ist auch möglich.
Darunter in einer linie als kleine bläcke die ressourcen welche darauf einzahlen, diese sind mit einer gestrichelten und gebiogenen linie zu den aufgaben nach oben verbunden.
Es gibt in beiden fällen einen schiber und tiefegrad der gezigetn aufgaben auszuwähöen (also wieviele kind-aufgaben bei abhängigkeizten gezigt werden)
Darunter wird die Aufgabe angezigt und kann dort direkt bearbeite werden Speichern nicht erforderlich netzpläne anzeige. etc aktualiseren sich automatisch.

---

zum ui (bilschirm rechts) modus Ressourcenübersicht:
Hier sehe ich meine ressourcen als listen, kann diese anklicken bearbietn, sehe verknüpfte aufgaben und kann z.b. bei personen angaben wie verfügabere fte oder bei budgets obergrenzen definieren.
ganz wichtig hier das der obere bereich für ressourcen ganglinien genutztz wird, heißt die auswirkungen aller Aufgaben auf die ressourcen überlagert dargestellt wird, sowohl bei FTE,PT oder Euros, eingestellte grenzwerte werden dargestellt.
EIn filtern der resoourcen nach aufgaben mit bestimmten tags ist möglich.
Es ist außerdem bei budgets möglich Jahressumen über bestimmte tags oder allgemein zu bilden bzw. in dem diagramm abzulesen.
Die ressourcen ganglinie kann auch als tabelle angezigt werden. pro ressource und pro jahr werden dabei immer zusötlich summen gebildet.

BEVOR DU STARTEST, FÜGE HIER 25 ja nein verständisfragen hin zu die ich zuerst beatworten werden.!!

---

# Verständnisfragen (Ja/Nein)

Bitte hinter jedem `Antwort:` mit **Ja** oder **Nein** antworten. In Klammern steht jeweils mein Vorschlag, falls du keine Präferenz hast — dann reicht "Vorschlag übernehmen".

## A) Technik & Auslieferung

**1.** Soll die JSON-Datei per **File System Access API** einmalig gewählt und danach **automatisch in dieselbe Datei zurückgeschrieben** werden (statt jedes Mal ein Download-Dialog)? Fallback für nicht unterstützte Browser wäre Download/Upload. _(Vorschlag: Ja)_
Antwort: ja, auch automisch speichern bitte, error falls das nicht klappt, integrität ist wichtig und datenverlust zu vermeiden.

**2.** Ist die Zielplattform ausschließlich ein **aktueller Chromium-basierter Desktop-Browser** (Chrome/Edge), sodass wir uns nicht um Safari/Firefox-Sonderfälle kümmern müssen? _(Vorschlag: Ja)_
Antwort:ja

**3.** Sollen **alle Libraries (React etc.) in die eine .html-Datei einkompiliert** werden, sodass die Anwendung komplett offline ohne Internet läuft (kein CDN zur Laufzeit)? _(Vorschlag: Ja)_
Antwort:ja

**4.** Ist ein **Build-Schritt (Vite + esbuild → single-file index.html)** in Ordnung, d.h. der Quellcode liegt im Repo als viele Module vor und wird von der CI zur einen HTML gebaut? _(Vorschlag: Ja)_
Antwort:jy

**5.** Soll die CI/CD **GitHub Actions** sein, die bei jedem Push auf `main` die `index.html` baut und als Release-Artefakt sowie via GitHub Pages bereitstellt? _(Vorschlag: Ja)_
Antwort:ja

**6.** Ist die Oberfläche **rein deutschsprachig** (keine Mehrsprachigkeit/i18n)? _(Vorschlag: Ja)_
Antwort:ja

**7.** Ist **Desktop-First ohne echte Mobile-Optimierung** akzeptabel (Layout ab ca. 1280px Breite optimiert)? _(Vorschlag: Ja)_
Antwort:ja

## B) Datenmodell & Struktur

**8.** Gehört eine Aufgabe immer zu **genau einem Vorhaben** (keine Mehrfachzuordnung)? _(Vorschlag: Ja)_
Antwort:ja

**9.** Sind **Ressourcen (Personen & Budgets) mandantenweit** definiert und damit über alle Vorhaben eines Mandanten hinweg gemeinsam nutzbar — und die Ganglinien summieren standardmäßig über alle Vorhaben des Mandanten? _(Vorschlag: Ja)_
Antwort:ja

**10.** Sind **Mandanten strikt getrennt**, d.h. keinerlei Verknüpfung von Aufgaben oder Ressourcen über Mandantengrenzen hinweg? _(Vorschlag: Ja)_
Antwort:ja

**11.** Ist die kleinste **Zeiteinheit ein Kalendertag** (keine Uhrzeiten, keine Stundenplanung)? _(Vorschlag: Ja)_
Antwort:ja (wobei ich auch krumme fte angeben kann, ist aber ja eh eine relaive einheit)

**12.** Soll bei Dauer-Berechnungen mit **Arbeitstagen (Mo–Fr)** gerechnet werden statt mit Kalendertagen (Feiertage bleiben zunächst unberücksichtigt)? _(Vorschlag: Ja)_
Antwort:ja

**13.** Dürfen **Dauerläufer-Aufgaben ohne Enddatum** existieren (offenes Ende, z.B. "Betrieb Infrastruktur X"), und werden diese in Ganglinien bis zum Ende des betrachteten Zeitraums fortgeschrieben? _(Vorschlag: Ja)_
Antwort:ja, ist kein eigener aufgaben typ sondern normale aufgaben erlauben es einfach so konfiguriert zu sein

**14.** Sind **Tags frei definierbare Textlabels** (mit Autovervollständigung aus bestehenden Tags), ohne feste Vorgabeliste? _(Vorschlag: Ja)_
Antwort:ja

**15.** Soll es einen **festen Aufgaben-Status-Satz** geben: `Offen`, `In Arbeit`, `Blockiert`, `Abgeschlossen`? _(Vorschlag: Ja)_
Antwort:ja

## C) Fachlogik: Abhängigkeiten & Berechnung

**16.** Bedeutet die normale Abhängigkeit immer **Ende→Start (Nachfolger startet am Tag nach dem spätesten Ende aller Vorgänger)**, ohne konfigurierbaren Puffer/Lag in v1? _(Vorschlag: Ja)_
Antwort:ja, der puffer ergibt sich j ein stück weit durch die varibale dauer von aufgaben (kann zwischden 4 und 7 tage dauern)

**17.** Ist die **"Parallelität"** eine eigene, nicht-terminverschiebende Beziehung — sie erzwingt keine Verschiebung, sondern erzeugt eine **Warnung**, wenn A läuft ohne dass B und C laufen? _(Vorschlag: Ja)_
Antwort:ja

**18.** Blockieren **unerfüllte ungetrackte Bedingungen** und **nicht abgeschlossene Vorhaben-Startbedingungen** die Aufgabe nur **visuell/als Warnung**, ohne die berechneten Termine zu verändern? _(Vorschlag: Ja)_
Antwort:ja, sonst könnte ja garkeine berechnung erfolgen

**19.** Soll der **kritische Pfad klassisch nach CPM** (längster Pfad ohne Puffer, inkl. Anzeige des Gesamtpuffers je Aufgabe) berechnet werden? _(Vorschlag: Ja)_
Antwort:ja aber details nur bei mousehover sichtbar

**20.** Sollen **Zyklen in Abhängigkeiten aktiv verhindert** werden (Auswahl wird gar nicht erst angeboten, plus deutliche Fehlermeldung)? _(Vorschlag: Ja)_
Antwort:ja

## D) Ressourcen & Auswertung

**21.** Werden **PT (Personentage) gleichmäßig über die Aufgabendauer verteilt** und FTE als konstanter Anteil pro Woche über die Laufzeit angesetzt (beide Angaben sind ineinander umrechenbar)? _(Vorschlag: Ja)_
Antwort:ja

**22.** Sind die Intervalle für **wiederkehrende Kosten**: `täglich`, `wöchentlich`, `monatlich`, `quartalsweise`, `jährlich` — ausreichend? _(Vorschlag: Ja)_
Antwort:ja aber auch z.b. N Monatlich etc.

**23.** Führt eine **Überschreitung von Grenzwerten** (FTE-Verfügbarkeit, Budget-Obergrenze) nur zu einer **farblichen Warnung/Markierung**, nicht zu einer Eingabe-Blockade? _(Vorschlag: Ja)_
Antwort: ja nur fahrlich warnen, gilt generell, keine aufwändigen fehlermeungen oder blocken, keep it simple, bei einem mousover gibt es einen hinweis was nicht stimmt.

## E) Versionierung & KI-Schnittstelle

**24.** Werden die **Checkpoints innerhalb derselben JSON-Datei** gespeichert (als Snapshot-Liste mit max. 50 Einträgen, neuer Checkpoint frühestens 10 Min nach dem letzten) — mit der Konsequenz einer größeren Datei? Alternative wäre Auslagerung in eine separate Datei. _(Vorschlag: Ja)_
Antwort:nei eine datei, so graoß wird sie schon nicht werden,

**25.** Soll der **KI-Export eine einzelne Markdown-Datei** sein (Anweisungen/Schema-Beschreibung + eingebettete JSON), und der **KI-Import über ein Einfügefeld** laufen, der vor Übernahme eine **Diff-Vorschau** (was wird angelegt/geändert/gelöscht) zur Bestätigung zeigt? _(Vorschlag: Ja)_
Antwort:ja

---

# Verständnisfragen Runde 2 (Ja/Nein)

Aus deinen Antworten haben sich weitere offene Punkte ergeben. Gleiches Format: **Ja**/**Nein** hinter `Antwort:`.

## F) Aufgaben-Details

**26.** Aus Antwort 16 ("kann zwischen 4 und 7 Tage dauern"): Soll die Dauer als **Spanne (min/max)** eingebbar sein, wobei für Terminberechnung und kritischen Pfad standardmäßig der **Max-Wert (pessimistisch)** verwendet und die Differenz in Gantt/Netzplan als **Unschärfe-/Pufferbalken** dargestellt wird? Ein Umschalter "optimistisch/pessimistisch" für die gesamte Ansicht käme dazu. _(Vorschlag: Ja)_
Antwort:ja

**27.** Zeile 35 nennt ein "Beschreibungsfeld mit Checkliste", Zeile 47 zusätzlich ein "umfangreiches Freitextfeld": Sind das **zwei getrennte Felder** — eine kurze Beschreibung (immer sichtbar, mit Checkliste) und ein separates, ausklappbares Notizfeld (Markdown, beliebig lang)? _(Vorschlag: Ja)_
Antwort:beide immer sichtbar

**28.** Ist das Tool in v1 **rein plangetrieben**, d.h. es gibt **kein Ist-Tracking** (kein Fortschritt in %, keine gebuchten Ist-Stunden/Ist-Kosten) — der Status `Offen/In Arbeit/Blockiert/Abgeschlossen` plus die Checkliste genügen als Fortschrittsanzeige? _(Vorschlag: Ja)_
Antwort:ja

**29.** Beim Löschen einer Aufgabe: Werden **Abhängigkeiten anderer Aufgaben auf diese automatisch entfernt** (mit Hinweis, welche betroffen sind), **ohne Kaskadenlöschung** der Nachfolger — und die Wiederherstellung läuft ausschließlich über Undo bzw. Checkpoints? _(Vorschlag: Ja)_
Antwort:es gibt die auswahl und warnung eine kaskadenlöscung durchzuführen.

## G) Ressourcen

**30.** Sollen **Personen-Verfügbarkeit (FTE) und Budget-Obergrenzen zeitraumabhängig** definierbar sein (Liste von Einträgen "gültig ab – bis: Wert", z.B. Person X ab 2027 nur 0,5 FTE; Budget Y je Jahr eine eigene Obergrenze) statt nur eines einzelnen globalen Werts? _(Vorschlag: Ja)_
Antwort:ja

**31.** Sind **Kosten reine Nominalwerte in Euro** ohne Inflation/Indexierung/Mehrwertsteuer-Logik, und Jahressummen werden **kalenderjahresweise (01.01.–31.12.)** gebildet — kein abweichendes Geschäftsjahr? _(Vorschlag: Ja)_
Antwort:ja

## H) Visualisierung & Bedienung

**32.** Wird der **Netzplan automatisch gelayoutet** (topologisch von links nach rechts, Ebenen nach Abhängigkeitstiefe) ohne manuelles Verschieben und Speichern von Knotenpositionen? _(Vorschlag: Ja)_
Antwort:erstaml ja, kann sein das wir das später ergänzen wollen

**33.** Sollen Gantt und Ressourcen-Ganglinien ein **umschaltbares Zeitraster** haben (Tag / Woche / Monat / Quartal / Jahr), Standard im Gantt = Woche, in den Ganglinien = Monat? _(Vorschlag: Ja)_
Antwort:ja

**34.** Soll es zusätzlich zu den Checkpoints ein **sofortiges Undo/Redo per Strg+Z / Strg+Y** für jede einzelne Änderung geben (Historie nur für die laufende Sitzung, nicht in der JSON gespeichert)? _(Vorschlag: Ja)_
Antwort:ja

## I) Persistenz & Migration

**35.** Zur Absicherung von Frage 24 und Zeile 25: Liegen die **Checkpoints als Ringpuffer (max. 50) in derselben JSON**, und wird beim Laden einer Datei mit älterer `schemaVersion` **automatisch migriert**, wobei vorher **automatisch eine Sicherungskopie** der Originaldatei (`<name>.v<alt>.bak.json`) daneben abgelegt wird? _(Vorschlag: Ja)_
Antwort:ja

---

# Umsetzungsstand

Diese Datei wird ab jetzt bei jeder Änderung gepflegt. Der Einstiegspunkt in den Code ist
[ARCHITEKTUR.md](ARCHITEKTUR.md), die Bedienung beschreibt [README.md](README.md).

## v1.0.0 — erste vollständige Umsetzung

**Technik:** React 18 + TypeScript, Vite mit `vite-plugin-singlefile` → eine `dist/index.html`
(ca. 276 KB, alle Libraries einkompiliert, offline lauffähig). GitHub Actions baut, typprüft, testet
und veröffentlicht das Artefakt sowie GitHub Pages. 37 Tests auf der Fachlogik.

**Vollständig umgesetzt:**

- Aufgaben mit Start/Ende/Dauer (ineinander umrechenbar), Dauer als Spanne min/max, Dauerläufer ohne Enddatum
- Abhängigkeiten Ende→Start mit Zyklusverhinderung, Parallelitäts-Beziehung als Warnung
- Ungetrackte Bedingungen und Vorhaben als Startbedingung (ohne Terminwirkung)
- Beschreibung + Checkliste + umfangreiches Freitextfeld, Tags mit stabiler Farbe ab erster Verwendung
- Personalressourcen über PT und FTE (ineinander umrechenbar), Kosten einmalig und wiederkehrend alle N Intervalle
- Netzplan mit Auto-Layout, Gantt mit Zeitraster Tag–Jahr, beide mit kritischem Pfad, Puffer, Unschärfebalken
- Ressourcen-Leiste unter beiden Visualisierungen mit gestrichelten Kurven zu den Aufgaben
- Tiefengrad-Slider, Gewichtung nach Zeit/Kosten/Personal, Szenario-Umschalter optimistisch/pessimistisch
- Ressourcen-Ganglinien mit zeitraumabhängigen Grenzwerten, Tag-Filter, Jahressummen, Tabellenansicht
- Mandanten als getrennte Datenräume, Vorhaben mit Fortschritt und Abschluss-Status
- Automatisches Speichern in die gewählte JSON, Fehler werden rot gemeldet; Sicherungskopie vor Migration
- Checkpoints (max. 50, frühestens alle 10 Min) plus Undo/Redo per Strg+Z/Strg+Y und Knöpfe in der Kopfzeile
- KI-Export als Markdown mit Schema-Anleitung, Import mit Diff-Vorschau
- Hell/Dunkel/System, vollständige Tastaturbedienung, Command-Palette auf Strg+K

**Ergänzungen über das Konzept hinaus** (aus PM-Best-Practices bzw. zur Bedienbarkeit):

- Command-Palette als zentraler Tastatur-Einstieg
- Fehlergrenze gegen weißen Bildschirm
- Beispielmandant beim ersten Start, der alle Konzepte einmal zeigt
- Löschen wahlweise nur die Aufgabe oder kaskadierend inkl. Nachfolger (mit Vorschau der Betroffenen)

**Bewusst offen gelassen** (siehe ARCHITEKTUR.md, Abschnitt 8): Ist-Tracking, Feiertagskalender,
manuelle Knotenpositionen, Lag an Abhängigkeiten, Mehrsprachigkeit, Mobile-Layout.

**Offene Punkte für später:**

- Frage 32: manuelles Verschieben der Netzplan-Knoten wurde als mögliche spätere Ergänzung vermerkt.
- Kalenderwochen-Beschriftung im Gantt läuft über Jahresgrenzen weiter (KW 52 → KW 1) – korrekt, aber
  bei sehr langen Plänen unübersichtlich; ggf. Jahreszahl ergänzen.

## v1.1.0 — Verdichtung, Navigation und Detailschliff

Projekt von **MPMT** in **MPT** umbenannt. Alle Texte im gesamten Bestand verwenden jetzt **echte
Umlaute** statt `ae`/`oe`/`ue`.

**Behoben:**

- Absturz nach „Neu" (`undefined is not an object (evaluating 'client.tasks')`): ein leerer
  Datenbestand hatte keinen Mandanten. Der Store erzwingt jetzt die Invariante „immer mindestens ein
  Mandant"; „Neu" legt zusätzlich gleich ein leeres Vorhaben an.
- Kritischer Pfad wies über Wochenenden einen Scheinpuffer von einem Tag aus (Rückwärtsrechnung zog
  einen Kalender- statt eines Arbeitstags ab).
- Mittelwert der FTE-Ganglinie verwässerte durch den langen Horizont gegen null; gemittelt wird jetzt
  nur über Zeiträume mit tatsächlicher Last („Ø aktiv").

**Neu bzw. geändert:**

- Kritischer Pfad wird nur noch auf Knopfdruck hervorgehoben (Knopf zeigt deutlich den Zustand).
- Netzplan ist zoom- und verschiebbar: Mausrad zoomt auf den Cursor, Ziehen verschiebt, Doppelklick
  auf einen Knoten zoomt heran, „Einpassen" und „Auf Auswahl" als Knöpfe. Die Ansicht passt sich
  automatisch ein, solange nicht selbst gezoomt wurde.
- Rechter Bereich ohne abgesetzte Karten und Padding; Plan und Bearbeitung grenzen direkt aneinander,
  die horizontale Trennung ist mit der Maus verschiebbar (Verhältnis wird gespeichert).
- Titelleiste deutlich schmaler (34 px mit 3 px Innenabstand).
- Ungetrackte Bedingungen erscheinen wie Ressourcen als Blöcke in der Leiste unter dem Plan; ein
  Klick schaltet erfüllt/nicht erfüllt um.
- Browser-Zurücktaste führt durch alle Ansichtswechsel zurück (UI-Zustand in der History-API).
- Ressourcenansicht: deutlicher „← Zurück"-Knopf im Detail, Ganglinien immer zwei nebeneinander und
  flacher, Ressourcenlisten zweizeilig (Name wird nicht mehr abgeschnitten).
- Dauer von Vorgängen wahlweise in **AT, Wochen, Monaten oder Jahren** eingebbar (feste Faktoren:
  5 / 21 / 252 Arbeitstage); gespeichert wird weiterhin in Arbeitstagen.
- Dauerläufer werden **zehn Jahre** über das Projektende hinaus fortgeschrieben statt eines Jahres.
- Löschen bestätigt auf demselben Knopf: erster Klick versetzt ihn in einen blinkenden
  Bestätigungszustand, ein zweiter Klick innerhalb von 3 Sekunden löscht.
- Status steht jetzt in einer Linie rechts neben dem (kürzeren) Titelfeld.
- Start- und Endfeld stehen bündig untereinander; Editor-Abschnitte in einem sauberen 2×2-Raster.
- Light Mode auf WCAG-Kontraste gerechnet (Text ≥ 4.5:1, Bedienelement-Grenzen ≥ 3:1); die Werte
  stehen in `styles/theme.css` und sind nachrechenbar.
- README enthält jetzt Screenshots beider Ansichten.

## v1.2.0 — Warnzentrum, Verkettung per Klick, gemeinsame Ablage

Schema auf **Version 2** gehoben (Migration von 1 vorhanden, Sicherungskopie wird automatisch
angelegt).

**Schemaänderungen:**

- `Task.milestone` neu — Meilensteine werden im Netzplan als Raute hervorgehoben und erzeugen im
  Gantt eine senkrechte Linie am Enddatum.
- `TaskSchedule.openEnded` **entfernt**. Ein Dauerläufer hat schlicht kein Enddatum: keine Dauer
  (`durationMax === 0`) und kein festes `end`. Ein eigener Schalter dafür entfällt; die Wahrheit
  steht an einer einzigen Stelle (`isOpenEnded()` in `model/types.ts`). Die Migration setzt bei
  bisherigen Dauerläufern die Dauer auf 0.
- `Database.lock` neu — Sperrvermerk für gemeinsam genutzte Ablagen.

**Warnungen überarbeitet:**

- Neu: Aufgabe hat den Starttermin erreicht, steht aber noch auf „Offen" → Warnung. Enddatum
  überschritten, Status nicht „Abgeschlossen" → Warnung.
- Neu: Personen und Budgets warnen **ab 90 % Auslastung**, nicht erst bei Überschreitung; die Meldung
  nennt den Anteil in Prozent.
- Geändert: offene Startbedingungen melden sich erst, wenn der Start erreicht ist (Warnung) oder
  innerhalb von 21 Tagen bevorsteht (Hinweis). Vorher schwiegen sie nicht — dadurch stand etwa
  „Betrieb Infrastruktur" dauerhaft auf Gelb, obwohl der Vorgänger noch monatelang läuft und
  überhaupt nichts zu tun war.
- Neu: **Warnzentrum** in der Kopfzeile (`Alt`+`W`) mit Zähler; sammelt alle Hinweise nach Objekt
  gruppiert, ein Klick springt zum betroffenen Objekt.

**Bedienung:**

- Beim Überfahren einer Aufgabe im Netzplan erscheint an ihrer linken und rechten Kante ein grünes
  „+": links legt es einen Vorgänger an, rechts eine Folgeaufgabe — jeweils samt Verknüpfung.
- Im Gantt zeigen Ankersymbole an den Balkenenden, ob ein Termin fest gesetzt ist (Raute) oder sich
  aus Vorgängern bzw. der Dauer ergibt (Winkel).
- Aufgaben mit festem Starttermin lassen sich im Gantt **live ziehen**; Nachfolger, kritischer Pfad
  und Ganglinien wandern sofort mit. Eine Bewegung ergibt genau einen Undo-Schritt.
- Beim Überfahren einer Ressource, Bedingung oder Abhängigkeit leuchten die betroffenen Aufgaben und
  Pfade auf, der Rest blasst ab.
- Ressourcenarten tragen ein eigenes Symbol: Person, Münze (Budget), Kästchen (Bedingung).
- Tastenkürzel für die Ansichten: `Alt`+`1`..`4` (Netzplan, Gantt, Ganglinien, Tabelle), zusätzlich
  `Alt`+`W` (Warnzentrum) und `Alt`+`H` (Anleitung).
- Beim ersten Start erscheint eine bebilderte **Kurzanleitung**. Sie verschwindet dauerhaft, sobald
  eine eigene Datei geöffnet oder angelegt wurde, und ist über „Hilfe" jederzeit wieder aufrufbar.
- Textmarkierung außerhalb von Eingabefeldern und Dialogtexten ist abgeschaltet.

**Darstellung:**

- Ressourcen-Ganglinien sind jetzt **gestapelte Balken je verursachender Aufgabe** und nutzen die
  volle verfügbare Höhe. Die Aufgabenfarben kommen aus einer reinen Blau-/Türkispalette, damit sie
  nicht mit den frei vergebenen Tag-Farben verwechselt werden; dieselbe Farbe steht in der Legende.
- Dauerläufer bleichen im Gantt nach dem letzten echten Projektende über vier Wochen aus.
- Titelzeile im Aufgaben-Editor: Titelfeld füllt die Breite, der Statusblock steht rechtsbündig und
  exakt gleich hoch daneben.
- Die Werkzeugleiste über dem Plan bleibt immer einzeilig — beim Umschalten auf Gantt sprang sie
  vorher in eine zweite Zeile und schob die Visualisierung nach unten.
- Seitenleiste schmaler; die vier Abschnitte der Aufgabenbearbeitung passen nebeneinander.
- Der Tiefen-Regler ist auf einen kurzen Schieber mit kleiner Zahl reduziert.
- Bei Kostenpositionen steht das Budget als Überschrift über der Bezeichnung, die dadurch die volle
  Breite bekommt.

**Neue Funktionen:**

- **Tag-Verwaltung** (Seitenleiste unten): umbenennen, umfärben (Palette oder freie Farbe), löschen
  inklusive Entfernen aus allen Aufgaben.
- **PNG-Export** von Netzplan und Gantt direkt an der jeweiligen Grafik. Ist die Grafik zu breit für
  ein sinnvolles Bild — ein Gantt mit Dauerläufern reicht zehn Jahre weit —, wird der sichtbare
  Ausschnitt exportiert und das am Knopf gesagt.
- **CSV-Export** des gesamten Bestands (Semikolon + BOM, damit Excel ihn ohne Import-Assistent
  öffnet), gegliedert in Abschnitte für Vorhaben, Aufgaben, Kosten, Personen, Budgets und
  Bedingungen.
- **Dateisperre für gemeinsame Ablagen.** Der Vermerk steht in der Datei selbst, damit er das
  Synchronisieren einer einzelnen Datei übersteht. Der Halter frischt ihn regelmäßig auf und prüft
  dabei, ob jemand anderes übernommen hat — dann wird sofort auf Nur-Lesen geschaltet, statt fremde
  Änderungen zu überschreiben. Bleibt das Lebenszeichen aus (Browser geschlossen, Rechner
  abgestürzt), läuft die Sperre nach drei Minuten ab und darf übernommen werden. Genau dieser Fall
  war die Anforderung: eine Datei darf nie dauerhaft blockiert bleiben.

**README:** oben ein prominenter Startknopf auf die über GitHub Pages veröffentlichte Datei
(`calkoe.github.io/mpt/`), darunter Einfachheit und der Datenschutz durch die ausschließlich lokale
Datenhaltung als erster Abschnitt.

## v1.2.1 — Versionierung, Werkzeugleisten und Browser-Hinweis

**Version:** wurde an zwei Stellen gepflegt (`package.json` und eine handgeschriebene Konstante
`APP_VERSION` in `factory.ts`) und war an beiden veraltet. Jetzt gibt es **genau eine Quelle**:
`version` in `package.json`. Build und Tests spritzen den Wert als `__APP_VERSION__` ein,
`src/version.ts` liest ihn. Die Anwendung zeigt Version und Urheberrechtsvermerk klein unten rechts.

**Veröffentlichung nur über Versionstags.** Der CI-Lauf baut und prüft weiterhin bei jedem Push,
veröffentlicht aber nur noch, wenn ein Tag `vN.N.N` gepusht wird, der
  - auf `main` sitzt,
  - zur Version in `package.json` passt,
  - höher ist als der zuletzt veröffentlichte Tag.
Zusätzlich prüft der Lauf, dass genau eine Datei entsteht, dass sie keine externen Referenzen
enthält und dass die Version tatsächlich im Build steht. `dist/` bleibt in `.gitignore` — die
öffentlich abrufbare `index.html` kann damit nur aus einem solchen Lauf stammen und nie
versehentlich von Hand eingecheckt werden.

**Behoben:**

- Die Fehlergrenze (`ErrorBoundary`) lag *innerhalb* von `PreferencesProvider`. Scheitert der
  Provider — `localStorage` und `matchMedia` sind z.B. in Safari auf `file://` eingeschränkt —,
  endete das in einer weißen Seite ohne jeden Hinweis, und auch die Anleitung erschien nicht mehr.
  Die Grenze liegt jetzt ganz außen, und die Zugriffe auf `matchMedia` sind abgesichert.

**Oberfläche:**

- Ressourcen-Diagramme scrollen nicht mehr senkrecht (war ein reines Rundungsartefakt).
- Der Löschknopf der gewählten Ressource steht oben in der Leiste bei „+ Person" und „+ Budget",
  zusammen mit ihren Warnungen.
- Beim Aufgaben-Editor steht die Beschreibung jetzt über die volle Breite direkt unter der
  Titelzeile; Warnungen und die Löschknöpfe sind ebenfalls in die obere Leiste gewandert.
- Der Warnzähler in der Kopfzeile ist orange statt rot — es sind Hinweise auf den Planungsstand,
  kein Fehlerzustand. Rot bleibt fehlgeschlagenen Schreibvorgängen vorbehalten.
- Die Kurzanleitung erscheint wieder bei jedem Start, solange mit dem Beispielbestand gearbeitet
  wird.
- **Fehlender Dateizugriff wird beim Start gemeldet.** In Safari und Firefox gibt es die File System
  Access API nicht; eine Leiste unter der Kopfzeile sagt das deutlich und nennt Chrome bzw. Edge.
  Ohne diesen Hinweis arbeitet man dort stundenlang in einem Bestand, der beim Schließen weg ist.

- Unten rechts steht neben der Version ein dezenter Link auf das Projekt
  (`github.com/calkoe/mpt`) statt eines Urheberrechtsvermerks.

- Der Hinweis zum fehlenden Dateizugriff nennt jetzt den **konkreten Grund**. Die Schnittstelle fehlt
  nicht nur in Safari und Firefox, sondern in Chrome auch auf `file://` (per Doppelklick geöffnet)
  und auf `http://` abseits von `localhost` - beides wurde als "Browser kann das nicht" gemeldet und
  führte auf die falsche Fährte. `fileAccessStatus()` unterscheidet jetzt zwischen unsicherem
  Kontext, direkt geöffneter Datei, eingebettetem Rahmen und fehlender Browser-Unterstützung.
