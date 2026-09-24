import { lazy } from "react";
import type { ApplicationModuleManifest, ModuleNavigationItem } from "@/app/module-registry/module.types";
import type { AuthorizationPolicy } from "@/shared/kernel/permissions";
import { DEPLOYMENT_STUDIO_PERMISSIONS } from "./features/deployment-studio/feature-permissions/deploymentStudio.permissions";
import { STUDIO_ACCESS_POLICY } from "./module-permissions";

// Le Studio reprend la coquille de l'administration : meme barre laterale, meme
// bandeau d'organisation. C'est un module a part entiere, mais l'operateur ne
// change pas d'environnement en passant de la flotte a sa configuration.
const AdminLayout = lazy(() => import("@/modules/module-administration/shared-module/components/AdminLayout.jsx"));
const StudioProjectsPage = lazy(() => import("./features/deployment-studio/feature-ui/pages/StudioProjectsPage"));
const StudioEditorPage = lazy(() => import("./features/deployment-studio/feature-ui/pages/StudioEditorPage"));
const StudioPresetsPage = lazy(() => import("./features/deployment-studio/feature-ui/pages/StudioPresetsPage"));
const StudioDeploymentsPage = lazy(() => import("./features/deployment-studio/feature-ui/pages/StudioDeploymentsPage"));

function pagePolicy(id: string, code: string): AuthorizationPolicy {
  return {
    id,
    requiresAuthentication: true,
    requiredPermissions: [{ code }],
    permissionMode: "ALL",
    organizationScoped: true,
  };
}

export const STUDIO_NAVIGATION: readonly ModuleNavigationItem[] = [
  {
    id: "studio.projects",
    to: "/studio",
    label: "Studio de déploiement",
    icon: "blocks",
    policy: pagePolicy("studio.projects.route", DEPLOYMENT_STUDIO_PERMISSIONS.PAGE),
    end: true,
  },
  {
    id: "studio.presets",
    to: "/studio/presets",
    label: "Catalogue de présets",
    icon: "layers",
    policy: pagePolicy("studio.presets.route", DEPLOYMENT_STUDIO_PERMISSIONS.PRESETS_PAGE),
  },
  {
    id: "studio.deployments",
    to: "/studio/deploiements",
    label: "Suivi des déploiements",
    icon: "activity",
    policy: pagePolicy("studio.deploiements.route", DEPLOYMENT_STUDIO_PERMISSIONS.DEPLOYMENT_READ),
  },
] as const;

export const studioModuleManifest: ApplicationModuleManifest = {
  id: "module-studio",
  name: "Studio de déploiement",
  version: "1.0.0",
  description: "Composition visuelle des bundles, agents et canaux avant déploiement sur la flotte.",
  basePath: "/studio",
  layout: AdminLayout,
  navigation: STUDIO_NAVIGATION,
  routes: [
    {
      id: "studio.projects",
      index: true,
      // Politique du module : c'est elle que le routeur applique aussi a la
      // coquille, avant meme d'afficher la barre laterale.
      policy: STUDIO_ACCESS_POLICY,
      component: StudioProjectsPage,
    },
    {
      id: "studio.presets",
      path: "presets",
      policy: pagePolicy("studio.presets.route", DEPLOYMENT_STUDIO_PERMISSIONS.PRESETS_PAGE),
      component: StudioPresetsPage,
    },
    {
      // Cette route reste avant l'identifiant dynamique : « deploiements »
      // est un ecran, jamais une cle de projet.
      id: "studio.deployments",
      path: "deploiements",
      policy: pagePolicy("studio.deploiements.route", DEPLOYMENT_STUDIO_PERMISSIONS.DEPLOYMENT_READ),
      component: StudioDeploymentsPage,
    },
    {
      // Route dynamique en dernier : les ecrans nommes seraient sinon pris
      // pour des identifiants de projet.
      id: "studio.editor",
      path: ":projectId",
      policy: pagePolicy("studio.editor.route", DEPLOYMENT_STUDIO_PERMISSIONS.PAGE),
      component: StudioEditorPage,
    },
  ],
  dependencies: ["module-administration"],
  defaultEnabled: true,
};
