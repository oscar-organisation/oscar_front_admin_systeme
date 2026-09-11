export type PermissionMap = Readonly<Record<string, readonly string[]>>;

export interface PermissionRequirement {
  code: string;
  action?: string;
}

export interface AuthorizationPolicy {
  id: string;
  requiresAuthentication: boolean;
  requiredPermissions?: readonly PermissionRequirement[];
  permissionMode?: "ALL" | "ANY";
  tenantScoped?: boolean;
  organizationScoped?: boolean;
  publicAccess?: boolean;
  denialMessage?: string;
}

export function hasPermission(
  permissions: PermissionMap | null | undefined,
  code: string,
  action = "view",
): boolean {
  const actions = permissions?.[code];
  return Array.isArray(actions) && actions.includes(action);
}

export function evaluatePolicy(
  permissions: PermissionMap | null | undefined,
  policy: AuthorizationPolicy,
): boolean {
  const required = policy.requiredPermissions || [];
  if (required.length === 0) return true;
  const results = required.map(({ code, action }) => hasPermission(permissions, code, action));
  return policy.permissionMode === "ALL" ? results.every(Boolean) : results.some(Boolean);
}

export function canSee(permissions: PermissionMap | null | undefined, code: string): boolean {
  return hasPermission(permissions, code, "view");
}

export function canAny(permissions: PermissionMap | null | undefined, codes: readonly string[]): boolean {
  return codes.some((code) => canSee(permissions, code));
}

export const PUBLIC_POLICY: AuthorizationPolicy = {
  id: "app.public",
  requiresAuthentication: false,
  publicAccess: true,
};

export const AUTHENTICATED_POLICY: AuthorizationPolicy = {
  id: "app.authenticated",
  requiresAuthentication: true,
};
