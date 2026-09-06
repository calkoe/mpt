/**
 * Eine Kostenposition zum Bearbeiten.
 *
 * Dieselbe Zuordnung lässt sich von zwei Seiten betrachten: von der Aufgabe
 * aus ("welche Budgets belaste ich?") und vom Budget aus ("welche Aufgaben
 * zehren an mir?"). Beide Richtungen zeigen und ändern dieselben Felder,
 * deshalb gibt es sie hier genau einmal - zwei Abschriften wären auf Dauer
 * garantiert auseinandergelaufen.
 *
 * Alle Zeilen liegen in einem gemeinsamen Raster: Beschriftung links, Eingabe
 * rechts, überall gleich breit und bündig abschliessend. Der Schieber legt den
 * geplanten Betrag anteilig auf den Abruf um (0-100 %), das Feld daneben nimmt
 * einen genauen Euro-Betrag entgegen - beides schreibt auf dasselbe Feld.
 */
import {
  COST_INTERVAL_LABEL,
  type CostInterval,
  type CostItem,
  type IsoDate,
} from "../../model/types";
import { costDueDates } from "../../engine/resources";
import { formatDateDe } from "../../engine/dates";
import {
  AmountInput,
  Button,
  NumberField,
  NumberSlider,
  Switch,
  TextInput,
} from "./controls";
import { MeasureLabel } from "./CostMeasure";

/** Anteil des geplanten Betrags, der bereits abgerufen ist. */
function spentPercent(cost: CostItem): number {
  if (cost.amount <= 0) return 0;
  return Math.round((cost.actualAmount / cost.amount) * 100);
}

export function CostFields({
  cost,
  caption,
  term,
  onEdit,
  onRemove,
}: {
  cost: CostItem;
  /** Gegenstück der Zuordnung: Budgetname bzw. Aufgabentitel. */
  caption: string;
  /** Laufzeit der Aufgabe - daraus ergeben sich die Fälligkeiten. */
  term?: { start: IsoDate; end: IsoDate; openEnded: boolean };
  /** Ändert genau diese Kostenposition. */
  onEdit: (
    label: string,
    recipe: (cost: CostItem) => void,
    coalesceKey?: string,
  ) => void;
  onRemove: () => void;
}) {
  /*
   * Vorschau der automatisch erzeugten Abrufe. Ein Rhythmus allein sagt nicht,
   * wann tatsächlich gebucht wird - das hängt am Aufgabenstart und am Raster.
   * Bei Dauerläufern wird die Liste gekappt: sie liefe zehn Jahre weiter.
   */
  const dueDates =
    cost.recurring && term ? costDueDates(cost, term.start, term.end, 13) : [];
  return (
    <div className="line-item">
      <div className="col">
        <div className="line-item__caption truncate">{caption}</div>

        <TextInput
          value={cost.label}
          placeholder="Bezeichnung"
          title="Bezeichnung der Kostenposition. Sie steht in der Auswertung des Budgets und in der CSV-Ausgabe."
          onChange={(label) =>
            onEdit(
              "Kostenposition bearbeitet",
              (c) => {
                c.label = label;
              },
              `cost-label-${cost.id}`,
            )
          }
        />

        <div className="fieldgrid">
          <span className="fieldgrid__label">
            <MeasureLabel measure="planned" />
          </span>
          <AmountInput
            title="Geplanter Betrag (○). Er wird zur Laufzeit der Aufgabe fällig, zählt gegen die Obergrenze des Budgets und bildet die Ganglinie."
            value={cost.amount}
            onChange={(amount) =>
              onEdit(
                "Betrag geändert",
                (c) => {
                  c.amount = amount;
                },
                `cost-amount-${cost.id}`,
              )
            }
          />

          <span className="fieldgrid__label">
            <MeasureLabel measure="actual" />
          </span>
          <AmountInput
            title="Tatsächlich abgerufener Betrag (●). Die Differenz zum geplanten ist der offene Rest; die Terminrechnung berührt er nicht."
            value={cost.actualAmount}
            onChange={(actualAmount) =>
              onEdit(
                "Abruf geändert",
                (c) => {
                  c.actualAmount = actualAmount;
                },
                `cost-actual-${cost.id}`,
              )
            }
          />

          {/* Schieber legt den geplanten Betrag anteilig auf den Abruf um. */}
          <span
            className="fieldgrid__label"
            title="Anteil des geplanten Betrags, der bereits abgerufen ist"
          >
            Abgerufen
          </span>
          <NumberSlider
            compact
            min={0}
            max={100}
            step={5}
            title="Setzt den abgerufenen Betrag als Anteil des geplanten - eine Abkürzung für das Feld darüber, nicht ein eigener Wert."
            value={spentPercent(cost)}
            format={(v) => `${v} %`}
            onChange={(value) =>
              onEdit(
                "Abruf geändert",
                (c) => {
                  c.actualAmount = Math.round((c.amount * value) / 100);
                },
                `cost-pct-${cost.id}`,
              )
            }
          />

          <span className="fieldgrid__label">Rhythmus</span>
          <Switch
            checked={cost.recurring}
            label="wiederkehrend"
            title="Wiederkehrend: der Betrag fällt am ersten Tag jedes Zeitraums erneut an, solange die Aufgabe läuft - aus einem Betrag wird eine Reihe."
            onChange={(recurring) =>
              onEdit("Kostenart geändert", (c) => {
                c.recurring = recurring;
              })
            }
          />

          {cost.recurring && (
            <>
              <span className="fieldgrid__label">alle</span>
              <div className="row">
                <div style={{ width: 56, flex: "none" }}>
                  <NumberField
                    value={cost.every}
                    min={1}
                    ariaLabel="Intervallfaktor"
                    title="Faktor des Rhythmus: 3 mit Einheit Monat heißt alle drei Monate."
                    onChange={(every) =>
                      onEdit(
                        "Intervall geändert",
                        (c) => {
                          c.every = Math.max(1, Math.round(every) || 1);
                        },
                        `cost-every-${cost.id}`,
                      )
                    }
                  />
                </div>
                <select
                  className="select grow"
                  title="Raster der Wiederholung. Gebucht wird jeweils am ersten Tag des Zeitraums; liegt der Aufgabenstart mittendrin, rückt der erste Abruf auf den nächsten Rasterbeginn."
                  value={cost.interval}
                  onChange={(e) =>
                    onEdit("Intervall geändert", (c) => {
                      c.interval = e.target.value as CostInterval;
                    })
                  }
                >
                  {(Object.keys(COST_INTERVAL_LABEL) as CostInterval[]).map(
                    (interval) => (
                      <option key={interval} value={interval}>
                        {COST_INTERVAL_LABEL[interval]}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </>
          )}
        </div>

        {dueDates.length > 0 && (
          <div className="duelist">
            <span className="duelist__title">
              {cost.recurring
                ? `Abrufe ab ${formatDateDe(dueDates[0])}`
                : "Abruf"}
            </span>
            <div className="duelist__items">
              {dueDates.slice(0, 12).map((date) => (
                <span key={date} className="duelist__item mono">
                  {formatDateDe(date)}
                </span>
              ))}
              {(dueDates.length > 12 || term?.openEnded) && (
                <span
                  className="duelist__item duelist__item--more"
                  title="Läuft weiter, solange die Aufgabe läuft"
                >
                  …
                </span>
              )}
            </div>
          </div>
        )}

        <TextInput
          className="input--note"
          value={cost.note}
          placeholder="Notiz - Bestellnummer, Stand der Abrechnung..."
          title="Freier Vermerk zur Position, etwa Bestellnummer oder Abrechnungsstand. Erscheint in der CSV-Ausgabe; auf die Rechnung wirkt er nicht."
          onChange={(note) =>
            onEdit(
              "Notiz geändert",
              (c) => {
                c.note = note;
              },
              `cost-note-${cost.id}`,
            )
          }
        />
      </div>

      <Button
        variant="ghost"
        icon
        title="Kostenposition entfernen"
        onClick={onRemove}
      >
        &times;
      </Button>
    </div>
  );
}
