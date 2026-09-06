/**
 * Wiederverwendbare Bedienelemente. Alles hier ist bewusst klein gehalten und
 * wird in der gesamten Anwendung genutzt - neue Ansichten sollen diese
 * Komponenten verwenden statt eigene Varianten zu bauen.
 *
 * Tastaturbedienung: alle Elemente sind fokussierbar, Segmented/Combobox
 * reagieren zusätzlich auf Pfeiltasten.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { isPlausibleIso, MAX_YEAR, MIN_YEAR } from '../../engine/dates';
import { documentOf } from './ownerWindow';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonProps {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: boolean;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  icon = false,
  block = false,
  disabled,
  title,
  type = 'button',
  ariaLabel,
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'sm' ? 'btn--sm' : '',
    icon ? 'btn--icon' : '',
    block ? 'btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel ?? title}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segmented Control (Toggle-Flächen)
// ---------------------------------------------------------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  block = false,
  ariaLabel,
  title,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  block?: boolean;
  ariaLabel?: string;
  /**
   * Erklärt, **was** hier eingestellt wird. Die Erklärung der einzelnen
   * Möglichkeiten steht an der jeweiligen Option; steht dort etwas, gewinnt
   * es beim Überfahren - genau richtig, denn dann ist die Frage konkreter.
   */
  title?: string;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
  };

  return (
    <div
      className={`segmented${block ? ' segmented--block' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
      title={title}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          tabIndex={option.value === value ? 0 : -1}
          className={`segmented__item${option.value === value ? ' segmented__item--active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Field-Hülle
// ---------------------------------------------------------------------------

/**
 * Beschriftetes Feld.
 *
 * **Zu jedem Eingabefeld gehört ein `title`.** Die Regel für den Text lautet:
 * *ein Satz, was der Wert setzt - und ein Satz, was daraus folgt.* Die
 * Beschriftung wird nicht wiederholt, und was ohnehin danebensteht, gehört
 * nicht hinein.
 *
 * ```
 * Dauer minimal → "Optimistische Dauer. Im Szenario 'opt.' bestimmt sie Ende,
 *                  Puffer und kritischen Pfad - die Nachfolger rücken mit."
 * FTE           → "Anteil einer Vollzeitstelle über die Laufzeit. Geht in
 *                  Auslastung und Warnungen ein, nicht in die Kosten."
 * ```
 *
 * Der Hinweis unter dem Feld (`hint`) ist etwas anderes: er steht immer da und
 * trägt eine Zahl oder eine Einheit. Der Tooltip erklärt die Wirkung.
 */
export function Field({
  label,
  hint,
  children,
  action,
  title,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /**
   * Erklärung für die ganze Gruppe - nur, wenn eine Überschrift mehrere
   * Bedienelemente überspannt. Sonst gehört der Tooltip an das Element selbst,
   * damit er auch beim Überfahren des Werts erscheint.
   */
  title?: string;
}) {
  return (
    <div className="field" title={title}>
      {(label || action) && (
        <div className="field__label">
          <span className="grow truncate">{label}</span>
          {action}
        </div>
      )}
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text / Zahl
// ---------------------------------------------------------------------------

/**
 * Verzögerung, bis eine Eingabe in den Datenbestand geschrieben wird.
 *
 * **Eine Zahl für alles** - Text, Zahl, Datum, Regler und Auswahl. Jeder
 * Commit klont den gesamten Bestand und lässt Terminplan und Ressourcenlast
 * neu rechnen; pro Tastendruck, Pfeiltaste oder Reglerschritt ist das viel zu
 * teuer, die Oberfläche wird davon spürbar zäh. Bedienelemente halten ihren
 * Wert deshalb selbst und melden ihn erst nach einer Sekunde Ruhe. Wer eine
 * Zahl schnell hochklickt, erzeugt so genau eine Neuberechnung statt zwanzig.
 *
 * Das Zurückschreiben in die Datei ist davon unabhängig und wartet länger
 * (siehe `AUTOSAVE_DEBOUNCE_MS` im Store) - ein Schreibvorgang auf einem
 * Netzlaufwerk kostet spürbar Zeit.
 */
export const COMMIT_DELAY_MS = 1000;

/**
 * Eigener Zustand mit verzögerter Übernahme.
 *
 * Geändert wird lokal und ohne Verzögerung; nach `delay` Ruhe (oder sofort
 * über `flush`, etwa beim Loslassen) geht der Wert an `onChange`. Ändert sich
 * der Wert von aussen - Undo, Dateiwechsel, anderes Objekt gewählt -,
 * übernimmt das Element ihn, solange gerade keine Eingabe aussteht.
 *
 * `commitIf` hält unfertige Zwischenstände zurück: beim Tippen einer
 * Jahreszahl steht kurzzeitig das Jahr 2 im Datumsfeld, und damit soll nicht
 * gerechnet werden.
 */
function useDeferredCommit<T>(
  value: T,
  onChange: (value: T) => void,
  delay: number,
  commitIf: (value: T) => boolean = () => true,
) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);
  /**
   * Der `onChange` aus dem Render, in dem zuletzt geändert wurde. Wechselt die
   * Auswahl mitten in einer Eingabe, zeigt der Prop bereits auf das neue
   * Objekt - die ausstehende Änderung gehört aber noch zum alten.
   */
  const target = useRef(onChange);
  const lastValue = useRef(value);

  const commit = (next: T, to: (v: T) => void, previous: T) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    if (next !== previous && commitIf(next)) to(next);
  };

  useEffect(() => {
    if (value === lastValue.current) return;
    if (pending.current) commit(draft, target.current, lastValue.current);
    lastValue.current = value;
    setDraft(value);
    // `draft` bewusst nicht in den Abhängigkeiten: es geht nur um den Wechsel
    // des Werts von aussen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return {
    draft,
    /** Neuer Wert vom Bedienelement - lokal sofort, nach oben verzögert. */
    set: (next: T) => {
      setDraft(next);
      pending.current = true;
      target.current = onChange;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => commit(next, onChange, value), delay);
    },
    /** Sofort übernehmen (Loslassen, Feld verlassen). */
    flush: () => commit(draft, target.current, value),
  };
}

export function TextInput({
  value,
  onChange,
  placeholder,
  title,
  className = '',
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>) {
  const text = useDeferredCommit(value, onChange, COMMIT_DELAY_MS);
  return (
    <input
      {...rest}
      className={`input ${className}`.trim()}
      value={text.draft}
      title={title}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => text.set(e.target.value)}
      onBlur={text.flush}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  title,
  rows = 3,
  className = 'textarea',
  autoFocus = false,
  onBlur,
  commitIf,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  rows?: number;
  /** Für Sonderfälle wie die Notizkachel im Netzplan. */
  className?: string;
  autoFocus?: boolean;
  /**
   * Läuft **nach** der Übernahme des Werts und bekommt ihn mitgeliefert. Ein
   * Blick in den Datenbestand hilft an dieser Stelle nicht: die Übernahme ist
   * eine Zustandsänderung und dort erst im nächsten Render zu sehen.
   */
  onBlur?: (value: string) => void;
  /**
   * Hält Zwischenstände zurück, die nicht in den Bestand sollen. Die Notiz im
   * Netzplan nutzt das: leer geschrieben heisst gelöscht, und ein leerer
   * Zwischenstand im Verlauf machte daraus zwei Schritte statt einem.
   */
  commitIf?: (value: string) => boolean;
}) {
  const text = useDeferredCommit(value, onChange, COMMIT_DELAY_MS, commitIf);
  return (
    <textarea
      className={className}
      title={title}
      rows={rows}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      value={text.draft}
      placeholder={placeholder}
      onChange={(e) => text.set(e.target.value)}
      onBlur={(e) => {
        text.flush();
        onBlur?.(e.target.value);
      }}
    />
  );
}

/**
 * Datumsfeld.
 *
 * Zwei Dinge sind hier wichtig und nicht offensichtlich:
 *
 *  1. **Unfertige Eingaben dürfen nicht gerechnet werden.** Wer "2027" ins
 *     Jahresfeld tippt, erzeugt unterwegs die Jahre 2, 20 und 202. Ein Plan,
 *     der im Jahr 2 beginnt und in der Gegenwart endet, spannt zwei
 *     Jahrtausende - die Terminrechnung braucht dafür Minuten und die Seite
 *     steht. `commitIf` lässt solche Zwischenstände gar nicht erst durch.
 *  2. Der Wert geht wie überall erst nach `COMMIT_DELAY_MS` Ruhe nach oben.
 *
 * Pfeil hoch/runter auf dem gerade markierten Teil (Tag, Monat, Jahr) ändert
 * ihn schrittweise - das kann der Browser von Haus aus, es muss nur die
 * Verzögerung dazwischen.
 */
export function DateInput({
  value,
  onChange,
  title,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  title?: string;
}) {
  const date = useDeferredCommit(
    value ?? '',
    onChange,
    COMMIT_DELAY_MS,
    (next) => next === '' || isPlausibleIso(next),
  );
  return (
    <input
      type="date"
      className="input"
      title={title}
      min={`${MIN_YEAR}-01-01`}
      max={`${MAX_YEAR}-12-31`}
      value={date.draft}
      onChange={(e) => date.set(e.target.value)}
      onBlur={date.flush}
    />
  );
}

// ---------------------------------------------------------------------------
// Zahlenfeld
// ---------------------------------------------------------------------------

const NUMBER_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** Deutsche Schreibweise: Punkt als Tausendertrenner, Komma als Dezimalzeichen. */
export function formatNumberDe(value: number): string {
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : '';
}

/** Liest eine deutsch geschriebene Zahl; `null`, wenn nichts Verwertbares drinsteht. */
export function parseNumberDe(text: string): number | null {
  const cleaned = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Zahleneingabe für alle Beträge und Mengen.
 *
 * Drei bewusste Entscheidungen:
 *
 *  - **Tausenderpunkte**, sobald das Feld nicht bearbeitet wird. Während des
 *    Tippens bleibt der rohe Text stehen: würde mitten in der Eingabe
 *    umformatiert, spränge die Schreibmarke bei jedem Tausender.
 *  - **Die 0 wird als leeres Feld gezeigt.** Sonst landet man beim Klicken
 *    hinter der Null und tippt aus 0 und 5 eine 05 - die häufigste kleine
 *    Ärgerlichkeit an Zahlenfeldern überhaupt.
 *  - **Pfeil hoch/runter** ändert den Wert um `step`, mit Umschalttaste um das
 *    Zehnfache. Zusammen mit der gemeinsamen Verzögerung erzeugt schnelles
 *    Durchklicken trotzdem nur eine Neuberechnung.
 */
export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  title,
  className = '',
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  title?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const number = useDeferredCommit(value, onChange, COMMIT_DELAY_MS);
  /** Roher Text, solange getippt wird - sonst die formatierte Zahl. */
  const [raw, setRaw] = useState<string | null>(null);

  const clamp = (next: number) => {
    let result = next;
    if (min !== undefined) result = Math.max(min, result);
    if (max !== undefined) result = Math.min(max, result);
    // Auf die Schrittweite runden, damit aus 0,1er-Schritten keine 0,30000000004 wird.
    const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
    return Number(result.toFixed(decimals));
  };

  const shown = raw ?? (number.draft === 0 ? '' : formatNumberDe(number.draft));

  const nudge = (direction: 1 | -1, factor: number) => {
    const next = clamp(number.draft + direction * step * factor);
    setRaw(null);
    number.set(next);
  };

  return (
    <input
      className={`input input--num ${className}`.trim()}
      type="text"
      inputMode="decimal"
      title={title}
      aria-label={ariaLabel}
      placeholder={placeholder ?? '0'}
      value={shown}
      onFocus={() => setRaw(number.draft === 0 ? '' : String(number.draft).replace('.', ','))}
      onChange={(e) => {
        setRaw(e.target.value);
        const parsed = parseNumberDe(e.target.value);
        number.set(parsed === null ? 0 : clamp(parsed));
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
      }}
      onBlur={() => {
        setRaw(null);
        number.flush();
      }}
    />
  );
}

/**
 * Zahl-Eingabe als Regler mit direkter Zahleingabe daneben. Zahlen werden laut
 * Konzept überall so eingegeben - der Regler für schnelles Schätzen, das Feld
 * für exakte Werte.
 *
 * **Der Regler schreibt erst beim Loslassen in den Datenbestand.** Während des
 * Ziehens liefe sonst pro Pixel ein Commit: tiefe Kopie des gesamten Bestands,
 * Terminplan und Ressourcenlast neu gerechnet. Der Griff folgt trotzdem sofort,
 * weil er seinen Wert lokal hält. Eine kurze Verzögerung greift zusätzlich als
 * Netz, falls das Loslassen nie ankommt (abgebrochene Berührung, Pfeiltasten).
 */
export function NumberSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  title,
  compact = false,
  format,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
  /**
   * Kurzform für Werkzeugleisten: nur Regler und eine kleine Zahl daneben,
   * ohne Eingabefeld. Für Einstellungen, die man schiebt statt tippt.
   */
  compact?: boolean;
  /** Nur in der Kurzform: eigene Beschriftung des Werts (z.B. "alle"). */
  format?: (value: number) => string;
}) {
  const slider = useDeferredCommit(value, onChange, COMMIT_DELAY_MS);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const shown = Number.isFinite(slider.draft) ? clamp(slider.draft) : min;
  const fill = ((shown - min) / Math.max(1e-9, max - min)) * 100;
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
  const rounded = Number(shown.toFixed(decimals));

  return (
    <div className={`slider${compact ? ' slider--compact' : ''}`} title={title}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => slider.set(Number(e.target.value))}
        // Loslassen schreibt sofort - Maus, Finger und Tastatur.
        onPointerUp={slider.flush}
        onKeyUp={slider.flush}
        onBlur={slider.flush}
      />
      {compact ? (
        <span className="slider__readout mono">
          {format ? format(rounded) : suffix ? `${rounded} ${suffix}` : rounded}
        </span>
      ) : (
        <>
          <div className="slider__value row">
            {/* Dasselbe Zahlenfeld wie überall - Tausenderpunkte, Pfeiltasten. */}
            <NumberField value={rounded} onChange={(next) => slider.set(next)} min={min} max={max} step={step} />
          </div>
          {suffix && <span className="faint nowrap">{suffix}</span>}
        </>
      )}
    </div>
  );
}

/**
 * Betragsfeld ohne Regler - für Euro-Beträge mit großer Spannweite.
 *
 * Die Einheit steht **im** Feld, nicht daneben: sonst endet ein Betragsfeld
 * ein Stück weiter links als jedes andere Feld der Zeile und die rechte Kante
 * einer Formularspalte ist nicht mehr durchgehend.
 */
export function AmountInput({
  value,
  onChange,
  suffix = '€',
  title,
}: {
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  title?: string;
}) {
  return (
    <div className="amount">
      <NumberField className="input--amount" value={value} onChange={onChange} step={100} min={0} title={title} />
      <span className="amount__suffix faint">{suffix}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combobox mit Autovervollständigung und "neu anlegen"
// ---------------------------------------------------------------------------

export interface ComboOption {
  id: string;
  label: string;
  hint?: string;
  color?: string;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Einträge mit `group` werden vor allen anderen gezeigt und durch eine
   * Überschrift abgesetzt. Genutzt, um die Aufgaben des aktuellen Vorhabens
   * nach oben zu holen - danach sucht man in aller Regel.
   */
  group?: string;
}

export function Combobox({
  options,
  onSelect,
  onCreate,
  placeholder = 'Suchen oder anlegen...',
  title,
  createLabel = (q: string) => `"${q}" neu anlegen`,
  autoFocus = false,
  value,
  onValueChange,
}: {
  options: ComboOption[];
  onSelect: (id: string) => void;
  onCreate?: (name: string) => void;
  placeholder?: string;
  title?: string;
  createLabel?: (query: string) => string;
  autoFocus?: boolean;
  /** Optional kontrolliert - sonst intern. */
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const [internal, setInternal] = useState('');
  const query = value ?? internal;
  const setQuery = onValueChange ?? setInternal;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
      : options;
    // Gruppierte Eintraege zuerst, sonst die urspruengliche Reihenfolge.
    const grouped = matching.filter((o) => o.group);
    const rest = matching.filter((o) => !o.group);
    return [...grouped, ...rest].slice(0, 50);
  }, [options, query]);

  const canCreate =
    Boolean(onCreate) &&
    query.trim().length > 0 &&
    !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    // Dokument des Feldes, nicht das globale - siehe ownerWindow.ts.
    const doc = documentOf(containerRef.current);
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    doc.addEventListener('mousedown', onDocClick);
    return () => doc.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const choose = (index: number) => {
    if (canCreate && index === filtered.length) {
      onCreate?.(query.trim());
    } else {
      const option = filtered[index];
      if (!option || option.disabled) return;
      onSelect(option.id);
    }
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive((a) => (a + (event.key === 'ArrowDown' ? 1 : -1) + total) % Math.max(1, total));
    } else if (event.key === 'Enter') {
      if (open && total > 0) {
        event.preventDefault();
        choose(active);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="combo" ref={containerRef}>
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={query}
        title={title}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="combo__list" id={listId} role="listbox">
          {filtered.map((option, index) => (
            <button
              key={option.id}
              data-group={option.group ?? undefined}
              type="button"
              role="option"
              aria-selected={index === active}
              aria-disabled={option.disabled}
              title={option.disabled ? option.disabledReason : option.hint}
              className={`combo__option${index === active ? ' combo__option--active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.color && <span className="chip__dot" style={{ background: option.color }} />}
              <span className="grow truncate">{option.label}</span>
              {option.hint && <span className="faint nowrap">{option.hint}</span>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={active === filtered.length}
              className={`combo__option combo__option--create${active === filtered.length ? ' combo__option--active' : ''}`}
              onMouseEnter={() => setActive(filtered.length)}
              onClick={() => choose(filtered.length)}
            >
              + {createLabel(query.trim())}
            </button>
          )}
          {total === 0 && <div className="combo__empty">Keine Treffer</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bestätigungsknopf
// ---------------------------------------------------------------------------

/**
 * Löschen ohne Dialog: der erste Klick versetzt denselben Knopf in einen
 * blinkenden Bestätigungszustand. Ein zweiter Klick innerhalb von 3 Sekunden
 * führt die Aktion aus, danach fällt der Knopf von selbst zurück.
 *
 * Bewusst kein Modal - das Konzept verlangt wenige Klicks und keine
 * aufwendigen Fehlerdialoge.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  variant = 'danger',
  size = 'md',
  disabled,
  title,
  block = false,
  icon = false,
}: {
  children: ReactNode;
  /** Beschriftung im Bestätigungszustand; Standard: "Wirklich?". */
  confirmLabel?: ReactNode;
  onConfirm: () => void;
  variant?: ButtonProps['variant'];
  size?: 'md' | 'sm';
  disabled?: boolean;
  title?: string;
  block?: boolean;
  icon?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  const disarm = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  };

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onClick = () => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  };

  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    icon && !armed ? 'btn--icon' : '',
    armed ? 'btn--confirm' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      onBlur={disarm}
      disabled={disabled}
      title={armed ? 'Zum Bestätigen erneut klicken (3 Sekunden)' : title}
    >
      {armed ? (confirmLabel ?? 'Wirklich?') : children}
    </button>
  );
}

const CONFIRM_WINDOW_MS = 3000;

export function Chip({
  label,
  color,
  onRemove,
  onClick,
  active,
  title,
}: {
  label: ReactNode;
  color?: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const className = `chip${onClick ? ' chip--button' : ''}${active ? ' chip--active' : ''}`;
  const body = (
    <>
      {color && <span className="chip__dot" style={{ background: color }} />}
      <span className="truncate">{label}</span>
    </>
  );
  const remove = onRemove && (
    <button
      type="button"
      className="chip__x"
      aria-label="Entfernen"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      &times;
    </button>
  );

  /*
   * Anklickbar **und** entfernbar: dann sind es zwei Knöpfe nebeneinander im
   * selben Rahmen, nicht einer im anderen. Ein `<button>` im `<button>` ist
   * ungültiges HTML - der Browser zieht den inneren beim Parsen heraus, und
   * dann hängt das Kreuz plötzlich neben dem Chip statt darin.
   */
  if (onClick && onRemove) {
    return (
      <span className={className} title={title}>
        <button type="button" className="chip__label" onClick={onClick}>
          {body}
        </button>
        {remove}
      </span>
    );
  }

  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={title}>
      {body}
    </button>
  ) : (
    <span className={className} title={title}>
      {body}
      {remove}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const doc = documentOf(ref.current);
    doc.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus();
    return () => doc.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal__head">
          <h2 className="grow" style={{ fontSize: 'var(--fs-lg)' }}>
            {title}
          </h2>
          <Button variant="ghost" icon onClick={onClose} title="Schließen (Esc)">
            &times;
          </Button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kleinteile
// ---------------------------------------------------------------------------

export function WarnIcon({ warnings, critical = false }: { warnings: string[]; critical?: boolean }) {
  if (warnings.length === 0) return null;
  return (
    <span className={`warn-icon${critical ? ' warn-icon--critical' : ''}`} title={warnings.join('\n')}>
      &#9888;
    </span>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'critical' | 'warn' | 'ok' | 'accent' }) {
  return <span className={`badge${tone !== 'default' ? ` badge--${tone}` : ''}`}>{children}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{title}</div>
        {hint && <div className="muted" style={{ marginTop: 4 }}>{hint}</div>}
      </div>
      {action}
    </div>
  );
}
