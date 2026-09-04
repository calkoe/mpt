/**
 * Fehlergrenze. Da der gesamte Datenbestand aus einer vom Nutzer gewählten
 * Datei stammt, darf ein unerwarteter Zustand nie zu einem weißen Bildschirm
 * führen - der Nutzer muss immer noch an seine Daten kommen.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[MPT] Unerwarteter Fehler:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="empty" style={{ padding: "var(--sp-6)" }}>
        <div style={{ maxWidth: 560, textAlign: "left" }}>
          <h2 style={{ fontSize: "var(--fs-xl)", marginBottom: "var(--sp-3)" }}>
            Etwas ist schiefgelaufen
          </h2>
          <p className="muted">
            Die Anwendung konnte die Ansicht nicht darstellen. Deine Daten in
            der Datei sind davon nicht betroffen - der letzte Speicherstand ist
            unverändert.
          </p>
          <pre
            className="mono"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: "var(--sp-3)",
              overflow: "auto",
              maxHeight: 220,
              fontSize: "var(--fs-sm)",
            }}
          >
            {error.message}
          </pre>
          <div className="row" style={{ marginTop: "var(--sp-3)" }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => this.setState({ error: null })}
            >
              Erneut versuchen
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
            >
              Neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}
