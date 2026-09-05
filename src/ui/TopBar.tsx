/**
 * Kopfzeile: Datei, Speicherstatus, Undo/Redo, Warnzentrum, Exporte, Verlauf,
 * KI-Austausch, Hilfe und Theme.
 *
 * Zwei Dinge sind hier bewusst prominent:
 *  - der Speicherstatus - bei einem Schreibfehler wird er rot und nennt die
 *    Ursache, damit kein Datenverlust unbemerkt bleibt,
 *  - der Warnzähler - er ist der Einstieg ins Warnzentrum und zeigt schon in
 *    der Leiste, ob etwas nicht stimmt.
 */
import { useState } from "react";
import { createClient, createDatabase, createVenture } from "../model/factory";
import { migrate } from "../model/migrate";
import { useStore } from "../state/store";
import { usePreferences, type ThemeSetting } from "../state/preferences";
import {
  createDatabaseFile,
  downloadText,
  isFileSystemAccessSupported,
  openDatabaseFile,
  pickFileViaInput,
  readFromHandle,
  serialize,
  type OpenResult,
} from "../persistence/fileStore";
import { formatAge, inspectLock, type LockStatus } from "../persistence/lock";
import { databaseToCsv } from "../export/csv";
import { timestampedName } from "../export/png";
import { Button, Modal, Segmented } from "./components/controls";
import { CheckpointDialog } from "./dialogs/CheckpointDialog";
import { AiDialog } from "./dialogs/AiDialog";
import { useWarningGroups } from "./dialogs/WarningCenter";

type DialogKind = "checkpoints" | "ai" | "notes";

/**
 * Warnzentrum und Anleitung liegen als Overlays in `App` - sie sind auch per
 * Tastenkürzel erreichbar und gehören deshalb nicht der Kopfzeile.
 */
export function TopBar({
  onOpenPalette,
  onOpenWarnings,
  onOpenGuide,
  recalled,
  onRecalledHandled,
}: {
  onOpenPalette: () => void;
  onOpenWarnings: () => void;
  onOpenGuide: () => void;
  /** Zuletzt verwendete Datei aus IndexedDB, falls vorhanden. */
  recalled: FileSystemFileHandle | null;
  onRecalledHandled: () => void;
}) {
  const store = useStore();
  const { prefs, setPrefs } = usePreferences();
  const { total: warningCount } = useWarningGroups();

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Fremde, noch gültige Sperre auf der gerade geöffneten Datei. */
  const [blockingLock, setBlockingLock] = useState<Extract<LockStatus, { kind: "held" }> | null>(null);

  /**
   * Übernimmt ein Öffnen-Ergebnis. Der Sperrvermerk in der Datei entscheidet,
   * ob geschrieben werden darf:
   *  - frei oder abgelaufen -> Sperre übernehmen und normal arbeiten,
   *  - fremd und noch gültig -> nur lesen, mit Hinweis und der Möglichkeit,
   *    die Sperre bewusst zu übernehmen.
   */
  const adoptResult = (result: OpenResult) => {
    const status = inspectLock(result.migration.db.lock);
    const messages = [...result.migration.notes];

    store.replaceDatabase(result.migration.db);
    if (status.kind === "held") {
      setBlockingLock(status);
      store.attachFile(result.handle, result.fileName, { readOnly: true });
    } else {
      if (status.kind === "stale") {
        messages.push(
          `Die Datei war noch als "in Bearbeitung von ${status.lock.holder}" markiert, das letzte ` +
            `Lebenszeichen ist aber ${formatAge(status.ageMs)} alt. Die verwaiste Sperre wurde übernommen.`,
        );
      }
      store.attachFile(result.handle, result.fileName);
    }

    onRecalledHandled();
    // Ab jetzt gilt der Bestand als "eigene Datei" - die Anleitung erscheint
    // beim nächsten Start nicht mehr von selbst.
    setPrefs({ guideSeen: true });

    if (messages.length > 0) {
      setNotes(messages);
      setDialog("notes");
    }
  };

  const loadFromHandle = async (handle: FileSystemFileHandle) => {
    setError(null);
    try {
      adoptResult(await readFromHandle(handle));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openFile = async () => {
    setError(null);
    try {
      if (isFileSystemAccessSupported()) {
        const result = await openDatabaseFile();
        if (result) adoptResult(result);
        return;
      }
      // Fallback: Datei einlesen, Speichern läuft dann über Download.
      const picked = await pickFileViaInput();
      if (!picked) return;
      const migration = migrate(JSON.parse(picked.text));
      store.replaceDatabase(migration.db, { dirty: true });
      setPrefs({ guideSeen: true });
      setNotes([
        'Dieser Browser unterstützt keinen direkten Dateizugriff. Änderungen müssen über "Kopie sichern" heruntergeladen werden.',
        ...migration.notes,
      ]);
      setDialog("notes");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const newFile = async () => {
    setError(null);
    try {
      // Startklarer Bestand: ein Mandant mit einem leeren Vorhaben, damit
      // sofort Aufgaben erfasst werden können.
      const client = createClient("Mandant");
      client.ventures = [createVenture("Erstes Vorhaben")];
      const fresh = createDatabase([client]);
      if (isFileSystemAccessSupported()) {
        const handle = await createDatabaseFile();
        if (!handle) return;
        store.replaceDatabase(fresh, { dirty: true });
        store.attachFile(handle, handle.name);
        await store.saveNow();
      } else {
        store.replaceDatabase(fresh, { dirty: true });
      }
      onRecalledHandled();
      setPrefs({ guideSeen: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveState = store.saveState;
  const saveLabel = (() => {
    switch (saveState.kind) {
      case "no-file":
        return store.supportsFileSystem
          ? "Keine Datei verbunden"
          : "Nur im Browser (kein Dateizugriff)";
      case "clean":
      case "saved":
        // "Lokal" ist keine Verzierung: es ist die Kernaussage des Werkzeugs -
        // die Daten liegen in einer Datei auf diesem Rechner, nirgendwo sonst.
        return `Lokal gespeichert · ${store.fileName}`;
      case "dirty":
        // Zwischen "geändert" und "geschrieben" liegt die Wartezeit des
        // Autosave. Das ist kein Warnzustand - es passiert gleich von selbst.
        return store.fileName ? `Wartet auf Speichern · ${store.fileName}` : "Nicht gespeichert...";
      case "saving":
        return "Speichert...";
      case "error":
        return `Speichern fehlgeschlagen: ${saveState.message}`;
      case "readonly":
        return `Nur lesen · ${store.fileName}`;
    }
  })();

  return (
    <header className="topbar app__topbar">
      <div className="topbar__brand">
        MPT <span>Projektmanagement</span>
      </div>


      <div className="topbar__divider" />

      <Button onClick={openFile} title="Datenbestand öffnen (Strg+O)">
        Öffnen
      </Button>
      <Button onClick={newFile} title="Neuen leeren Datenbestand anlegen">
        Neu
      </Button>
      {recalled && (
        <Button
          variant="primary"
          onClick={() => void loadFromHandle(recalled)}
          title="Zuletzt verwendete Datei erneut verbinden"
        >
          "{recalled.name}" laden
        </Button>
      )}

      <div
        className={`savestate savestate--${saveState.kind}`}
        title={saveState.kind === "error" || saveState.kind === "readonly" ? saveState.message : saveLabel}
      >
        <span className="savestate__dot" />
        <span className="truncate">{saveLabel}</span>
        {saveState.kind === "error" && (
          <Button size="sm" variant="ghost" onClick={() => void store.saveNow()}>
            Erneut
          </Button>
        )}
        {saveState.kind === "readonly" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={store.takeOverLock}
            title="Sperre übernehmen und wieder in die Datei schreiben"
          >
            Übernehmen
          </Button>
        )}
      </div>

      {/*
        Mittig zwischen Speicherstand und Warnzentrum: der wichtigste Satz über
        dieses Werkzeug, dort, wo man ihn beiläufig liest. Die beiden Abstände
        links und rechts halten ihn in der Mitte, egal wie lang der Dateiname
        ist. Bewusst blass - eine Zusicherung, keine Werbung.
      */}
      <div className="spacer" />
      <span
        className="topbar__privacy"
        title="Es gibt keinen Server, keine Konten und keine Übertragung - der Datenbestand liegt als Datei auf diesem Rechner."
      >
        Alle Daten lokal auf diesem Rechner
      </span>
      <div className="spacer" />

      {/*
        Einstieg ins Warnzentrum. Bewusst immer neutral und ohne Zahl: die
        Kopfzeile ist keine Alarmleiste, und ein dauerhaft oranger Zähler
        stumpft ab. Wie ernst es steht, sagt das Warnzentrum selbst - dort
        stehen die Befunde farbig und sortiert.
      */}
      <button
        type="button"
        className="warncount"
        onClick={onOpenWarnings}
        title={
          warningCount > 0
            ? `${warningCount} Hinweis(e) - Warnzentrum öffnen (Alt+W)`
            : "Keine Hinweise - Warnzentrum öffnen (Alt+W)"
        }
        aria-label="Warnzentrum öffnen"
      >
        <span aria-hidden="true">&#9888;</span>
      </button>

      <div className="topbar__divider" />

      <Button icon variant="ghost" disabled={!store.canUndo} onClick={store.undo} title="Rückgängig (Strg+Z)">
        &#8630;
      </Button>
      <Button icon variant="ghost" disabled={!store.canRedo} onClick={store.redo} title="Wiederholen (Strg+Y)">
        &#8631;
      </Button>

      <div className="topbar__divider" />

      <Button
        variant="ghost"
        title="Kopie als JSON-Datei herunterladen"
        onClick={() => downloadText(serialize(store.db), store.fileName ?? "projektplan.json")}
      >
        JSON
      </Button>
      <Button
        variant="ghost"
        title="Gesamten Datenbestand als CSV herunterladen (Semikolon, für Excel)"
        onClick={() =>
          downloadText(databaseToCsv(store.db, prefs.scenario), timestampedName("mpt-datenbestand", "csv"), "text/csv")
        }
      >
        CSV
      </Button>
      <Button variant="ghost" onClick={() => setDialog("checkpoints")} title="Checkpoints der letzten Änderungen">
        Verlauf
      </Button>
      <Button
        variant="ghost"
        onClick={() => setDialog("ai")}
        title="Datenbestand für ein LLM exportieren oder Änderungen importieren"
      >
        KI-Austausch
      </Button>
      <Button variant="ghost" onClick={onOpenGuide} title="Kurzanleitung erneut anzeigen (Alt+H)">
        Hilfe
      </Button>
      <Button variant="ghost" onClick={onOpenPalette} title="Befehle (Strg+K)">
        &#9906;
      </Button>

      <Segmented<ThemeSetting>
        ariaLabel="Farbschema"
        value={prefs.theme}
        onChange={(theme) => setPrefs({ theme })}
        options={[
          { value: "light", label: "☀", title: "Hell" },
          { value: "system", label: "◐", title: "System" },
          { value: "dark", label: "☽", title: "Dunkel" },
        ]}
      />

      {dialog === "checkpoints" && <CheckpointDialog onClose={() => setDialog(null)} />}
      {dialog === "ai" && <AiDialog onClose={() => setDialog(null)} />}
      {dialog === "notes" && (
        <Modal title="Hinweise zum geladenen Datenbestand" onClose={() => setDialog(null)}>
          <ul className="col" style={{ paddingLeft: "var(--sp-4)" }}>
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </Modal>
      )}
      {blockingLock && (
        <Modal
          title="Datei ist in Bearbeitung"
          onClose={() => setBlockingLock(null)}
          footer={
            <>
              <Button onClick={() => setBlockingLock(null)}>Nur lesen</Button>
              <Button
                variant="danger"
                onClick={() => {
                  store.takeOverLock();
                  setBlockingLock(null);
                }}
                title="Nur tun, wenn sicher ist, dass niemand anderes gerade schreibt"
              >
                Sperre übernehmen
              </Button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            <strong>{blockingLock.lock.holder}</strong> hat diese Datei geöffnet; das letzte Lebenszeichen ist{" "}
            {formatAge(blockingLock.ageMs)} alt.
          </p>
          <p>
            Die Datei ist deshalb nur zum Lesen verbunden - es wird nichts zurückgeschrieben. Sobald die andere
            Sitzung die Datei schließt oder sich einige Minuten nicht mehr meldet, kannst du sie ganz normal
            erneut öffnen.
          </p>
          <p className="faint" style={{ marginBottom: 0 }}>
            "Sperre übernehmen" schreibt sofort wieder mit. Arbeitet die andere Sitzung noch, gewinnt dann,
            wer zuletzt speichert.
          </p>
        </Modal>
      )}
      {error && (
        <Modal title="Fehler" onClose={() => setError(null)}>
          <p style={{ color: "var(--critical)" }}>{error}</p>
        </Modal>
      )}
    </header>
  );
}
