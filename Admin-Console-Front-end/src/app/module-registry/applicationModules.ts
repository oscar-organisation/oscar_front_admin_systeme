import { administrationModuleManifest } from "@/modules/module-administration";
import { operationsModuleManifest } from "@/modules/module-operations";
import type { ApplicationModuleManifest } from "./module.types";

const manifests = [administrationModuleManifest, operationsModuleManifest] as const;

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
