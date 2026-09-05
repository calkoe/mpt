/**
 * Aktuelle Visualisierung als PNG.
 *
 * Ein SVG lässt sich nur dann als Bild rendern, wenn es für sich allein steht.
 * Im Dokument bezieht unser SVG praktisch alle Farben aus CSS-Variablen und
 * externen Regeln - beides ist in einem `<img>` nicht verfügbar. Deshalb wird
 * eine Kopie erzeugt, in der jede zeichnerisch relevante Eigenschaft als
 * Attribut am Element steht (aus `getComputedStyle` des Originals gelesen).
 *
 * Der Rest ist Standard: serialisieren, als Data-URL in ein Bild laden, auf
 * ein Canvas zeichnen, als PNG herunterladen. Alles lokal im Browser - es
 * verlässt nichts den Rechner.
 */

/** Eigenschaften, die das Aussehen bestimmen und deshalb mitgenommen werden. */
const COPIED_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'rx',
  'ry',
] as const;

/** Vergrößerungsfaktor - macht Beschriftungen auch beim Zoomen lesbar. */
const SCALE = 2;
/**
 * Ab dieser Breite in Zeichenkoordinaten wird nicht mehr die ganze Grafik
 * exportiert, sondern der sichtbare Ausschnitt. Ein Gantt mit Dauerläufern
 * reicht zehn Jahre weit - das ergäbe sonst ein über 40.000 Pixel breites Bild,
 * das kein Programm mehr sinnvoll anzeigt.
 */
const MAX_CONTENT_SIDE = 5000;
/** Obergrenze der längeren Bildkante in Pixeln. */
const MAX_IMAGE_SIDE = 8000;

export interface PngExportOptions {
  /** Hintergrundfarbe; ohne Angabe bleibt das Bild transparent. */
  background?: string;
  fileName: string;
  /**
   * Zweite Ebene, die im Bild über dem Inhalt liegt - im Gantt die
   * mitgeführte Beschriftungsspalte samt Ressourcenleiste. Ohne sie fehlten
   * genau die Aufgabentitel im Export.
   */
  overlay?: SVGSVGElement | null;
}

export interface PngExportResult {
  /** true, wenn nur der sichtbare Ausschnitt exportiert wurde. */
  clipped: boolean;
}

/**
 * Erzeugt aus einem im Dokument hängenden SVG ein PNG und lädt es herunter.
 * Wirft, wenn das Bild nicht erzeugt werden kann - der Aufrufer meldet das.
 */
export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  options: PngExportOptions,
): Promise<PngExportResult> {
  const { box, clipped } = exportBox(svg);
  const image = await renderSvg(svg, box);
  const scale = Math.min(SCALE, MAX_IMAGE_SIDE / Math.max(box.width, box.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Der Browser stellt keine 2D-Zeichenfläche bereit.');

  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  /*
   * Die mitgeführte Ebene (Beschriftungsspalte und Ressourcenleiste im Gantt)
   * liegt am linken Rand des sichtbaren Bereichs - im Bild also am linken Rand
   * des Ausschnitts. Ohne sie fehlten im Export genau die Aufgabentitel.
   */
  if (options.overlay) {
    const overlayBox = {
      x: 0,
      y: box.y,
      width: options.overlay.width.baseVal.value,
      height: box.height,
    };
    const overlayImage = await renderSvg(options.overlay, overlayBox);
    context.drawImage(overlayImage, 0, 0, Math.round(overlayBox.width * scale), canvas.height);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden.');
  triggerDownload(blob, options.fileName);
  return { clipped };
}

/** Serialisiert ein SVG mit eingebetteten Stilen und lädt es als Bild. */
async function renderSvg(svg: SVGSVGElement, box: Box): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('width', String(box.width));
  clone.setAttribute('height', String(box.height));
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const source = new XMLSerializer().serializeToString(clone);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
}

/**
 * Welcher Bereich landet im Bild? Normalfall: alles. Ist die Grafik extrem
 * breit - der Gantt reicht bei Dauerläufern zehn Jahre weit - wird stattdessen
 * der sichtbare Ausschnitt genommen; das ist dann buchstäblich "die aktuelle
 * Ansicht" und bleibt eine Datei, die man auch öffnen kann.
 */
function exportBox(svg: SVGSVGElement): { box: Box; clipped: boolean } {
  const box = contentBox(svg);
  if (box.width <= MAX_CONTENT_SIDE && box.height <= MAX_CONTENT_SIDE) return { box, clipped: false };

  const scroller = svg.parentElement;
  if (!scroller) return { box, clipped: false };
  // Der Gantt zeichnet in Bildschirmpixeln, deshalb entspricht die
  // Scrollposition direkt der Koordinate im SVG.
  return {
    box: {
      x: scroller.scrollLeft,
      y: scroller.scrollTop,
      width: Math.min(box.width, scroller.clientWidth),
      height: Math.min(box.height, scroller.clientHeight),
    },
    clipped: true,
  };
}

/**
 * Sichtbarer Inhalt des SVG. `getBBox()` liefert die tatsächliche Ausdehnung
 * aller Formen - so landet auch bei einer gezoomten Ansicht der ganze Plan im
 * Bild und nicht nur der Bildschirmausschnitt.
 */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function contentBox(svg: SVGSVGElement): Box {
  const padding = 16;
  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return {
        x: bbox.x - padding,
        y: bbox.y - padding,
        width: bbox.width + padding * 2,
        height: bbox.height + padding * 2,
      };
    }
  } catch {
    // getBBox wirft bei nicht gerenderten Elementen - dann Fallback.
  }
  const rect = svg.getBoundingClientRect();
  return { x: 0, y: 0, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

/**
 * Überträgt die berechneten Darstellungswerte vom Original auf die Kopie.
 * Beide Bäume sind strukturgleich, deshalb genügt ein paralleler Durchlauf.
 */
function inlineStyles(source: SVGSVGElement, target: SVGSVGElement): void {
  const originals = [source, ...source.querySelectorAll<SVGElement>('*')];
  const clones = [target, ...target.querySelectorAll<SVGElement>('*')];

  for (let i = 0; i < originals.length && i < clones.length; i++) {
    const computed = window.getComputedStyle(originals[i]);
    const clone = clones[i];
    for (const property of COPIED_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      // `none` muss mitkopiert werden: eine Kante ist `fill: none`, und ohne
      // diese Angabe füllt das Bild sie schwarz aus.
      if (value && value !== 'normal') clone.setAttribute(property, value);
    }
    // Klassen zeigen auf Regeln, die im Bild nicht existieren - sie würden nur
    // stören, weil sie die eben gesetzten Attribute überschreiben könnten.
    clone.removeAttribute('class');
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Die Grafik konnte nicht gelesen werden.'));
    image.src = url;
  });
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dateiname mit Datum, damit mehrere Exporte nebeneinander bestehen. */
export function timestampedName(prefix: string, extension: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `${prefix}-${stamp}.${extension}`;
}
