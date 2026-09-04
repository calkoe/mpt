import { defineConfig } from 'vitest/config';
import pkg from './package.json';

// Getrennt von vite.config.ts, damit die Build-Konfiguration nicht an den
// Vite-Typen von Vitest hängt.
export default defineConfig({
  // Dieselbe Versionsquelle wie im Build, damit Tests und Auslieferung
  // nicht auseinanderlaufen.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
});
