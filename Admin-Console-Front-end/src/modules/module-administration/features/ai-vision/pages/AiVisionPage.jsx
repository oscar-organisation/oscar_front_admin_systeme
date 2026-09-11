import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconAlertCircle,
  IconArrowUpRight,
  IconCheck,
  IconCpu,
  IconEdit,
  IconInfo,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconX,
} from "@/components/Icons.jsx";

const CHIP = { sandbox: "warning", production: "online", archive: "neutral", archived: "neutral" };
const DEPLOYMENT_DEFAULTS = {
  enabled: false,
  inference_fps: 5,
  confidence: 25,
  iou_threshold: 45,
  overlay_enabled: true,
  incident_enabled: false,
  config: {},
};

const TASKS = [
  ["product_detection", "Détection de produits"],
  ["person_detection", "Détection de personnes"],
  ["incident_detection", "Détection d'incidents"],
  ["object_detection", "Détection d'objets générique"],
  ["classification", "Classification d'image"],
  ["segmentation", "Segmentation"],
  ["pose", "Estimation de pose"],
  ["anomaly_detection", "Détection d'anomalies"],
];

const RUNTIMES = [
  ["ultralytics", "Ultralytics / PyTorch (.pt)"],
  ["onnxruntime", "ONNX Runtime (.onnx)"],
  ["tensorrt", "TensorRT (.engine)"],
  ["torchscript", "TorchScript (.torchscript)"],
  ["tflite", "TensorFlow Lite (.tflite)"],
];

const EXECUTABLE_RUNTIMES = new Set(["ultralytics", "pytorch"]);
const EXECUTABLE_TASKS = new Set([
  "object_detection", "product_detection", "person_detection", "incident_detection",
]);

function isDeployable(model) {
  return EXECUTABLE_RUNTIMES.has(model.runtime) && EXECUTABLE_TASKS.has(model.tache);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Taille inconnue";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function AiVisionPage() {
  const { can, user } = useAuth();
  const [models, setModels] = useState([]);
  const [cats, setCats] = useState([]);
  const [robots, setRobots] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [selectedRobotId, setSelectedRobotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingDeployment, setSavingDeployment] = useState("");
  const [modelModal, setModelModal] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const canUpload = can("api:ai.model.upload", "execute");
  const canPromote = can("api:ai.model.promote", "execute");
  const canDeploy = can("api:ai.model.deploy", "execute");
  const canCatCreate = can("api:ai.category.write", "create");
  const canCatUpdate = can("api:ai.category.write", "update");
  const canCatDelete = can("api:ai.category.write", "delete");

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setErr("");
    const [modelResult, categoryResult, robotResult] = await Promise.allSettled([
      api.get("/ai/models"),
      api.get("/ai/categories"),
      api.get("/robots"),
    ]);
    if (modelResult.status === "fulfilled") setModels(Array.isArray(modelResult.value) ? modelResult.value : []);
    if (categoryResult.status === "fulfilled") setCats(Array.isArray(categoryResult.value) ? categoryResult.value : []);
    if (robotResult.status === "fulfilled") {
      const nextRobots = Array.isArray(robotResult.value) ? robotResult.value : [];
      setRobots(nextRobots);
      setSelectedRobotId((current) => current || nextRobots[0]?.id || "");
    }
    const failed = [modelResult, categoryResult].find((result) => result.status === "rejected");
    if (failed) setErr(captureError(failed.reason, { feature: "ai-vision", action: "list" }));
    setLoading(false);
  }, []);

  const loadDeployments = useCallback(async () => {
    if (!selectedRobotId) {
      setDeployments([]);
      return;
    }
    try {
      const result = await api.get(`/ai/deployments?robot_id=${encodeURIComponent(selectedRobotId)}`);
      setDeployments(Array.isArray(result) ? result : []);
    } catch (error) {
      setDeployments([]);
      setErr(captureError(error, { feature: "ai-vision", action: "list-deployments" }));
    }
  }, [selectedRobotId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { void loadDeployments(); }, [loadDeployments]);

  function openModel() {
    setErr("");
    setModelModal({
      nom: "", version: "1.0.0", tache: "product_detection", runtime: "ultralytics",
      description: "", input_width: 640, input_height: 640, color_space: "RGB", labels: "",
      trusted_artifact: false,
    });
  }

  function openCat(category) {
    setErr("");
    setCatModal(category
      ? { mode: "edit", id: category.id, code: category.code, label: category.label, couleur: category.couleur || "#d85810", type: category.type || "retail" }
      : { mode: "create", code: "", label: "", couleur: "#d85810", type: "retail" });
  }

  async function submitModel(event) {
    event.preventDefault();
    setErr("");
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Sélectionnez un artefact de modèle supporté.");
    const labels = modelModal.labels.split(",").map((label) => label.trim()).filter(Boolean);
    const form = new FormData();
    Object.entries(modelModal).forEach(([key, value]) => {
      if (key !== "labels") form.append(key, String(value));
    });
    form.append("labels_json", JSON.stringify(labels));
    form.append("framework", modelModal.runtime);
    form.append("file", file);
    try {
      await api.postForm("/ai/models", form, { timeoutMs: 120000 });
      setModelModal(null);
      await loadCatalog();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "upload-model" }));
    }
  }

  async function promote(model) {
    if (!window.confirm(`Promouvoir « ${model.nom} » v${model.version} en production ?`)) return;
    try {
      await api.post(`/ai/models/${model.id}/promote`, { statut: "production" });
      await loadCatalog();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "promote-model" }));
    }
  }

  async function toggleDeployment(model) {
    if (!selectedRobotId || savingDeployment) return;
    const current = deployments.find((deployment) => deployment.model_id === model.id);
    setSavingDeployment(model.id);
    setErr("");
    try {
      await api.put(`/ai/models/${model.id}/deployments/${selectedRobotId}`, {
        ...DEPLOYMENT_DEFAULTS,
        ...(current || {}),
        enabled: !current?.enabled,
        id: undefined,
        org_id: undefined,
        model_id: undefined,
        robot_id: undefined,
        created_at: undefined,
        updated_at: undefined,
      });
      await loadDeployments();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "toggle-deployment" }));
    } finally {
      setSavingDeployment("");
    }
  }

  async function submitCat(event) {
    event.preventDefault();
    setErr("");
    const payload = { code: catModal.code, label: catModal.label, couleur: catModal.couleur, type: catModal.type };
    try {
      if (catModal.mode === "edit") await api.patch(`/ai/categories/${catModal.id}`, payload);
      else await api.post("/ai/categories", payload);
      setCatModal(null);
      await loadCatalog();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: catModal.mode }));
    }
  }

  async function removeCat(category) {
    if (!window.confirm(`Supprimer la catégorie « ${category.label} » ?`)) return;
    try {
      await api.del(`/ai/categories/${category.id}`);
      await loadCatalog();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-vision", action: "delete-category" }));
    }
  }

  return (
    <>
      <PageHeader
        title="Sandbox IA & Vision"
        subtitle="Registre, validation et activation des modèles sur les flux robots"
        actions={canUpload && (
          <button className="btn-shell primary" data-testid="model-upload" onClick={openModel}>
            <IconUpload size={16} /> Importer un modèle
          </button>
        )}
      />

      <div className="platform-content ai-vision-page" data-testid="sandbox-page">
        {err && !modelModal && !catModal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}

        <section className="ai-runtime-strip" aria-label="Architecture du moteur de vision">
          <div><IconUpload size={17} /><span><strong>1. Registre</strong><small>Artefact, manifeste et empreinte</small></span></div>
          <div><IconCpu size={17} /><span><strong>2. Perception</strong><small>Inférence isolée du contrôle</small></span></div>
          <div><IconSparkles size={17} /><span><strong>3. Overlay</strong><small>Résultats via LiveKit Data</small></span></div>
        </section>

        <div className="ai-vision-grid">
          <section className="card-shell ai-models-card">
            <div className="card-head ai-card-head">
              <div>
                <h3><IconCpu size={16} /> Modèles d'inférence ({models.length})</h3>
                <small>Un modèle doit être en production avant activation.</small>
              </div>
              <button className="btn-shell small" onClick={loadCatalog} title="Actualiser"><IconRefresh size={13} /></button>
            </div>

            <div className="card-body flush table-wrap">
              <table className="data-table ai-model-table">
                <thead><tr><th>Modèle</th><th>Artefact</th><th>Cycle</th><th>Validation</th><th>Actions</th></tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={5} className="ai-empty">Chargement des modèles...</td></tr>}
                  {!loading && models.map((model) => (
                    <tr key={model.id} data-testid="model-row">
                      <td>
                        <div className="ai-model-identity">
                          <span className="ai-model-icon"><IconSparkles size={15} /></span>
                          <span><strong data-testid="model-name">{model.nom}</strong><small>{model.tache} · v{model.version}</small></span>
                        </div>
                      </td>
                      <td><strong className="ai-runtime-name">{model.runtime || model.framework}</strong><small>{formatBytes(model.artifact_size)}</small></td>
                      <td><span className={`status-chip ${CHIP[model.statut] || "neutral"}`}>{model.statut}</span></td>
                      <td><span className={`status-chip ${model.validation_status === "manifest_valid" ? "online" : "warning"}`}>{model.validation_status || "à valider"}</span></td>
                      <td className="row-actions">
                        {canPromote && model.statut === "sandbox" && (
                          <button className="btn-shell small" data-testid="model-promote" onClick={() => promote(model)}>
                            <IconArrowUpRight size={13} /> Promouvoir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && models.length === 0 && <tr><td colSpan={5} className="ai-empty">Aucun modèle chargé pour cette organisation.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="card-shell ai-deploy-card">
            <div className="card-head"><div><h3><IconRobot size={16} /> Activation par robot</h3><small>Contrôle l'inférence sur le flux sélectionné.</small></div></div>
            <div className="card-body">
              <label className="auth-label" htmlFor="ai-robot">Robot cible</label>
              <select id="ai-robot" className="field-shell" value={selectedRobotId} onChange={(event) => setSelectedRobotId(event.target.value)}>
                {robots.length === 0 && <option value="">Aucun robot disponible</option>}
                {robots.map((robot) => <option key={robot.id} value={robot.id}>{robot.nom}</option>)}
              </select>
              <div className="ai-deployment-list">
                {models.map((model) => {
                  const deployment = deployments.find((item) => item.model_id === model.id);
                  const enabled = Boolean(deployment?.enabled);
                  const deployable = isDeployable(model);
                  const validArtifact = model.validation_status === "manifest_valid" && model.artifact_sha256;
                  const unavailable = model.statut !== "production" || !validArtifact || !deployable || !selectedRobotId || !canDeploy;
                  const stateLabel = !validArtifact
                    ? "Artefact validé requis"
                    : model.statut !== "production"
                    ? "Promotion requise"
                    : deployable ? `${deployment?.inference_fps || 5} FPS d'inférence` : "Adaptateur worker requis";
                  return (
                    <label className={`ai-deployment-row${unavailable ? " disabled" : ""}`} key={model.id}>
                      <span><strong>{model.nom}</strong><small>{stateLabel}</small></span>
                      <input type="checkbox" checked={enabled} disabled={unavailable || savingDeployment === model.id} onChange={() => toggleDeployment(model)} />
                      <i aria-hidden="true" />
                    </label>
                  );
                })}
                {models.length === 0 && <p className="ai-empty compact">Importez un modèle pour commencer.</p>}
              </div>
            </div>
          </aside>

          <section className="card-shell ai-categories-card">
            <div className="card-head">
              <div><h3><IconSparkles size={16} /> Catégories de détection</h3><small>Classes et couleurs rendues dans le cockpit.</small></div>
              {canCatCreate && <button className="btn-shell small" data-testid="category-add" onClick={() => openCat()}><IconPlus size={13} /> Ajouter</button>}
            </div>
            <div className="card-body">
              <div className="legend-list">
                {cats.map((category) => (
                  <div className="legend-item" key={category.id} data-testid="category-item">
                    <span className="ai-category-name"><i style={{ "--legend-color": category.couleur || "var(--shell-blue)" }} /><strong>{category.label}</strong></span>
                    <span className="row-actions">
                      <span className="status-chip neutral">{category.type || "retail"}</span>
                      {canCatUpdate && <button className="btn-shell small" data-testid="category-edit" onClick={() => openCat(category)} title="Modifier"><IconEdit size={12} /></button>}
                      {canCatDelete && <button className="btn-shell small danger" data-testid="category-delete" onClick={() => removeCat(category)} title="Supprimer"><IconTrash size={12} /></button>}
                    </span>
                  </div>
                ))}
                {cats.length === 0 && <p className="ai-empty compact">Aucune catégorie configurée.</p>}
              </div>
              <div className="ai-privacy-note"><IconInfo size={15} /><small>La détection de personnes reste non nominative : présence et trajectoire uniquement.</small></div>
            </div>
          </section>
        </div>
      </div>

      {modelModal && (
        <div className="modal-backdrop show">
          <form className="modal-shell ai-model-modal" onSubmit={submitModel} data-testid="model-modal">
            <div className="modal-head"><h3><IconUpload size={18} /> Importer un modèle</h3><button type="button" className="icon-btn" onClick={() => setModelModal(null)} aria-label="Fermer"><IconX size={16} /></button></div>
            <div className="modal-body">
              <div className="ai-form-grid full"><div><label className="auth-label">Artefact</label><input className="field-shell" type="file" ref={fileRef} data-testid="model-file" accept=".pt,.onnx,.engine,.torchscript,.tflite" required /></div></div>
              <div className="ai-form-grid"><div><label className="auth-label">Nom</label><input className="field-shell" data-testid="model-nom" value={modelModal.nom} onChange={(e) => setModelModal({ ...modelModal, nom: e.target.value })} placeholder="Détection rayon vide" required /></div><div><label className="auth-label">Version</label><input className="field-shell" data-testid="model-version" value={modelModal.version} onChange={(e) => setModelModal({ ...modelModal, version: e.target.value })} required /></div></div>
              <div className="ai-form-grid"><div><label className="auth-label">Tâche</label><select className="field-shell" data-testid="model-tache" value={modelModal.tache} onChange={(e) => setModelModal({ ...modelModal, tache: e.target.value })}>{TASKS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label className="auth-label">Runtime</label><select className="field-shell" data-testid="model-framework" value={modelModal.runtime} onChange={(e) => setModelModal({ ...modelModal, runtime: e.target.value })}>{RUNTIMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
              <div className="ai-form-grid three"><div><label className="auth-label">Largeur</label><input className="field-shell" type="number" min="32" max="4096" value={modelModal.input_width} onChange={(e) => setModelModal({ ...modelModal, input_width: e.target.value })} /></div><div><label className="auth-label">Hauteur</label><input className="field-shell" type="number" min="32" max="4096" value={modelModal.input_height} onChange={(e) => setModelModal({ ...modelModal, input_height: e.target.value })} /></div><div><label className="auth-label">Couleur</label><select className="field-shell" value={modelModal.color_space} onChange={(e) => setModelModal({ ...modelModal, color_space: e.target.value })}><option>RGB</option><option>BGR</option></select></div></div>
              <label className="auth-label">Classes, séparées par des virgules</label><input className="field-shell" value={modelModal.labels} onChange={(e) => setModelModal({ ...modelModal, labels: e.target.value })} placeholder="produit, personne, rayon_vide" />
              <label className="auth-label">Description</label><textarea className="field-shell" rows={3} value={modelModal.description} onChange={(e) => setModelModal({ ...modelModal, description: e.target.value })} placeholder="Usage prévu, dataset et limites connues." />
              {user?.is_superadmin && <label className="ai-trust-checkbox"><input type="checkbox" checked={modelModal.trusted_artifact} onChange={(e) => setModelModal({ ...modelModal, trusted_artifact: e.target.checked })} /><span><strong>Artefact PyTorch de confiance</strong><small>À cocher uniquement pour des poids `.pt` produits ou audités par l'équipe OSCAR.</small></span></label>}
              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot"><button type="button" className="btn-shell" onClick={() => setModelModal(null)}>Annuler</button><button type="submit" className="btn-shell primary" data-testid="model-save"><IconCheck size={14} /> Importer en sandbox</button></div>
          </form>
        </div>
      )}

      {catModal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitCat} data-testid="category-modal">
            <div className="modal-head"><h3>{catModal.mode === "edit" ? "Modifier la catégorie" : "Nouvelle catégorie"}</h3><button type="button" className="icon-btn" onClick={() => setCatModal(null)} aria-label="Fermer"><IconX size={16} /></button></div>
            <div className="modal-body">
              <label className="auth-label">Code système</label><input className="field-shell" data-testid="category-code" value={catModal.code} onChange={(e) => setCatModal({ ...catModal, code: e.target.value })} placeholder="rayon_vide" required />
              <label className="auth-label">Libellé</label><input className="field-shell" data-testid="category-label" value={catModal.label} onChange={(e) => setCatModal({ ...catModal, label: e.target.value })} placeholder="Rayon vide" required />
              <div className="ai-form-grid"><div><label className="auth-label">Couleur d'overlay</label><input className="field-shell" type="color" data-testid="category-couleur" value={catModal.couleur} onChange={(e) => setCatModal({ ...catModal, couleur: e.target.value })} /></div><div><label className="auth-label">Famille</label><select className="field-shell" data-testid="category-type" value={catModal.type} onChange={(e) => setCatModal({ ...catModal, type: e.target.value })}><option value="retail">Retail / Produits</option><option value="securite">Sécurité / Incidents</option><option value="humain">Flux humain</option></select></div></div>
              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>
            <div className="modal-foot"><button type="button" className="btn-shell" onClick={() => setCatModal(null)}>Annuler</button><button type="submit" className="btn-shell primary" data-testid="category-save"><IconCheck size={14} /> Enregistrer</button></div>
          </form>
        </div>
      )}
    </>
  );
}
