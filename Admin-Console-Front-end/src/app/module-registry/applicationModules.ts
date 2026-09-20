import { administrationModuleManifest } from "@/modules/module-administration";
import { operationsModuleManifest } from "@/modules/module-operations";
import { studioModuleManifest } from "@/modules/module-studio";
import type { ApplicationModuleManifest, ModuleNavigationItem } from "./module.types";

const manifests = [administrationModuleManifest, studioModuleManifest, operationsModuleManifest] as const;

function validateModules(modules: readonly ApplicationModuleManifest[]): void {
  const ids = new Set<string>();
  const routeIds = new Set<string>();

  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    ids.add(module.id);
    for (const route of module.routes) {
      if (routeIds.has(route.id)) throw new Error(`Duplicate module route id: ${route.id}`);
      routeIds.add(route.id);
    }
  }

  for (const module of modules) {
    for (const dependency of module.dependencies || []) {
      if (!ids.has(dependency)) throw new Error(`Missing module dependency: ${module.id} -> ${dependency}`);
    }
  }
}

validateModules(manifests);

export const applicationModules: readonly ApplicationModuleManifest[] = manifests.filter(
  (module) => module.defaultEnabled,
);

/**
 * Navigation de la coquille, composee par les modules eux-memes.
 *
 * La barre laterale n'appartient a aucun module en particulier : chaque module
 * declare ses entrees, et celui qui n'en declare aucune (le cockpit, lance
 * depuis un autre espace) n'y apparait pas.
 */
export const consoleNavigation: readonly ModuleNavigationItem[] = applicationModules.flatMap(
  (module) => module.navigation,
);
