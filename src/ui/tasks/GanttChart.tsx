/**
 * Gantt-Diagramm als SVG.
 *
 * Je Aufgabe ein Balken von früheste Lage bis Ende. Zusätzlich:
 *  - halbtransparente Verlängerung = Unschärfe zwischen optimistischer und
 *    pessimistischer Dauer,
 *  - grauer Balken dahinter = Gesamtpuffer bis zur spätesten Lage,
 *  - rote Umrandung = kritischer Pfad,
 *  - gestrichelte Linie = heute,
 *  - senkrechte Linie = Meilenstein an seinem Enddatum.
 *
 * Ankersymbole an den Balkenenden zeigen, woher ein Termin kommt: eine Raute
 * steht für einen fest gesetzten Termin, ein Winkel für einen aus Vorgängern
 * bzw. aus der Dauer abgeleiteten. Balken mit festem Starttermin lassen sich
 * direkt ziehen - alles andere ergibt sich aus dem Netz und wäre an dieser
 * Stelle nicht sinnvoll verschiebbar.
 *
 * Dauerläufer laufen bis zum Horizont und bleichen dafür nach dem letzten
 * echten Projektende über vier Wochen aus (`runnerFade`).
 */
import { useMemo, useRef, useState } from 'react';
import type { Client, Id, Task } from '../../model/types';
import { checklistProgress, TASK_STATUS_LABEL } from '../../model/types';
import {
  addDays,
  buildBuckets,
  diffDays,
  formatDateDe,
  nextWorkday,
  periodStartOf,
  today,
  type Granularity,
} from '../../engine/dates';
import type { ScheduledTask, ScheduleResult } from '../../engine/schedule';
import type { Warning } from '../../engine/validate';
import { usePreferences } from '../../state/preferences';
import { useStore } from '../../state/store';
import { ExportPngButton } from '../components/ExportPngButton';
import { ChartToolbar, ZoomControls } from '../components/ChartToolbar';
import { useChartZoom } from '../components/useChartZoom';
import { useElementSize } from '../components/useElementSize';
import { formatDuration } from '../../engine/schedule';
import { countRailBlocks, railHeight, ResourceRailLayer } from './ResourceRailLayer';
import { TagBadges } from './TagBadges';
import { fitText, fontOf } from '../components/measureText';

const ROW_HEIGHT = 26;
/** Grenzen der ziehbaren Beschriftungsspalte. */
const MIN_LABEL_WIDTH = 120;
const MAX_LABEL_WIDTH = 560;
const HEADER_HEIGHT = 30;
const PADDING = 12;
const MIN_DAY_WIDTH: Record<string, number> = { day: 22, week: 5.5, month: 1.8, quarter: 0.9, year: 0.4 };
/**
 * Bei Dauerläufern reicht der Zeitraum zehn Jahre in die Zukunft. Ohne Deckel
 * würde ein Tagesraster darüber ein absurd breites SVG erzeugen.
 */
const MAX_CHART_WIDTH = 24000;
/** Über diese Spanne blenden Dauerläufer nach dem Projektende aus. */
const RUNNER_FADE_DAYS = 28;

export function GanttChart({
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
  const { prefs, setPrefs } = usePreferences();
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, prefs.ganttLabelWidth));
  const svgRef = useRef<SVGSVGElement>(null);
  const [highlighted, setHighlighted] = useState<Set<Id> | null>(null);

  const rows = useMemo(
    () =>
      tasks
        .map((task) => ({ task, st: schedule.byId.get(task.id) }))
        .filter((r): r is { task: Task; st: ScheduledTask } => Boolean(r.st))
        .sort((a, b) => diffDays(b.st.start, a.st.start) || a.task.title.localeCompare(b.task.title, 'de')),
    [tasks, schedule],
  );

  /*
   * Gezeichnet wird der volle Zeitraum - Dauerlaeufer laufen zehn Jahre weiter,
   * und wer dorthin scrollt, soll sie auch sehen.
   */
  const { from, to } = useMemo(() => {
    if (rows.length === 0) return { from: schedule.displayStart, to: schedule.horizonEnd };
    let min = rows[0].st.start;
    let max = rows[0].st.end;
    for (const r of rows) {
      if (diffDays(r.st.start, min) > 0) min = r.st.start;
      if (diffDays(max, r.st.lateEnd) > 0) max = r.st.lateEnd;
      if (diffDays(max, r.st.endPessimistic) > 0) max = r.st.endPessimistic;
    }
    // Immer etwas Vorlauf vor heute - siehe `displayStart`.
    if (diffDays(schedule.displayStart, min) > 0) min = schedule.displayStart;
    /*
     * Die Achse beginnt auf einer Rastergrenze. Sonst faengt sie mitten in
     * einer Kalenderwoche an: die erste senkrechte Linie liegt dann irgendwo
     * im Bild statt an der Kante, und ihre Beschriftung ragt links heraus.
     */
    return { from: periodStartOf(min, prefs.ganttGranularity), to: max };
  }, [rows, schedule, prefs.ganttGranularity]);

  /*
   * Fuer die Zoomstufe zaehlt dagegen nur der Teil bis zum Ende der letzten
   * endlichen Aufgabe (plus etwas Luft fuers Unendlichzeichen). Sonst
   * quetschte ein einzelner Dauerlaeufer zehn Jahre in die Breite und das
   * eigentliche Projekt in den linken Rand.
   */
  const focusDays = Math.max(1, diffDays(from, schedule.displayEnd) + 1);

  const totalDays = Math.max(1, diffDays(from, to) + 1);
  /** Grundbreite je Tag beim Zoomfaktor 1. */
  const baseDayWidth = Math.min(
    MIN_DAY_WIDTH[prefs.ganttGranularity] ?? 4,
    Math.max(0.05, MAX_CHART_WIDTH / totalDays),
  );

  /*
   * Zoomstufe: passt sich beim Wechsel von Zeitraster oder Zeitraum
   * automatisch so an, dass das ganze Projekt die Breite ausfuellt.
   */
  const box = useElementSize<HTMLDivElement>();
  const chartZoom = useChartZoom({
    /*
     * Nur die Zeitachse wird gezoomt - die Beschriftungsspalte links und die
     * Innenabstaende bleiben gleich breit. Sie gehoeren deshalb NICHT in
     * `naturalWidth`, sondern werden von der verfuegbaren Breite abgezogen.
     */
    naturalWidth: Math.max(1, focusDays * baseDayWidth),
    availableWidth: Math.max(120, box.width - labelWidth - PADDING * 2 - 2),
    resetKey: `${prefs.ganttGranularity}|${from}|${schedule.displayEnd}|${Math.round(box.width)}`,
  });

  const dayWidth = baseDayWidth * chartZoom.zoom;
  const chartWidth = Math.max(420, totalDays * dayWidth);
  const width = labelWidth + chartWidth + PADDING * 2;
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + PADDING * 2;
  const showRail = prefs.showResourceRail;
  /** Sichtbare Breite - die feste Ebene richtet sich danach, nicht nach dem Inhalt. */
  const viewportWidth = Math.max(320, box.width);
  /*
   * Platz fuer die Ressourcenleiste. Sie bricht bei vielen Ressourcen um und
   * wird dadurch hoeher - die Zeichenflaeche muss das wissen, sonst wird die
   * unterste Reihe abgeschnitten.
   */
  const railBlockCount = countRailBlocks(client, tasks);
  const railSpace = showRail ? railHeight(railBlockCount, viewportWidth, labelWidth + PADDING) : 0;
  const svgHeight = height + railSpace;

  const x = (date: string) => labelWidth + PADDING + diffDays(from, date) * dayWidth;
  const buckets = useMemo(() => buildBuckets(from, to, prefs.ganttGranularity), [from, to, prefs.ganttGranularity]);
  const todayIso = today();
  const tagById = useMemo(() => new Map(client.tags.map((t) => [t.id, t])), [client.tags]);

  const drag = useBarDrag({ dayWidth, granularity: prefs.ganttGranularity, commitClient });
  /*
   * Fester Streifen fuer die Tag-Marken am rechten Rand der Spalte. Er ist
   * fuer alle Zeilen gleich breit, damit die Marken untereinander fluchten -
   * eine je nach Tag-Anzahl wandernde Kante wirkte unruhig. Gibt es nirgends
   * Tags, faellt der Streifen weg und die Titel bekommen die ganze Breite.
   */
  const tagArea = tasks.some((t) => t.tagIds.length > 0)
    ? Math.min(TAG_AREA_MAX, Math.round(labelWidth * 0.42))
    : 0;
  const startResize = useColumnResize(labelWidth, (next) => setPrefs({ ganttLabelWidth: next }));

  /*
   * Die mitgefuehrte Ebene - Beschriftungsspalte und Ressourcenleiste - bleibt
   * ueber `position: sticky` stehen. Das erledigt der Compositor des Browsers;
   * eine selbstgebaute Loesung muesste bei jedem Scrollereignis ein Transform
   * schreiben und liefe dem Scrollen sichtbar hinterher.
   */
  const frozenRef = useRef<SVGSVGElement>(null);

  /*
   * Jede wievielte Rasterbeschriftung gezeichnet wird. Bei schmalen Spalten
   * stuenden sonst "KW 1" und "KW 2" ineinander.
   */
  const bucketWidth = chartWidth / Math.max(1, buckets.length);
  const labelEvery = Math.max(1, Math.ceil(52 / Math.max(1, bucketWidth)));

  if (rows.length === 0) {
    return (
      <div className="empty">
        <div>Keine Aufgaben in dieser Auswahl.</div>
      </div>
    );
  }

  const fadeStart = x(schedule.projectEnd);
  const fadeEnd = x(addDays(schedule.projectEnd, RUNNER_FADE_DAYS));
  const milestones = rows.filter((row) => row.task.milestone && !row.st.openEnded);

  return (
    <div className="viz viz--plain" ref={box.ref}>
      {/* Oben in der Werkzeugleiste statt auf der Flaeche - siehe ChartToolbar. */}
      <ChartToolbar>
        <ZoomControls
          fitTitle="Gesamten Zeitraum wieder über die volle Breite zeigen"
          zoom={{
            scale: chartZoom.zoom,
            zoomBy: chartZoom.zoomBy,
            fit: chartZoom.fit,
            adjusted: chartZoom.userAdjusted,
          }}
        />
        <ExportPngButton svgRef={svgRef} overlayRef={frozenRef} namePrefix="mpt-gantt" />
      </ChartToolbar>

      <div className="gantt" style={{ width }}>
      <svg ref={svgRef} className="gantt__chart" width={width} height={svgHeight} role="img" aria-label="Gantt-Diagramm">
        <defs>
          {/*
            Ausblenden der Dauerläufer: eine Maske, die bis zum Projektende voll
            deckt und danach über vier Wochen auf null läuft. Als Maske statt
            als Verlauf im Balken, damit sie unabhängig von der Balkenfarbe für
            alle Dauerläufer dieselbe bleibt.
          */}
          <linearGradient id="runnerFadeGradient" gradientUnits="userSpaceOnUse" x1={fadeStart} x2={fadeEnd} y1={0} y2={0}>
            <stop offset="0" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="runnerFade" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={svgHeight}>
            <rect x={0} y={0} width={Math.max(0, fadeStart)} height={svgHeight} fill="#fff" />
            <rect
              x={Math.max(0, fadeStart)}
              y={0}
              width={Math.max(0, fadeEnd - fadeStart)}
              height={svgHeight}
              fill="url(#runnerFadeGradient)"
            />
          </mask>
        </defs>

        {/*
          Raster. Die Beschriftung wird ausgeduennt: bei schmalen Spalten
          stuenden "KW 1", "KW 2", "KW 3" sonst ineinander und ergaeben einen
          unlesbaren Streifen. Gezeichnet wird jede n-te, sodass zwischen zwei
          Beschriftungen immer Platz bleibt.
        */}
        {buckets.map((bucket, index) => (
          <g key={bucket.key}>
            <line
              className="gantt__grid"
              x1={x(bucket.start)}
              y1={HEADER_HEIGHT}
              x2={x(bucket.start)}
              y2={height - PADDING}
            />
            {index % labelEvery === 0 && (
              <text className="gantt__tick" x={x(bucket.start) + 4} y={HEADER_HEIGHT - 9}>
                {bucket.label}
              </text>
            )}
          </g>
        ))}

        <line
          className="gantt__grid gantt__grid--strong"
          x1={labelWidth + PADDING}
          y1={HEADER_HEIGHT}
          x2={width - PADDING}
          y2={HEADER_HEIGHT}
        />

        {/* Meilensteinlinien liegen unter den Balken, damit sie nicht stören. */}
        {milestones.map((row) => (
          <g key={`ms-${row.task.id}`} className="gantt__milestone">
            <line x1={x(row.st.end) + dayWidth} y1={HEADER_HEIGHT} x2={x(row.st.end) + dayWidth} y2={height - PADDING} />
            <title>{`Meilenstein: ${row.task.title} · ${formatDateDe(row.st.end)}`}</title>
          </g>
        ))}

        {diffDays(from, todayIso) >= 0 && diffDays(todayIso, to) >= 0 && (
          <line className="gantt__today" x1={x(todayIso)} y1={HEADER_HEIGHT - 4} x2={x(todayIso)} y2={height - PADDING} />
        )}

        {rows.map((row, index) => {
          const st = row.st;
          const y = HEADER_HEIGHT + index * ROW_HEIGHT + PADDING;
          const selected = ui.selectedTaskId === row.task.id;
          const critical = prefs.showCriticalPath && st.critical && !st.openEnded;
          /*
            Balken tragen die Statusfarbe - genau wie die Knoten im Netzplan.
            Die Tagfarbe hier zu verwenden hiess, zwei verschiedene Aussagen in
            dieselbe Farbe zu packen; die Tags stehen deshalb als Marken in der
            Beschriftungsspalte.
          */
          const fill = `var(--status-${row.task.status})`;
          const rowWarnings = warnings.get(row.task.id) ?? [];
          const progress = checklistProgress(row.task);
          const dimmed = Boolean(highlighted && !highlighted.has(row.task.id));

          // Verschiebung wirkt sofort optisch; festgeschrieben wird sie schon
          // beim Ziehen (siehe useBarDrag), der Versatz gleicht nur die
          // Verzögerung bis zur Neuberechnung aus.
          const offset = drag.offsetFor(row.task.id);
          const barX = x(st.start) + offset;
          const barEnd = x(st.end) + dayWidth + offset;
          const uncertainEnd = x(st.endPessimistic) + dayWidth + offset;
          const slackEnd = x(st.lateEnd) + dayWidth + offset;
          const movable = row.task.schedule.anchor === 'date';

          const tooltip = [
            row.task.milestone ? `${row.task.title} (Meilenstein)` : row.task.title,
            `Status: ${TASK_STATUS_LABEL[row.task.status]}`,
            `${formatDateDe(st.start)} - ${st.openEnded ? 'offen' : formatDateDe(st.end)} (${formatDuration(st)})`,
            st.openEnded ? 'Dauerläufer ohne Enddatum' : `Puffer: ${st.slack} AT${st.critical ? ' - kritischer Pfad' : ''}`,
            st.endOptimistic !== st.endPessimistic
              ? `Unschärfe: ${formatDateDe(st.endOptimistic)} - ${formatDateDe(st.endPessimistic)}`
              : '',
            `Start: ${movable ? 'festes Datum (ziehbar)' : 'ergibt sich aus den Vorgängern'}`,
            st.openEnded
              ? 'Ende: keines'
              : `Ende: ${row.task.schedule.end ? 'fest gesetzt' : 'ergibt sich aus der Dauer'}`,
            progress ? `Checkliste: ${progress.done} von ${progress.total} erledigt` : '',
            ...rowWarnings.map((w) => `! ${w.text}`),
          ]
            .filter(Boolean)
            .join('\n');

          return (
            <g
              key={row.task.id}
              className={`gantt__row${dimmed ? ' gantt__row--dim' : ''}`}
              onClick={() => setUi({ selectedTaskId: row.task.id })}
              style={{ cursor: 'pointer' }}
            >
              <title>{tooltip}</title>
              <rect
                className="gantt__bg"
                x={0}
                y={y - 3}
                width={width}
                height={ROW_HEIGHT}
                fill={selected ? 'var(--accent-soft)' : 'transparent'}
              />

              {/* Puffer */}
              {!st.openEnded && st.slack > 0 && slackEnd > barEnd && (
                <rect
                  className="gantt__bar gantt__bar--slack"
                  rx={4}
                  x={barEnd}
                  y={y + 4}
                  width={Math.max(2, slackEnd - barEnd)}
                  height={ROW_HEIGHT - 12}
                />
              )}

              {/* Unschärfe zwischen min und max Dauer */}
              {!st.openEnded && uncertainEnd > barEnd && (
                <rect
                  className="gantt__bar gantt__bar--uncertain"
                  rx={4}
                  x={barEnd}
                  y={y + 2}
                  width={Math.max(2, uncertainEnd - barEnd)}
                  height={ROW_HEIGHT - 8}
                  fill={fill}
                />
              )}

              {/* Hauptbalken */}
              <rect
                className={`gantt__bar${movable ? ' gantt__bar--movable' : ''}`}
                rx={4}
                x={barX}
                y={y + 2}
                width={Math.max(3, (st.openEnded ? x(to) + dayWidth : barEnd) - barX)}
                height={ROW_HEIGHT - 8}
                fill={fill}
                opacity={row.task.status === 'done' ? 0.55 : 1}
                stroke={critical ? 'var(--critical)' : selected ? 'var(--accent)' : 'transparent'}
                strokeWidth={critical || selected ? 2 : 0}
                mask={st.openEnded ? 'url(#runnerFade)' : undefined}
                onPointerDown={movable ? (event) => drag.start(event, row.task) : undefined}
              />

              {/* Ankersymbole: woher kommen Start und Ende? */}
              <AnchorMark x={barX} y={y + ROW_HEIGHT / 2 - 2} fixed={movable} side="start" />
              {!st.openEnded && (
                <AnchorMark x={barEnd} y={y + ROW_HEIGHT / 2 - 2} fixed={Boolean(row.task.schedule.end)} side="end" />
              )}

              {/* Meilenstein-Raute am Enddatum */}
              {row.task.milestone && !st.openEnded && (
                <rect
                  className="gantt__milestone-mark"
                  x={barEnd - 5}
                  y={y + ROW_HEIGHT / 2 - 7}
                  width={10}
                  height={10}
                  transform={`rotate(45 ${barEnd} ${y + ROW_HEIGHT / 2 - 2})`}
                />
              )}

              {st.openEnded && (
                <text x={fadeEnd + 4} y={y + 14} className="gantt__tick" fill="var(--info)">
                  ∞
                </text>
              )}

              {/*
                Fortschritt aus der Checkliste, direkt hinter dem Balken - nur
                bei Aufgaben in Arbeit und nur, wenn es Punkte gibt.
              */}
              {progress && !st.openEnded && (
                <text className="node__progress" x={barEnd + 6} y={y + 14}>
                  {progress.done}/{progress.total}
                </text>
              )}
            </g>
          );
        })}

      </svg>

      {/*
        Mitgefuehrte Ebene: bleibt am linken Rand stehen, waehrend die Balken
        darunter wandern. `pointer-events` ist am Wurzelelement abgeschaltet und
        nur an den bedienbaren Teilen wieder an - sonst faenge diese Flaeche
        alle Klicks ab, die eigentlich den Balken gelten.
      */}
      <svg
        ref={frozenRef}
        className="gantt__frozen"
        width={viewportWidth}
        height={svgHeight}
        style={{ marginTop: -svgHeight }}
        aria-hidden="true"
      >
        {/*
          Ressourcenleiste. Ihre Verbindungslinien haengen an der
          **Beschriftungsspalte** und nicht am Balken: der Balken wandert beim
          Scrollen, die Leiste nicht - eine Kurve zwischen beiden zeigte danach
          ins Leere. Die Bloecke beginnen erst hinter der Spalte, sonst liefen
          die Linien nach links unter sie und waeren dort verdeckt.
        */}
        {showRail && (
          <g>
            <rect className="gantt__frozen-bg" x={0} y={height - PADDING} width={viewportWidth} height={railSpace} />
            <ResourceRailLayer
              client={client}
              tasks={tasks}
              anchors={rows.map((row, index) => ({
                taskId: row.task.id,
                x: labelWidth + PADDING,
                y: HEADER_HEIGHT + index * ROW_HEIGHT + PADDING + ROW_HEIGHT - 10,
              }))}
              top={height - PADDING}
              width={viewportWidth}
              offsetX={labelWidth + PADDING}
              resourceWarnings={resourceWarnings}
              highlighted={highlighted}
              onHighlight={setHighlighted}
            />
          </g>
        )}

        {/*
          Beschriftungsspalte. Zuletzt gezeichnet und mitgefuehrt: sie liegt
          damit ueber den Balken und bleibt beim Scrollen stehen - nur die
          Balken wandern. Die undurchsichtige Flaeche darunter ist noetig,
          weil die Balken sonst durch die Titel hindurchliefen.
        */}
        <g>
          <rect className="gantt__frozen-bg" x={0} y={0} width={labelWidth + PADDING} height={height} />
          {rows.map((row, index) => {
            const y = HEADER_HEIGHT + index * ROW_HEIGHT + PADDING;
            const selected = ui.selectedTaskId === row.task.id;
            const rowWarnings = warnings.get(row.task.id) ?? [];
            const dimmed = Boolean(highlighted && !highlighted.has(row.task.id));
            const tags = row.task.tagIds
              .map((id) => tagById.get(id))
              .filter((t): t is NonNullable<typeof t> => Boolean(t));

            return (
              <g
                key={row.task.id}
                className={`gantt__row${dimmed ? ' gantt__row--dim' : ''}`}
                onClick={() => setUi({ selectedTaskId: row.task.id })}
                style={{ cursor: 'pointer' }}
              >
                <title>{row.task.title}</title>
                <rect
                  className="gantt__bg"
                  x={0}
                  y={y - 3}
                  width={labelWidth + PADDING}
                  height={ROW_HEIGHT}
                  fill={selected ? 'var(--accent-soft)' : 'transparent'}
                />
                {/*
                  Titel links, Tag-Marken rechtsbuendig daneben - dieselbe
                  Darstellung wie im Netzplan. Wieviel vom Titel passt, haengt
                  von der gezogenen Spaltenbreite ab und wird gemessen.
                */}
                <text className="gantt__label" x={PADDING} y={y + 13} fontWeight={selected ? 650 : 400}>
                  {rowWarnings.length > 0 ? '⚠ ' : ''}
                  {row.task.milestone ? '◆ ' : ''}
                  {fitText(
                    row.task.title,
                    labelWidth - PADDING * 2 - tagArea - (rowWarnings.length > 0 ? 14 : 0) - (row.task.milestone ? 12 : 0),
                    fontOf(GANTT_LABEL_FONT),
                  )}
                </text>
                {tags.length > 0 && (
                  <TagBadges tags={tags} y={y + 3} available={tagArea - 4} startX={labelWidth - PADDING - tagArea + 4} />
                )}
              </g>
            );
          })}

          {/*
            Ziehgriff der Spalte gehoert an ihre Kante - also ebenfalls in die
            mitgefuehrte Ebene.
          */}
          <rect
            className="gantt__resize"
            x={labelWidth + PADDING - 3}
            y={0}
            width={6}
            height={height}
            onPointerDown={startResize}
          >
            <title>Spaltenbreite ziehen</title>
          </rect>
          <line
            className="gantt__grid gantt__grid--strong"
            x1={labelWidth + PADDING}
            y1={0}
            x2={labelWidth + PADDING}
            y2={height - PADDING}
          />
        </g>
      </svg>
      </div>
    </div>
  );
}

/**
 * Kleines Symbol an einem Balkenende.
 *  - `fixed`: gefüllte Raute - der Termin steht fest (Datum eingetragen).
 *  - sonst  : offener Winkel - der Termin ergibt sich aus Vorgängern bzw. Dauer.
 */
function AnchorMark({ x, y, fixed, side }: { x: number; y: number; fixed: boolean; side: 'start' | 'end' }) {
  if (fixed) {
    return (
      <rect className="gantt__anchor gantt__anchor--fixed" x={x - 3} y={y - 3} width={6} height={6} transform={`rotate(45 ${x} ${y})`}>
        <title>{side === 'start' ? 'Start fest gesetzt' : 'Ende fest gesetzt'}</title>
      </rect>
    );
  }
  const direction = side === 'start' ? 1 : -1;
  return (
    <path
      className="gantt__anchor"
      d={`M ${x} ${y - 4} L ${x + direction * 4} ${y} L ${x} ${y + 4}`}
    >
      <title>{side === 'start' ? 'Start ergibt sich aus den Vorgängern' : 'Ende ergibt sich aus der Dauer'}</title>
    </path>
  );
}

/**
 * Ziehen eines Balkens mit festem Starttermin.
 *
 * Beim Ziehen wird der neue Start sofort festgeschrieben - so wandern
 * Nachfolger, kritischer Pfad und Ressourcenkurven live mit. Alle Schritte
 * einer Bewegung teilen sich denselben `coalesceKey` und ergeben daher genau
 * einen Undo-Schritt.
 */
function useBarDrag({
  dayWidth,
  granularity,
  commitClient,
}: {
  dayWidth: number;
  /** Aktuelles Zeitraster - der Balken rastet auf dessen Grenzen ein. */
  granularity: Granularity;
  commitClient: ReturnType<typeof useStore>['commitClient'];
}) {
  const [state, setState] = useState<{ taskId: Id; pixels: number } | null>(null);
  const origin = useRef<{ x: number; start: string; end?: string; applied: number } | null>(null);

  const start = (event: React.PointerEvent<SVGRectElement>, task: Task) => {
    if (!task.schedule.start) return;
    event.stopPropagation();
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, start: task.schedule.start, end: task.schedule.end, applied: 0 };
    setState({ taskId: task.id, pixels: 0 });

    const move = (e: PointerEvent) => {
      const base = origin.current;
      if (!base) return;
      const pixels = e.clientX - base.x;
      /*
       * Eingerastet wird auf das gewaehlte Zeitraster: im Monatsraster
       * springt der Balken von Monatsanfang zu Monatsanfang. Wer taggenau
       * schieben will, stellt das Raster auf Woche - dann bleibt der
       * Wochenmontag die feinste Stufe. Ohne Einrasten landen Termine bei
       * grobem Raster irgendwo mitten im Monat, obwohl man optisch eine
       * Spalte weit gezogen hat.
       */
      const rawDays = Math.round(pixels / Math.max(0.05, dayWidth));
      const snapped = periodStartOf(addDays(base.start, rawDays), granularity);
      const days = diffDays(base.start, snapped);
      setState({ taskId: task.id, pixels });
      if (days === base.applied) return;
      base.applied = days;
      commitClient(
        'Aufgabe verschoben',
        (c) => {
          const target = c.tasks.find((t) => t.id === task.id);
          if (!target) return;
          target.schedule.start = nextWorkday(addDays(base.start, days));
          // Ein fest gesetztes Ende wandert mit, damit die Dauer erhalten bleibt.
          if (base.end) target.schedule.end = addDays(base.end, days);
        },
        { coalesceKey: `gantt-drag-${task.id}`, checkpoint: false },
      );
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      origin.current = null;
      setState(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  /**
   * Rest-Versatz in Pixeln: die Aufgabe ist bereits auf ganze Tage gesetzt,
   * der Balken folgt aber dem Zeiger, damit das Ziehen nicht ruckelt.
   */
  const offsetFor = (taskId: Id): number => {
    if (!state || state.taskId !== taskId || !origin.current) return 0;
    return state.pixels - origin.current.applied * dayWidth;
  };

  return { start, offsetFor };
}

/**
 * Ziehen der Beschriftungsspalte.
 *
 * Die Breite liegt in den Ansichtseinstellungen und wird waehrend des Ziehens
 * fortlaufend gesetzt - sie beeinflusst nur das Layout, keinen Datenbestand.
 */
function useColumnResize(current: number, apply: (width: number) => void) {
  const origin = useRef<{ x: number; width: number } | null>(null);

  return (event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    event.preventDefault();
    origin.current = { x: event.clientX, width: current };

    const move = (e: PointerEvent) => {
      const base = origin.current;
      if (!base) return;
      apply(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, base.width + (e.clientX - base.x))));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      origin.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
}

/** Breitester zulaessiger Markenstreifen - darueber bliebe zu wenig Titel. */
const TAG_AREA_MAX = 132;
const GANTT_LABEL_FONT = '11px';
