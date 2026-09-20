import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "./model";
import { ajouterProjet, configurerPerimetre, rafraichir } from "./projectStore";
import { listerBundles } from "../feature-data/studioApi";

vi.mock("../feature-data/studioApi", () => ({
  listerBundles: vi.fn(), creerBundle: vi.fn(), enregistrerBrouillon: vi.fn(),
  lireVersion: vi.fn(), projetDepuisBundle: vi.fn(),
}));

describe("isolation du cache Studio", () => {
  beforeEach(() => {
    configurerPerimetre(null, null);
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("sépare utilisateurs et organisations sans importer l'ancien cache", () => {
    const projet = createProject("Projet A", "", "ENVIRONNEMENT_EXECUTION_ROBOT", "VIDE");
    localStorage.setItem("oscar.studio.configuration.v1.projects", JSON.stringify([projet]));
    configurerPerimetre("u1", "a");
    ajouterProjet(projet);
    configurerPerimetre("u1", "b");
    ajouterProjet({ ...projet, id: "b", name: "Projet B" });
    configurerPerimetre("u2", "a");
    ajouterProjet({ ...projet, id: "c", name: "Projet C" });
    expect(JSON.parse(localStorage.getItem("oscar.studio.projects.v2:u1:a")!)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("oscar.studio.projects.v2:u1:b")!)[0].name).toBe("Projet B");
    expect(JSON.parse(localStorage.getItem("oscar.studio.projects.v2:u2:a")!)[0].name).toBe("Projet C");
  });

  it("ignore une réponse reçue après un changement d'organisation", async () => {
    let terminer!: (bundles: []) => void;
    vi.mocked(listerBundles).mockReturnValue(new Promise((resolve) => { terminer = resolve; }));
    configurerPerimetre("u1", "a");
    const requete = rafraichir();
    configurerPerimetre("u1", "b");
    terminer([]);
    await requete;
    expect(localStorage.getItem("oscar.studio.projects.v2:u1:b")).toBeNull();
  });
});
