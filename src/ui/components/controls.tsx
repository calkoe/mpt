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
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  block?: boolean;
  ariaLabel?: string;
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

export function Field({
  label,
  hint,
  children,
  action,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="field">
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
  return (
    <input
      {...rest}
      className={`input ${className}`.trim()}
      value={value}
      title={title}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className="textarea"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function DateInput({
  value,
  onChange,
  title,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  title?: string;
}) {
  return (
    <input
      type="date"
      className="input"
      title={title}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Zahl-Eingabe als Slider mit direkter Zahleingabe daneben. Zahlen werden laut
 * Konzept überall so eingegeben - der Slider für schnelles Schätzen, das
 * Feld für exakte Werte.
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
   * Kurzform für Werkzeugleisten: nur Schieber und eine kleine Zahl daneben,
   * ohne Eingabefeld. Für Einstellungen, die man schiebt statt tippt.
   */
  compact?: boolean;
  /** Nur in der Kurzform: eigene Beschriftung des Werts (z.B. "alle"). */
  format?: (value: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fill = ((clamp(value) - min) / Math.max(1e-9, max - min)) * 100;
  const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
  const shown = Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;

  return (
    <div className={`slider${compact ? ' slider--compact' : ''}`} title={title}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value)}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {compact ? (
        <span className="slider__readout mono">
          {format ? format(shown) : suffix ? `${shown} ${suffix}` : shown}
        </span>
      ) : (
        <>
          <div className="slider__value row">
            <input
              className="input input--num"
              type="number"
              min={min}
              step={step}
              value={shown}
              onChange={(e) => onChange(e.target.value === '' ? min : Number(e.target.value))}
            />
          </div>
          {suffix && <span className="faint nowrap">{suffix}</span>}
        </>
      )}
    </div>
  );
}

/** Betragsfeld ohne Slider - für Euro-Beträge mit großer Spannweite. */
export function AmountInput({
  value,
  onChange,
  suffix = '€',
}: {
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="row">
      <input
        className="input input--num"
        type="number"
        step={100}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      <span className="faint">{suffix}</span>
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
}

export function Combobox({
  options,
  onSelect,
  onCreate,
  placeholder = 'Suchen oder anlegen...',
  createLabel = (q: string) => `"${q}" neu anlegen`,
  autoFocus = false,
  value,
  onValueChange,
}: {
  options: ComboOption[];
  onSelect: (id: string) => void;
  onCreate?: (name: string) => void;
  placeholder?: string;
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
    if (!q) return options.slice(0, 50);
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)).slice(0, 50);
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
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
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
  const content = (
    <>
      {color && <span className="chip__dot" style={{ background: color }} />}
      <span className="truncate">{label}</span>
      {onRemove && (
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
      )}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} title={title}>
      {content}
    </button>
  ) : (
    <span className={className} title={title}>
      {content}
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
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus();
    return () => document.removeEventListener('keydown', onKey);
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
