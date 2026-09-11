import { describe, expect, it } from "vitest";
import { AppError } from "./AppError";
import { normalizeError } from "./normalizeError";

describe("normalizeError", () => {
  it("préserve une AppError déjà normalisée", () => {
    const source = new AppError({
      code: "BUSINESS_RULE",
      category: "business",
      userMessage: "Action impossible dans cet état.",
      retryable: false,
    });
    expect(normalizeError(source)).toBe(source);
  });

  it("convertit un statut HTTP sans exposer le détail technique", () => {
    const result = normalizeError({ status: 403, message: "internal ACL details" });
    expect(result.category).toBe("authorization");
    expect(result.userMessage).toMatch(/autorisation/i);
    expect(result.userMessage).not.toContain("ACL");
  });

  it("classe une panne réseau comme réessayable", () => {
    const result = normalizeError(new TypeError("Failed to fetch"));
    expect(result.category).toBe("network");
    expect(result.retryable).toBe(true);
  });
});
