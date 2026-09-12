import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, SESSION_EXPIRED_EVENT } from "../api";
import { getUserErrorMessage } from "../errors";
import { hasPermission, type PermissionMap } from "../permissions";
import { reportError } from "../observability";
import { runtimeConfig } from "../../config";
import { DEMO_ORGANISATION_MEMBERSHIPS } from "@/demo/organisationMemberships";
import {
  normaliseOrganisations,
  resolveOrganisationScope,
  scopeHeader,
  type OrganisationMembershipInput,
  type ScopedOrganisation,
} from "./organisationScope";

export interface AuthUser {
  id: string;
  email: string;
  nom: string;
  org_id?: string | null;
  tenant_id?: string | null;
  is_superadmin?: boolean;
  active_org_id?: string | null;
  organisations?: ScopedOrganisation[];
  memberships?: OrganisationMembershipInput[];
  organisation_memberships?: OrganisationMembershipInput[];
  permissions?: PermissionMap;
}

export type OrganisationContext = ScopedOrganisation;
export const ORGANISATION_CHANGED_EVENT = "oscar:organisation-changed";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  permissions: PermissionMap;
  ready: boolean;
  activeOrganisationId: string | null;
  organisations: OrganisationContext[];
  activeOrganisation: OrganisationContext | null;
  switchingOrganisation: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  switchOrganisation: (organisationId: string | null) => Promise<void>;
  can: (code: string, action?: string) => boolean;
}

/**
 * Correspondance des codes courts historiques vers les permissions réellement
 * servies par l'API.
 *
 * L'API expose `api:<ressource>.<capacité>` avec un tableau d'actions, par
 * exemple `api:org.write -> ["view","create","update","delete"]`. Plusieurs
 * pages interrogeaient encore une forme abrégée, `org:create`, qui ne
 * correspond à aucun code servi : la vérification échouait donc toujours, et
 * les boutons de création, de modification et de suppression restaient
 * invisibles, y compris pour un super administrateur.
 *
 * La table est ici plutôt que dans chaque page : il n'y a qu'un endroit à
 * corriger le jour où le vocabulaire de l'API change, et les pages gardent une
 * forme lisible.
 */
const CODES_HISTORIQUES: Record<string, readonly [string, string]> = {
  "org:create": ["api:org.write", "create"],
  "org:update": ["api:org.write", "update"],
  "org:delete": ["api:org.write", "delete"],
  "site:create": ["api:site.write", "create"],
  "site:update": ["api:site.write", "update"],
  "site:delete": ["api:site.write", "delete"],
  "user:create": ["api:user.write", "create"],
  "user:update": ["api:user.write", "update"],
  "user:delete": ["api:user.write", "delete"],
  "user:assign_role": ["api:user.write", "update"],
  "role:create": ["api:role.write", "create"],
  "role:update": ["api:role.write", "update"],
  "role:delete": ["api:role.write", "delete"],
  "role:assign_permission": ["api:role.write", "update"],
  "robot:create": ["api:robot.write", "create"],
  "robot:update": ["api:robot.write", "update"],
  "robot:delete": ["api:robot.write", "delete"],
  "robot:diagnose": ["api:robot.supervise", "execute"],
  "robot:tokens": ["api:robot.token.issue", "execute"],
};

export function resolvePermissionCode(code: string, action: string): [string, string] {
  const connu = CODES_HISTORIQUES[code];
  return connu ? [connu[0], connu[1]] : [code, action];
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ACTIVE_ORGANISATION_KEY = "oscar_active_organisation";

function storedOrganisation(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ORGANISATION_KEY);
  } catch {
    return null;
  }
}

function persistOrganisation(organisationId: string | null): void {
  try {
    if (organisationId) window.localStorage.setItem(ACTIVE_ORGANISATION_KEY, organisationId);
    else window.localStorage.removeItem(ACTIVE_ORGANISATION_KEY);
  } catch {
    // The selected organisation remains valid for the current browser session.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [ready, setReady] = useState(false);
  const [activeOrganisationId, setActiveOrganisationId] = useState<string | null>(null);
  const [switchingOrganisation, setSwitchingOrganisation] = useState(false);

  const clearSession = useCallback(() => {
    api.clearTokens();
    api.setScope({});
    persistOrganisation(null);
    setUser(null);
    setPermissions({});
    setActiveOrganisationId(null);
  }, []);

  const applyIdentity = useCallback((me: AuthUser, requestedScope?: string | null) => {
    const demoOrganisations = runtimeConfig.enableDemoOrganisations
      ? DEMO_ORGANISATION_MEMBERSHIPS
      : [];
    const organisations = normaliseOrganisations(me, demoOrganisations);
    const nextOrganisation = resolveOrganisationScope(me, organisations, requestedScope);
    const selectedOrganisation = organisations.find(({ id }) => id === nextOrganisation);
    const nextPermissions = selectedOrganisation?.permissions || me.permissions || {};
    const normalisedUser: AuthUser = {
      ...me,
      active_org_id: nextOrganisation === "*" ? null : nextOrganisation,
      organisations,
    };
    setUser(normalisedUser);
    setPermissions(nextPermissions);
    setActiveOrganisationId(nextOrganisation);
    const organisationHeader = scopeHeader(nextOrganisation);
    api.setScope({
      ...(me.tenant_id ? { tenantId: me.tenant_id } : {}),
      ...(organisationHeader ? { organizationId: organisationHeader } : {}),
    });
    persistOrganisation(nextOrganisation);
    return normalisedUser;
  }, []);

  const loadMe = useCallback(async () => {
    const requestedScope = storedOrganisation();
    const requestedHeader = scopeHeader(requestedScope);
    api.setScope(requestedHeader ? { organizationId: requestedHeader } : {});
    const me = await api.get<AuthUser>("/auth/me");
    return applyIdentity(me, requestedScope);
  }, [applyIdentity]);

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      if (api.getAccess()) {
        try {
          await loadMe();
        } catch (error) {
          reportError(error, { feature: "authentication", action: "restore-session" });
          clearSession();
        }
      }
      if (mounted) setReady(true);
    };
    void bootstrap();
    return () => { mounted = false; };
  }, [clearSession, loadMe]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, clearSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, clearSession);
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      api.setScope({});
      persistOrganisation(null);
      const tokens = await api.post<TokenResponse>("/auth/login", { email, password }, { skipRefresh: true });
      api.setTokens(tokens.access_token, tokens.refresh_token);
      return await loadMe();
    } catch (error) {
      reportError(error, { feature: "authentication", action: "login" });
      throw Object.assign(error instanceof Error ? error : new Error(getUserErrorMessage(error)), {
        detail: getUserErrorMessage(error),
      });
    }
  }, [loadMe]);

  const switchOrganisation = useCallback(async (organisationId: string | null) => {
    const requestedScope = organisationId === "*"
      ? "*"
      : organisationId || (user?.is_superadmin ? "*" : null);
    const previousScope = activeOrganisationId;
    if (requestedScope === previousScope) return;
    const target = user?.organisations?.find((organisation) => organisation.id === requestedScope);
    if (requestedScope !== "*" && !target) {
      throw new Error("Cette organisation ne fait pas partie de votre périmètre d’accès.");
    }
    if (requestedScope === "*" && !user?.is_superadmin) {
      throw new Error("La vue globale est réservée aux administrateurs de la plateforme.");
    }
    setSwitchingOrganisation(true);
    const requestedHeader = scopeHeader(requestedScope);
    api.setScope({
      ...(user?.tenant_id ? { tenantId: user.tenant_id } : {}),
      ...(requestedHeader ? { organizationId: requestedHeader } : {}),
    });
    try {
      if (target?.is_demo && user) {
        applyIdentity(user, requestedScope);
        window.dispatchEvent(new CustomEvent(ORGANISATION_CHANGED_EVENT, {
          detail: { previousOrganisationId: previousScope, organisationId: requestedScope },
        }));
        return;
      }
      const me = await api.get<AuthUser>("/auth/me");
      applyIdentity(me, requestedScope);
      window.dispatchEvent(new CustomEvent(ORGANISATION_CHANGED_EVENT, {
        detail: { previousOrganisationId: previousScope, organisationId: requestedScope },
      }));
    } catch (error) {
      const previousHeader = scopeHeader(previousScope);
      api.setScope({
        ...(user?.tenant_id ? { tenantId: user.tenant_id } : {}),
        ...(previousHeader ? { organizationId: previousHeader } : {}),
      });
      reportError(error, { feature: "authentication", action: "switch-organisation" });
      throw error;
    } finally {
      setSwitchingOrganisation(false);
    }
  }, [activeOrganisationId, applyIdentity, user]);
  const can = useCallback(
    (code: string, action = "view") => {
      const [codeReel, actionReelle] = resolvePermissionCode(code, action);
      return hasPermission(permissions, codeReel, actionReelle);
    },
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      ready,
      activeOrganisationId,
      organisations: user?.organisations || [],
      activeOrganisation: user?.organisations?.find(({ id }) => id === activeOrganisationId) || null,
      switchingOrganisation,
      login,
      logout: clearSession,
      switchOrganisation,
      can,
    }),
    [
      user,
      permissions,
      ready,
      activeOrganisationId,
      switchingOrganisation,
      login,
      clearSession,
      switchOrganisation,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return context;
}
