import { lazy } from "react";
import type { ApplicationModuleManifest, ModuleNavigationItem } from "@/app/module-registry/module.types";
import type { AuthorizationPolicy } from "@/shared/kernel/permissions";
import { AI_VISION_PERMISSIONS } from "./features/ai-vision/feature-permissions/aiVision.permissions";
import { AUDIT_LOG_PERMISSIONS } from "./features/audit-log/feature-permissions/auditLog.permissions";
import { FLEET_MANAGEMENT_PERMISSIONS } from "./features/fleet-management/feature-permissions/fleetManagement.permissions";
import { IDENTITY_ACCESS_PERMISSIONS } from "./features/identity-access/feature-permissions/identityAccess.permissions";
import { TENANT_MANAGEMENT_PERMISSIONS } from "./features/tenant-management/feature-permissions/tenantManagement.permissions";
import { ADMINISTRATION_ACCESS_POLICY } from "./module-permissions";

const AdminLayout = lazy(() => import("./shared-module/components/AdminLayout.jsx"));
const DashboardPage = lazy(() => import("./features/fleet-overview/pages/DashboardPage.jsx"));
const OrganisationsPage = lazy(() => import("./features/tenant-management/pages/OrganisationsPage.jsx"));
const SitesPage = lazy(() => import("./features/tenant-management/pages/SitesPage.jsx"));
const UsersPage = lazy(() => import("./features/identity-access/pages/UsersPage.jsx"));
const RolesPage = lazy(() => import("./features/identity-access/pages/RolesPage.jsx"));
const IamStructurePage = lazy(() => import("./features/identity-access/pages/IamStructurePage.jsx"));
const RobotsPage = lazy(() => import("./features/fleet-management/pages/RobotsPage.jsx"));
const AiVisionPage = lazy(() => import("./features/ai-vision/pages/AiVisionPage.jsx"));
const AuditLogPage = lazy(() => import("./features/audit-log/pages/AuditLogPage.jsx"));
const AccountPage = lazy(() => import("./features/account/pages/AccountPage.jsx"));

function pagePolicy(id: string, code: string): AuthorizationPolicy {
  return {
    id,
    requiresAuthentication: true,
    requiredPermissions: [{ code }],
    permissionMode: "ALL",
    organizationScoped: true,
  };
}

export const ADMINISTRATION_NAVIGATION: readonly ModuleNavigationItem[] = [
  { id: "administration.overview", to: "/admin", label: "Vue d'ensemble", icon: "home", policy: ADMINISTRATION_ACCESS_POLICY, end: true },
  { id: "administration.organizations", to: "/admin/organisations", label: "Organisations", icon: "building", policy: pagePolicy("tenant.organizations.route", TENANT_MANAGEMENT_PERMISSIONS.ORGANIZATIONS_PAGE) },
  { id: "administration.sites", to: "/admin/sites", label: "Sites", icon: "store", policy: pagePolicy("tenant.sites.route", TENANT_MANAGEMENT_PERMISSIONS.SITES_PAGE) },
  { id: "administration.users", to: "/admin/utilisateurs", label: "Utilisateurs", icon: "users", policy: pagePolicy("identity.users.route", IDENTITY_ACCESS_PERMISSIONS.USERS_PAGE) },
  { id: "administration.roles", to: "/admin/roles", label: "Accès", icon: "shield", policy: pagePolicy("identity.roles.route", IDENTITY_ACCESS_PERMISSIONS.ROLES_PAGE) },
  { id: "administration.iam-structure", to: "/admin/structure", label: "Structure IAM", icon: "layers", policy: pagePolicy("identity.structure.route", IDENTITY_ACCESS_PERMISSIONS.STRUCTURE_PAGE) },
  { id: "administration.robots", to: "/admin/robots", label: "Robots", icon: "robot", policy: pagePolicy("fleet.robots.route", FLEET_MANAGEMENT_PERMISSIONS.ROBOTS_PAGE) },
  { id: "administration.ai-vision", to: "/admin/sandbox", label: "Sandbox IA & Vision", icon: "cpu", policy: pagePolicy("ai-vision.route", AI_VISION_PERMISSIONS.PAGE) },
  { id: "administration.audit", to: "/admin/audit", label: "Journal d'audit", icon: "activity", policy: pagePolicy("audit-log.route", AUDIT_LOG_PERMISSIONS.PAGE) },
] as const;

export const administrationModuleManifest: ApplicationModuleManifest = {
  id: "module-administration",
  name: "Administration",
  version: "1.0.0",
  description: "Gestion des tenants, identités, droits, robots, modèles IA et audit.",
  basePath: "/admin",
  layout: AdminLayout,
  navigation: ADMINISTRATION_NAVIGATION,
  routes: [
    { id: "administration.overview", index: true, policy: ADMINISTRATION_ACCESS_POLICY, component: DashboardPage },
    { id: "tenant.organizations", path: "organisations", policy: pagePolicy("tenant.organizations.route", TENANT_MANAGEMENT_PERMISSIONS.ORGANIZATIONS_PAGE), component: OrganisationsPage },
    { id: "tenant.sites", path: "sites", policy: pagePolicy("tenant.sites.route", TENANT_MANAGEMENT_PERMISSIONS.SITES_PAGE), component: SitesPage },
    { id: "identity.users", path: "utilisateurs", policy: pagePolicy("identity.users.route", IDENTITY_ACCESS_PERMISSIONS.USERS_PAGE), component: UsersPage },
    { id: "identity.roles", path: "roles", policy: pagePolicy("identity.roles.route", IDENTITY_ACCESS_PERMISSIONS.ROLES_PAGE), component: RolesPage },
    { id: "identity.structure", path: "structure", policy: pagePolicy("identity.structure.route", IDENTITY_ACCESS_PERMISSIONS.STRUCTURE_PAGE), component: IamStructurePage },
    { id: "fleet.robots", path: "robots", policy: pagePolicy("fleet.robots.route", FLEET_MANAGEMENT_PERMISSIONS.ROBOTS_PAGE), component: RobotsPage },
    { id: "ai-vision.models", path: "sandbox", policy: pagePolicy("ai-vision.route", AI_VISION_PERMISSIONS.PAGE), component: AiVisionPage },
    {
      id: "account.self",
      path: "compte",
      // Aucune permission requise : seule la session compte, et la page
      // n'agit que sur son porteur.
      policy: { id: "account.self.route", requiresAuthentication: true },
      component: AccountPage,
    },
    { id: "audit-log.events", path: "audit", policy: pagePolicy("audit-log.route", AUDIT_LOG_PERMISSIONS.PAGE), component: AuditLogPage },
  ],
  defaultEnabled: true,
};
