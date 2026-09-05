/**
 * Ansichts-Einstellungen. Nicht Teil des Datenbestands und nicht Teil von
 * Undo/Redo - sie liegen in localStorage, damit die Ansicht nach einem Reload
 * gleich aussieht.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Granularity } from "../engine/dates";
import type { Scenario } from "../engine/schedule";
import type { PersonUnit } from "../engine/resources";

export type ThemeSetting = "system" | "light" | "dark";
export type TaskView = "network" | "gantt";
export type ResourceView = "chart" | "table";
export type Weighting = "none" | "duration" | "cost";
/**
 * Welche der drei Geldgrössen die Tabelle zeigt. Sie dürfen nie verwechselt
 * werden: `approved` ist die Obergrenze, `planned` die Absicht, `actual` das
 * tatsächlich abgeflossene Geld - nur Letzteres löst Warnungen aus.
 */
export type CostMeasure = "approved" | "planned" | "actual";

export interface Preferences {
  theme: ThemeSetting;
  taskView: TaskView;
  resourceView: ResourceView;
  scenario: Scenario;
  ganttGranularity: Granularity;
  resourceGranularity: Granularity;
  personUnit: PersonUnit;
  weighting: Weighting;
  /** Kritischer Pfad wird nur auf Knopfdruck hervorgehoben. */
  showCriticalPath: boolean;
  showResourceRail: boolean;
  /** Anteil der oberen Fläche (Plan) am rechten Bereich, 0..1. */
  splitRatio: number;
  /** Breite der Beschriftungsspalte im Gantt in Pixeln - frei ziehbar. */
  ganttLabelWidth: number;
  /** Kennzahl, die in der Ressourcentabelle gezeigt wird. */
  costMeasure: CostMeasure;
  /**
   * Die Kurzanleitung wurde bereits gesehen. Wird gesetzt, sobald eine eigene
   * Datei geöffnet oder angelegt wurde - wer mit dem Beispielbestand spielt,
   * bekommt sie beim nächsten Start noch einmal.
   */
  guideSeen: boolean;
}

const DEFAULTS: Preferences = {
  theme: "system",
  taskView: "network",
  resourceView: "chart",
  scenario: "max",
  ganttGranularity: "week",
  resourceGranularity: "month",
  personUnit: "FTE",
  weighting: "duration",
  showCriticalPath: false,
  showResourceRail: true,
  splitRatio: 0.55,
  ganttLabelWidth: 210,
  costMeasure: "planned",
  guideSeen: false,
};

const STORAGE_KEY = "mpt.preferences";

interface PreferencesValue {
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  /** Effektives Theme nach Auflösung von 'system'. */
  resolvedTheme: "light" | "dark";
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

/**
 * `matchMedia` ist in eingeschränkten Kontexten (Safari auf `file://`,
 * eingebettete Ansichten) nicht immer benutzbar. Ein Fehler beim Abfragen des
 * Farbschemas darf die Anwendung nicht verhindern - im Zweifel hell.
 */
function prefersDark(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>(load);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    try {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* Speicher voll oder gesperrt - Einstellungen bleiben dann sitzungslokal. */
    }
  }, [prefs]);

  const resolvedTheme =
    prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const value = useMemo<PreferencesValue>(
    () => ({
      prefs,
      setPrefs: (patch) => setState((p) => ({ ...p, ...patch })),
      resolvedTheme,
    }),
    [prefs, resolvedTheme],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value)
    throw new Error(
      "usePreferences muss innerhalb von <PreferencesProvider> verwendet werden.",
    );
  return value;
}
