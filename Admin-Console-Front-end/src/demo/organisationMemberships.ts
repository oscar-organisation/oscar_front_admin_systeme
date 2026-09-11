import type { ScopedOrganisation } from "@/shared/kernel/auth/organisationScope";

// Explicitly opt-in local fixtures. AuthProvider merges them only in `npm run dev:demo`.
export const DEMO_ORGANISATION_MEMBERSHIPS: ScopedOrganisation[] = [
  {
    id: "demo-oscar-retail-france",
    nom: "OSCAR Retail France",
    slug: "oscar-retail-france",
    is_primary: true,
    is_demo: true,
    roles: [{ code: "fleet-supervisor", nom: "Superviseur de flotte" }],
  },
  {
    id: "demo-lab-robotique",
    nom: "Laboratoire robotique",
    slug: "laboratoire-robotique",
    is_demo: true,
    roles: [{ code: "robot-operator", nom: "Opérateur robot" }],
  },
  {
    id: "demo-logistique-partenaire",
    nom: "Logistique partenaire",
    slug: "logistique-partenaire",
    is_demo: true,
    roles: [{ code: "viewer", nom: "Observateur" }],
  },
];
