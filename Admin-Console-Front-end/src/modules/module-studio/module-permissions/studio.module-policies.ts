import type { AuthorizationPolicy } from "@/shared/kernel/permissions";
import { STUDIO_PAGE_PERMISSIONS } from "./studio.module-permissions";

export const STUDIO_ACCESS_POLICY: AuthorizationPolicy = {
  id: "studio.module.access",
  requiresAuthentication: true,
  requiredPermissions: STUDIO_PAGE_PERMISSIONS.map((code) => ({ code })),
  permissionMode: "ANY",
  organizationScoped: true,
  denialMessage: "Votre compte n’a pas accès au Studio de déploiement.",
};
