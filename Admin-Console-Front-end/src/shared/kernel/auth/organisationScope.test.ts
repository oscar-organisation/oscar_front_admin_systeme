import { describe, expect, it } from "vitest";
import {
  normaliseOrganisations,
  organisationRoleLabel,
  resolveOrganisationScope,
  scopeHeader,
} from "./organisationScope";

describe("organisation scope", () => {
  it("merges direct organisations and role-bearing memberships", () => {
    const organisations = normaliseOrganisations({
      organisations: [{ id: "org-a", nom: "Enseigne Nord", slug: "nord", is_primary: true }],
      memberships: [{
        organisation_id: "org-a",
        organisation: { id: "org-a", nom: "Enseigne Nord", slug: "nord" },
        roles: ["Superviseur", { id: "operator", nom: "Opérateur" }],
      }],
      organisation_memberships: [{
        organisation_id: "org-b",
        organisation_nom: "Enseigne Sud",
        role: "Observateur",
      }],
    });

    expect(organisations.map(({ id }) => id)).toEqual(["org-a", "org-b"]);
    expect(organisationRoleLabel(organisations[0])).toBe("Superviseur, Opérateur");
    expect(organisationRoleLabel(organisations[1])).toBe("Observateur");
  });

  it("excludes revoked memberships", () => {
    const organisations = normaliseOrganisations({
      memberships: [
        { organisation_id: "active", organisation_nom: "Active" },
        { organisation_id: "disabled", organisation_nom: "Désactivée", status: "disabled" },
      ],
    });

    expect(organisations).toHaveLength(1);
    expect(organisations[0]?.id).toBe("active");
  });

  it("keeps an authorised requested scope and rejects stale stored scopes", () => {
    const organisations = normaliseOrganisations({
      organisations: [
        { id: "primary", nom: "Principale", is_primary: true },
        { id: "secondary", nom: "Secondaire" },
      ],
    });

    expect(resolveOrganisationScope({}, organisations, "secondary")).toBe("secondary");
    expect(resolveOrganisationScope({}, organisations, "removed-org")).toBe("primary");
  });

  it("allows global scope only for a super administrator", () => {
    const organisations = normaliseOrganisations({
      organisations: [{ id: "org-a", nom: "Organisation A" }],
    });

    expect(resolveOrganisationScope({ is_superadmin: true }, organisations, "*")).toBe("*");
    expect(resolveOrganisationScope({ is_superadmin: false }, organisations, "*")).toBe("org-a");
    expect(scopeHeader("*")).toBe("*");
    expect(scopeHeader("org-a")).toBe("org-a");
  });

  it("adds demo fixtures only when explicitly supplied", () => {
    const demo = [{
      id: "demo-org",
      nom: "Organisation de démonstration",
      slug: "organisation-demo",
      is_demo: true,
      roles: [{ nom: "Opérateur" }],
    }];

    expect(normaliseOrganisations({})).toEqual([]);
    expect(normaliseOrganisations({}, demo)).toEqual(demo);
  });
});
