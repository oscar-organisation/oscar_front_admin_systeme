import { Component, type ErrorInfo, type ReactNode } from "react";
import { runtimeConfig } from "@/shared/config";
import { normalizeError } from "@/shared/kernel/errors";
import { reportError } from "@/shared/kernel/observability";

interface Props {
  children: ReactNode;
  scope?: string;
}

interface State {
  error: unknown | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, {
      feature: this.props.scope || "application",
      action: "render",
      route: window.location.pathname,
      environment: runtimeConfig.environment,
      version: runtimeConfig.version,
    });
    if (import.meta.env.DEV) console.error(info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const error = normalizeError(this.state.error);
    return (
      <main className="system-state-page" role="alert">
        <div className="system-state-panel">
          <span className="system-state-code">Incident d’affichage</span>
          <h1>Cette zone n’a pas pu être affichée</h1>
          <p>{error.userMessage}</p>
          <div className="system-state-actions">
            <button className="btn-shell primary" type="button" onClick={() => window.location.reload()}>
              Réessayer
            </button>
            <a className="btn-shell" href="/">Retour aux espaces</a>
          </div>
          {error.correlationId && <small>Référence : {error.correlationId}</small>}
        </div>
      </main>
    );
  }
}
