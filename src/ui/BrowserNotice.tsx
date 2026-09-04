/**
 * Hinweisleiste, wenn der Browser keinen direkten Dateizugriff hat.
 *
 * Die Meldung nennt den **konkreten Grund**. Das ist kein Detailluxus: die
 * File System Access API fehlt nicht nur in Safari und Firefox, sie
 * verschwindet auch in Chrome, sobald die Seite per Doppelklick (`file://`)
 * oder über einfaches `http://` geöffnet wurde. Eine pauschale Meldung
 * "dieser Browser kann das nicht" schickt einen dann auf die falsche Fährte -
 * der Browser kann es, die Seite darf es nur nicht.
 *
 * Bewusst nicht dauerhaft wegklickbar: die Leiste kommt bei jedem Start
 * wieder, solange der Zugriff fehlt. Wer das übersieht, arbeitet stundenlang
 * in einem Bestand, der beim Schließen des Tabs weg ist.
 */
import { useState, type ReactNode } from 'react';
import { fileAccessStatus, type FileAccessStatus } from '../persistence/fileStore';
import { Button } from './components/controls';

interface NoticeText {
  headline: string;
  detail: ReactNode;
}

function describe(status: Exclude<FileAccessStatus, { kind: 'available' }>): NoticeText {
  switch (status.kind) {
    case 'local-file':
      return {
        headline: 'Direkt geöffnete Dateien dürfen nicht zurückschreiben.',
        detail: (
          <>
            Diese Seite läuft über <code>file://</code>, also per Doppelklick aus dem Dateisystem. Chrome
            gibt den Dateizugriff dort nicht frei. Rufe MPT über <strong>https</strong> auf (die
            veröffentlichte Fassung) oder liefere die Datei über einen lokalen Webserver aus – dann
            funktioniert das automatische Speichern sofort.
          </>
        ),
      };
    case 'insecure':
      return {
        headline: 'Die Seite läuft nicht über eine gesicherte Verbindung.',
        detail: (
          <>
            Der Dateizugriff steht nur über <strong>https</strong> oder <code>localhost</code> zur
            Verfügung – hier ist es <code>{status.origin}</code>. Der Browser kann es also, die Seite
            darf es nur nicht.
          </>
        ),
      };
    case 'embedded':
      return {
        headline: 'MPT läuft in einem eingebetteten Rahmen.',
        detail: <>Der Dateizugriff ist dort gesperrt. Öffne die Seite in einem eigenen Tab.</>,
      };
    case 'unsupported':
      return {
        headline: 'Dieser Browser kann keine Dateien schreiben.',
        detail: (
          <>
            Das automatische Speichern gibt es nur in <strong>Chrome oder Edge</strong> am Rechner.
            Safari und Firefox kennen die nötige Schnittstelle nicht.
          </>
        ),
      };
  }
}

export function BrowserNotice() {
  const [dismissed, setDismissed] = useState(false);
  const status = fileAccessStatus();

  if (dismissed || status.kind === 'available') return null;
  const { headline, detail } = describe(status);

  return (
    <div className="notice app__notice" role="status">
      <span className="notice__icon" aria-hidden="true">
        &#9888;
      </span>
      <span className="grow">
        <strong>{headline}</strong> {detail} Solange kannst du alles ausprobieren und den Bestand über{' '}
        <em>JSON</em> herunterladen – automatisch gespeichert wird nichts.
      </span>
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)} title="Hinweis ausblenden">
        Verstanden
      </Button>
    </div>
  );
}
