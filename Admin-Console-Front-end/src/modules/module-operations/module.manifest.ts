import { lazy } from "react";
import type { ApplicationModuleManifest } from "@/app/module-registry/module.types";
import { COCKPIT_ACCESS_POLICY, SUPERVISION_ACCESS_POLICY } from "./module-permissions";

const CockpitLauncherPage = lazy(() => import("./features/cockpit/pages/CockpitLauncherPage.jsx"));
const SupervisionPage = lazy(() => import("./features/supervision/pages/SupervisionPage.jsx"));

export const operationsModuleManifest: ApplicationModuleManifest = {
  id: "module-operations",
  name: "Opérations robotiques",
  version: "1.0.0",
  description: "Cockpit XR et supervision vidéo 2D.",
  routes: [
    { id: "operations.cockpit", path: "/cockpit", policy: COCKPIT_ACCESS_POLICY, component: CockpitLauncherPage },
    { id: "operations.supervision", path: "/operator", policy: SUPERVISION_ACCESS_POLICY, component: SupervisionPage },
  ],
  navigation: [],
  defaultEnabled: true,
};
