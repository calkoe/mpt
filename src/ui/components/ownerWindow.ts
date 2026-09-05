/**
 * Zu welchem Fenster gehört dieses Element?
 *
 * Aufgaben- und Ressourcenansicht können in einem eigenen Browserfenster laufen
 * (siehe ui/PanelWindow.tsx). Sie werden dort per Portal hineingerendert -
 * derselbe React-Baum, derselbe Datenbestand, aber ein **anderes Dokument**.
 * `window.addEventListener` und `document.body` zeigen dann weiterhin auf das
 * Hauptfenster: ein Ziehen im ausgelagerten Fenster bekäme nie ein
 * `pointermove` zu sehen, ein aufgeklapptes Menü landete im falschen Fenster.
 *
 * Deshalb wird das Fenster nirgends global angenommen, sondern immer aus dem
 * Element abgeleitet, an dem die Bedienung tatsächlich stattfindet. Ohne
 * ausgelagertes Fenster kommt genau das Hauptfenster heraus - der Normalfall
 * bleibt also unverändert.
 */

/** Fenster eines Elements; ohne Bezug das Hauptfenster. */
export function windowOf(node: Node | null | undefined): Window {
  return node?.ownerDocument?.defaultView ?? window;
}

/** Dokument eines Elements; ohne Bezug das Hauptdokument. */
export function documentOf(node: Node | null | undefined): Document {
  return node?.ownerDocument ?? document;
}
