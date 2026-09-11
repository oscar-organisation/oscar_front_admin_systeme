import { describe, expect, it } from "vitest";
import { applicationModules } from "./applicationModules";

describe("application module registry", () => {
  it("expose des identifiants de modules et de routes uniques", () => {
    const moduleIds = applicationModules.map((module) => module.id);
    const routeIds = applicationModules.flatMap((module) => module.routes.map((route) => route.id));
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
    expect(new Set(routeIds).size).toBe(routeIds.length);
  });

  it("déclare une politique et un composant pour chaque route", () => {
    for (const route of applicationModules.flatMap((module) => module.routes)) {
      expect(route.policy.id).toBeTruthy();
      expect(route.component).toBeTruthy();
      expect(route.index === true || typeof route.path === "string").toBe(true);
    }
  });
});
