import type { ComponentType, LazyExoticComponent } from "react";
import type { AuthorizationPolicy } from "@/shared/kernel/permissions";

export type ModuleIconKey = "home" | "building" | "store" | "users" | "shield" | "robot" | "cpu" | "activity" | "layers" | "blocks";

export interface ModuleNavigationItem {
  id: string;
  to: string;
  label: string;
  icon: ModuleIconKey;
  policy: AuthorizationPolicy;
  end?: boolean;
}

interface ModuleRouteBase {
  id: string;
  policy: AuthorizationPolicy;
  component: LazyExoticComponent<ComponentType>;
}

export type ModuleRouteDefinition = ModuleRouteBase & (
  | { index: true; path?: never }
  | { path: string; index?: false }
);

export interface ApplicationModuleManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  basePath?: string;
  layout?: LazyExoticComponent<ComponentType>;
  routes: readonly ModuleRouteDefinition[];
  navigation: readonly ModuleNavigationItem[];
  dependencies?: readonly string[];
  featureFlags?: readonly string[];
  defaultEnabled: boolean;
}
