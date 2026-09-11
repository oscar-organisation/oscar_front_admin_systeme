import { useEffect, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconStore,
  IconPlus,
  IconSearch,
  IconEdit,
  IconTrash,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
} from "@/components/Icons.jsx";

export default function Sites() {
  const { can } = useAuth();
  const [sites, setSites] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");

  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', ... }
  const [err, setErr] = useState("");

  const canCreate = can("site:create");
  const canUpdate = can("site:update");
  const canDelete = can("site:delete");

  function reload() {
    setLoading(true);
    setErr("");
    Promise.all([api.get("/sites"), api.get("/organisations")])
      .then(([s, o]) => {
        setSites(Array.isArray(s) ? s : []);
        setOrgs(Array.isArray(o) ? o : []);
      })
      .catch((error) => {
        setSites([]);
        setOrgs([]);
        setErr(captureError(error, { feature: "tenant-sites", action: "list" }));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = sites.filter((s) => {
    const matchQ =
      !q || (s.nom + " " + (s.ville || "") + " " + (s.org_nom || "")).toLowerCase().includes(q.toLowerCase());
    const matchOrg = orgFilter === "all" || s.organisation_id === orgFilter;
    return matchQ && matchOrg;
  });

  function openCreate() {
    setErr("");
    setModal({
      mode: "create",
      nom: "",
      org_id: orgs[0]?.id || "",
      ville: "",
      code_postal: "",
      adresse: "",
    });
  }

  function openEdit(s) {
    setErr("");
    setModal({
      mode: "edit",
      id: s.id,
      nom: s.nom,
      org_id: s.organisation_id || "",
      ville: s.ville || "",
      code_postal: s.code_postal || "",
      adresse: s.adresse || "",
    });
  }

  async function submitModal(e) {
    e.preventDefault();
    setErr("");
    const payload = {
      nom: modal.nom,
      organisation_id: modal.org_id,
      ville: modal.ville,
      code_postal: modal.code_postal,
      adresse: modal.adresse,
    };
    try {
      if (modal.mode === "edit") {
        await api.patch(`/sites/${modal.id}`, payload);
      } else {
        await api.post("/sites", payload);
      }
      setModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "tenant-sites", action: modal.mode }));
    }
  }

  async function remove(s) {
    if (!window.confirm(`Supprimer le site « ${s.nom} » ?`)) return;
    try {
      await api.del(`/sites/${s.id}`);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "tenant-sites", action: "delete" }));
    }
  }

  return (
    <>
      <PageHeader
        title="Sites & Magasins de Retail"
        subtitle="Établissements physiques, points de vente et cartographie des rayons"
        actions={
          canCreate && (
            <button className="btn-shell primary" data-testid="site-create-btn" onClick={openCreate}>
              <IconPlus size={16} /> Nouveau site
            </button>
          )
        }
      />

      <div className="platform-content" data-testid="sites-page">
        {err && !modal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}
        {/* Filter Bar */}
        <div className="card-shell" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
              <input
                className="field-shell"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher par nom, ville, organisation..."
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

        {/* Sites Table */}
        <div className="card-shell">
          <div className="card-head">
            <div>
              <h3><IconStore size={16} /> Sites Référencés ({filtered.length})</h3>
              <small>Points de déploiement des robots</small>
            </div>
            <button className="btn-shell small" onClick={reload}>
              <IconRefresh size={13} /> Actualiser
            </button>
          </div>

          <div className="card-body flush table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site / Magasin</th>
                  <th>Organisation</th>
                  <th>Localisation</th>
                  <th>Adresse</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Chargement des sites...
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((s) => (
                  <tr key={s.id} data-testid="site-row">
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "var(--radius-sm)",
                            background: "rgba(245, 158, 11, 0.1)",
                            border: "1px solid rgba(245, 158, 11, 0.2)",
                            color: "#fbbf24",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <IconStore size={16} />
                        </div>
                        <div>
                          <strong data-testid="site-name" style={{ color: "#fff", display: "block" }}>{s.nom}</strong>
                          <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>ID: {s.id.slice(0, 8)}</small>
                        </div>
                      </div>
                    </td>
                    <td>{s.org_nom || "—"}</td>
                    <td>
                      <span className="status-chip neutral" style={{ fontSize: 11 }}>
                        {s.ville ? `${s.ville} (${s.code_postal || "-"})` : "Non spécifiée"}
                      </span>
                    </td>
                    <td style={{ color: "var(--shell-muted)", fontSize: 12.5 }}>{s.adresse || "—"}</td>
                    <td className="row-actions">
                      {canUpdate && (
                        <button
                          className="btn-shell small"
                          data-testid="site-edit"
                          title="Modifier"
                          onClick={() => openEdit(s)}
                        >
                          <IconEdit size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          className="btn-shell small danger"
                          data-testid="site-delete"
                          title="Supprimer"
                          onClick={() => remove(s)}
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
                      Aucun site répertorié.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Création / Édition Site */}
      {modal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModal} data-testid="site-modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3>{modal.mode === "create" ? "Nouveau site de vente" : "Modifier le site"}</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Nom du site</label>
              <input
                className="field-shell"
                data-testid="site-nom"
                value={modal.nom}
                onChange={(e) => setModal({ ...modal, nom: e.target.value })}
                placeholder="ex: Hyper Auchan - Vélizy"
                required
              />

              <label className="auth-label">Organisation parente</label>
              <select
                className="field-shell"
                data-testid="site-org"
                value={modal.org_id}
                onChange={(e) => setModal({ ...modal, org_id: e.target.value })}
                required
              >
                <option value="">- choisir -</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.nom}</option>
                ))}
              </select>

              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Ville</label>
                  <input
                    className="field-shell"
                    data-testid="site-ville"
                    value={modal.ville}
                    onChange={(e) => setModal({ ...modal, ville: e.target.value })}
                    placeholder="Vélizy-Villacoublay"
                  />
                </div>
                <div>
                  <label className="auth-label">Code postal</label>
                  <input
                    className="field-shell"
                    value={modal.code_postal}
                    onChange={(e) => setModal({ ...modal, code_postal: e.target.value })}
                    placeholder="78140"
                  />
                </div>
              </div>

              <label className="auth-label">Adresse complète</label>
              <input
                className="field-shell"
                value={modal.adresse}
                onChange={(e) => setModal({ ...modal, adresse: e.target.value })}
                placeholder="2 Avenue de l'Europe"
              />

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="site-save">
                <IconCheck size={14} /> {modal.mode === "create" ? "Créer le site" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
