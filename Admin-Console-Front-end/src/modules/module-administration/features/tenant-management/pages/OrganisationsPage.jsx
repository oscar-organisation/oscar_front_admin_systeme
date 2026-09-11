import { useEffect, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconBuilding,
  IconPlus,
  IconSearch,
  IconEdit,
  IconTrash,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
} from "@/components/Icons.jsx";

export default function Organisations() {
  const { can } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', ... }
  const [err, setErr] = useState("");

  const canCreate = can("org:create");
  const canUpdate = can("org:update");
  const canDelete = can("org:delete");

  function reload() {
    setLoading(true);
    setErr("");
    api.get("/organisations")
      .then((d) => setOrgs(Array.isArray(d) ? d : []))
      .catch((error) => {
        setOrgs([]);
        setErr(captureError(error, { feature: "tenant-organizations", action: "list" }));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = orgs.filter((o) =>
    !q || (o.nom + " " + (o.slug || "")).toLowerCase().includes(q.toLowerCase())
  );

  function openCreate() {
    setErr("");
    setModal({ mode: "create", nom: "", slug: "", description: "" });
  }

  function openEdit(o) {
    setErr("");
    setModal({
      mode: "edit",
      id: o.id,
      nom: o.nom,
      slug: o.slug,
      description: o.description || "",
    });
  }

  async function submitModal(e) {
    e.preventDefault();
    setErr("");
    try {
      if (modal.mode === "create") {
        await api.post("/organisations", {
          nom: modal.nom,
          slug: modal.slug,
          description: modal.description,
        });
      } else {
        await api.patch(`/organisations/${modal.id}`, {
          nom: modal.nom,
          slug: modal.slug,
          description: modal.description,
        });
      }
      setModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "tenant-organizations", action: modal.mode }));
    }
  }

  async function remove(o) {
    if (!window.confirm(`Supprimer l'organisation « ${o.nom} » ?`)) return;
    try {
      await api.del(`/organisations/${o.id}`);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "tenant-organizations", action: "delete" }));
    }
  }

  return (
    <>
      <PageHeader
        title="Organisations & Enseignes"
        subtitle="Groupes de distribution, filiales et entités opérationnelles"
        actions={
          canCreate && (
            <button className="btn-shell primary" data-testid="org-create-btn" onClick={openCreate}>
              <IconPlus size={16} /> Nouvelle organisation
            </button>
          )
        }
      />

      <div className="platform-content" data-testid="orgs-page">
        {err && !modal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}
        {/* Search Bar */}
        <div className="card-shell" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "14px 20px" }}>
            <div style={{ position: "relative", maxWidth: 400 }}>
              <input
                className="field-shell"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher une organisation..."
                style={{ paddingLeft: 34 }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--shell-dim)" }}>
                <IconSearch size={15} />
              </span>
            </div>
          </div>
        </div>

        {/* Organisations Table */}
        <div className="card-shell">
          <div className="card-head">
            <div>
              <h3><IconBuilding size={16} /> Organisations Enregistrées ({filtered.length})</h3>
              <small>Entités clientes et partenaires d'exploitation</small>
            </div>
            <button className="btn-shell small" onClick={reload}>
              <IconRefresh size={13} /> Actualiser
            </button>
          </div>

          <div className="card-body flush table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Identifiant Slug</th>
                  <th>Description</th>
                  <th>Date de création</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Chargement des organisations...
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((o) => (
                  <tr key={o.id} data-testid="org-row">
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(0, 229, 255, 0.08)",
                            border: "1px solid rgba(0, 229, 255, 0.2)",
                            color: "var(--shell-blue)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <IconBuilding size={16} />
                        </div>
                        <div>
                          <strong data-testid="org-name" style={{ color: "#fff", display: "block" }}>{o.nom}</strong>
                          <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>ID: {o.id.slice(0, 8)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <code style={{ fontSize: 12, color: "var(--shell-muted)" }}>{o.slug}</code>
                    </td>
                    <td style={{ color: "var(--shell-muted)", fontSize: 12.5 }}>{o.description || "—"}</td>
                    <td style={{ color: "var(--shell-dim)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                      {o.created_at ? new Date(o.created_at).toLocaleDateString("fr-FR") : "—"}
                    </td>
                    <td className="row-actions">
                      {canUpdate && (
                        <button
                          className="btn-shell small"
                          data-testid="org-edit"
                          title="Modifier"
                          onClick={() => openEdit(o)}
                        >
                          <IconEdit size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="btn-shell small danger"
                          data-testid="org-delete"
                          title="Supprimer"
                          onClick={() => remove(o)}
                        >
                          <IconTrash size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Aucune organisation trouvée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Création / Édition Organisation */}
      {modal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModal} data-testid="org-modal" style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>{modal.mode === "create" ? "Nouvelle organisation" : "Modifier l'organisation"}</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Nom de l'organisation</label>
              <input
                className="field-shell"
                data-testid="org-nom"
                value={modal.nom}
                onChange={(e) => setModal({ ...modal, nom: e.target.value })}
                placeholder="ex: Groupe Carrefour"
                required
              />

              <label className="auth-label">Slug technique</label>
              <input
                className="field-shell"
                data-testid="org-slug"
                value={modal.slug}
                onChange={(e) => setModal({ ...modal, slug: e.target.value })}
                placeholder="ex: carrefour-france"
                required
              />

              <label className="auth-label">Description / Secteur d'activité</label>
              <textarea
                className="field-shell"
                value={modal.description}
                onChange={(e) => setModal({ ...modal, description: e.target.value })}
                placeholder="Description sommaire..."
                rows={3}
              />

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="org-save">
                <IconCheck size={14} /> {modal.mode === "create" ? "Créer l'organisation" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
