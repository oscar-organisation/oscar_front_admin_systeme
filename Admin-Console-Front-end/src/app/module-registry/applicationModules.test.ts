import { describe, expect, it } from "vitest";
import { applicationModules, consoleNavigation } from "./applicationModules";

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

  it("compose la navigation de la coquille à partir des modules", () => {
    // La barre laterale n'est plus la propriete du module Administration : le
    // Studio y place son entree sans que la coquille le connaisse.
    const cibles = consoleNavigation.map((item) => item.to);
    expect(cibles).toContain("/admin");
    expect(cibles).toContain("/studio");
    expect(new Set(cibles).size).toBe(cibles.length);
    for (const item of consoleNavigation) {
      expect(item.to.startsWith("/")).toBe(true);
      expect(item.policy.id).toBeTruthy();
    }
  });

  it("sépare la configuration des opérations et distingue le suivi de l'audit", () => {
    const structure = consoleNavigation.find((item) => item.id === "administration.iam-structure");
    const robots = consoleNavigation.find((item) => item.id === "administration.robots");
    const audit = consoleNavigation.find((item) => item.id === "administration.audit");
    const suivi = consoleNavigation.find((item) => item.id === "studio.deployments");

    expect(structure?.section).toBe("configuration");
    expect(robots?.section).toBe("operations");
    expect(suivi?.icon).not.toBe(audit?.icon);
  });
});
