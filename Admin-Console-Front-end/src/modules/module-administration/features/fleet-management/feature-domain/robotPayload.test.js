import { describe, expect, it } from "vitest";

import { corpsRobot } from "./robotPayload.js";

const FORMULAIRE = {
  nom: "OSCAR-04",
  org_id: "org-carrefour",
  site_id: "site-rayon-frais",
  serial: "OSC-2024-0004",
  modele: "ROSMASTER M3 Pro",
  firmware: "1.0.0",
  statut: "online",
  batterie: "100",
  capacites: "navigation, vision",
};

describe("corpsRobot", () => {
  it("nomme l'organisation org_id, comme l'attend l'API", () => {
    // Le formulaire envoyait `organisation_id`. Pydantic ignore une cle
    // inconnue sans rien dire : le robot naissait sans organisation, donc
    // invisible dans une liste filtree et hors de portee d'un deploiement.
    const corps = corpsRobot(FORMULAIRE);
    expect(corps.org_id).toBe("org-carrefour");
    expect(corps).not.toHaveProperty("organisation_id");
  });

  it("transmet null plutot qu'une chaine vide pour un rattachement absent", () => {
    const corps = corpsRobot({ ...FORMULAIRE, org_id: "", site_id: "" });
    expect(corps.org_id).toBeNull();
    expect(corps.site_id).toBeNull();
  });

  it("decoupe les capacites et ecarte les vides", () => {
    const corps = corpsRobot({ ...FORMULAIRE, capacites: " navigation ,, vision , " });
    expect(corps.capacites).toEqual(["navigation", "vision"]);
  });

  it("rend une liste vide quand aucune capacite n'est saisie", () => {
    expect(corpsRobot({ ...FORMULAIRE, capacites: "" }).capacites).toEqual([]);
  });

  it("convertit la batterie en nombre", () => {
    expect(corpsRobot(FORMULAIRE).batterie).toBe(100);
  });
});
