import { expect, test, type Page } from "@playwright/test";

const studioPermissions = [
  "ui:studio.page",
  "ui:studio.publish_button",
  "api:bundle.read",
  "api:bundle.write",
  "api:bundle.publish",
  "api:deployment.read",
  "api:deployment.execute",
];

/**
 * Serveur Studio simulé : il tient l'état d'un bundle et de sa version, ce qui
 * suffit à jouer le parcours réel (composer, publier, déployer) sans base.
 */
async function studioServer(page: Page, permissions: string[], options?: { erreurValidation?: string }) {
  await page.addInitScript(() => {
    window.localStorage.setItem("oscar_access", "e2e-access");
    window.localStorage.setItem("oscar_refresh", "e2e-refresh");
    window.localStorage.setItem("oscar.studio.guide.dismissed", "true");
    // Chaque test repart d'un navigateur sans brouillon local.
    window.localStorage.removeItem("oscar.studio.configuration.v1.projects");
  });

  const etat = { bundles: [] as Record<string, unknown>[], deployments: [] as unknown[] };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const chemin = url.pathname.replace(/^.*\/api/, "");
    const methode = request.method();

    if (chemin.endsWith("/auth/me")) {
      await route.fulfill({ json: {
        id: "user-studio", nom: "Intégratrice Studio", email: "studio@example.test", org_id: "org-e2e",
        permissions: Object.fromEntries(permissions.map((code) => [code, ["view", "create", "update", "delete", "execute"]])),
      } });
      return;
    }
    if (chemin === "/studio/bundles" && methode === "GET") {
      await route.fulfill({ json: etat.bundles });
      return;
    }
    if (chemin === "/studio/bundles" && methode === "POST") {
      const corps = request.postDataJSON();
      const bundle = {
        id: "bundle-e2e", org_id: "org-e2e", nom: corps.nom, slug: "bundle-e2e",
        description: corps.description, target: corps.target, statut: "active",
        draft_version: { id: "version-e2e", bundle_id: "bundle-e2e", numero: 1, statut: "draft" },
        published_version: null, version_count: 1, robot_count: 0,
        component_count: 2, agent_count: 1,
      };
      etat.bundles = [bundle];
      await route.fulfill({ status: 201, json: bundle });
      return;
    }
    if (chemin.endsWith("/draft") && methode === "PUT") {
      await route.fulfill({ json: { id: "version-e2e", bundle_id: "bundle-e2e", numero: 1, statut: "draft", checksum: "abc" } });
      return;
    }
    if (chemin.endsWith("/validate")) {
      const erreurs = options?.erreurValidation ? [options.erreurValidation] : [];
      await route.fulfill({ json: { valide: erreurs.length === 0, erreurs, avertissements: [] } });
      return;
    }
    if (chemin.endsWith("/publish")) {
      await route.fulfill({ json: { id: "version-e2e", bundle_id: "bundle-e2e", numero: 1, statut: "published", checksum: "abc" } });
      return;
    }
    if (chemin === "/robots" && methode === "GET") {
      await route.fulfill({ json: [
        { id: "robot-1", nom: "OSCAR-01", slug: "oscar-01", statut: "online" },
        { id: "robot-2", nom: "OSCAR-02", slug: "oscar-02", statut: "offline" },
      ] });
      return;
    }
    if (chemin === "/studio/deployments" && methode === "POST") {
      const corps = request.postDataJSON();
      etat.deployments = corps.robot_ids;
      await route.fulfill({ status: 201, json: corps.robot_ids.map((robotId: string) => ({
        id: `deploiement-${robotId}`, robot_id: robotId, statut: "pending", version_numero: 1,
      })) });
      return;
    }
    await route.fulfill({ json: [] });
  });

  return etat;
}

async function creerProjet(page: Page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByText("Plan de composition")).toBeVisible();
}

async function creerProjetSansCanevas(page: Page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
}

test("le Studio est accessible depuis la navigation de la console", async ({ page }) => {
  await studioServer(page, studioPermissions);
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Projets de configuration" })).toBeVisible();
  if ((page.viewportSize()?.width || 0) > 760) {
    await expect(page.getByTestId("nav-studio")).toBeVisible();
  }
});

test("un projet créé devient un bundle serveur et s'ouvre dans l'éditeur", async ({ page }) => {
  await studioServer(page, studioPermissions);
  await creerProjetSansCanevas(page);
  // L'identifiant de route est celui du bundle serveur, pas un identifiant local.
  await expect(page).toHaveURL(/\/studio\/bundle-e2e$/);
  if ((page.viewportSize()?.width || 0) >= 1100) {
    await expect(page.getByRole("button", { name: "Publier" })).toBeVisible();
  }
});

test("publier puis déployer sur un robot choisi", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) < 1100, "Le plan de composition demande un écran large.");
  const etat = await studioServer(page, studioPermissions);
  await creerProjet(page);

  await page.getByRole("button", { name: "Publier" }).click();
  await page.getByRole("button", { name: /Publier la version/ }).click();

  const cible = page.locator(".deployment-target", { hasText: "OSCAR-01" });
  await expect(cible).toBeVisible();
  await cible.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Déployer sur 1 robot/ }).click();

  await expect(page.getByText("1 déploiement en cours")).toBeVisible();
  await expect(page.getByText("En attente du robot")).toBeVisible();
  expect(etat.deployments).toEqual(["robot-1"]);
});

test("une composition refusée par le serveur ne se publie pas", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) < 1100, "Le plan de composition demande un écran large.");
  await studioServer(page, studioPermissions, { erreurValidation: "Identifiant technique dupliqué : CANAL_X." });
  await creerProjet(page);

  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByText("Identifiant technique dupliqué : CANAL_X.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Publier la version/ })).toBeDisabled();
});

test("sur un écran étroit, l'éditeur renvoie vers un poste de travail", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) >= 1100, "Cas propre aux petits écrans.");
  await studioServer(page, studioPermissions);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByText(/écran d’au moins/)).toBeVisible();
});

test("sans le droit de publication, le bouton Publier reste masqué", async ({ page }) => {
  test.skip((page.viewportSize()?.width || 0) < 1100, "Le plan de composition demande un écran large.");
  await studioServer(page, ["ui:studio.page", "api:bundle.read", "api:bundle.write"]);
  await creerProjet(page);
  await expect(page.getByRole("button", { name: "Publier" })).toHaveCount(0);
});

test("sans le droit d'accès, le Studio est refusé", async ({ page }) => {
  await studioServer(page, ["ui:robots.page"]);
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Projets de configuration" })).toHaveCount(0);
});
