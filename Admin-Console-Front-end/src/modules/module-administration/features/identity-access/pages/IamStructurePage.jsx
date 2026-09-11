import { useEffect, useMemo, useState } from "react";

import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconShield,
  IconTrash,
  IconUsers,
  IconX,
} from "@/components/Icons.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import "./iam-structure.css";

const TABS = [
  ["hierarchy", "Hiérarchie"],
  ["teams", "Équipes"],
  ["access", "Groupes d'accès"],
  ["fleets", "Flottes"],
];

function Modal({ title, children, onClose, onSubmit, saving }) {
  return (
    <div className="modal-backdrop show">
      <form className="modal-shell iam-modal" onSubmit={onSubmit}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <IconX size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <button type="button" className="btn-shell" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-shell primary" disabled={saving}>
            <IconCheck size={14} /> {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChoiceGrid({ items, selected, onToggle, label }) {
  return (
    <fieldset className="iam-choice-fieldset">
      <legend>{label}</legend>
      <div className="iam-choice-grid">
        {items.map((item) => (
          <label key={item.id} className={selected.includes(item.id) ? "selected" : ""}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span>{item.nom || item.label}</span>
          </label>
        ))}
        {items.length === 0 && <small>Aucun élément disponible.</small>}
      </div>
    </fieldset>
  );
}

function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export default function IamStructurePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState("hierarchy");
  const [data, setData] = useState({
    orgs: [], categories: [], teams: [], users: [], roles: [], features: [],
    permissionGroups: [], roleGroups: [], fleets: [], robots: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const canCreate = can("api:iam.structure.write", "create");
  const canUpdate = can("api:iam.structure.write", "update");
  const canDelete = can("api:iam.structure.write", "delete");

  const orgMap = useMemo(() => new Map(data.orgs.map((org) => [org.id, org])), [data.orgs]);

  function reload() {
    setLoading(true);
    setError("");
    Promise.all([
      api.get("/organisations/tree"),
      api.get("/organisation-categories"),
      api.get("/teams"),
      api.get("/users"),
      api.get("/roles"),
      api.get("/features"),
      api.get("/permission-groups"),
      api.get("/role-groups"),
      api.get("/fleets"),
      api.get("/robots"),
    ]).then(([orgs, categories, teams, users, roles, features, permissionGroups, roleGroups, fleets, robots]) => {
      setData({ orgs, categories, teams, users, roles, features, permissionGroups, roleGroups, fleets, robots });
    }).catch((reason) => {
      setError(captureError(reason, { feature: "iam-structure", action: "load" }));
    }).finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  async function run(action) {
    setSaving(true);
    setError("");
    try {
      await action();
      setModal(null);
      reload();
    } catch (reason) {
      setError(captureError(reason, { feature: "iam-structure", action: "write" }));
    } finally {
      setSaving(false);
    }
  }

  async function updateOrganisation(org, patch) {
    await run(() => api.patch(`/organisations/${org.id}`, {
      nom: org.nom,
      slug: org.slug,
      contact: org.contact || null,
      statut: org.statut || "active",
      category_id: org.category_id || null,
      parent_id: org.parent_id || null,
      ...patch,
    }));
  }

  function openTeam(team = null) {
    setModal({
      type: "team",
      id: team?.id,
      nom: team?.nom || "",
      description: team?.description || "",
      statut: team?.statut || "active",
      org_ids: team?.org_ids || [],
      user_ids: team?.members?.map((member) => member.user_id) || [],
      role_ids: team?.role_ids || [],
      role_group_ids: team?.role_group_ids || [],
    });
  }

  function saveTeam(event) {
    event.preventDefault();
    run(async () => {
      const payload = {
        nom: modal.nom, description: modal.description, statut: modal.statut, org_ids: modal.org_ids,
      };
      const team = modal.id
        ? await api.patch(`/teams/${modal.id}`, payload)
        : await api.post("/teams", payload);
      await api.put(`/teams/${team.id}/members`, { user_ids: modal.user_ids });
      await api.put(`/teams/${team.id}/access`, {
        role_ids: modal.role_ids,
        role_group_ids: modal.role_group_ids,
        scope_type: "all",
        scope_id: null,
      });
    });
  }

  function openPermissionGroup(group = null) {
    setModal({
      type: "permission-group",
      id: group?.id,
      nom: group?.nom || "",
      description: group?.description || "",
      visibility: group?.visibility || "private",
      org_id: group?.org_id || "",
      feature_codes: group?.permissions?.map((permission) => permission.feature_code) || [],
    });
  }

  function savePermissionGroup(event) {
    event.preventDefault();
    const permissions = modal.feature_codes.map((code) => {
      const feature = data.features.find((item) => item.code === code);
      return { feature_code: code, actions: feature?.actions || ["view"] };
    });
    const payload = {
      nom: modal.nom,
      description: modal.description,
      visibility: modal.visibility,
      org_id: modal.visibility === "public" ? null : (modal.org_id || null),
      permissions,
    };
    run(() => modal.id
      ? api.patch(`/permission-groups/${modal.id}`, payload)
      : api.post("/permission-groups", payload));
  }

  function openRoleGroup(group = null) {
    setModal({
      type: "role-group",
      id: group?.id,
      nom: group?.nom || "",
      description: group?.description || "",
      visibility: group?.visibility || "private",
      org_id: group?.org_id || "",
      role_ids: group?.role_ids || [],
      permission_group_ids: group?.permission_group_ids || [],
    });
  }

  function saveRoleGroup(event) {
    event.preventDefault();
    const payload = {
      nom: modal.nom,
      description: modal.description,
      visibility: modal.visibility,
      org_id: modal.visibility === "public" ? null : (modal.org_id || null),
      role_ids: modal.role_ids,
      permission_group_ids: modal.permission_group_ids,
    };
    run(() => modal.id
      ? api.patch(`/role-groups/${modal.id}`, payload)
      : api.post("/role-groups", payload));
  }

  function openFleet(fleet = null) {
    setModal({
      type: "fleet",
      id: fleet?.id,
      nom: fleet?.nom || "",
      code: fleet?.code || "",
      description: fleet?.description || "",
      org_id: fleet?.org_id || data.orgs[0]?.id || "",
      robot_ids: fleet?.robot_ids || [],
    });
  }

  function saveFleet(event) {
    event.preventDefault();
    const payload = {
      nom: modal.nom, code: modal.code, description: modal.description,
      org_id: modal.org_id, robot_ids: modal.robot_ids,
    };
    run(() => modal.id ? api.patch(`/fleets/${modal.id}`, payload) : api.post("/fleets", payload));
  }

  async function remove(path, label) {
    if (!window.confirm(`Supprimer « ${label} » ?`)) return;
    await run(() => api.del(path));
  }

  return (
    <>
      <PageHeader
        title="Structure IAM"
        subtitle="Hiérarchies, équipes, politiques mutualisées et flottes"
        actions={<button className="btn-shell small" onClick={reload}><IconRefresh size={14} /> Actualiser</button>}
      />

      <div className="platform-content iam-page" data-testid="iam-structure-page">
        {error && <div className="auth-error iam-error" role="alert"><IconAlertCircle size={15} /> {error}</div>}
        <div className="iam-tabs" role="tablist" aria-label="Structure IAM">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {loading && <div className="iam-loading">Chargement de la structure...</div>}

        {!loading && tab === "hierarchy" && (
          <div className="iam-two-columns">
            <section className="card-shell iam-panel">
              <div className="card-head">
                <div><h3><IconBuilding size={16} /> Arbre des organisations</h3><small>Accès descendant hérité du parent</small></div>
              </div>
              <div className="iam-scroll-area">
                <table className="data-table iam-hierarchy-table">
                  <thead><tr><th>Organisation</th><th>Catégorie</th><th>Parent</th></tr></thead>
                  <tbody>
                    {data.orgs.map((org) => (
                      <tr key={org.id}>
                        <td>
                          <div className="iam-org-name" style={{ paddingLeft: `${org.depth * 22}px` }}>
                            {org.depth > 0 && <span className="iam-branch" />}
                            <strong>{org.nom}</strong><small>{org.slug}</small>
                          </div>
                        </td>
                        <td>
                          <select className="field-shell compact" value={org.category_id || ""} disabled={!canUpdate}
                            onChange={(event) => updateOrganisation(org, { category_id: event.target.value || null })}>
                            <option value="">Non classée</option>
                            {data.categories.map((category) => <option key={category.id} value={category.id}>{category.nom}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="field-shell compact" value={org.parent_id || ""} disabled={!canUpdate}
                            onChange={(event) => updateOrganisation(org, { parent_id: event.target.value || null })}>
                            <option value="">Racine</option>
                            {data.orgs.filter((candidate) => candidate.id !== org.id).map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.nom}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card-shell iam-panel">
              <div className="card-head">
                <div><h3><IconLayers size={16} /> Catégories</h3><small>Types d'entités réutilisables</small></div>
                {canCreate && <button className="btn-shell small primary" onClick={() => setModal({ type: "category", code: "", nom: "", description: "" })}><IconPlus size={14} /> Ajouter</button>}
              </div>
              <div className="iam-list">
                {data.categories.map((category) => (
                  <div className="iam-list-row" key={category.id}>
                    <div><strong>{category.nom}</strong><small>{category.code} · {category.description || "Sans description"}</small></div>
                    {canDelete && <button className="icon-btn danger" title="Supprimer" onClick={() => remove(`/organisation-categories/${category.id}`, category.nom)}><IconTrash size={14} /></button>}
                  </div>
                ))}
                {data.categories.length === 0 && <div className="iam-empty">Créez les catégories « Site opérationnel », « Groupe » ou « Filiale ».</div>}
              </div>
            </section>
          </div>
        )}

        {!loading && tab === "teams" && (
          <section className="card-shell iam-panel">
            <div className="card-head">
              <div><h3><IconUsers size={16} /> Équipes ({data.teams.length})</h3><small>Utilisateurs, organisations et droits mutualisés</small></div>
              {canCreate && <button className="btn-shell primary" onClick={() => openTeam()}><IconPlus size={15} /> Nouvelle équipe</button>}
            </div>
            <div className="iam-scroll-area">
              <table className="data-table">
                <thead><tr><th>Équipe</th><th>Organisations</th><th>Membres</th><th>Accès</th><th /></tr></thead>
                <tbody>
                  {data.teams.map((team) => (
                    <tr key={team.id}>
                      <td><strong>{team.nom}</strong><small className="iam-cell-note">{team.description || "Sans description"}</small></td>
                      <td>{team.org_ids.map((id) => orgMap.get(id)?.nom).filter(Boolean).join(", ") || "Globale"}</td>
                      <td>{team.members.length}</td>
                      <td>{team.role_ids.length} rôle(s), {team.role_group_ids.length} groupe(s)</td>
                      <td className="row-actions">
                        {canUpdate && <button className="btn-shell small" onClick={() => openTeam(team)}>Gérer</button>}
                        {canDelete && <button className="icon-btn danger" onClick={() => remove(`/teams/${team.id}`, team.nom)}><IconTrash size={14} /></button>}
                      </td>
                    </tr>
                  ))}
                  {data.teams.length === 0 && <tr><td colSpan={5} className="iam-empty">Aucune équipe définie.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && tab === "access" && (
          <div className="iam-two-columns">
            <section className="card-shell iam-panel">
              <div className="card-head">
                <div><h3><IconShield size={16} /> Groupes de permissions</h3><small>Capacités API et interface réutilisables</small></div>
                {canCreate && <button className="btn-shell small primary" onClick={() => openPermissionGroup()}><IconPlus size={14} /> Ajouter</button>}
              </div>
              <div className="iam-list">
                {data.permissionGroups.map((group) => (
                  <div className="iam-list-row" key={group.id}>
                    <button className="iam-row-main" onClick={() => canUpdate && openPermissionGroup(group)}>
                      <strong>{group.nom}</strong><small>{group.visibility} · {group.permissions.length} permission(s)</small>
                    </button>
                    {canDelete && <button className="icon-btn danger" onClick={() => remove(`/permission-groups/${group.id}`, group.nom)}><IconTrash size={14} /></button>}
                  </div>
                ))}
                {data.permissionGroups.length === 0 && <div className="iam-empty">Aucun groupe de permissions.</div>}
              </div>
            </section>
            <section className="card-shell iam-panel">
              <div className="card-head">
                <div><h3><IconLayers size={16} /> Groupes de rôles</h3><small>Profils composés, publics ou privés</small></div>
                {canCreate && <button className="btn-shell small primary" onClick={() => openRoleGroup()}><IconPlus size={14} /> Ajouter</button>}
              </div>
              <div className="iam-list">
                {data.roleGroups.map((group) => (
                  <div className="iam-list-row" key={group.id}>
                    <button className="iam-row-main" onClick={() => canUpdate && openRoleGroup(group)}>
                      <strong>{group.nom}</strong><small>{group.visibility} · {group.role_ids.length} rôle(s)</small>
                    </button>
                    {canDelete && <button className="icon-btn danger" onClick={() => remove(`/role-groups/${group.id}`, group.nom)}><IconTrash size={14} /></button>}
                  </div>
                ))}
                {data.roleGroups.length === 0 && <div className="iam-empty">Aucun groupe de rôles.</div>}
              </div>
            </section>
          </div>
        )}

        {!loading && tab === "fleets" && (
          <section className="card-shell iam-panel">
            <div className="card-head">
              <div><h3><IconRobot size={16} /> Flottes ({data.fleets.length})</h3><small>Regroupement opérationnel des robots par organisation</small></div>
              {canCreate && <button className="btn-shell primary" onClick={() => openFleet()}><IconPlus size={15} /> Nouvelle flotte</button>}
            </div>
            <div className="iam-scroll-area">
              <table className="data-table">
                <thead><tr><th>Flotte</th><th>Code</th><th>Organisation</th><th>Robots</th><th /></tr></thead>
                <tbody>
                  {data.fleets.map((fleet) => (
                    <tr key={fleet.id}>
                      <td><strong>{fleet.nom}</strong><small className="iam-cell-note">{fleet.description || "Sans description"}</small></td>
                      <td><code>{fleet.code}</code></td>
                      <td>{orgMap.get(fleet.org_id)?.nom || "Organisation inconnue"}</td>
                      <td>{fleet.robot_ids.length}</td>
                      <td className="row-actions">
                        {canUpdate && <button className="btn-shell small" onClick={() => openFleet(fleet)}>Gérer</button>}
                        {canDelete && <button className="icon-btn danger" onClick={() => remove(`/fleets/${fleet.id}`, fleet.nom)}><IconTrash size={14} /></button>}
                      </td>
                    </tr>
                  ))}
                  {data.fleets.length === 0 && <tr><td colSpan={5} className="iam-empty">Aucune flotte définie.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {modal?.type === "category" && (
        <Modal title="Nouvelle catégorie d'organisation" saving={saving} onClose={() => setModal(null)} onSubmit={(event) => { event.preventDefault(); run(() => api.post("/organisation-categories", modal)); }}>
          <label className="auth-label">Nom</label><input className="field-shell" required value={modal.nom} onChange={(event) => setModal({ ...modal, nom: event.target.value })} />
          <label className="auth-label">Code</label><input className="field-shell" required value={modal.code} onChange={(event) => setModal({ ...modal, code: event.target.value.toLowerCase().replace(/\s+/g, "-") })} />
          <label className="auth-label">Description</label><textarea className="field-shell" rows={3} value={modal.description} onChange={(event) => setModal({ ...modal, description: event.target.value })} />
        </Modal>
      )}

      {modal?.type === "team" && (
        <Modal title={modal.id ? "Gérer l'équipe" : "Nouvelle équipe"} saving={saving} onClose={() => setModal(null)} onSubmit={saveTeam}>
          <label className="auth-label">Nom</label><input className="field-shell" required value={modal.nom} onChange={(event) => setModal({ ...modal, nom: event.target.value })} />
          <label className="auth-label">Description</label><textarea className="field-shell" rows={2} value={modal.description} onChange={(event) => setModal({ ...modal, description: event.target.value })} />
          <ChoiceGrid label="Organisations" items={data.orgs} selected={modal.org_ids} onToggle={(id) => setModal({ ...modal, org_ids: toggleId(modal.org_ids, id) })} />
          <ChoiceGrid label="Membres" items={data.users} selected={modal.user_ids} onToggle={(id) => setModal({ ...modal, user_ids: toggleId(modal.user_ids, id) })} />
          <ChoiceGrid label="Rôles" items={data.roles} selected={modal.role_ids} onToggle={(id) => setModal({ ...modal, role_ids: toggleId(modal.role_ids, id) })} />
          <ChoiceGrid label="Groupes de rôles" items={data.roleGroups} selected={modal.role_group_ids} onToggle={(id) => setModal({ ...modal, role_group_ids: toggleId(modal.role_group_ids, id) })} />
        </Modal>
      )}

      {modal?.type === "permission-group" && (
        <Modal title={modal.id ? "Modifier le groupe de permissions" : "Nouveau groupe de permissions"} saving={saving} onClose={() => setModal(null)} onSubmit={savePermissionGroup}>
          <label className="auth-label">Nom</label><input className="field-shell" required value={modal.nom} onChange={(event) => setModal({ ...modal, nom: event.target.value })} />
          <label className="auth-label">Description</label><textarea className="field-shell" rows={2} value={modal.description} onChange={(event) => setModal({ ...modal, description: event.target.value })} />
          <div className="iam-form-grid">
            <label><span className="auth-label">Visibilité</span><select className="field-shell" value={modal.visibility} onChange={(event) => setModal({ ...modal, visibility: event.target.value })}><option value="private">Privée</option><option value="public">Publique</option></select></label>
            <label><span className="auth-label">Organisation</span><select className="field-shell" disabled={modal.visibility === "public"} value={modal.org_id} onChange={(event) => setModal({ ...modal, org_id: event.target.value })}><option value="">Aucune</option>{data.orgs.map((org) => <option key={org.id} value={org.id}>{org.nom}</option>)}</select></label>
          </div>
          <ChoiceGrid label="Fonctionnalités incluses" items={data.features.map((feature) => ({ ...feature, id: feature.code, nom: feature.label }))} selected={modal.feature_codes} onToggle={(id) => setModal({ ...modal, feature_codes: toggleId(modal.feature_codes, id) })} />
        </Modal>
      )}

      {modal?.type === "role-group" && (
        <Modal title={modal.id ? "Modifier le groupe de rôles" : "Nouveau groupe de rôles"} saving={saving} onClose={() => setModal(null)} onSubmit={saveRoleGroup}>
          <label className="auth-label">Nom</label><input className="field-shell" required value={modal.nom} onChange={(event) => setModal({ ...modal, nom: event.target.value })} />
          <label className="auth-label">Description</label><textarea className="field-shell" rows={2} value={modal.description} onChange={(event) => setModal({ ...modal, description: event.target.value })} />
          <div className="iam-form-grid">
            <label><span className="auth-label">Visibilité</span><select className="field-shell" value={modal.visibility} onChange={(event) => setModal({ ...modal, visibility: event.target.value })}><option value="private">Privée</option><option value="public">Publique</option></select></label>
            <label><span className="auth-label">Organisation</span><select className="field-shell" disabled={modal.visibility === "public"} value={modal.org_id} onChange={(event) => setModal({ ...modal, org_id: event.target.value })}><option value="">Aucune</option>{data.orgs.map((org) => <option key={org.id} value={org.id}>{org.nom}</option>)}</select></label>
          </div>
          <ChoiceGrid label="Rôles inclus" items={data.roles} selected={modal.role_ids} onToggle={(id) => setModal({ ...modal, role_ids: toggleId(modal.role_ids, id) })} />
          <ChoiceGrid label="Groupes de permissions inclus" items={data.permissionGroups} selected={modal.permission_group_ids} onToggle={(id) => setModal({ ...modal, permission_group_ids: toggleId(modal.permission_group_ids, id) })} />
        </Modal>
      )}

      {modal?.type === "fleet" && (
        <Modal title={modal.id ? "Gérer la flotte" : "Nouvelle flotte"} saving={saving} onClose={() => setModal(null)} onSubmit={saveFleet}>
          <div className="iam-form-grid"><label><span className="auth-label">Nom</span><input className="field-shell" required value={modal.nom} onChange={(event) => setModal({ ...modal, nom: event.target.value })} /></label><label><span className="auth-label">Code</span><input className="field-shell" required value={modal.code} onChange={(event) => setModal({ ...modal, code: event.target.value.toUpperCase().replace(/\s+/g, "-") })} /></label></div>
          <label className="auth-label">Organisation</label><select className="field-shell" required value={modal.org_id} onChange={(event) => setModal({ ...modal, org_id: event.target.value })}><option value="">Sélectionner</option>{data.orgs.map((org) => <option key={org.id} value={org.id}>{org.nom}</option>)}</select>
          <label className="auth-label">Description</label><textarea className="field-shell" rows={2} value={modal.description} onChange={(event) => setModal({ ...modal, description: event.target.value })} />
          <ChoiceGrid label="Robots de la flotte" items={data.robots} selected={modal.robot_ids} onToggle={(id) => setModal({ ...modal, robot_ids: toggleId(modal.robot_ids, id) })} />
        </Modal>
      )}
    </>
  );
}
