import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import ForbiddenPage from "@/app/pages/ForbiddenPage";
import LoadingPage from "@/app/pages/LoadingPage";
import { useAuth } from "@/shared/kernel/auth";
import { evaluatePolicy, type AuthorizationPolicy } from "@/shared/kernel/permissions";

export function PolicyGuard({ policy, children }: { policy: AuthorizationPolicy; children: ReactNode }) {
  const { user, permissions, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <LoadingPage />;
  if (policy.requiresAuthentication && !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!policy.publicAccess && !evaluatePolicy(permissions, policy)) {
    return <ForbiddenPage {...(policy.denialMessage ? { message: policy.denialMessage } : {})} />;
  }
  return children;
}
