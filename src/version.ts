/**
 * Version der Anwendung.
 *
 * **Gepflegt wird sie an genau einer Stelle: `version` in `package.json`.**
 * Der Build spritzt den Wert über `define` als `__APP_VERSION__` ein (siehe
 * `vite.config.ts` und `vitest.config.ts`). Eine zweite, von Hand gepflegte
 * Konstante gab es hier früher - sie lief erwartungsgemäß auseinander.
 *
 * Der Fallback greift nur, wenn eine Datei ohne Bundler geladen wird; im
 * fertigen Build und in den Tests steht immer der echte Wert.
 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';

/** `true`, wenn die Version aus einem echten Build stammt. */
export function isReleaseBuild(): boolean {
  return APP_VERSION !== '0.0.0-dev';
}

/** Projektseite. Erscheint als dezenter Link unten rechts in der Anwendung. */
export const PROJECT_URL = 'https://github.com/calkoe/mpt';
