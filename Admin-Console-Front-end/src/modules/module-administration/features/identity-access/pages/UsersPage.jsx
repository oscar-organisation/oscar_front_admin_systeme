import { useEffect, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import "./iam-structure.css";
import {
  IconUsers,
  IconPlus,
  IconSearch,
  IconEdit,
  IconTrash,
  IconShield,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
} from "@/components/Icons.jsx";

export default function Users() {
  const { can } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleGroups, setRoleGroups] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");

  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', ... }
  const [rolesModal, setRolesModal] = useState(null); // user to edit roles
  const [err, setErr] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const canCreate = can("api:user.write", "create") || can("user:create");
  const canUpdate = can("api:user.write", "update") || can("user:update");
  const canDelete = can("api:user.write", "delete") || can("user:delete");
  const canAssignRoles = canUpdate || can("user:assign_role");

  const roleId = (role) => role?.id || role?.role_id || role?.code;
  const roleName = (role) => role?.nom || role?.role_nom || role?.label || role?.code || "Rôle";

  function reload() {
    setLoading(true);
    setLoadError("");
    Promise.all([api.get("/users"), api.get("/roles"), api.get("/organisations"), api.get("/role-groups")])
      .then(([u, r, o, rg]) => {
        setUsers(Array.isArray(u) ? u : []);
        setRoles(Array.isArray(r) ? r : []);
        setOrgs(Array.isArray(o) ? o : []);
        setRoleGroups(Array.isArray(rg) ? rg : []);
      })
      .catch((error) => {
        setUsers([]);
        setRoles([]);
        setOrgs([]);
        setLoadError(captureError(error, { feature: "identity-users", action: "list" }));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = users.filter((u) => {
    const matchQ =
      !q || (u.nom + " " + u.email + " " + (u.org_nom || "")).toLowerCase().includes(q.toLowerCase());
    const matchOrg = orgFilter === "all" || (u.organisation_id || u.org_id) === orgFilter;
    return matchQ && matchOrg;
  });

  function openCreate() {
    setErr("");
    setModal({
      mode: "create",
      nom: "",
      email: "",
      password: "",
      password_confirm: "",
      org_id: orgs[0]?.id || "",
      organisation_ids: orgs[0]?.id ? [orgs[0].id] : [],
      statut: "active",
      role_id: roleId(roles[0]) || "",
    });
  }

  function openEdit(u) {
    setErr("");
    setModal({
      mode: "edit",
      id: u.id,
      nom: u.nom,
      email: u.email,
      password: "",
      password_confirm: "",
      org_id: u.org_id || u.organisation_id || "",
      organisation_ids: u.organisation_ids?.length
        ? u.organisation_ids
        : ((u.org_id || u.organisation_id) ? [u.org_id || u.organisation_id] : []),
      statut: u.statut || "active",
    });
  }

  function openRoles(u) {
    setErr("");
    setRolesModal({
      user: u,
      selectedIds: new Set(u.roles?.map((role) => roleId(role)).filter(Boolean) || []),
      selectedGroupIds: new Set(u.role_group_ids || []),
    });
  }

  async function submitModal(e) {
    e.preventDefault();
    setErr("");
    if (modal.password !== modal.password_confirm) {
      setErr("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSaving(true);
    try {
      let targetId = modal.id;
      if (modal.mode === "create") {
        const created = await api.post("/users", {
          nom: modal.nom.trim(),
          email: modal.email.trim(),
          password: modal.password || null,
          org_id: modal.org_id || null,
          statut: modal.statut,
        });
        targetId = created.id;
        if (modal.role_id) {
          await api.put(`/users/${created.id}/roles`, { role_ids: [modal.role_id] });
        }
      } else {
        const payload = {
          nom: modal.nom.trim(),
          email: modal.email.trim(),
          org_id: modal.org_id || null,
          statut: modal.statut,
        };
        if (modal.password) payload.password = modal.password;
        await api.patch(`/users/${modal.id}`, payload);
      }
      await api.put(`/users/${targetId}/organisations`, {
        org_ids: modal.organisation_ids,
        primary_org_id: modal.org_id || null,
      });
      setModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "identity-users", action: modal.mode }));
    } finally {
      setSaving(false);
    }
  }

  async function submitRoles(e) {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      await api.put(`/users/${rolesModal.user.id}/roles`, {
        role_ids: Array.from(rolesModal.selectedIds),
      });
      await api.put(`/users/${rolesModal.user.id}/role-groups`, {
        ids: Array.from(rolesModal.selectedGroupIds),
      });
      setRolesModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "identity-users", action: "assign-roles" }));
    } finally {
      setSaving(false);
    }
  }

  async function remove(u) {
    if (!window.confirm(`Supprimer l'utilisateur « ${u.nom} » (${u.email}) ?`)) return;
    try {
      await api.del(`/users/${u.id}`);
      reload();
    } catch (error) {
      setLoadError(captureError(error, { feature: "identity-users", action: "delete" }));
    }
  }

  function toggleRole(role) {
    const id = roleId(role);
    const next = new Set(rolesModal.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRolesModal({ ...rolesModal, selectedIds: next });
  }

  function toggleRoleGroup(group) {
    const next = new Set(rolesModal.selectedGroupIds);
    if (next.has(group.id)) next.delete(group.id);
    else next.add(group.id);
    setRolesModal({ ...rolesModal, selectedGroupIds: next });
  }

  return (
    <>
      <PageHeader
        title="Utilisateurs & Rôles"
        subtitle="Comptes d'accès, opérateurs téléopération, superviseurs et administrateurs"
        actions={
          canCreate && (
            <button className="btn-shell primary" data-testid="user-create-btn" onClick={openCreate}>
              <IconPlus size={16} /> Nouvel utilisateur
            </button>
          )
        }
      />

      <div className="platform-content" data-testid="users-page">
        {loadError && (
          <div className="auth-error roles-error" role="alert">
            <IconAlertCircle size={15} /> {loadError}
          </div>
        )}
        {/* Filters */}
        <div className="card-shell" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
              <input
                className="field-shell"
                data-testid="user-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher par nom, email, organisation..."
                style={{ paddingLeft: 34 }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--shell-dim)" }}>
                <IconSearch size={15} />
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--shell-dim)", fontWeight: 600 }}>ORGANISATION :</span>
              <select
                className="field-shell"
                data-testid="user-org-filter"
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
                style={{ width: 170 }}
              >
                <option value="all">Toutes</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.nom}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="card-shell">
          <div className="card-head">
            <div>
              <h3><IconUsers size={16} /> Utilisateurs ({filtered.length})</h3>
              <small>Répertoire des identités actives</small>
            </div>
            <button className="btn-shell small" onClick={reload}>
              <IconRefresh size={13} /> Actualiser
            </button>
          </div>

          <div className="card-body flush table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Utilisateur</th>
                  <th>Email</th>
                  <th>Organisation</th>
                  <th>Statut</th>
                  <th>Rôles attribués</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Chargement des utilisateurs...
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((u) => {
                  const userRoles = u.roles || [];
                  return (
                    <tr key={u.id} data-testid="user-row">
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "var(--radius-sm)",
                              background: "var(--shell-elevated)",
                              border: "1px solid var(--shell-line)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 700,
                              color: "var(--shell-blue)",
                            }}
                          >
                            {(u.nom || "AD").slice(0, 2).toUpperCase()}
                          </div>
                          <strong data-testid="user-name" style={{ color: "#fff" }}>{u.nom}</strong>
                        </div>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--shell-muted)" }}>
                        {u.email}
                      </td>
                      <td>{u.org_nom || orgs.find((org) => org.id === u.org_id)?.nom || "Organisation globale"}</td>
                      <td>
                        <span className={`status-chip ${u.statut === "active" ? "online" : u.statut === "disabled" ? "danger" : "neutral"}`}>
                          {u.statut === "active" ? "Actif" : u.statut === "disabled" ? "Désactivé" : "Invité"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {userRoles.map((r, idx) => {
                            return (
                              <span
                                key={idx}
                                className="status-chip info"
                                style={{ fontSize: 11, padding: "2px 8px" }}
                              >
                                {typeof r === "string" ? r : roleName(r)}
                              </span>
                            );
                          })}
                          {userRoles.length === 0 && (
                            <span style={{ color: "var(--shell-dim)", fontSize: 12 }}>Aucun rôle</span>
                          )}
                        </div>
                      </td>
                      <td className="row-actions">
                        {canAssignRoles && (
                          <button
                            className="btn-shell small"
                            data-testid="user-roles"
                            title="Gérer les rôles"
                            onClick={() => openRoles(u)}
                          >
                            <IconShield size={13} /> Rôles
                          </button>
                        )}
                        {canUpdate && (
                          <button
                            className="btn-shell small"
                            data-testid="user-edit"
                            title="Modifier"
                            onClick={() => openEdit(u)}
                          >
                            <IconEdit size={13} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="btn-shell small danger"
                            data-testid="user-delete"
                            title="Supprimer"
                            onClick={() => remove(u)}
                          >
                            <IconTrash size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Aucun utilisateur correspondant.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Création / Édition Utilisateur */}
      {modal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModal} data-testid="user-modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3>{modal.mode === "create" ? "Nouvel utilisateur" : "Modifier l'utilisateur"}</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Nom complet</label>
              <input
                className="field-shell"
                data-testid="user-nom"
                value={modal.nom}
                onChange={(e) => setModal({ ...modal, nom: e.target.value })}
                placeholder="ex: Jean Dupont"
                required
              />

              <label className="auth-label">Adresse email</label>
              <input
                className="field-shell"
                type="email"
                data-testid="user-email"
                value={modal.email}
                onChange={(e) => setModal({ ...modal, email: e.target.value })}
                placeholder="jean.dupont@entreprise.com"
                required
              />

              <label className="auth-label">
                {modal.mode === "create" ? "Mot de passe initial" : "Nouveau mot de passe (optionnel)"}
              </label>
              <input
                className="field-shell"
                type="password"
                data-testid="user-pass"
                value={modal.password}
                onChange={(e) => setModal({ ...modal, password: e.target.value })}
                placeholder={modal.mode === "create" ? "Mot de passe robuste" : "Laisser vide pour ne pas changer"}
                required={modal.mode === "create"}
                minLength={modal.password ? 8 : undefined}
              />

              <label className="auth-label">
                {modal.mode === "create" ? "Confirmer le mot de passe" : "Confirmer le nouveau mot de passe"}
              </label>
              <input
                className="field-shell"
                type="password"
                data-testid="user-pass-confirm"
                value={modal.password_confirm}
                onChange={(e) => setModal({ ...modal, password_confirm: e.target.value })}
                placeholder="Saisir le même mot de passe"
                required={modal.mode === "create" || Boolean(modal.password)}
              />

              <label className="auth-label">Organisation</label>
              <select
                className="field-shell"
                data-testid="user-org"
                value={modal.org_id}
                onChange={(e) => setModal({
                  ...modal,
                  org_id: e.target.value,
                  organisation_ids: e.target.value && !modal.organisation_ids.includes(e.target.value)
                    ? [...modal.organisation_ids, e.target.value]
                    : modal.organisation_ids,
                })}
                required
              >
                <option value="">- choisir -</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.nom}</option>
                ))}
              </select>

              <fieldset className="iam-choice-fieldset">
                <legend>Organisations accessibles</legend>
                <div className="iam-choice-grid">
                  {orgs.map((o) => {
                    const selected = modal.organisation_ids.includes(o.id);
                    return (
                      <label key={o.id} className={selected ? "selected" : ""}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={o.id === modal.org_id}
                          onChange={() => setModal({
                            ...modal,
                            organisation_ids: selected
                              ? modal.organisation_ids.filter((id) => id !== o.id)
                              : [...modal.organisation_ids, o.id],
                          })}
                        />
                        <span>{o.nom}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label className="auth-label">Statut du compte</label>
              <select
                className="field-shell"
                data-testid="user-status"
                value={modal.statut}
                onChange={(e) => setModal({ ...modal, statut: e.target.value })}
              >
                <option value="active">Actif</option>
                <option value="invited">Invité</option>
                <option value="disabled">Désactivé</option>
              </select>

              {modal.mode === "create" && (
                <>
                  <label className="auth-label">Rôle principal</label>
                  <select
                    className="field-shell"
                    data-testid="user-role-select"
                    value={modal.role_id}
                    onChange={(e) => setModal({ ...modal, role_id: e.target.value })}
                  >
                    {roles.map((r) => (
                      <option key={roleId(r)} value={roleId(r)}>{roleName(r)}</option>
                    ))}
                  </select>
                </>
              )}

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="user-save" disabled={saving}>
                <IconCheck size={14} /> {saving ? "Enregistrement..." : modal.mode === "create" ? "Créer l'utilisateur" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Affectation des Rôles */}
      {rolesModal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitRoles} data-testid="user-roles-modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3><IconShield size={18} /> Rôles — {rolesModal.user.nom}</h3>
              <button type="button" className="icon-btn" onClick={() => setRolesModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ margin: "0 0 14px", color: "var(--shell-muted)", fontSize: 13 }}>
                Sélectionnez les rôles et niveaux d'accès attribués à cet utilisateur :
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roles.map((r) => {
                  const active = rolesModal.selectedIds.has(roleId(r));
                  return (
                    <label
                      key={roleId(r)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        borderRadius: "var(--radius-md)",
                        background: active ? "rgba(0, 229, 255, 0.08)" : "rgba(255, 255, 255, 0.02)",
                        border: `1px solid ${active ? "rgba(0, 229, 255, 0.3)" : "var(--shell-line)"}`,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleRole(r)}
                        style={{ accentColor: "var(--shell-blue)", width: 16, height: 16 }}
                      />
                      <div style={{ flex: 1 }}>
                        <strong style={{ color: active ? "#fff" : "var(--shell-text)", fontSize: 13.5, display: "block" }}>
                          {roleName(r)}
                        </strong>
                        <small style={{ color: "var(--shell-dim)", fontSize: 11.5 }}>
                          Identifiant : <code>{roleId(r)}</code>
                        </small>
                      </div>
                    </label>
                  );
                })}
              </div>
              <h4 style={{ margin: "20px 0 8px", color: "var(--shell-text)", fontSize: 13 }}>Groupes de rôles</h4>
              <div className="iam-choice-grid">
                {roleGroups.map((group) => {
                  const active = rolesModal.selectedGroupIds.has(group.id);
                  return (
                    <label key={group.id} className={active ? "selected" : ""}>
                      <input type="checkbox" checked={active} onChange={() => toggleRoleGroup(group)} />
                      <span>{group.nom}</span>
                    </label>
                  );
                })}
                {roleGroups.length === 0 && <small>Aucun groupe de rôles disponible.</small>}
              </div>
              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setRolesModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="user-roles-save" disabled={saving}>
                <IconCheck size={14} /> {saving ? "Mise à jour..." : "Mettre à jour les rôles"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
