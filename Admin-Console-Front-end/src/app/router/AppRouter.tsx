import { lazy, Suspense, type ComponentType } from "react";
import { Route, Routes } from "react-router-dom";
import { GlobalErrorBoundary } from "@/app/error-boundaries/GlobalErrorBoundary";
import { applicationModules } from "@/app/module-registry";
import LoadingPage from "@/app/pages/LoadingPage";
import NotFoundPage from "@/app/pages/NotFoundPage";
import { AUTHENTICATED_POLICY, PUBLIC_POLICY } from "@/shared/kernel/permissions";
import { PolicyGuard } from "./PolicyGuard";

const LoginPage = lazy(() => import("@/pages/Login.jsx"));
const SpaceSelectionPage = lazy(() => import("@/pages/SpaceSelection.jsx"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPassword.jsx"));
const SetPasswordPage = lazy(() => import("@/pages/SetPassword.jsx"));

function guardedElement(
  id: string,
  policy: Parameters<typeof PolicyGuard>[0]["policy"],
  Component: ComponentType,
) {
  return (
    <PolicyGuard policy={policy}>
      <GlobalErrorBoundary scope={id}>
        <Component />
      </GlobalErrorBoundary>
    </PolicyGuard>
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<LoadingPage />}>
      <Routes>
        <Route path="/login" element={guardedElement("authentication.login", PUBLIC_POLICY, LoginPage)} />

        {/* Parcours d'identite ouverts sans session : le porteur du lien n'est
            pas encore authentifie, et dans le cas d'une invitation il n'a meme
            pas encore de mot de passe. */}
        <Route
          path="/forgot-password"
          element={guardedElement("authentication.forgot", PUBLIC_POLICY, ForgotPasswordPage)}
        />
        <Route
          path="/reset-password"
          element={(
            <PolicyGuard policy={PUBLIC_POLICY}>
              <GlobalErrorBoundary scope="authentication.reset">
                <SetPasswordPage mode="reset" />
              </GlobalErrorBoundary>
            </PolicyGuard>
          )}
        />
        <Route
          path="/accept-invitation"
          element={(
            <PolicyGuard policy={PUBLIC_POLICY}>
              <GlobalErrorBoundary scope="authentication.invitation">
                <SetPasswordPage mode="invitation" />
              </GlobalErrorBoundary>
            </PolicyGuard>
          )}
        />
        <Route path="/" element={guardedElement("workspace.selection", AUTHENTICATED_POLICY, SpaceSelectionPage)} />

        {applicationModules.map((module) => {
          if (module.layout && module.basePath) {
            const Layout = module.layout;
            const modulePolicy = module.routes[0]?.policy || AUTHENTICATED_POLICY;
            return (
              <Route key={module.id} path={module.basePath} element={guardedElement(`${module.id}.layout`, modulePolicy, Layout)}>
                {module.routes.map((route) => route.index ? (
                  <Route
                    key={route.id}
                    index
                    element={guardedElement(route.id, route.policy, route.component)}
                  />
                ) : (
                  <Route
                    key={route.id}
                    path={route.path}
                    element={guardedElement(route.id, route.policy, route.component)}
                  />
                ))}
              </Route>
            );
          }

          return module.routes.map((route) => route.index ? null : (
            <Route
              key={route.id}
              path={route.path}
              element={guardedElement(route.id, route.policy, route.component)}
            />
          ));
        })}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
