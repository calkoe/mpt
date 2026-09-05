/**
 * Lädt die aktuelle Visualisierung als PNG herunter.
 *
 * Sitzt bewusst direkt an der jeweiligen Grafik statt in der Kopfzeile: nur
 * dort ist eindeutig, welches SVG gemeint ist, und der Knopf ist genau da, wo
 * man beim Betrachten ohnehin hinschaut.
 */
import { useState, type RefObject } from 'react';
import { downloadSvgAsPng, timestampedName } from '../../export/png';
import { usePreferences } from '../../state/preferences';
import { Button } from './controls';

export function ExportPngButton({
  svgRef,
  overlayRef,
  namePrefix,
}: {
  svgRef: RefObject<SVGSVGElement>;
  /** Mitgeführte Ebene, die im Bild darüberliegt (Gantt: Titelspalte + Leiste). */
  overlayRef?: RefObject<SVGSVGElement>;
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
      });
      if (result.clipped) setStatus({ kind: 'clipped' });
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    }
  };

  const title =
    status?.kind === 'error'
      ? status.text
      : status?.kind === 'clipped'
        ? 'Die Grafik war zu breit für ein einzelnes Bild - exportiert wurde der sichtbare Ausschnitt.'
        : 'Aktuelle Ansicht als PNG herunterladen';

  return (
    <Button size="sm" onClick={() => void run()} title={title} variant={status?.kind === 'error' ? 'danger' : 'default'}>
      {status?.kind === 'error' ? 'PNG fehlgeschlagen' : status?.kind === 'clipped' ? 'PNG (Ausschnitt)' : 'PNG'}
    </Button>
  );
}
