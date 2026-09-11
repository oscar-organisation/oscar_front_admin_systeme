import { expect, test, type Page } from "@playwright/test";

const allPermissions = [
  "ui:orgs.page", "ui:sites.page", "ui:users.page", "ui:roles.page",
  "ui:robots.page", "ui:sandbox.page", "ui:audit.page",
  "ui:cockpit.page", "ui:operator.page",
];

async function authenticated(page: Page, permissions = allPermissions) {
  await page.addInitScript(() => {
    window.localStorage.setItem("oscar_access", "e2e-access");
    window.localStorage.setItem("oscar_refresh", "e2e-refresh");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) {
      const permissionMap = Object.fromEntries(permissions.map((code) => [code, ["view"]]));
      await route.fulfill({ json: {
        id: "user-e2e",
        nom: "Administrateur Test",
        email: "admin@example.test",
        org_id: "org-e2e",
        permissions: permissionMap,
      } });
      return;
    }
    if (path.endsWith("/roles/role-e2e")) {
      await route.fulfill({ json: { id: "role-e2e", nom: "Superviseur", permissions: [] } });
      return;
    }
    if (path.endsWith("/roles")) {
      await route.fulfill({ json: [{ id: "role-e2e", nom: "Superviseur", description: "Accès de test" }] });
      return;
    }
    if (path.endsWith("/features")) {
      await route.fulfill({ json: [{ code: "ui:roles.page", label: "Page rôles", module: "Identités", actions: ["view"] }] });
      return;
    }
    await route.fulfill({ json: [] });
  });
}

test("navigation administration et sidebar repliable", async ({ page }) => {
  await authenticated(page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard")).toBeVisible();
  if ((page.viewportSize()?.width || 0) <= 760) {
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    await expect(page.getByRole("navigation")).toBeVisible();
  } else {
    await expect(page.getByRole("navigation")).toBeVisible();
    await page.getByRole("button", { name: "Réduire la navigation" }).click();
    await expect(page.locator(".platform-shell")).toHaveClass(/sidebar-collapsed/);
    await page.getByRole("button", { name: "Déployer la navigation" }).click();
    await expect(page.locator(".platform-shell")).not.toHaveClass(/sidebar-collapsed/);
  }
});

test("bascule uniquement entre les organisations assignées et propage le périmètre", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("oscar_access", "e2e-access");
    window.localStorage.setItem("oscar_refresh", "e2e-refresh");
  });
  const scopedRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/auth/me")) {
      const scope = request.headers()["x-organization-id"];
      if (scope) scopedRequests.push(scope);
      const permissionMap = Object.fromEntries(allPermissions.map((code) => [code, ["view"]]));
      await route.fulfill({ json: {
        id: "user-multitenant",
        nom: "Opératrice Multisite",
        email: "operator@example.test",
        active_org_id: "org-nord",
        organisations: [
          { id: "org-nord", nom: "Enseigne Nord", slug: "nord", is_primary: true, roles: ["Superviseur"] },
          { id: "org-sud", nom: "Enseigne Sud", slug: "sud", roles: ["Opérateur"] },
        ],
        permissions: permissionMap,
      } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/");
  const switcher = page.getByTestId("organisation-switcher");
  await expect(switcher).toContainText("Enseigne Nord");
  await expect(switcher).toContainText("Superviseur");

  await switcher.click();
  await page.getByTestId("organisation-option-org-sud").click();
  await expect(switcher).toContainText("Enseigne Sud");
  await expect(switcher).toContainText("Opérateur");
  await expect.poll(() => scopedRequests.at(-1)).toBe("org-sud");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("oscar_active_organisation"))).toBe("org-sud");
});

test("la vue globale est explicitement transmise à l'API", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("oscar_access", "e2e-access");
    window.localStorage.setItem("oscar_refresh", "e2e-refresh");
    window.localStorage.setItem("oscar_active_organisation", "org-nord");
  });
  const scopes: Array<string | undefined> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/auth/me")) {
      scopes.push(request.headers()["x-organization-id"]);
      await route.fulfill({ json: {
        id: "superadmin-e2e",
        nom: "Super Admin",
        email: "admin@example.test",
        is_superadmin: true,
        organisations: [
          { id: "org-nord", nom: "Enseigne Nord", slug: "nord", is_primary: true },
        ],
        permissions: Object.fromEntries(allPermissions.map((code) => [code, ["view"]])),
      } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto("/");
  await page.getByTestId("organisation-switcher").click();
  await page.getByTestId("organisation-option-global").click();
  await expect(page.getByTestId("organisation-switcher")).toContainText("Toutes les organisations");
  await expect.poll(() => scopes.at(-1)).toBe("*");
});

test("refus explicite lorsqu'une permission de route manque", async ({ page }) => {
  await authenticated(page, ["ui:operator.page"]);
  await page.goto("/admin/utilisateurs");
  await expect(page.getByRole("heading", { name: /fonction n’est pas autorisée/i })).toBeVisible();
});

test("la page rôles reste bornée dans le viewport", async ({ page }) => {
  await authenticated(page);
  await page.goto("/admin/roles");
  await expect(page.getByTestId("roles-page")).toBeVisible();
  const size = await page.locator(".permissions-panel").boundingBox();
  expect(size?.height || 0).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
  await expect(page.locator(".permissions-grid")).toHaveCSS("overflow-y", "auto");
});

test("le formulaire de connexion reflow sans débordement horizontal", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("une route inconnue affiche une vraie page 404", async ({ page }) => {
  await page.goto("/route-inexistante");
  await expect(page.getByRole("heading", { name: /adresse ne correspond à aucun écran/i })).toBeVisible();
});
