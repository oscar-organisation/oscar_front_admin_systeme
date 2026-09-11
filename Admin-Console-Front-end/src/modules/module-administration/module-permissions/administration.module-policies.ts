import type { AuthorizationPolicy } from "@/shared/kernel/permissions";
import { ADMINISTRATION_PAGE_PERMISSIONS } from "./administration.module-permissions";

export const ADMINISTRATION_ACCESS_POLICY: AuthorizationPolicy = {
  id: "administration.module.access",
  requiresAuthentication: true,
  requiredPermissions: ADMINISTRATION_PAGE_PERMISSIONS.map((code) => ({ code })),
  permissionMode: "ANY",
  organizationScoped: true,
  denialMessage: "Votre compte n’a accès à aucune fonction d’administration.",
};
