import { describe, expect, it } from "vitest";
import { canAny, canSee, evaluatePolicy, hasPermission } from "./authorization";

describe("authorization kernel", () => {
  const permissions = {
    "api:org.read": ["view"],
    "api:org.write": ["view", "create", "update", "delete"],
    "ui:orgs.page": ["view"],
  } as const;

  it("évalue les actions et les raccourcis de visibilité", () => {
    expect(hasPermission(permissions, "api:org.write", "create")).toBe(true);
    expect(hasPermission(permissions, "api:org.read", "create")).toBe(false);
    expect(canSee(permissions, "ui:orgs.page")).toBe(true);
    expect(canAny(permissions, ["ui:audit.page", "ui:orgs.page"])).toBe(true);
  });

  it("respecte les politiques ALL et ANY", () => {
    const requiredPermissions = [
      { code: "api:org.read" },
      { code: "api:org.write", action: "delete" },
    ];
    expect(evaluatePolicy(permissions, {
      id: "org.all",
      requiresAuthentication: true,
      requiredPermissions,
      permissionMode: "ALL",
    })).toBe(true);
    expect(evaluatePolicy(permissions, {
      id: "org.any",
      requiresAuthentication: true,
      requiredPermissions: [{ code: "ui:missing" }, { code: "ui:orgs.page" }],
      permissionMode: "ANY",
    })).toBe(true);
  });
});
