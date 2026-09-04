/**
 * Eine Kostenposition zum Bearbeiten.
 *
 * Dieselbe Zuordnung lässt sich von zwei Seiten betrachten: von der Aufgabe
 * aus ("welche Budgets belaste ich?") und vom Budget aus ("welche Aufgaben
 * zehren an mir?"). Beide Richtungen zeigen und ändern dieselben Felder,
 * deshalb gibt es sie hier genau einmal - zwei Abschriften wären auf Dauer
 * garantiert auseinandergelaufen.
 *
 * Geplant und abgerufen stehen nebeneinander: der Schieber legt den geplanten
 * Betrag anteilig auf den Abruf um (0-100 %), das Feld daneben nimmt einen
 * genauen Euro-Betrag entgegen. Beides schreibt auf dasselbe Feld.
 */
import { COST_INTERVAL_LABEL, type CostInterval, type CostItem } from '../../model/types';
import { AmountInput, Button, NumberSlider, Switch, TextInput } from './controls';

/** Anteil des geplanten Betrags, der bereits abgerufen ist. */
function spentPercent(cost: CostItem): number {
  if (cost.amount <= 0) return 0;
  return Math.round((cost.actualAmount / cost.amount) * 100);
}

export function CostFields({
  cost,
  caption,
  onEdit,
  onRemove,
}: {
  cost: CostItem;
  /** Gegenstück der Zuordnung: Budgetname bzw. Aufgabentitel. */
  caption: string;
  /** Ändert genau diese Kostenposition. */
  onEdit: (label: string, recipe: (cost: CostItem) => void, coalesceKey?: string) => void;
  onRemove: () => void;
}) {
  const percent = spentPercent(cost);

  return (
    <div className="line-item">
      <div className="col">
        <div className="line-item__caption truncate">{caption}</div>

        <TextInput
          value={cost.label}
          placeholder="Bezeichnung"
          onChange={(label) =>
            onEdit('Kostenposition bearbeitet', (c) => { c.label = label; }, `cost-label-${cost.id}`)
          }
        />

        <div className="line-item__controls">
          <label className="costfield">
            <span className="costfield__label">geplant</span>
            <AmountInput
              value={cost.amount}
              onChange={(amount) =>
                onEdit('Betrag geändert', (c) => { c.amount = amount; }, `cost-amount-${cost.id}`)
              }
            />
          </label>

          <label className="costfield">
            <span className="costfield__label">abgerufen</span>
            <AmountInput
              value={cost.actualAmount}
              onChange={(actualAmount) =>
                onEdit('Abruf geändert', (c) => { c.actualAmount = actualAmount; }, `cost-actual-${cost.id}`)
              }
            />
          </label>
        </div>

        {/* Schieber legt den geplanten Betrag anteilig auf den Abruf um. */}
        <div className="costfield costfield--slider" title="Anteil des geplanten Betrags, der bereits abgerufen ist">
          <span className="costfield__label">Anteil</span>
          <NumberSlider
            compact
            min={0}
            max={100}
            step={5}
            value={percent}
            format={(v) => `${v} %`}
            onChange={(value) =>
              onEdit('Abruf geändert', (c) => { c.actualAmount = Math.round((c.amount * value) / 100); }, `cost-pct-${cost.id}`)
            }
          />
        </div>

        <div className="line-item__controls">
          <Switch
            checked={cost.recurring}
            label="wiederkehrend"
            onChange={(recurring) => onEdit('Kostenart geändert', (c) => { c.recurring = recurring; })}
          />
          {cost.recurring && (
            <div className="row">
              <span className="faint">alle</span>
              <input
                className="input input--num"
                style={{ width: 56 }}
                type="number"
                min={1}
                value={cost.every}
                onChange={(e) =>
                  onEdit('Intervall geändert', (c) => { c.every = Math.max(1, Number(e.target.value) || 1); }, `cost-every-${cost.id}`)
                }
              />
              <select
                className="select"
                style={{ width: 118 }}
                value={cost.interval}
                onChange={(e) =>
                  onEdit('Intervall geändert', (c) => { c.interval = e.target.value as CostInterval; })
                }
              >
                {(Object.keys(COST_INTERVAL_LABEL) as CostInterval[]).map((interval) => (
                  <option key={interval} value={interval}>
                    {COST_INTERVAL_LABEL[interval]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <TextInput
          className="input--note"
          value={cost.note}
          placeholder="Notiz - Bestellnummer, Stand der Abrechnung..."
          onChange={(note) => onEdit('Notiz geändert', (c) => { c.note = note; }, `cost-note-${cost.id}`)}
        />
      </div>

      <Button variant="ghost" icon title="Kostenposition entfernen" onClick={onRemove}>
        &times;
      </Button>
    </div>
  );
}
