import type { PermissionMap } from "../permissions";

export interface OrganisationRole {
  id?: string;
  code?: string;
  nom: string;
}

export interface OrganisationContextInput {
  id?: string;
  organisation_id?: string;
  nom?: string;
  organisation_nom?: string;
  slug?: string;
  parent_id?: string | null;
  is_primary?: boolean;
  active?: boolean;
  status?: string;
  roles?: Array<OrganisationRole | string>;
  role?: OrganisationRole | string;
  role_names?: string[];
  permissions?: PermissionMap;
}

export interface OrganisationMembershipInput extends OrganisationContextInput {
  organisation?: OrganisationContextInput;
}

export interface ScopedOrganisation {
  id: string;
  nom: string;
  slug: string;
  parent_id?: string | null;
  is_primary?: boolean;
  is_demo?: boolean;
  roles: OrganisationRole[];
  permissions?: PermissionMap;
}

interface OrganisationSource {
  organisations?: OrganisationContextInput[];
  memberships?: OrganisationMembershipInput[];
  organisation_memberships?: OrganisationMembershipInput[];
  org_id?: string | null;
  active_org_id?: string | null;
  is_superadmin?: boolean;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normaliseRole(role: OrganisationRole | string): OrganisationRole | null {
  if (typeof role === "string") return role.trim() ? { nom: role.trim() } : null;
  if (!role || typeof role.nom !== "string" || !role.nom.trim()) return null;
  return { ...role, nom: role.nom.trim() };
}

function rolesFor(source: OrganisationContextInput): OrganisationRole[] {
  const candidates = [
    ...(source.roles || []),
    ...(source.role ? [source.role] : []),
    ...(source.role_names || []),
  ];
  const roles = candidates.map(normaliseRole).filter((role): role is OrganisationRole => Boolean(role));
  return roles.filter((role, index) => roles.findIndex((candidate) =>
    (candidate.id && role.id ? candidate.id === role.id : candidate.nom === role.nom),
  ) === index);
}

function normaliseOrganisation(source: OrganisationContextInput): ScopedOrganisation | null {
  if (source.active === false || source.status === "inactive" || source.status === "disabled") return null;
  const id = source.id || source.organisation_id;
  if (!id) return null;
  const nom = source.nom || source.organisation_nom || `Organisation ${id}`;
  return {
    id,
    nom,
    slug: source.slug || slugify(nom) || id,
    ...(source.parent_id !== undefined ? { parent_id: source.parent_id } : {}),
    ...(source.is_primary !== undefined ? { is_primary: source.is_primary } : {}),
    roles: rolesFor(source),
    ...(source.permissions ? { permissions: source.permissions } : {}),
  };
}

function fromMembership(membership: OrganisationMembershipInput): ScopedOrganisation | null {
  const organisation = membership.organisation || {};
  const id = organisation.id || membership.organisation_id || membership.id;
  const role = membership.role || organisation.role;
  const permissions = membership.permissions || organisation.permissions;
  const isPrimary = membership.is_primary ?? organisation.is_primary;
  return normaliseOrganisation({
    ...membership,
    ...organisation,
    ...(id ? { id } : {}),
    roles: [...(organisation.roles || []), ...(membership.roles || [])],
    ...(role ? { role } : {}),
    role_names: [...(organisation.role_names || []), ...(membership.role_names || [])],
    ...(permissions ? { permissions } : {}),
    ...(isPrimary !== undefined ? { is_primary: isPrimary } : {}),
  });
}

export function normaliseOrganisations(
  source: OrganisationSource,
  demoOrganisations: ScopedOrganisation[] = [],
): ScopedOrganisation[] {
  const memberships = [...(source.memberships || []), ...(source.organisation_memberships || [])];
  const candidates = [
    ...(source.organisations || []).map(normaliseOrganisation),
    ...memberships.map(fromMembership),
    ...demoOrganisations,
  ].filter((organisation): organisation is ScopedOrganisation => Boolean(organisation));

  const organisations = new Map<string, ScopedOrganisation>();
  for (const organisation of candidates) {
    const previous = organisations.get(organisation.id);
    if (!previous) {
      organisations.set(organisation.id, organisation);
      continue;
    }
    const isPrimary = previous.is_primary || organisation.is_primary;
    organisations.set(organisation.id, {
      ...previous,
      ...organisation,
      roles: rolesFor({ roles: [...previous.roles, ...organisation.roles] }),
      ...(isPrimary !== undefined ? { is_primary: isPrimary } : {}),
    });
  }

  if (organisations.size === 0 && source.org_id) {
    organisations.set(source.org_id, {
      id: source.org_id,
      nom: `Organisation ${source.org_id}`,
      slug: source.org_id,
      is_primary: true,
      roles: [],
    });
  }

  return [...organisations.values()].sort((left, right) => {
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return left.nom.localeCompare(right.nom, "fr");
  });
}

export function resolveOrganisationScope(
  source: OrganisationSource,
  organisations: ScopedOrganisation[],
  requestedScope?: string | null,
): string | null {
  if (source.is_superadmin && requestedScope === "*") return "*";
  if (requestedScope && organisations.some((organisation) => organisation.id === requestedScope)) {
    return requestedScope;
  }
  if (source.active_org_id && organisations.some((organisation) => organisation.id === source.active_org_id)) {
    return source.active_org_id;
  }
  const primary = organisations.find((organisation) => organisation.is_primary) || organisations[0];
  if (primary) return primary.id;
  return source.is_superadmin ? "*" : null;
}

export function scopeHeader(organisationId: string | null): string | undefined {
  return organisationId || undefined;
}

export function organisationRoleLabel(organisation?: ScopedOrganisation): string {
  if (!organisation || organisation.roles.length === 0) return "Membre";
  return organisation.roles.map((role) => role.nom).join(", ");
}
