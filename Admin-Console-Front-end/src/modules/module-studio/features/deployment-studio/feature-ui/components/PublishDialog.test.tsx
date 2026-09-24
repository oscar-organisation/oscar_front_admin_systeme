import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createProject } from "../../feature-domain/model";
import {
  deployer,
  listerDeploiements,
  listerFlottes,
  listerPresetsTous,
  listerRobots,
  listerSites,
  publier,
  verifier,
} from "../../feature-data/studioApi";
import PublishDialog from "./PublishDialog";

vi.mock("@/shared/kernel/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { is_superadmin: false } }),
}));

vi.mock("../../feature-data/studioApi", () => ({
  deployer: vi.fn(),
  listerDeploiements: vi.fn(),
  listerFlottes: vi.fn(),
  listerPresetsTous: vi.fn(),
  listerRobots: vi.fn(),
  listerSites: vi.fn(),
  publier: vi.fn(),
  verifier: vi.fn(),
}));

describe("PublishDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifier).mockResolvedValue({ valide: true, erreurs: [], avertissements: [] });
    vi.mocked(publier).mockResolvedValue({ id: "version-2", numero: 2 } as never);
    vi.mocked(listerFlottes).mockResolvedValue([]);
    vi.mocked(listerSites).mockResolvedValue([
      { id: "site-a", nom: "Paris Centre", code: "PARIS" },
      { id: "site-b", nom: "Lyon Part-Dieu", code: "LYON" },
      { id: "site-vide", nom: "Bordeaux Lac", code: "BORDEAUX" },
    ]);
    vi.mocked(listerRobots).mockResolvedValue([
      { id: "robot-a", nom: "OSCAR Paris", slug: "oscar-paris", statut: "online", site_id: "site-a" },
      { id: "robot-b", nom: "OSCAR Lyon", slug: "oscar-lyon", statut: "online", site_id: "site-b" },
    ]);
    vi.mocked(listerPresetsTous).mockResolvedValue([]);
    vi.mocked(deployer).mockResolvedValue([]);
    vi.mocked(listerDeploiements).mockResolvedValue([]);
  });

  it("n'affiche que les sites dans cette portée et en accepte plusieurs", async () => {
    const project = {
      ...createProject("Déploiement magasins", "", "ENVIRONNEMENT_EXECUTION_ROBOT", "VIDE"),
      bundleId: "bundle-1",
    };
    render(
      <MemoryRouter>
        <PublishDialog
          project={project}
          issues={[]}
          canDeploy
          onClose={() => undefined}
          onPublished={() => undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Publier la version/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Sites/ }));

    expect(screen.queryByText("OSCAR Paris")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Bordeaux Lac/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Paris Centre/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Lyon Part-Dieu/ }));
    const bouton = screen.getByRole("button", { name: "Déployer sur 2 robots" });
    expect(bouton.querySelector("[translate='no']")).toHaveTextContent("2");
    fireEvent.click(bouton);

    await waitFor(() => {
      expect(deployer).toHaveBeenCalledWith(
        "version-2",
        { siteIds: ["site-a", "site-b"] },
        "Déploiement magasins",
      );
    });
  });

  it("actualise le suivi jusqu'à la confirmation du runtime", async () => {
    vi.mocked(deployer).mockResolvedValue([
      {
        id: "deployment-1",
        robot_id: "robot-a",
        robot_nom: "OSCAR Paris",
        statut: "pending",
      },
    ]);
    vi.mocked(listerDeploiements).mockResolvedValue([
      {
        id: "deployment-1",
        robot_id: "robot-a",
        robot_nom: "OSCAR Paris",
        statut: "active",
      },
    ]);
    const project = {
      ...createProject("Déploiement magasins", "", "ENVIRONNEMENT_EXECUTION_ROBOT", "VIDE"),
      bundleId: "bundle-1",
    };

    render(
      <MemoryRouter>
        <PublishDialog
          project={project}
          issues={[]}
          canDeploy
          onClose={() => undefined}
          onPublished={() => undefined}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Publier la version/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /OSCAR Paris/ }));
    fireEvent.click(screen.getByRole("button", { name: "Déployer sur 1 robot" }));

    expect(await screen.findByText("Runtime actif")).toBeInTheDocument();
    expect(listerDeploiements).toHaveBeenCalledWith({ bundleId: "bundle-1" });
    expect(screen.getByRole("button", { name: /Voir le suivi/ })).toBeInTheDocument();
  });
});
