/**
 * Lädt die aktuelle Visualisierung als PNG herunter.
 *
 * Sitzt bewusst direkt an der jeweiligen Grafik statt in der Kopfzeile: nur
 * dort ist eindeutig, welches SVG gemeint ist, und der Knopf ist genau da, wo
 * man beim Betrachten ohnehin hinschaut.
 *
 * **Überall dasselbe Zeichen**, ob in der Werkzeugleiste von Netzplan und Gantt
 * oder in der Kopfzeile einer Ganglinienkachel: ein Herunterladen-Pfeil. Die
 * frühere Beschriftung "PNG" wäre in den Kacheln vielfach erschienen - und zwei
 * verschiedene Erscheinungsformen für dieselbe Handlung sind genau das, was die
 * Oberfläche nicht haben soll.
 */
import { useState, type RefObject } from 'react';
import { downloadSvgAsPng, timestampedName, type PngExportOptions } from '../../export/png';
import { usePreferences } from '../../state/preferences';
import { Button } from './controls';

export function ExportPngButton({
  svgRef,
  overlayRef,
  overlayFit,
  namePrefix,
}: {
  svgRef: RefObject<SVGSVGElement>;
  /** Mitgeführte Ebene, die im Bild darüberliegt (Gantt: Titelspalte + Leiste). */
  overlayRef?: RefObject<SVGSVGElement>;
  /** Wo diese Ebene im Bild sitzt - siehe export/png.ts. */
  overlayFit?: PngExportOptions['overlayFit'];
  namePrefix: string;
}) {
  const { resolvedTheme } = usePreferences();
  const [status, setStatus] = useState<null | { kind: 'error'; text: string } | { kind: 'clipped' }>(null);

  const run = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    setStatus(null);
    try {
      const result = await downloadSvgAsPng(svg, {
        fileName: timestampedName(namePrefix, 'png'),
        // Ohne deckenden Hintergrund wäre helle Schrift auf Transparenz später
        // unlesbar - deshalb die Flächenfarbe des aktiven Themes.
        background: resolvedTheme === 'dark' ? '#171a21' : '#ffffff',
        overlay: overlayRef?.current,
        overlayFit,
      });
      if (result.clipped) setStatus({ kind: 'clipped' });
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    }
  };

  const title =
    status?.kind === 'error'
      ? `PNG fehlgeschlagen: ${status.text}`
      : status?.kind === 'clipped'
        ? 'Die Grafik war zu breit für ein einzelnes Bild - exportiert wurde der sichtbare Ausschnitt. Erneut herunterladen?'
        : 'Diagramm als PNG herunterladen';

  return (
    <Button
      size="sm"
      icon
      variant={status?.kind === 'error' ? 'danger' : 'default'}
      onClick={() => void run()}
      title={title}
    >
      {/* Scheitert der Export, tritt das Warnzeichen an die Stelle des Pfeils -
          ein rot umrandeter Pfeil allein sähe aus wie ein Zustand, nicht wie
          ein Hinweis. */}
      {status?.kind === 'error' ? '⚠' : '⤓'}
    </Button>
  );
}
