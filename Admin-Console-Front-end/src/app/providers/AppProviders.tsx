import { useEffect, type ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { runtimeConfig } from "@/shared/config";
import { ThemeProvider } from "@/shared/design-system/themes";
import { AuthProvider } from "@/shared/kernel/auth";
import { reportError } from "@/shared/kernel/observability";

function GlobalErrorListeners({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError(event.error || event.message, {
      action: "window.error",
      route: window.location.pathname,
      environment: runtimeConfig.environment,
      version: runtimeConfig.version,
    });
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason, {
      action: "unhandledrejection",
      route: window.location.pathname,
      environment: runtimeConfig.environment,
      version: runtimeConfig.version,
    });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return children;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const routerProps = runtimeConfig.basePath === "/"
    ? {}
    : { basename: runtimeConfig.basePath };

  return (
    <ThemeProvider>
      <BrowserRouter {...routerProps}>
        <AuthProvider>
          <GlobalErrorListeners>{children}</GlobalErrorListeners>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
