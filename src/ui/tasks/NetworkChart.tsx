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
import type { Client, Id, Task } from '../../model/types';
import { TASK_STATUS_LABEL } from '../../model/types';
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
import { wouldCreateCycle, type ScheduleResult } from '../../engine/schedule';
import type { Warning } from '../../engine/validate';
import { createFollowUp, createPredecessor } from '../../model/factory';
import { usePreferences } from '../../state/preferences';
import { useStore } from '../../state/store';
import { RAIL_HEIGHT, ResourceRailLayer, type RailAnchor } from './ResourceRailLayer';
import { useZoomPan } from '../components/useZoomPan';
import { Button, ConfirmButton } from '../components/controls';
import { ExportPngButton } from '../components/ExportPngButton';
import { TagBadges } from './TagBadges';

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
  const contentHeight = layout.height + (showRail ? RAIL_HEIGHT : 0);

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

  /** Gewichtung: Balken am Knoten variiert nach gewählter Kennzahl. */
  const weightOf = (task: Task): number => {
    const st = schedule.byId.get(task.id);
    switch (prefs.weighting) {
      case 'duration':
        return st?.duration ?? 1;
      case 'cost':
        return task.costs.reduce((s, c) => s + Math.abs(c.amount), 0);
      case 'people':
        return task.assignments.reduce((s, a) => s + (a.mode === 'FTE' ? a.value * 20 : a.value), 0);
      default:
        return 0;
    }
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

  const focusSelected = () => {
    const node = ui.selectedTaskId ? nodeById.get(ui.selectedTaskId) : undefined;
    if (node) zoom.focusOn(node);
  };

  // Zoomstufe als Ref: der Bewegungs-Handler soll nicht bei jeder Aenderung
  // neu gebaut werden.
  const scaleRef = useRef(zoom.scale);
  scaleRef.current = zoom.scale;
  const drag = useNodeDrag({ scaleRef, commitClient, onDragged: zoom.markAdjusted });

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

      {/* Zoom-Steuerung */}
      <div className="viz__controls">
        <Button size="sm" icon onClick={() => zoom.zoomBy(1 / 1.25)} title="Herauszoomen">
          &minus;
        </Button>
        <span className="viz__zoomlevel mono" title="Aktueller Zoom">
          {Math.round(zoom.scale * 100)}%
        </span>
        <Button size="sm" icon onClick={() => zoom.zoomBy(1.25)} title="Hineinzoomen">
          +
        </Button>
        <Button
          size="sm"
          onClick={() => {
            lastFit.current = '';
            zoom.reset();
          }}
          title="Gesamten Plan wieder einpassen"
        >
          Einpassen
        </Button>
        <Button
          size="sm"
          disabled={!ui.selectedTaskId || !nodeById.has(ui.selectedTaskId)}
          onClick={focusSelected}
          title="Auf die gewählte Aufgabe zoomen (auch per Doppelklick auf einen Knoten)"
        >
          Auf Auswahl
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
      </div>

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
              weightRatio={prefs.weighting === 'none' ? 0 : weightOf(node.task) / maxWeight}
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

        </g>
      </svg>
    </div>
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

  const tooltip = [
    task.milestone ? `${task.title} (Meilenstein)` : task.title,
    `Status: ${TASK_STATUS_LABEL[task.status]}`,
    st ? `${formatDateDe(st.start)} - ${st.openEnded ? 'offen' : formatDateDe(st.end)}` : '',
    st && !st.openEnded ? `Dauer: ${st.duration} AT · Puffer: ${st.slack} AT${st.critical ? ' (kritischer Pfad)' : ''}` : '',
    costProgress !== null ? `Kosten abgerufen: ${Math.round(costProgress * 100)} %` : '',
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
          Gewichtungsbalken ganz unten am Rand. Bei der Gewichtung nach Kosten
          zeigt der gefuellte Teil zusaetzlich, wie viel davon bereits
          abgerufen ist - dieselbe Aussage wie im Kosten-Editor, nur als Bild.
        */}
        {weightRatio > 0 && (
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
      <text className="node__title" x={26} y={20}>
        {truncate(task.title, 25)}
      </text>
      <text className="node__meta" x={12} y={38}>
        {st ? `${formatDateDe(st.start)} → ${st.openEnded ? 'offen' : formatDateDe(st.end)}` : '-'}
      </text>
      <text className="node__meta" x={12} y={47}>
        {st && !st.openEnded ? `${st.duration} AT` : 'Dauerläufer'}
        {st && !st.openEnded && st.slack > 0 ? ` · Puffer ${st.slack}` : ''}
        {critical ? ' · kritisch' : ''}
      </text>
      {/*
        Tags als kleine Textmarken mit farbigem Hintergrund - dieselbe Idee wie
        `.badge` in der Oberflaeche: geteilte Farbe fuer Flaeche und Schrift,
        die Flaeche stark abgeschwaecht. So bleibt der Name lesbar, egal wie
        hell oder dunkel die Tag-Farbe ist.
      */}
      <TagBadges tags={tags} y={node.height - 17} available={node.width - 24} />

      {warnings.length > 0 && (
        <text x={node.width - 16} y={20} fill="var(--warn)" fontSize={13}>
          &#9888;
        </text>
      )}
      {st?.openEnded && (
        <text x={node.width - 16} y={47} fill="var(--info)" fontSize={11} textAnchor="end">
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
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      if (frame) cancelAnimationFrame(frame);
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

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  return { start };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
