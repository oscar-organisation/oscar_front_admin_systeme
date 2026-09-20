import { expect, test, type Page } from "@playwright/test";

const studioPermissions = [
  "ui:studio.page",
  "ui:studio.publish_button",
  "api:bundle.read",
  "api:bundle.write",
  "api:bundle.publish",
];

async function authenticated(page: Page, permissions: string[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("oscar_access", "e2e-access");
    window.localStorage.setItem("oscar_refresh", "e2e-refresh");
    // Le guide de demarrage masquerait le canevas au premier affichage.
    window.localStorage.setItem("oscar.studio.guide.dismissed", "true");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ json: {
        id: "user-studio",
        nom: "Intégratrice Studio",
        email: "studio@example.test",
        org_id: "org-e2e",
        permissions: Object.fromEntries(permissions.map((code) => [code, ["view", "create", "update", "delete", "execute"]])),
      } });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test("le Studio est accessible depuis la navigation de la console", async ({ page }) => {
  await authenticated(page, studioPermissions);
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Projets de configuration" })).toBeVisible();
  // L'entree de menu vient du module lui-meme, pas de la coquille.
  if ((page.viewportSize()?.width || 0) > 760) {
    await expect(page.getByTestId("nav-studio")).toBeVisible();
  }
});

test("un projet créé s'ouvre dans l'éditeur de composition", async ({ page }) => {
  await authenticated(page, studioPermissions);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  await expect(page).toHaveURL(/\/studio\/projet-/);
  await expect(page.getByText("Plan de composition")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publier" })).toBeVisible();
});

test("sans le droit de publication, le bouton Publier reste masqué", async ({ page }) => {
  await authenticated(page, ["ui:studio.page", "api:bundle.read", "api:bundle.write"]);
  await page.goto("/studio");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  await expect(page.getByText("Plan de composition")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publier" })).toHaveCount(0);
});

test("sans le droit d'accès, le Studio est refusé", async ({ page }) => {
  await authenticated(page, ["ui:robots.page"]);
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Projets de configuration" })).toHaveCount(0);
});
