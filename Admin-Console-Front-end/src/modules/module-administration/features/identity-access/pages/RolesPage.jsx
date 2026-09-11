import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconShield,
  IconPlus,
  IconEdit,
  IconTrash,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconKey,
  IconSearch,
} from "@/components/Icons.jsx";

const ACTION_LABELS = {
  view: "Consulter",
  read: "Lire",
  create: "Créer",
  update: "Modifier",
  edit: "Modifier",
  delete: "Supprimer",
  control: "Piloter",
  execute: "Exécuter",
  assign: "Affecter",
};

function roleName(role) {
  return role?.nom || role?.label || role?.code || "Rôle sans nom";
}

function permissionMap(role) {
  return new Map(
    (role?.permissions || []).map((permission) => [
      permission.feature_code || permission.code,
      new Set(permission.actions || []),
    ]),
  );
}

export default function Roles() {
  const { can } = useAuth();
  const [roles, setRoles] = useState([]);
  const [selectedRole, setSelectedRole] = useState(null);
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRole, setLoadingRole] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState("");
  const [savingPerms, setSavingPerms] = useState(false);
  const [featureQuery, setFeatureQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");

  const canCreate = can("api:role.write", "create") || can("role:create");
  const canUpdate = can("api:role.write", "update") || can("role:update");
  const canDelete = can("api:role.write", "delete") || can("role:delete");
  const canAssignPerms = canUpdate || can("role:assign_permission");

  const loadRole = useCallback(async (role) => {
    if (!role) {
      setSelectedRole(null);
      return;
    }
    setSelectedRole(role);
    setLoadingRole(true);
    setLoadError("");
    try {
      setSelectedRole(await api.get(`/roles/${role.id}`));
    } catch (error) {
      setLoadError(captureError(error, { feature: "identity-roles", action: "read" }));
    } finally {
      setLoadingRole(false);
    }
  }, []);

  const reload = useCallback(async (preferredId = null) => {
    setLoading(true);
    setLoadError("");
    try {
      const [roleData, featureData] = await Promise.all([
        api.get("/roles"),
        api.get("/features"),
      ]);
      const roleList = Array.isArray(roleData) ? roleData : [];
      setRoles(roleList);
      setFeatures(Array.isArray(featureData) ? featureData : []);
      const target = roleList.find((role) => role.id === preferredId) || roleList[0] || null;
      await loadRole(target);
    } catch (error) {
      setRoles([]);
      setFeatures([]);
      setSelectedRole(null);
      setLoadError(captureError(error, { feature: "identity-roles", action: "list" }));
    } finally {
      setLoading(false);
    }
  }, [loadRole]);

  useEffect(() => {
    reload(null);
  }, [reload]);

  function openCreate() {
    setFormError("");
    setModal({ mode: "create", nom: "", description: "" });
  }

  function openEdit(role) {
    setFormError("");
    setModal({
      mode: "edit",
      id: role.id,
      nom: roleName(role),
      description: role.description || "",
      org_id: role.org_id || null,
    });
  }

  async function submitModal(event) {
    event.preventDefault();
    setFormError("");
    try {
      const payload = {
        nom: modal.nom.trim(),
        description: modal.description.trim() || null,
        org_id: modal.org_id || null,
      };
      if (modal.mode === "create") {
        await api.post("/roles", payload);
      } else {
        await api.patch(`/roles/${modal.id}`, payload);
      }
      const preferredId = modal.mode === "edit" ? modal.id : null;
      setModal(null);
      await reload(preferredId);
    } catch (error) {
      setFormError(captureError(error, { feature: "identity-roles", action: modal.mode }));
    }
  }

  async function remove(role) {
    if (!window.confirm(`Supprimer le rôle « ${roleName(role)} » ?`)) return;
    try {
      await api.del(`/roles/${role.id}`);
      await reload(selectedRole?.id === role.id ? null : selectedRole?.id);
    } catch (error) {
      setLoadError(captureError(error, { feature: "identity-roles", action: "delete" }));
    }
  }

  async function togglePermission(featureCode, action) {
    if (!selectedRole || !canAssignPerms || savingPerms) return;
    const next = permissionMap(selectedRole);
    const actions = next.get(featureCode) || new Set();
    if (actions.has(action)) actions.delete(action);
    else actions.add(action);
    if (actions.size) next.set(featureCode, actions);
    else next.delete(featureCode);

    const payload = Array.from(next, ([feature_code, actionSet]) => ({
      feature_code,
      actions: Array.from(actionSet),
    }));

    setSavingPerms(true);
    setLoadError("");
    try {
      setSelectedRole(await api.put(`/roles/${selectedRole.id}/permissions`, payload));
    } catch (error) {
      setLoadError(captureError(error, { feature: "identity-roles", action: "assign-permission" }));
    } finally {
      setSavingPerms(false);
    }
  }

  const selectedPermissions = useMemo(() => permissionMap(selectedRole), [selectedRole]);
  const assignedActions = useMemo(
    () => Array.from(selectedPermissions.values()).reduce((total, actions) => total + actions.size, 0),
    [selectedPermissions],
  );
  const modules = useMemo(
    () => Array.from(new Set(features.map((feature) => feature.module).filter(Boolean))).sort(),
    [features],
  );
  const filteredFeatures = useMemo(() => {
    const query = featureQuery.trim().toLocaleLowerCase("fr");
    return features.filter((feature) => {
      if (moduleFilter !== "all" && feature.module !== moduleFilter) return false;
      if (!query) return true;
      return [feature.label, feature.code, feature.module]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("fr").includes(query));
    });
  }, [featureQuery, features, moduleFilter]);

  return (
    <>
      <PageHeader
        title="Rôles & habilitations"
        subtitle="Profils de sécurité et matrice des droits d'accès"
        actions={canCreate && (
          <button className="btn-shell primary" data-testid="role-create-btn" onClick={openCreate}>
            <IconPlus size={16} /> Nouveau rôle
          </button>
        )}
      />

      <div className="platform-content" data-testid="roles-page">
        {loadError && (
          <div className="auth-error roles-error" role="alert">
            <IconAlertCircle size={15} /> {loadError}
          </div>
        )}

        <div className="roles-layout">
          <section className="card-shell roles-panel">
            <div className="card-head">
              <div>
                <h3><IconShield size={16} /> Rôles définis</h3>
                <small>{roles.length} profil(s) disponible(s)</small>
              </div>
              <button className="icon-btn" title="Actualiser les rôles" aria-label="Actualiser les rôles" onClick={() => reload(selectedRole?.id)}>
                <IconRefresh size={14} />
              </button>
            </div>

            <div className="roles-list">
              {loading && <p className="roles-placeholder">Chargement des rôles...</p>}
              {!loading && roles.length === 0 && <p className="roles-placeholder">Aucun rôle disponible.</p>}
              {!loading && roles.map((role) => {
                const selected = selectedRole?.id === role.id;
                return (
                  <div
                    key={role.id}
                    className={`role-row${selected ? " selected" : ""}`}
                    data-testid="role-item"
                    onClick={() => loadRole(role)}
                  >
                    <div className="role-row-copy">
                      <strong>{roleName(role)}</strong>
                      <small>{role.description || (role.is_system ? "Rôle système" : "Rôle personnalisé")}</small>
                    </div>
                    <div className="row-actions">
                      {canUpdate && (
                        <button
                          type="button"
                          className="icon-btn"
                          title="Modifier le rôle"
                          aria-label={`Modifier ${roleName(role)}`}
                          data-testid="role-edit"
                          onClick={(event) => { event.stopPropagation(); openEdit(role); }}
                        >
                          <IconEdit size={13} />
                        </button>
                      )}
                      {canDelete && !role.is_system && (
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Supprimer le rôle"
                          aria-label={`Supprimer ${roleName(role)}`}
                          data-testid="role-delete"
                          onClick={(event) => { event.stopPropagation(); remove(role); }}
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card-shell permissions-panel">
            <div className="card-head">
              <div>
                <h3><IconKey size={16} /> {selectedRole ? roleName(selectedRole) : "Permissions"}</h3>
                <small>{selectedRole?.description || "Sélectionnez un rôle pour consulter ses droits."}</small>
              </div>
              {selectedRole && <span className="status-chip info">{assignedActions} droit(s)</span>}
            </div>

            <div className="card-body">
              {loadingRole && <p className="roles-placeholder">Chargement de la matrice...</p>}
              {!loadingRole && !selectedRole && (
                <div className="permissions-empty">Sélectionnez un rôle dans la liste.</div>
              )}
              {!loadingRole && selectedRole && features.length === 0 && (
                <div className="permissions-empty">Aucune fonctionnalité répertoriée dans le système.</div>
              )}
              {!loadingRole && selectedRole && features.length > 0 && (
                <div className="permissions-browser">
                  <div className="permissions-toolbar">
                    <label className="permissions-search">
                      <IconSearch size={15} />
                      <input
                        type="search"
                        value={featureQuery}
                        placeholder="Rechercher une permission"
                        aria-label="Rechercher une permission"
                        onChange={(event) => setFeatureQuery(event.target.value)}
                      />
                    </label>
                    <select
                      className="field-shell permissions-module-filter"
                      value={moduleFilter}
                      aria-label="Filtrer les permissions par module"
                      onChange={(event) => setModuleFilter(event.target.value)}
                    >
                      <option value="all">Tous les modules</option>
                      {modules.map((module) => <option value={module} key={module}>{module}</option>)}
                    </select>
                    <span className="permissions-count">{filteredFeatures.length}/{features.length}</span>
                  </div>

                  {filteredFeatures.length === 0 ? (
                    <div className="permissions-empty compact">Aucun droit ne correspond à ces filtres.</div>
                  ) : (
                    <div className="permissions-grid">
                      {filteredFeatures.map((feature) => {
                        const activeActions = selectedPermissions.get(feature.code) || new Set();
                        return (
                          <section className="permission-group" key={feature.code}>
                            <div className="permission-group-head">
                              <div>
                                <strong>{feature.label || feature.code}</strong>
                                <code>{feature.code}</code>
                              </div>
                              <span>{feature.module}</span>
                            </div>
                            <div className="permission-actions">
                              {(feature.actions || []).map((action) => (
                                <label className="permission-action" key={action}>
                                  <input
                                    type="checkbox"
                                    checked={activeActions.has(action)}
                                    disabled={!canAssignPerms || savingPerms}
                                    onChange={() => togglePermission(feature.code, action)}
                                  />
                                  <span>{ACTION_LABELS[action] || action}</span>
                                </label>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModal} data-testid="role-modal">
            <div className="modal-head">
              <h3>{modal.mode === "create" ? "Nouveau rôle" : "Modifier le rôle"}</h3>
              <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => setModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label" htmlFor="role-name">Nom du rôle</label>
              <input
                id="role-name"
                className="field-shell"
                data-testid="role-label"
                value={modal.nom}
                onChange={(event) => setModal({ ...modal, nom: event.target.value })}
                placeholder="Superviseur rayon frais"
                required
              />

              <label className="auth-label" htmlFor="role-description">Description</label>
              <textarea
                id="role-description"
                className="field-shell"
                value={modal.description}
                onChange={(event) => setModal({ ...modal, description: event.target.value })}
                placeholder="Responsabilités et périmètre du rôle"
                rows={3}
              />

              {formError && <div className="auth-error"><IconAlertCircle size={15} /> {formError}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="role-save">
                <IconCheck size={14} /> {modal.mode === "create" ? "Créer" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
