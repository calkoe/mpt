/**
 * Netzplan als SVG - zoom- und verschiebbar.
 *
 * Knoten = Aufgaben (Farbstreifen zeigt den Status), Kanten = Abhängigkeiten;
 * Parallelität verlässt die Knoten oben/unten. Ein Klick wählt die Aufgabe aus -
 * oder übernimmt sie in das gerade aktive Abhängigkeitsfeld (pickTarget).
 *
 * Bedienung der Fläche: Mausrad zoomt auf den Cursor, Ziehen verschiebt,
 * Doppelklick auf einen Knoten zoomt heran. Der Zoomzustand gehört zur
 * Sitzung und wird nicht gespeichert.
 *
 * Zwei Hilfen beim Bauen des Plans:
 *  - Beim Überfahren eines Knotens erscheint an seiner linken und rechten
 *    Kante ein grünes "+", das direkt einen Vorgänger bzw. Nachfolger anlegt.
 *  - Beim Überfahren einer Kante oder einer Ressource unten leuchten alle
 *    beteiligten Aufgaben auf, der Rest blasst ab.
 *
 * Knoten lassen sich ziehen. Gespeichert wird nur der **Versatz** gegenüber der
 * berechneten Position (`task.layout`), damit das automatische Layout aktiv
 * bleibt: ändern sich Abhängigkeiten, wandert der Knoten mit und behält seine
 * Verschiebung. "Ansicht zurücksetzen" verwirft alle Versätze.
 *
 * Strg+C / Strg+V dupliziert die gewählte Aufgabe.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Id, Note, Task } from '../../model/types';
import { checklistProgress, TASK_STATUS_LABEL } from '../../model/types';
import {
  edgePath,
  hasManualLayout,
  layoutNetwork,
  NODE_HEIGHT,
  NODE_WIDTH,
  parallelPath,
  type LayoutNode,
} from '../../engine/layout';
import { formatDateDe } from '../../engine/dates';
import { formatDuration, taskProgress, wouldCreateCycle, type ScheduleResult } from '../../engine/schedule';
import type { Warning } from '../../engine/validate';
import { createFollowUp, createNote, createPredecessor } from '../../model/factory';
import { usePreferences } from '../../state/preferences';
import { useStore } from '../../state/store';
import { countRailBlocks, railHeight, ResourceRailLayer, type RailAnchor } from './ResourceRailLayer';
import { useZoomPan } from '../components/useZoomPan';
import { Button, ConfirmButton, TextArea } from '../components/controls';
import { ExportPngButton } from '../components/ExportPngButton';
import { ChartToolbar, ZoomControls } from '../components/ChartToolbar';
import { TagBadges } from './TagBadges';
import { fitText, fontOf, wrapText } from '../components/measureText';
import { windowOf } from '../components/ownerWindow';

export function NetworkChart({
  client,
  tasks,
  schedule,
  warnings,
  resourceWarnings,
}: {
  client: Client;
  tasks: Task[];
  schedule: ScheduleResult;
  warnings: Map<Id, Warning[]>;
  resourceWarnings: Map<Id, Warning[]>;
}) {
  const { ui, setUi, commitClient } = useStore();
  const { prefs } = usePreferences();
  const zoom = useZoomPan();
  const svgRef = useRef<SVGSVGElement>(null);

  /** Aufgabe unter dem Zeiger - steuert die beiden "+"-Knöpfe. */
  const [hoveredTask, setHoveredTask] = useState<Id | null>(null);
  /** Aufgaben, die gerade hervorgehoben werden (Kante oder Ressource). */
  const [highlighted, setHighlighted] = useState<Set<Id> | null>(null);

  const layout = useMemo(
    () => layoutNetwork(tasks, (id) => schedule.byId.get(id)?.depth ?? 0),
    [tasks, schedule],
  );

  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const tagById = useMemo(() => new Map(client.tags.map((t) => [t.id, t])), [client.tags]);

  const showRail = prefs.showResourceRail;
  // Die Leiste bricht bei vielen Ressourcen um und wird dadurch hoeher.
  const contentHeight =
    layout.height + (showRail ? railHeight(countRailBlocks(client, tasks), layout.width) : 0);

  /**
   * Automatisch einpassen, solange der Nutzer nicht selbst gezoomt hat.
   * Über einen ResizeObserver, weil die Fläche beim ersten Aufbau und beim
   * Ziehen des Trenners ihre Größe ändert - ein einmaliges Einpassen beim
   * Mounten träfe noch die falschen Maße.
   */
  const { fit, userAdjusted } = zoom;
  const container = zoom.containerRef;
  const lastFit = useRef<string>('');

  useEffect(() => {
    const element = container.current;
    if (!element || userAdjusted) return;

    const apply = () => {
      const box = element.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return;
      const signature = `${Math.round(box.width)}x${Math.round(box.height)}|${layout.width}x${contentHeight}`;
      if (lastFit.current === signature) return;
      lastFit.current = signature;
      fit({ x: 0, y: 0, width: layout.width, height: contentHeight });
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, contentHeight, fit, layout.width, userAdjusted]);

  const pick = ui.pickTarget;

  const onNodeClick = (task: Task) => {
    if (pick) {
      // Im Auswahlmodus: Klick übernimmt die Aufgabe in das aktive Feld.
      const field = pick.field;
      const sourceId = pick.taskId;
      if (task.id === sourceId) return;
      if (field === 'dependsOn' && wouldCreateCycle(client.tasks, sourceId, task.id)) return;
      commitClient(field === 'dependsOn' ? 'Abhängigkeit ergänzt' : 'Parallelität ergänzt', (c) => {
        const target = c.tasks.find((t) => t.id === sourceId);
        if (!target) return;
        const list = target[field];
        if (!list.includes(task.id)) list.push(task.id);
        if (field === 'dependsOn') target.schedule.anchor = 'dependency';
      });
      return;
    }
    setUi({ selectedTaskId: task.id });
  };

  /**
   * Legt über die "+"-Knöpfe eine verkettete Aufgabe an.
   *  - 'before': die neue Aufgabe wird Vorgänger der angeklickten,
   *  - 'after' : die angeklickte wird Vorgänger der neuen.
   * In beiden Fällen wird die abhängige Seite auf den Abhängigkeitsanker
   * gestellt, sonst hätte die Verknüpfung keine terminliche Wirkung.
   */
  const addChained = (task: Task, side: 'before' | 'after') => {
    const created =
      side === 'after'
        ? createFollowUp(task, `${task.title} - Folge`)
        : createPredecessor(task, `Vorgänger von ${task.title}`);

    commitClient(side === 'after' ? 'Folgeaufgabe angelegt' : 'Vorgängeraufgabe angelegt', (c) => {
      c.tasks.push(created);
      if (side === 'before') {
        const target = c.tasks.find((t) => t.id === task.id);
        if (!target) return;
        if (!target.dependsOn.includes(created.id)) target.dependsOn.push(created.id);
        target.schedule.anchor = 'dependency';
      }
    });
    setUi({ selectedTaskId: created.id });
    setHoveredTask(null);
  };

  /**
   * Kennzahl fuer die **relative** Gewichtung (Kosten): der Balken zeigt den
   * Anteil an der teuersten Aufgabe. Die Zeitgewichtung geht einen anderen Weg
   * - siehe `ratioOf`.
   */
  const weightOf = (task: Task): number =>
    prefs.weighting === 'cost' ? task.costs.reduce((s, c) => s + Math.abs(c.amount), 0) : 0;

  /**
   * Fuellstand des Balkens am Knoten, 0..1.
   *
   * Bei "Zeit" ist es der Fortschritt im geplanten Zeitraum - eine Zahl, die
   * fuer sich steht und keinen Vergleich mit anderen Aufgaben braucht. Bei
   * "Kosten" dagegen der Anteil an der teuersten Aufgabe; dort sagt ein
   * absoluter Betrag ohne Bezug nichts.
   */
  const ratioOf = (task: Task): number => {
    if (prefs.weighting === 'none') return 0;
    if (prefs.weighting === 'duration') return taskProgress(task, schedule.byId.get(task.id));
    return weightOf(task) / maxWeight;
  };

  /** Wie viel der geplanten Kosten einer Aufgabe ist bereits abgerufen? */
  const costProgressOf = (task: Task): number | null => {
    const planned = task.costs.reduce((sum, c) => sum + c.amount, 0);
    if (planned <= 0) return null;
    return task.costs.reduce((sum, c) => sum + c.actualAmount, 0) / planned;
  };

  const maxWeight = useMemo(
    () => Math.max(1, ...tasks.map(weightOf)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, prefs.weighting, schedule],
  );

  // Zoomstufe als Ref: der Bewegungs-Handler soll nicht bei jeder Aenderung
  // neu gebaut werden.
  const scaleRef = useRef(zoom.scale);
  scaleRef.current = zoom.scale;
  const drag = useNodeDrag({ scaleRef, commitClient, onDragged: zoom.markAdjusted });
  const noteDrag = useNoteDrag({ scaleRef, commitClient });

  /** Notiz, in der gerade geschrieben wird. */
  const [editingNote, setEditingNote] = useState<Id | null>(null);

  /**
   * Neue Notiz in der Mitte des sichtbaren Ausschnitts - dort, wo man gerade
   * hinsieht. Am Rand der Zeichenfläche wäre sie erst einmal ausserhalb des
   * Bildes und man müsste sie suchen.
   */
  const addNote = () => {
    const box = container.current?.getBoundingClientRect();
    const scale = Math.max(0.01, zoom.scale);
    const x = ((box ? box.width / 2 : 400) - zoom.offsetX) / scale - NOTE_WIDTH / 2;
    const y = ((box ? box.height / 2 : 300) - zoom.offsetY) / scale - NOTE_HEIGHT / 2;
    const note = createNote(x, y);
    /*
     * Anlegen, Schreiben und ein etwaiges Verwerfen tragen denselben
     * Zusammenfassungsschlüssel: eine neue Notiz zu schreiben ist **ein**
     * Schritt im Verlauf, kein Dutzend.
     */
    commitClient('Notiz angelegt', (c) => {
      c.notes.push(note);
    }, { coalesceKey: `note-${note.id}` });
    setEditingNote(note.id);
  };

  /**
   * Leer geschrieben heisst gelöscht - ein eigener Löschknopf entfällt damit.
   *
   * Der Text kommt vom Feld selbst, nicht aus `client`: die Übernahme läuft
   * unmittelbar davor über denselben Zustandswechsel und ist hier noch nicht
   * zu sehen. Ohne Text wird auch nichts committet, sonst gälte die Datei
   * schon als geändert, weil man eine Notiz nur angesehen hat.
   */
  const finishNote = (id: Id, text: string) => {
    setEditingNote(null);
    if (text.trim().length > 0) return;
    commitClient('Notiz gelöscht', (c) => {
      c.notes = c.notes.filter((n) => n.id !== id);
    }, { coalesceKey: `note-${id}` });
  };

  /** Verwirft alle Handverschiebungen und stellt das Auto-Layout wieder her. */
  const resetLayout = () =>
    commitClient('Ansicht zurückgesetzt', (c) => {
      for (const t of c.tasks) delete t.layout;
    });

  if (tasks.length === 0) {
    return (
      <div className="empty">
        <div>Keine Aufgaben in dieser Auswahl.</div>
      </div>
    );
  }

  const anchors: RailAnchor[] = layout.nodes.map((n) => ({
    taskId: n.id,
    x: n.x + n.width / 2,
    y: n.y + n.height,
  }));

  return (
    <div
      className={`viz viz--zoom${zoom.isPanning ? ' viz--panning' : ''}`}
      ref={zoom.containerRef}
      onPointerDown={zoom.onPointerDown}
    >
      {pick && (
        <div className="pickmode">
          <span>
            Auswahlmodus: Aufgabe im Netzplan anklicken, um sie als{' '}
            {pick.field === 'dependsOn' ? 'Vorgänger' : 'parallel laufende Aufgabe'} zu übernehmen.
          </span>
          <button type="button" className="btn btn--sm" onClick={() => setUi({ pickTarget: null })}>
            Fertig (Esc)
          </button>
        </div>
      )}

      {/*
        Bedienelemente stehen oben in der Werkzeugleiste, nicht auf der
        Zeichenflaeche - siehe ChartToolbar. Gerendert werden sie hier, weil
        nur das Diagramm seine Zoomstufe und sein SVG kennt.
      */}
      <ChartToolbar>
        <ZoomControls
          fitTitle="Gesamten Plan wieder einpassen"
          zoom={{
            scale: zoom.scale,
            zoomBy: zoom.zoomBy,
            adjusted: zoom.userAdjusted,
            fit: () => {
              lastFit.current = '';
              zoom.reset();
            },
          }}
        />
        {/*
          Notizen sind eine Eigenheit des Netzplans - im Gantt gibt es keine
          freie Fläche, auf der sie stehen könnten. Deshalb steht der Knopf hier
          und nicht in der Werkzeugleiste der Aufgabenansicht.
        */}
        <Button size="sm" onClick={addNote} title="Freie Notiz auf der Fläche ablegen">
          + Notiz
        </Button>

        {/* Nur sichtbar, wenn es überhaupt etwas zurückzusetzen gibt. */}
        {hasManualLayout(client.tasks) && (
          <ConfirmButton
            size="sm"
            variant="default"
            onConfirm={resetLayout}
            confirmLabel="Wirklich zurücksetzen?"
            title="Alle von Hand verschobenen Aufgaben auf die automatisch berechnete Anordnung zurücksetzen"
          >
            Ansicht zurücksetzen
          </ConfirmButton>
        )}
        <ExportPngButton svgRef={svgRef} namePrefix="mpt-netzplan" />
      </ChartToolbar>

      <svg ref={svgRef} width="100%" height="100%" role="img" aria-label="Netzplan der Aufgaben">
        <defs>
          {/*
            Ein einziger Clip-Pfad genuegt: alle Knoten haben dieselbe Groesse
            (NODE_WIDTH x NODE_HEIGHT).
          */}
          <clipPath id={NODE_CLIP_ID}>
            <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} ry={8} />
          </clipPath>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--border-strong)" />
          </marker>
          <marker id="arrow-critical" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--critical)" />
          </marker>
        </defs>

        <g transform={zoom.transform}>
          {/* Kanten */}
          {layout.edges.map((edge, index) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const criticalEdge =
              prefs.showCriticalPath &&
              edge.kind === 'dependency' &&
              schedule.byId.get(edge.from)?.critical &&
              schedule.byId.get(edge.to)?.critical;
            // Beim Überfahren einer Kante leuchten ihre beiden Enden auf; ohne
            // Hervorhebung gilt weiterhin die Auswahl als schwacher Fokus.
            const lit = highlighted
              ? highlighted.has(edge.from) && highlighted.has(edge.to)
              : !ui.selectedTaskId || ui.selectedTaskId === edge.from || ui.selectedTaskId === edge.to;
            return (
              <path
                key={`${edge.from}-${edge.to}-${index}`}
                d={edge.kind === 'parallel' ? parallelPath(from, to) : edgePath(from, to)}
                className={[
                  'edge',
                  edge.kind === 'parallel' ? 'edge--parallel' : '',
                  criticalEdge ? 'edge--critical' : '',
                  lit ? '' : 'edge--dim',
                  highlighted && lit ? 'edge--lit' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                markerEnd={edge.kind === 'dependency' ? `url(#${criticalEdge ? 'arrow-critical' : 'arrow'})` : undefined}
                onMouseEnter={() => setHighlighted(new Set([edge.from, edge.to]))}
                onMouseLeave={() => setHighlighted(null)}
              >
                <title>
                  {edge.kind === 'dependency'
                    ? `${nodeById.get(edge.from)?.task.title} → ${nodeById.get(edge.to)?.task.title}`
                    : `${nodeById.get(edge.from)?.task.title} läuft parallel zu ${nodeById.get(edge.to)?.task.title}`}
                </title>
              </path>
            );
          })}

          {/*
            Ressourcenleiste VOR den Knoten: ihre Verbindungslinien laufen von
            den oberen Reihen nach unten und wuerden sonst quer ueber die
            Knoten der unteren Reihen gezeichnet.
          */}
          {showRail && (
            <ResourceRailLayer
              client={client}
              tasks={tasks}
              anchors={anchors}
              top={layout.height - 8}
              width={layout.width}
              resourceWarnings={resourceWarnings}
              highlighted={highlighted}
              onHighlight={setHighlighted}
            />
          )}

          {/* Knoten */}
          {layout.nodes.map((node) => (
            <NodeView
              key={node.id}
              node={node}
              schedule={schedule}
              selected={ui.selectedTaskId === node.id}
              dim={Boolean(pick && pick.taskId === node.id) || Boolean(highlighted && !highlighted.has(node.id))}
              lit={Boolean(highlighted?.has(node.id))}
              showCritical={prefs.showCriticalPath}
              warnings={warnings.get(node.id) ?? []}
              tags={node.task.tagIds.map((id) => tagById.get(id)).filter((t): t is NonNullable<typeof t> => Boolean(t))}
              weightRatio={ratioOf(node.task)}
              withTrack={prefs.weighting === 'duration'}
              costProgress={prefs.weighting === 'cost' ? costProgressOf(node.task) : null}
              /* Die "+"-Knöpfe stören im Auswahlmodus nur. */
              showAdders={hoveredTask === node.id && !pick}
              onHover={(hovering) => setHoveredTask(hovering ? node.id : null)}
              onClick={() => onNodeClick(node.task)}
              onZoomTo={() => zoom.focusOn(node)}
              onAdd={(side) => addChained(node.task, side)}
              onDragStart={(event) => drag.start(event, node.task, node)}
            />
          ))}

          {/*
            Notizen zuletzt: sie liegen frei auf der Fläche und sollen nicht
            hinter einem Knoten verschwinden, wenn man sie dorthin zieht.
          */}
          {client.notes.map((note) => (
            <NoteView
              key={note.id}
              note={note}
              editing={editingNote === note.id}
              onEdit={() => setEditingNote(note.id)}
              onChange={(text) =>
                commitClient('Notiz geändert', (c) => {
                  const target = c.notes.find((n) => n.id === note.id);
                  if (target) target.text = text;
                }, { coalesceKey: `note-${note.id}` })
              }
              onDone={(text) => finishNote(note.id, text)}
              onDragStart={(event) => noteDrag.start(event, note)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notizkacheln
// ---------------------------------------------------------------------------

/**
 * Ziehen einer Notiz. Anders als ein Knoten hat sie keine berechnete Position,
 * die als Bezug dient - gespeichert wird deshalb die Lage selbst, nicht ein
 * Versatz.
 */
function useNoteDrag({
  scaleRef,
  commitClient,
}: {
  scaleRef: React.MutableRefObject<number>;
  commitClient: ReturnType<typeof useStore>['commitClient'];
}) {
  const start = (event: React.PointerEvent, note: Note) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    /*
     * Verhindert den Fokuswechsel, den ein Zeigerdruck sonst auslöst. Ohne das
     * verlöre eine gerade angelegte Notiz beim Anfassen der Griffleiste den
     * Fokus - und weil sie noch leer ist, wäre sie damit gelöscht, bevor man
     * sie an ihren Platz schieben konnte.
     */
    event.preventDefault();

    const element = (event.currentTarget as Element).closest('[data-note]');
    const originX = event.clientX;
    const originY = event.clientY;
    let dx = 0;
    let dy = 0;
    let moved = false;
    let frame = 0;

    // Fenster und Bildtakt des angefassten Elements - siehe ownerWindow.ts.
    const view = windowOf(event.currentTarget);

    const paint = () => {
      frame = 0;
      element?.setAttribute('transform', `translate(${note.x + dx},${note.y + dy})`);
    };

    const move = (e: PointerEvent) => {
      const scale = Math.max(0.01, scaleRef.current);
      dx = (e.clientX - originX) / scale;
      dy = (e.clientY - originY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (!frame) frame = view.requestAnimationFrame(paint);
    };

    const end = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      if (frame) view.cancelAnimationFrame(frame);
      if (!moved) return;

      commitClient('Notiz verschoben', (c) => {
        const target = c.notes.find((n) => n.id === note.id);
        if (!target) return;
        target.x = Math.round(note.x + dx);
        target.y = Math.round(note.y + dy);
      });
    };

    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
  };

  return { start };
}

/*
 * Genau so gross wie ein Knoten: Notizen liegen dadurch im selben Raster und
 * ragen nicht in die Ressourcenleiste darunter. Unterschieden werden sie ueber
 * die Farbe, nicht ueber die Form.
 */
const NOTE_WIDTH = NODE_WIDTH;
const NOTE_HEIGHT = NODE_HEIGHT;
/** Griffleiste oben: dort wird gezogen, im Rest wird geschrieben. */
const NOTE_GRIP = 14;
/** Seitlicher Einzug des Textes - in beiden Zustaenden derselbe. */
const NOTE_PADDING = 8;
const NOTE_LINE_HEIGHT = 15;
const NOTE_FONT = '12px';
/** Oberkante der ersten Zeilenschachtel, gemessen vom Kachelrand. */
const NOTE_TEXT_TOP = NOTE_GRIP + 4;
/**
 * Abstand von der Oberkante einer Zeilenschachtel zur Schriftlinie.
 *
 * HTML setzt Text ueber Zeilenhoehe und Schriftmetrik, SVG ueber die
 * Schriftlinie. Ohne diesen Ausgleich stuende der Text beim Bearbeiten tiefer
 * als danach - die Notiz zuckte bei jedem Klick. In Chrome mit Inter 12px auf
 * 15px Zeilenhoehe nachgemessen.
 */
const NOTE_BASELINE = 12;
const NOTE_LINES = Math.floor((NOTE_HEIGHT - NOTE_TEXT_TOP - 2) / NOTE_LINE_HEIGHT);

/**
 * Freie Notiz auf der Fläche.
 *
 * Zwei Zustände statt eines: angezeigt wird sie als SVG-Text, geschrieben wird
 * in einem echten Textfeld (`foreignObject`). Ein dauerhaftes Textfeld wäre
 * einfacher gewesen, käme aber im PNG-Export nicht mit - dort wird das SVG
 * serialisiert, und HTML darin verliert alle Stile.
 *
 * Gezogen wird an der Leiste oben, geschrieben im Feld darunter. Beides am
 * selben Ort ginge nicht: ein Zeigerdruck kann nicht gleichzeitig Textmarke
 * setzen und die Kachel verschieben.
 */
function NoteView({
  note,
  editing,
  onEdit,
  onChange,
  onDone,
  onDragStart,
}: {
  note: Note;
  editing: boolean;
  onEdit: () => void;
  onChange: (text: string) => void;
  /** Bearbeitung beendet - leer heisst gelöscht. */
  onDone: (text: string) => void;
  onDragStart: (event: React.PointerEvent) => void;
}) {
  const lines = useMemo(
    () => wrapText(note.text, NOTE_WIDTH - NOTE_PADDING * 2, fontOf(NOTE_FONT), NOTE_LINES),
    [note.text],
  );

  return (
    <g className="note" transform={`translate(${note.x},${note.y})`} data-note={note.id}>
      <rect className="note__box" width={NOTE_WIDTH} height={NOTE_HEIGHT} rx={6} ry={6} />

      {/* Griffleiste - der einzige Ort, an dem gezogen wird. */}
      <rect
        className="note__grip"
        width={NOTE_WIDTH}
        height={NOTE_GRIP}
        rx={6}
        ry={6}
        onPointerDown={onDragStart}
      >
        <title>Ziehen zum Verschieben</title>
      </rect>

      {editing ? (
        /*
          Genau dort, wo auch der angezeigte Text steht: gleicher Einzug links,
          gleiche Oberkante der ersten Zeile. Das Feld selbst hat deshalb
          keinen Innenabstand (siehe .note__input).
        */
        <foreignObject
          x={NOTE_PADDING}
          y={NOTE_TEXT_TOP}
          width={NOTE_WIDTH - NOTE_PADDING * 2}
          height={NOTE_HEIGHT - NOTE_TEXT_TOP - 2}
          /*
            Der Zeigerdruck bleibt im Feld. Sonst erreicht er die Zeichenfläche
            darunter, die daraufhin zu schieben beginnt - und statt Text zu
            markieren, verschiebt man den ganzen Plan.
          */
          onPointerDown={(e) => e.stopPropagation()}
        >
          <TextArea
            className="note__input"
            autoFocus
            value={note.text}
            placeholder="Notiz… (leer lassen zum Löschen)"
            onChange={onChange}
            /* Leer wird nie zwischengespeichert - siehe onDone. */
            commitIf={(text) => text.trim().length > 0}
            onBlur={onDone}
          />
        </foreignObject>
      ) : (
        <text className="note__text" onClick={onEdit}>
          {lines.map((line, index) => (
            <tspan key={index} x={NOTE_PADDING} y={NOTE_TEXT_TOP + NOTE_BASELINE + index * NOTE_LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
          <title>Klicken zum Bearbeiten</title>
        </text>
      )}

      {/* Auch die leere Fläche unter kurzem Text öffnet die Bearbeitung. */}
      {!editing && (
        <rect
          className="note__hit"
          y={NOTE_GRIP}
          width={NOTE_WIDTH}
          height={NOTE_HEIGHT - NOTE_GRIP}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onEdit}
        />
      )}
    </g>
  );
}

/** Radius der Anlege-Knöpfe an den Knotenkanten. */
const ADDER_RADIUS = 9;

/** Gemeinsamer Clip-Pfad aller Knoten - siehe defs im SVG. */
const NODE_CLIP_ID = 'mpt-node-clip';

function NodeView({
  node,
  schedule,
  selected,
  dim,
  lit,
  showCritical,
  warnings,
  tags,
  weightRatio,
  withTrack,
  costProgress,
  showAdders,
  onHover,
  onClick,
  onZoomTo,
  onAdd,
  onDragStart,
}: {
  node: LayoutNode;
  schedule: ScheduleResult;
  selected: boolean;
  dim: boolean;
  lit: boolean;
  showCritical: boolean;
  warnings: Warning[];
  /** Tags der Aufgabe - als kleine Marken am unteren Rand. */
  tags: { id: Id; name: string; color: string }[];
  weightRatio: number;
  /** Leere Spur hinter dem Balken - nur beim Fortschritt sinnvoll. */
  withTrack: boolean;
  /**
   * Anteil der bereits abgerufenen Kosten (0..1) - nur bei Gewichtung nach
   * Kosten belegt, sonst `null`.
   */
  costProgress: number | null;
  showAdders: boolean;
  onHover: (hovering: boolean) => void;
  onClick: () => void;
  onZoomTo: () => void;
  onAdd: (side: 'before' | 'after') => void;
  onDragStart: (event: React.PointerEvent) => void;
}) {
  const st = schedule.byId.get(node.id);
  const task = node.task;
  const critical = showCritical && st?.critical && !st.openEnded;
  const statusColor = `var(--status-${task.status})`;
  const progress = checklistProgress(task);

  const tooltip = [
    task.milestone ? `${task.title} (Meilenstein)` : task.title,
    `Status: ${TASK_STATUS_LABEL[task.status]}`,
    st ? `${formatDateDe(st.start)} - ${st.openEnded ? 'offen' : formatDateDe(st.end)}` : '',
    st && !st.openEnded ? `Dauer: ${formatDuration(st)} · Puffer: ${st.slack} AT${st.critical ? ' (kritischer Pfad)' : ''}` : '',
    costProgress !== null ? `Kosten abgerufen: ${Math.round(costProgress * 100)} %` : '',
    progress ? `Checkliste: ${progress.done} von ${progress.total} erledigt` : '',
    ...warnings.map((w) => `! ${w.text}`),
    'Doppelklick zoomt heran',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <g
      data-node={node.id}
      className={[
        'node',
        selected ? 'node--selected' : '',
        critical ? 'node--critical' : '',
        task.milestone ? 'node--milestone' : '',
        lit ? 'node--lit' : '',
        dim ? 'node--dim' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      transform={`translate(${node.x},${node.y})`}
      onClick={onClick}
      onPointerDown={onDragStart}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onZoomTo();
      }}
      tabIndex={0}
      role="button"
      aria-label={task.title}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <title>{tooltip}</title>
      {/*
        Reihenfolge ist hier entscheidend: erst die gefuellte Flaeche, dann
        alles Innere geclippt, ganz zuletzt die Umrandung. Der Statusstreifen
        stiess sonst ueber die abgerundete Ecke hinaus und die Umrandung kreuzte
        ihn - genau die unsaubere linke Kante.
      */}
      <rect className="node__fill" width={node.width} height={node.height} rx={8} ry={8} />

      <g clipPath={`url(#${NODE_CLIP_ID})`}>
        {/* Statusstreifen links */}
        <rect className="node__accent" x={0} y={0} width={4} height={node.height} fill={statusColor} />

        {/*
          Balken ganz unten am Rand. Bei "Zeit" ist er ein Fortschrittsbalken
          mit leerer Spur - ohne sie saehe "noch nicht begonnen" aus wie
          "Balken abgeschaltet". Bei "Kosten" zeigt der gefuellte Teil
          zusaetzlich, wie viel davon bereits abgerufen ist - dieselbe Aussage
          wie im Kosten-Editor, nur als Bild.
        */}
        {withTrack && (
          <rect
            x={8}
            y={node.height - 4}
            width={node.width - 16}
            height={3}
            rx={1.5}
            fill="var(--border-strong)"
            opacity={0.4}
          />
        )}
        {(weightRatio > 0 || withTrack) && (
          <>
            <rect
              x={8}
              y={node.height - 4}
              width={(node.width - 16) * Math.min(1, weightRatio)}
              height={3}
              rx={1.5}
              fill="var(--accent)"
              opacity={costProgress === null ? 0.55 : 0.25}
            />
            {costProgress !== null && costProgress > 0 && (
              <rect
                x={8}
                y={node.height - 4}
                width={(node.width - 16) * Math.min(1, weightRatio) * Math.min(1, costProgress)}
                height={3}
                rx={1.5}
                fill="var(--ok)"
              />
            )}
          </>
        )}
      </g>
      {/* Meilensteine tragen die übliche Raute statt des Statuspunkts. */}
      {task.milestone ? (
        <rect x={11} y={11} width={10} height={10} rx={1.5} fill={statusColor} transform="rotate(45 16 16)" />
      ) : (
        <circle cx={16} cy={16} r={4} fill={statusColor} />
      )}
      {/*
        Der Titel wird auf die tatsaechlich verfuegbare Breite gemessen, nicht
        auf eine feste Zeichenzahl gekuerzt: "Freigabe durch Lenkungskreis"
        besteht aus schmalen Buchstaben und passt laenger als "MW-Ausbau WWW".
        Nach Zeichen gezaehlt lief das eine zu frueh ab und das andere ueber
        den Rand hinaus.
      */}
      <text className="node__title" x={TITLE_X} y={TITLE_BASELINE}>
        {fitText(task.title, node.width - TITLE_X - (warnings.length > 0 ? 26 : 12), fontOf(NODE_TITLE_FONT))}
      </text>
      <text className="node__meta" x={12} y={META_BASELINE}>
        {st ? `${formatDateDe(st.start)} → ${st.openEnded ? 'offen' : formatDateDe(st.end)}` : '-'}
      </text>
      {/* Fortschritt aus der Checkliste - nur bei Aufgaben in Arbeit. */}
      {progress && (
        <text className="node__progress" x={node.width - 12} y={META_BASELINE} textAnchor="end">
          <title>{`${progress.done} von ${progress.total} Punkten erledigt`}</title>
          {progress.done}/{progress.total}
        </text>
      )}
      <text className="node__meta" x={12} y={META_BASELINE + META_LINE}>
        {st && !st.openEnded ? formatDuration(st) : 'Dauerläufer'}
        {st && !st.openEnded && st.slack > 0 ? ` · Puffer ${st.slack}` : ''}
        {critical ? ' · kritisch' : ''}
      </text>
      {/*
        Tags als kleine Textmarken mit farbigem Hintergrund - dieselbe Idee wie
        `.badge` in der Oberflaeche: geteilte Farbe fuer Flaeche und Schrift,
        die Flaeche stark abgeschwaecht. So bleibt der Name lesbar, egal wie
        hell oder dunkel die Tag-Farbe ist.
      */}
      <TagBadges tags={tags} y={TAGS_TOP} available={node.width - 24} />

      {warnings.length > 0 && (
        <text x={node.width - 16} y={TITLE_BASELINE} fill="var(--warn)" fontSize={13}>
          &#9888;
        </text>
      )}
      {st?.openEnded && (
        <text x={node.width - 16} y={META_BASELINE + META_LINE} fill="var(--info)" fontSize={11} textAnchor="end">
          ∞
        </text>
      )}

      {/* Umrandung zuletzt, damit sie ueber allem liegt und die Kante sauber ist. */}
      <rect className="node__box" width={node.width} height={node.height} rx={8} ry={8} />

      {/*
        Anlege-Knöpfe. Sie sitzen genau auf der Kante des Knotens, damit beim
        Hinüberfahren keine Lücke entsteht, in der der Zeiger den Knoten
        verlassen und die Knöpfe wieder verschwinden würden.
      */}
      {showAdders && (
        <>
          <AdderButton
            cx={0}
            cy={node.height / 2}
            title={`Vorgänger von "${task.title}" anlegen`}
            onActivate={() => onAdd('before')}
          />
          <AdderButton
            cx={node.width}
            cy={node.height / 2}
            title={`Folgeaufgabe zu "${task.title}" anlegen`}
            onActivate={() => onAdd('after')}
          />
        </>
      )}
    </g>
  );
}

function AdderButton({
  cx,
  cy,
  title,
  onActivate,
}: {
  cx: number;
  cy: number;
  title: string;
  onActivate: () => void;
}) {
  return (
    <g
      className="adder"
      role="button"
      aria-label={title}
      tabIndex={0}
      onClick={(e) => {
        // Sonst würde zusätzlich der Knoten ausgewählt.
        e.stopPropagation();
        onActivate();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      <title>{title}</title>
      <circle className="adder__disc" cx={cx} cy={cy} r={ADDER_RADIUS} />
      <path
        className="adder__plus"
        d={`M ${cx} ${cy - 4.5} V ${cy + 4.5} M ${cx - 4.5} ${cy} H ${cx + 4.5}`}
      />
    </g>
  );
}

/**
 * Ziehen eines Knotens.
 *
 * Gespeichert wird ein **Versatz** gegenüber der berechneten Position, nicht
 * die Position selbst - so bleibt das Auto-Layout wirksam.
 *
 * Wichtig für die Flüssigkeit: während des Ziehens wird **kein** React-Zustand
 * angefasst. Ein `setState` je Mausbewegung würde den gesamten Plan neu
 * rendern - alle Knoten, alle Kanten, die ganze Ressourcenleiste -, und genau
 * das machte das Ziehen zäh. Stattdessen wird das `transform` des gezogenen
 * Knotens direkt am DOM-Element gesetzt, gedrosselt auf einen Bildaufbau.
 * Erst beim Loslassen entsteht ein Commit.
 *
 * Die Zoomstufe muss herausgerechnet werden: eine Mausbewegung von 100 px
 * entspricht bei halber Vergrößerung 200 Zeichen-Einheiten.
 */
function useNodeDrag({
  scaleRef,
  commitClient,
  onDragged,
}: {
  /** Als Ref, damit der Bewegungs-Handler nicht bei jedem Zoom neu entsteht. */
  scaleRef: React.MutableRefObject<number>;
  commitClient: ReturnType<typeof useStore>['commitClient'];
  /** Verhindert, dass sich die Ansicht nach dem Verschieben neu einpasst. */
  onDragged: () => void;
}) {
  const start = (event: React.PointerEvent, task: Task, node: LayoutNode) => {
    if (event.button !== 0) return;
    // Nicht ziehen, wenn ein "+"-Knopf oder ein anderes Bedienelement getroffen wurde.
    if ((event.target as Element).closest('.adder')) return;
    event.stopPropagation();

    const element = (event.currentTarget as SVGGElement) ?? null;
    const base = task.layout ?? { dx: 0, dy: 0 };
    const originX = event.clientX;
    const originY = event.clientY;
    let dx = 0;
    let dy = 0;
    let moved = false;
    let frame = 0;

    /*
     * Fenster des angefassten Knotens - siehe components/ownerWindow.ts. Auch
     * der Bildtakt kommt von dort: verdeckt das ausgelagerte Fenster das
     * Hauptfenster, drosselt der Browser dessen `requestAnimationFrame` bis zum
     * Stillstand, und die Vorschau bliebe unter dem Zeiger stehen.
     */
    const view = windowOf(event.currentTarget);

    const paint = () => {
      frame = 0;
      element?.setAttribute('transform', `translate(${node.x + dx},${node.y + dy})`);
    };

    const move = (e: PointerEvent) => {
      const scale = Math.max(0.01, scaleRef.current);
      dx = (e.clientX - originX) / scale;
      dy = (e.clientY - originY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      // Höchstens ein Neuzeichnen je Bildaufbau.
      if (!frame) frame = view.requestAnimationFrame(paint);
    };

    const end = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      if (frame) view.cancelAnimationFrame(frame);
      if (!moved) return;

      onDragged();
      const nextDx = Math.round(base.dx + dx);
      const nextDy = Math.round(base.dy + dy);
      commitClient('Aufgabe im Netzplan verschoben', (c) => {
        const target = c.tasks.find((t) => t.id === task.id);
        if (!target) return;
        // Versatz null bedeutet "wieder automatisch" - dann das Feld ganz
        // entfernen, damit die Datei sauber bleibt.
        if (nextDx === 0 && nextDy === 0) delete target.layout;
        else target.layout = { dx: nextDx, dy: nextDy };
      });
    };

    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
  };

  return { start };
}

/*
 * Senkrechter Aufbau eines Knotens.
 *
 * Titel, die beiden Metazeilen und die Tag-Marken standen vorher in
 * ungleichen Abstaenden untereinander - der Block wirkte dadurch schief.
 * Diese Konstanten legen einen gleichmaessigen Rhythmus fest: gleicher
 * Abstand ueber dem Titel wie unter den Marken, und zwischen den Gruppen
 * jeweils derselbe Zwischenraum.
 */
/** Linke Kante des Titels - hinter dem Statuspunkt. */
const TITLE_X = 28;
const TITLE_BASELINE = 19;
const META_BASELINE = 37;
const META_LINE = 12;
/**
 * Obere Kante der Markenzeile. Der Abstand zur letzten Metazeile ist derselbe
 * wie zwischen Titel und Metazeilen, und oben wie unten bleibt gleich viel
 * Rand (NODE_HEIGHT ist darauf abgestimmt).
 */
const TAGS_TOP = 58;
const NODE_TITLE_FONT = '600 12px';

