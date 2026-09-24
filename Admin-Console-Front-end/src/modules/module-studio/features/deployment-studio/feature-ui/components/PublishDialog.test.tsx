import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../../feature-domain/model";
import {
  deployer,
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
    ]);
    vi.mocked(listerRobots).mockResolvedValue([
      { id: "robot-a", nom: "OSCAR Paris", slug: "oscar-paris", statut: "online", site_id: "site-a" },
      { id: "robot-b", nom: "OSCAR Lyon", slug: "oscar-lyon", statut: "online", site_id: "site-b" },
    ]);
    vi.mocked(listerPresetsTous).mockResolvedValue([]);
    vi.mocked(deployer).mockResolvedValue([]);
  });

  it("n'affiche que les sites dans cette portée et en accepte plusieurs", async () => {
    const project = {
      ...createProject("Déploiement magasins", "", "ENVIRONNEMENT_EXECUTION_ROBOT", "VIDE"),
      bundleId: "bundle-1",
    };
    render(
      <PublishDialog
        project={project}
        issues={[]}
        canDeploy
        onClose={() => undefined}
        onPublished={() => undefined}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Publier la version/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Sites/ }));

    expect(screen.queryByText("OSCAR Paris")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Paris Centre/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Lyon Part-Dieu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Déployer sur 2 robots" }));

    await waitFor(() => {
      expect(deployer).toHaveBeenCalledWith(
        "version-2",
        { siteIds: ["site-a", "site-b"] },
        "Déploiement magasins",
      );
    });
  });
});
