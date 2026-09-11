import { AI_VISION_PERMISSIONS } from "../features/ai-vision/feature-permissions/aiVision.permissions";
import { AUDIT_LOG_PERMISSIONS } from "../features/audit-log/feature-permissions/auditLog.permissions";
import { FLEET_MANAGEMENT_PERMISSIONS } from "../features/fleet-management/feature-permissions/fleetManagement.permissions";
import { IDENTITY_ACCESS_PERMISSIONS } from "../features/identity-access/feature-permissions/identityAccess.permissions";
import { TENANT_MANAGEMENT_PERMISSIONS } from "../features/tenant-management/feature-permissions/tenantManagement.permissions";

export const ADMINISTRATION_MODULE_PERMISSIONS = {
  ACCESS: "administration:access",
} as const;

export const ADMINISTRATION_PAGE_PERMISSIONS = [
  TENANT_MANAGEMENT_PERMISSIONS.ORGANIZATIONS_PAGE,
  TENANT_MANAGEMENT_PERMISSIONS.SITES_PAGE,
  IDENTITY_ACCESS_PERMISSIONS.USERS_PAGE,
  IDENTITY_ACCESS_PERMISSIONS.ROLES_PAGE,
  FLEET_MANAGEMENT_PERMISSIONS.ROBOTS_PAGE,
  AI_VISION_PERMISSIONS.PAGE,
  AUDIT_LOG_PERMISSIONS.PAGE,
] as const;
