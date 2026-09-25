import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listerDeploiements, listerRobots } from "../../feature-data/studioApi";
import StudioDeploymentsPage from "./StudioDeploymentsPage";

vi.mock("../../feature-data/studioApi", () => ({
  listerDeploiements: vi.fn(),
  listerRobots: vi.fn(),
}));

describe("StudioDeploymentsPage", () => {
  beforeEach(() => {
    vi.mocked(listerRobots).mockResolvedValue([
      { id: "robot-1", nom: "OSCAR-01", slug: "oscar-01", statut: "online" },
    ]);
    vi.mocked(listerDeploiements).mockResolvedValue([
      {
        id: "deployment-1",
        robot_id: "robot-1",
        robot_nom: "OSCAR-01",
        robot_slug: "oscar-01",
        bundle_nom: "Navigation magasin",
        version_numero: 3,
        statut: "failed",
        message: "Checksum de l’image invalide",
        report: { etape: "verification", resultat: "refus" },
        created_at: "2026-09-24T08:30:00Z",
      },
    ]);
  });

  it("affiche le message renvoyé pour un déploiement en échec", async () => {
    render(<StudioDeploymentsPage />);

    expect(await screen.findByText("Checksum de l’image invalide")).toBeInTheDocument();
    expect(screen.getByText("Échec", { selector: ".deployment-status" })).toBeInTheDocument();
    expect(screen.getByText("OSCAR-01", { selector: ".deployment-row__identity strong" })).toBeInTheDocument();
  });

  it("distingue les déploiements en cours des runtimes déjà actifs", async () => {
    vi.mocked(listerDeploiements).mockResolvedValue([
      {
        id: "deployment-pending",
        robot_id: "robot-1",
        robot_nom: "OSCAR en attente",
        statut: "pending",
        created_at: "2026-09-24T08:30:00Z",
      },
      {
        id: "deployment-delivered",
        robot_id: "robot-2",
        robot_nom: "OSCAR en application",
        statut: "delivered",
        created_at: "2026-09-24T08:31:00Z",
      },
      {
        id: "deployment-active",
        robot_id: "robot-3",
        robot_nom: "OSCAR actif",
        statut: "active",
        created_at: "2026-09-24T08:32:00Z",
      },
    ]);

    render(<StudioDeploymentsPage />);

    expect(await screen.findByText("OSCAR actif")).toBeInTheDocument();
    const carteEnCours = screen.getByRole("button", { name: /En cours 2/ });
    expect(screen.getByRole("button", { name: /Actifs 1/ })).toBeInTheDocument();
    fireEvent.click(carteEnCours);

    await waitFor(() => expect(screen.queryByText("OSCAR actif")).not.toBeInTheDocument());
    expect(screen.getByText("OSCAR en attente")).toBeInTheDocument();
    expect(screen.getByText("OSCAR en application")).toBeInTheDocument();
  });

  it("garde le compte rendu ouvert quand la page se réactualise", async () => {
    // Le suivi interrogeait le serveur toutes les cinq secondes et remplacait
    // la liste par un voyant de chargement : les lignes etaient demontees, et
    // le compte rendu qu'on etait en train de lire se refermait.
    const enCours = {
      id: "deployment-1",
      robot_id: "robot-1",
      robot_nom: "OSCAR-01",
      robot_slug: "oscar-01",
      bundle_nom: "Navigation magasin",
      version_numero: 3,
      statut: "delivered",
      report: { etape: "reception" },
      created_at: "2026-09-24T08:30:00Z",
    };
    vi.mocked(listerDeploiements).mockResolvedValue([enCours]);

    render(<StudioDeploymentsPage />);

    const details = await screen.findByText("Compte rendu du robot");
    fireEvent.click(details);
    const bloc = details.closest("details") as HTMLDetailsElement;
    await waitFor(() => expect(bloc.open).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /Actualiser/ }));

    await waitFor(() => expect(vi.mocked(listerDeploiements).mock.calls.length).toBeGreaterThan(2));
    expect(bloc.open).toBe(true);
    expect(screen.queryByText(/Chargement des déploiements/)).not.toBeInTheDocument();
  });

  it("ne remplace pas la liste quand le serveur renvoie la même chose", async () => {
    // C'est ce qui supprime les sauts : sans changement, aucun rendu.
    render(<StudioDeploymentsPage />);

    const ligne = await screen.findByText("Navigation magasin");
    fireEvent.click(screen.getByRole("button", { name: /Actualiser/ }));

    await waitFor(() => expect(vi.mocked(listerDeploiements).mock.calls.length).toBeGreaterThan(2));
    // Le meme noeud du DOM, donc React n'a rien remonte.
    expect(screen.getByText("Navigation magasin")).toBe(ligne);
  });
});
