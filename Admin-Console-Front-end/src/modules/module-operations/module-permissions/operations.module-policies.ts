import type { AuthorizationPolicy } from "@/shared/kernel/permissions";
import { COCKPIT_PERMISSIONS } from "../features/cockpit/feature-permissions/cockpit.permissions";
import { SUPERVISION_PERMISSIONS } from "../features/supervision/feature-permissions/supervision.permissions";

export const COCKPIT_ACCESS_POLICY: AuthorizationPolicy = {
  id: "operations.cockpit.access",
  requiresAuthentication: true,
  requiredPermissions: [{ code: COCKPIT_PERMISSIONS.PAGE }],
  permissionMode: "ALL",
  organizationScoped: true,
};

export const SUPERVISION_ACCESS_POLICY: AuthorizationPolicy = {
  id: "operations.supervision.access",
  requiresAuthentication: true,
  requiredPermissions: [{ code: SUPERVISION_PERMISSIONS.PAGE }],
  permissionMode: "ALL",
  organizationScoped: true,
};
