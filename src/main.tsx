import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { PreferencesProvider } from './state/preferences';
import { StoreProvider } from './state/store';
import './styles/theme.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root-Element nicht gefunden.');

// Die Fehlergrenze liegt bewusst ganz aussen: auch die Provider koennen
// scheitern (localStorage und matchMedia sind z.B. in Safari auf file://
// eingeschraenkt). Lag sie innerhalb, endete so ein Fehler in einer weissen
// Seite ohne jeden Hinweis.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <PreferencesProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </PreferencesProvider>
    </ErrorBoundary>
  </StrictMode>,
);
