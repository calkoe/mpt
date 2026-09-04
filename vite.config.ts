import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json';

// Baut die komplette Anwendung in eine einzige, offline lauffaehige index.html.
// Alle Libraries (React, ReactDOM) werden mit einkompiliert - kein CDN zur Laufzeit.
export default defineConfig({
  base: './',
  // Einzige Quelle der Version ist package.json - siehe src/version.ts.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
    reportCompressedSize: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
