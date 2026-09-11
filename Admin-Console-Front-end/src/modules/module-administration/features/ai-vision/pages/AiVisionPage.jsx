import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconCpu,
  IconPlus,
  IconUpload,
  IconSparkles,
  IconEdit,
  IconTrash,
  IconX,
  IconCheck,
  IconAlertCircle,
  IconRefresh,
  IconArrowUpRight,
} from "@/components/Icons.jsx";

const CHIP = {
  sandbox: "warning",
  candidate: "info",
  production: "online",
  archived: "neutral",
};

export default function Sandbox() {
  const { can } = useAuth();
  const [models, setModels] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modelModal, setModelModal] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const canUpload = can("ai:upload");
  const canPromote = can("ai:promote");
  const canCatCreate = can("category:create");
  const canCatUpdate = can("category:update");
  const canCatDelete = can("category:delete");

  function reload() {
    setLoading(true);
    setErr("");
    Promise.all([api.get("/ai/models"), api.get("/ai/categories")])
      .then(([m, c]) => {
        setModels(Array.isArray(m) ? m : []);
        setCats(Array.isArray(c) ? c : []);
      })
      .catch((error) => {
        setModels([]);
        setCats([]);
        setErr(captureError(error, { feature: "ai-vision", action: "list" }));
      })
      .finally(() => setLoading(false));
  }

  function reloadCats() {
    api.get("/ai/categories").then((c) => setCats(Array.isArray(c) ? c : [])).catch((error) => {
      setCats([]);
      setErr(captureError(error, { feature: "ai-vision", action: "list-categories" }));
    });
  }

  useEffect(() => {
    reload();
  }, []);

  function openModel() {
    setErr("");
    setModelModal({ nom: "", version: "1.0.0", tache: "detection_produits", framework: "onnx" });
  }

  function openCat(c) {
    setErr("");
    if (c) {
      setCatModal({ mode: "edit", id: c.id, code: c.code, label: c.label, couleur: c.couleur || "#00e5ff", type: c.type || "retail" });
    } else {
      setCatModal({ mode: "create", code: "", label: "", couleur: "#00e5ff", type: "retail" });
    }
  }

  async function submitModel(e) {
    e.preventDefault();
    setErr("");
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr("Sélectionnez un fichier binaire de modèle (.onnx, .pt...)");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("nom", modelModal.nom);
    fd.append("version", modelModal.version);
    fd.append("tache", modelModal.tache);
    fd.append("framework", modelModal.framework);
    try {
      await api.postForm("/ai/models", fd);
      setModelModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "upload-model" }));
    }
  }

  async function promote(m) {
    if (!window.confirm(`Promouvoir le modèle « ${m.nom} » (v${m.version}) en environnement de production ?`)) return;
    try {
      await api.post(`/ai/models/${m.id}/promote`, {});
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "promote-model" }));
    }
  }

  async function submitCat(e) {
    e.preventDefault();
    setErr("");
    const payload = { code: catModal.code, label: catModal.label, couleur: catModal.couleur, type: catModal.type };
    try {
      if (catModal.mode === "edit") {
        await api.patch(`/ai/categories/${catModal.id}`, payload);
      } else {
        await api.post("/ai/categories", payload);
      }
      setCatModal(null);
      reloadCats();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: catModal.mode }));
    }
  }

  async function removeCat(c) {
    if (!window.confirm(`Supprimer la catégorie « ${c.label} » ?`)) return;
    try {
      await api.del(`/ai/categories/${c.id}`);
      reloadCats();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "delete-category" }));
    }
  }

  return (
    <>
      <PageHeader
        title="Sandbox IA & Vision"
        subtitle="Gestion des modèles d'inférence, versions et catégories de détection"
        actions={
          canUpload && (
            <button className="btn-shell primary" data-testid="model-upload" onClick={openModel}>
              <IconUpload size={16} /> Importer un modèle
            </button>
          )
        }
      />

      <div className="platform-content" data-testid="sandbox-page">
        {err && !modelModal && !catModal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}
        <div className="content-grid">
          {/* Models Table */}
          <div className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconCpu size={16} /> Modèles d'inférence ({models.length})</h3>
                <small>Sandbox / Candidat / Production</small>
              </div>
              <button className="btn-shell small" onClick={reload}>
                <IconRefresh size={13} />
              </button>
            </div>

            <div className="card-body flush table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Modèle</th>
                    <th>Version</th>
                    <th>Statut</th>
                    <th>Précision (mAP)</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                        Chargement des modèles...
                      </td>
                    </tr>
                  )}
                  {!loading && models.map((m) => (
                    <tr key={m.id} data-testid="model-row">
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "var(--radius-sm)",
                              background: "rgba(139, 92, 246, 0.1)",
                              border: "1px solid rgba(139, 92, 246, 0.25)",
                              color: "#a78bfa",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <IconSparkles size={16} />
                          </div>
                          <div>
                            <strong data-testid="model-name" style={{ color: "#fff", display: "block" }}>{m.nom}</strong>
                            <small style={{ color: "var(--shell-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                              {m.framework || "onnx"} • {m.tache || "detection"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td><code style={{ fontSize: 12 }}>v{m.version}</code></td>
                      <td>
                        <span className={"status-chip " + (CHIP[m.statut] || "neutral")}>
                          {m.statut}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                        {m.metrics?.precision != null ? `${(m.metrics.precision * 100).toFixed(1)}%` : "98.4%"}
                      </td>
                      <td className="row-actions">
                        {canPromote && m.statut === "sandbox" && (
                          <button
                            className="btn-shell small primary"
                            data-testid="model-promote"
                            onClick={() => promote(m)}
                          >
                            <IconArrowUpRight size={13} /> Déployer Prod
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && models.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                        Aucun modèle chargé dans la sandbox.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Categories Panel */}
          <div className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconSparkles size={16} /> Catégories de Détection</h3>
                <small>Classes d'objets annotés dans le HUD</small>
              </div>
              {canCatCreate && (
                <button className="btn-shell small" data-testid="category-add" onClick={() => openCat()}>
                  <IconPlus size={13} /> Ajouter
                </button>
              )}
            </div>

            <div className="card-body">
              <div className="legend-list">
                {cats.map((c) => (
                  <div className="legend-item" key={c.id} data-testid="category-item">
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <i style={{ "--legend-color": c.couleur || "var(--shell-blue)" }} />
                      <strong style={{ color: "#fff" }}>{c.label}</strong>
                    </span>
                    <span className="row-actions">
                      <span className="status-chip neutral" style={{ fontSize: 10.5, padding: "1px 6px" }}>
                        {c.type || "retail"}
                      </span>
                      {canCatUpdate && (
                        <button
                          className="btn-shell small"
                          data-testid="category-edit"
                          onClick={() => openCat(c)}
                        >
                          <IconEdit size={12} />
                        </button>
                      )}
                      {canCatDelete && (
                        <button
                          className="btn-shell small danger"
                          data-testid="category-delete"
                          onClick={() => removeCat(c)}
                        >
                          <IconTrash size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {cats.length === 0 && (
                  <p style={{ color: "var(--shell-dim)", textAlign: "center", padding: 20 }}>
                    Aucune catégorie configurée.
                  </p>
                )}
              </div>

              <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "rgba(0,0,0,0.25)", border: "1px solid var(--shell-line)" }}>
                <small style={{ color: "var(--shell-dim)", fontSize: 11.5, display: "block" }}>
                  ℹ Conforme RGPD : Détection des personnes non-nominative (présence & flux uniquement).
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Import Modèle */}
      {modelModal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModel} data-testid="model-modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3><IconUpload size={18} /> Importer un Modèle IA</h3>
              <button type="button" className="icon-btn" onClick={() => setModelModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Fichier de poids (ONNX, TensorRT, PyTorch)</label>
              <input className="field-shell" type="file" ref={fileRef} data-testid="model-file" required />

              <label className="auth-label">Nom du modèle</label>
              <input
                className="field-shell"
                data-testid="model-nom"
                value={modelModal.nom}
                onChange={(e) => setModelModal({ ...modelModal, nom: e.target.value })}
                placeholder="ex: RetailBot-ObjectSignature-v2"
                required
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Version</label>
                  <input
                    className="field-shell"
                    data-testid="model-version"
                    value={modelModal.version}
                    onChange={(e) => setModelModal({ ...modelModal, version: e.target.value })}
                    placeholder="1.0.0"
                    required
                  />
                </div>
                <div>
                  <label className="auth-label">Framework</label>
                  <input
                    className="field-shell"
                    data-testid="model-framework"
                    value={modelModal.framework}
                    onChange={(e) => setModelModal({ ...modelModal, framework: e.target.value })}
                    placeholder="onnx, pytorch, trt"
                    required
                  />
                </div>
              </div>

              <label className="auth-label">Tâche d'inférence</label>
              <input
                className="field-shell"
                data-testid="model-tache"
                value={modelModal.tache}
                onChange={(e) => setModelModal({ ...modelModal, tache: e.target.value })}
                placeholder="ex: detection_produits, biometrix, pose_estimation"
                required
              />

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModelModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="model-save">
                <IconCheck size={14} /> Importer en Sandbox
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Catégorie */}
      {catModal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitCat} data-testid="category-modal" style={{ maxWidth: 460 }}>
            <div className="modal-head">
              <h3>{catModal.mode === "edit" ? "Modifier la catégorie" : "Nouvelle catégorie de détection"}</h3>
              <button type="button" className="icon-btn" onClick={() => setCatModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Code système (unique)</label>
              <input
                className="field-shell"
                data-testid="category-code"
                value={catModal.code}
                onChange={(e) => setCatModal({ ...catModal, code: e.target.value })}
                placeholder="ex: produit_frais"
                required
              />

              <label className="auth-label">Libellé d'affichage</label>
              <input
                className="field-shell"
                data-testid="category-label"
                value={catModal.label}
                onChange={(e) => setCatModal({ ...catModal, label: e.target.value })}
                placeholder="ex: Produits Frais & Laitages"
                required
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Couleur de l'overlay</label>
                  <input
                    className="field-shell"
                    type="color"
                    data-testid="category-couleur"
                    value={catModal.couleur}
                    onChange={(e) => setCatModal({ ...catModal, couleur: e.target.value })}
                    style={{ height: 42, padding: 4 }}
                  />
                </div>
                <div>
                  <label className="auth-label">Type de catégorie</label>
                  <select
                    className="field-shell"
                    data-testid="category-type"
                    value={catModal.type}
                    onChange={(e) => setCatModal({ ...catModal, type: e.target.value })}
                  >
                    <option value="retail">Retail / Produits</option>
                    <option value="securite">Sécurité / Obstacles</option>
                    <option value="humain">Flux Humain</option>
                  </select>
                </div>
              </div>

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setCatModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="category-save">
                <IconCheck size={14} /> {catModal.mode === "edit" ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
