import React from "react";
import ReactDOM from "react-dom/client";
import AppRouter from "@/app/router/AppRouter";
import { AppProviders } from "@/app/providers/AppProviders";
import { GlobalErrorBoundary } from "@/app/error-boundaries/GlobalErrorBoundary";
import "@/styles/platform.css";
import "@/styles/oscar.css";
import "@/styles/console.css";
import "@/shared/design-system/themes/tokens.css";
import "@/shared/design-system/premium.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root #root is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <AppProviders>
        <a className="skip-link" href="#main-content">Aller au contenu principal</a>
        <AppRouter />
      </AppProviders>
    </GlobalErrorBoundary>
  </React.StrictMode>,
);
