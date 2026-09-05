/**
 * Eine Personalzuordnung zum Bearbeiten.
 *
 * Wie bei den Kosten lässt sich dieselbe Zuordnung von zwei Seiten betrachten:
 * von der Aufgabe aus ("wen binde ich hier?") und von der Person aus ("woran
 * hänge ich eigentlich?"). Beide Richtungen zeigen und ändern dieselben
 * Felder, deshalb gibt es sie hier genau einmal - zwei Abschriften wären auf
 * Dauer garantiert auseinandergelaufen.
 *
 * Aufbau wie in `CostFields`: oben das Gegenstück der Zuordnung, darunter der
 * Grundwert und optional abweichende Bedarfe je Zeitraum.
 */
import type { IsoDate, PersonAssignment } from '../../model/types';
import { createPeriodValue } from '../../model/factory';
import { Button, NumberSlider, Segmented } from './controls';
import { PeriodPicker, periodBounds } from './PeriodPicker';

/** Obergrenze des Reglers - eine Person kann höchstens eine ganze Stelle sein. */
function sliderMax(mode: PersonAssignment['mode']): number {
  return mode === 'FTE' ? 1 : 200;
}

function sliderStep(mode: PersonAssignment['mode']): number {
  return mode === 'FTE' ? 0.1 : 1;
}

export function AssignmentFields({
  assignment,
  caption,
  taskStart,
  taskWorkdays,
  onEdit,
  onRemove,
}: {
  assignment: PersonAssignment;
  /** Gegenstück der Zuordnung: Personenname bzw. Aufgabentitel. */
  caption: string;
  /** Aufgabenstart - Vorschlag für einen neuen Bedarfszeitraum. */
  taskStart?: IsoDate;
  /** Laufzeit der Aufgabe in Arbeitstagen - für die Umrechnung PT <-> FTE. */
  taskWorkdays: number;
  onEdit: (label: string, recipe: (assignment: PersonAssignment) => void, coalesceKey?: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="line-item">
      <div className="col">
        <div className="line-item__caption truncate">{caption}</div>

        <div className="line-item__controls">
          <Segmented
            value={assignment.mode}
            onChange={(mode) =>
              onEdit('Bindungsart geändert', (a) => {
                // Beim Wechsel den Wert sinnvoll umrechnen.
                const days = Math.max(1, taskWorkdays);
                if (mode === 'PT' && a.mode === 'FTE') a.value = Math.round(a.value * days * 10) / 10;
                if (mode === 'FTE' && a.mode === 'PT') a.value = Math.round((a.value / days) * 100) / 100;
                a.mode = mode as 'PT' | 'FTE';
              })
            }
            options={[
              { value: 'FTE', label: 'FTE', title: 'Anteil pro Woche (0..1)' },
              { value: 'PT', label: 'PT', title: 'Personentage gesamt' },
            ]}
          />
          <div style={{ minWidth: 190, flex: 1 }}>
            <NumberSlider
              min={0}
              max={sliderMax(assignment.mode)}
              step={sliderStep(assignment.mode)}
              value={assignment.value}
              onChange={(value) =>
                onEdit('Aufwand geändert', (a) => { a.value = value; }, `asg-${assignment.id}`)
              }
            />
          </div>
        </div>

        {/*
          Abweichende Bedarfe je Zeitraum. Ohne Eintrag gilt der Grundwert oben
          für die ganze Aufgabe - der Normalfall bleibt also ein einziger Regler.
        */}
        {assignment.periods.map((period) => (
          <div key={period.id} className="row row--wrap subperiod">
            <PeriodPicker
              from={period.from}
              to={period.to}
              onChange={(from, to) =>
                onEdit('Bedarfszeitraum geändert', (a) => {
                  const p = a.periods.find((x) => x.id === period.id);
                  if (p) {
                    p.from = from;
                    p.to = to;
                  }
                })
              }
            />
            <div style={{ minWidth: 140, flex: 1 }}>
              <NumberSlider
                min={0}
                max={sliderMax(assignment.mode)}
                step={sliderStep(assignment.mode)}
                value={period.value}
                suffix={assignment.mode}
                onChange={(value) =>
                  onEdit('Bedarfszeitraum geändert', (a) => {
                    const p = a.periods.find((x) => x.id === period.id);
                    if (p) p.value = value;
                  }, `per-${period.id}`)
                }
              />
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon
              title="Zeitraum entfernen"
              onClick={() =>
                onEdit('Bedarfszeitraum entfernt', (a) => {
                  a.periods = a.periods.filter((x) => x.id !== period.id);
                })
              }
            >
              &times;
            </Button>
          </div>
        ))}

        <Button
          size="sm"
          variant="ghost"
          title="Abweichenden Bedarf für einen Zeitraum festlegen"
          onClick={() =>
            onEdit('Bedarfszeitraum ergänzt', (a) => {
              const bounds = defaultPeriodFor(taskStart);
              a.periods.push(createPeriodValue(a.value, bounds.from, bounds.to));
            })
          }
        >
          + Zeitraum
        </Button>
      </div>

      <Button variant="ghost" icon title="Zuordnung entfernen" onClick={onRemove}>
        &times;
      </Button>
    </div>
  );
}

/** Vorschlag für einen neuen Bedarfszeitraum: das Quartal des Aufgabenstarts. */
export function defaultPeriodFor(start?: IsoDate): { from: IsoDate; to: IsoDate } {
  const iso = start ?? new Date().toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const quarter = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;
  return periodBounds(year, quarter);
}
