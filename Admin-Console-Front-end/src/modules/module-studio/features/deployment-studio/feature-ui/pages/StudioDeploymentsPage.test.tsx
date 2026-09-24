import { render, screen } from "@testing-library/react";
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
});
