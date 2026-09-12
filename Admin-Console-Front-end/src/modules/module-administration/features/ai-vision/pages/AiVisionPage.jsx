import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  IconLayers,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconGrid,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconX,
} from "@/components/Icons.jsx";

const MODEL_CHIP = { sandbox: "warning", production: "online", archive: "neutral", archived: "neutral" };
const BOX_CHIP = { draft: "warning", published: "online", archive: "neutral" };
const ITEM_DEFAULTS = {
  position: 0,
  inference_fps: 5,
  confidence: 25,
  iou_threshold: 45,
  overlay_enabled: true,
  incident_enabled: false,
  camera: "primary",
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

function versionSuggestion(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return `${version || "1.0"}.1`;
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

export default function AiVisionPage() {
  const { can, user } = useAuth();
  const [models, setModels] = useState([]);
  const [cats, setCats] = useState([]);
  const [robots, setRobots] = useState([]);
  const [sites, setSites] = useState([]);
  const [fleets, setFleets] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assignmentDraft, setAssignmentDraft] = useState({ targetType: "robot", targetId: "", boxId: "" });
  const [loading, setLoading] = useState(true);
  const [savingAssignment, setSavingAssignment] = useState("");
  const [modelModal, setModelModal] = useState(null);
  const [boxModal, setBoxModal] = useState(null);
  const [catModal, setCatModal] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const canUpload = can("api:ai.model.upload", "execute");
  const canPromote = can("api:ai.model.promote", "execute");
  const canDeploy = can("api:ai.model.deploy", "execute");
  const canCatCreate = can("api:ai.category.write", "create");
  const canCatUpdate = can("api:ai.category.write", "update");
  const canCatDelete = can("api:ai.category.write", "delete");

  const publishedBoxes = useMemo(() => boxes.filter((box) => box.statut === "published"), [boxes]);
  const productionModels = useMemo(() => models.filter((model) => model.statut === "production"), [models]);
  const targetOptions = assignmentDraft.targetType === "site"
    ? sites
    : assignmentDraft.targetType === "fleet" ? fleets : robots;

  const loadStudio = useCallback(async () => {
    setLoading(true);
    setErr("");
    const requests = await Promise.allSettled([
      api.get("/ai/models"),
      api.get("/ai/categories"),
      api.get("/robots"),
      api.get("/sites"),
      api.get("/fleets"),
      api.get("/ai/model-boxes"),
      api.get("/ai/model-box-assignments"),
    ]);
    const values = requests.map((result) => result.status === "fulfilled" && Array.isArray(result.value) ? result.value : []);
    const [nextModels, nextCats, nextRobots, nextSites, nextFleets, nextBoxes, nextAssignments] = values;
    setModels(nextModels);
    setCats(nextCats);
    setRobots(nextRobots);
    setSites(nextSites);
    setFleets(nextFleets);
    setBoxes(nextBoxes);
    setAssignments(nextAssignments);
    setAssignmentDraft((current) => {
      const options = current.targetType === "site"
        ? nextSites
        : current.targetType === "fleet" ? nextFleets : nextRobots;
      const selectableBoxes = nextBoxes.filter((box) => box.statut === "published");
      return {
        ...current,
        targetId: options.some((item) => item.id === current.targetId)
          ? current.targetId
          : options[0]?.id || "",
        boxId: selectableBoxes.some((box) => box.id === current.boxId)
          ? current.boxId
          : selectableBoxes[0]?.id || "",
      };
    });
    const coreFailure = [requests[0], requests[1], requests[5], requests[6]]
      .find((result) => result.status === "rejected");
    if (coreFailure) setErr(captureError(coreFailure.reason, { feature: "ai-studio", action: "list" }));
    setLoading(false);
  }, []);

  useEffect(() => { void loadStudio(); }, [loadStudio]);

  function openModel() {
    setErr("");
    setModelModal({
      nom: "", version: "1.0.0", tache: "product_detection", runtime: "ultralytics",
      description: "", input_width: 640, input_height: 640, color_space: "RGB", labels: "",
      category_ids: [], map50: "", precision: "", recall: "", trusted_artifact: false,
    });
  }

  function openBox(box = null) {
    setErr("");
    setBoxModal(box ? {
      id: box.id,
      nom: box.nom,
      version: box.version,
      description: box.description || "",
      items: box.items.map((item) => ({
        model_id: item.model_id,
        position: item.position,
        inference_fps: item.inference_fps,
        confidence: item.confidence,
        iou_threshold: item.iou_threshold,
        overlay_enabled: item.overlay_enabled,
        incident_enabled: item.incident_enabled,
        camera: item.camera,
        config: item.config || {},
      })),
    } : { nom: "", version: "1.0.0", description: "", items: [] });
  }

  function openCat(category) {
    setErr("");
    setCatModal(category
      ? { mode: "edit", id: category.id, code: category.code, label: category.label, couleur: category.couleur || "#d85810", type: category.type || "retail" }
      : { mode: "create", code: "", label: "", couleur: "#d85810", type: "retail" });
  }

  function toggleModelInBox(modelId) {
    setBoxModal((current) => {
      const selected = current.items.some((item) => item.model_id === modelId);
      const items = selected
        ? current.items.filter((item) => item.model_id !== modelId)
        : [...current.items, { ...ITEM_DEFAULTS, model_id: modelId, position: current.items.length }];
      return { ...current, items: items.map((item, position) => ({ ...item, position })) };
    });
  }

  function updateBoxItem(modelId, patch) {
    setBoxModal((current) => ({
      ...current,
      items: current.items.map((item) => item.model_id === modelId ? { ...item, ...patch } : item),
    }));
  }

  async function submitModel(event) {
    event.preventDefault();
    setErr("");
    const file = fileRef.current?.files?.[0];
    if (!file) return setErr("Sélectionnez un artefact de modèle supporté.");
    const labels = modelModal.labels.split(",").map((label) => label.trim()).filter(Boolean);
    const form = new FormData();
    Object.entries(modelModal).forEach(([key, value]) => {
      if (!["labels", "category_ids", "map50", "precision", "recall"].includes(key)) form.append(key, String(value));
    });
    form.append("labels_json", JSON.stringify(labels));
    form.append("category_ids_json", JSON.stringify(modelModal.category_ids));
    form.append("metrics_json", JSON.stringify(Object.fromEntries(
      [["map50", modelModal.map50], ["precision", modelModal.precision], ["recall", modelModal.recall]]
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, Number(value)]),
    )));
    form.append("framework", modelModal.runtime);
    form.append("file", file);
    try {
      await api.postForm("/ai/models", form, { timeoutMs: 120000 });
      setModelModal(null);
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "upload-model" }));
    }
  }

  async function submitBox(event) {
    event.preventDefault();
    setErr("");
    const payload = {
      nom: boxModal.nom.trim(),
      version: boxModal.version.trim(),
      description: boxModal.description.trim() || null,
      items: boxModal.items.map((item, position) => ({
        ...item,
        position,
        inference_fps: Number(item.inference_fps),
        confidence: Number(item.confidence),
        iou_threshold: Number(item.iou_threshold),
      })),
    };
    try {
      if (boxModal.id) await api.patch(`/ai/model-boxes/${boxModal.id}`, payload);
      else await api.post("/ai/model-boxes", payload);
      setBoxModal(null);
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: boxModal.id ? "update-box" : "create-box" }));
    }
  }

  async function promote(model) {
    if (!window.confirm(`Promouvoir « ${model.nom} » v${model.version} en production ?`)) return;
    try {
      await api.post(`/ai/models/${model.id}/promote`, { statut: "production" });
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "promote-model" }));
    }
  }

  async function publishBox(box) {
    if (!window.confirm(`Publier « ${box.nom} » v${box.version} ? Cette version deviendra immuable.`)) return;
    try {
      await api.post(`/ai/model-boxes/${box.id}/publish`);
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "publish-box" }));
    }
  }

  async function cloneBox(box) {
    const version = window.prompt("Version de la nouvelle Box", versionSuggestion(box.version));
    if (!version?.trim()) return;
    try {
      await api.post(`/ai/model-boxes/${box.id}/clone`, { version: version.trim() });
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "clone-box" }));
    }
  }

  async function saveAssignment(boxId, targetType, targetId, enabled = true) {
    if (!boxId || !targetId || savingAssignment) return;
    const key = `${boxId}:${targetType}:${targetId}`;
    setSavingAssignment(key);
    setErr("");
    try {
      await api.put(`/ai/model-boxes/${boxId}/assignments/${targetType}/${targetId}`, { enabled });
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "assign-box" }));
    } finally {
      setSavingAssignment("");
    }
  }

  function changeTargetType(targetType) {
    const options = targetType === "site" ? sites : targetType === "fleet" ? fleets : robots;
    setAssignmentDraft((current) => ({ ...current, targetType, targetId: options[0]?.id || "" }));
  }

  function targetName(assignment) {
    const source = assignment.robot_id ? robots : assignment.fleet_id ? fleets : sites;
    const id = assignment.robot_id || assignment.fleet_id || assignment.site_id;
    const type = assignment.robot_id ? "Robot" : assignment.fleet_id ? "Flotte" : "Site";
    return `${type} · ${source.find((item) => item.id === id)?.nom || id}`;
  }

  async function submitCat(event) {
    event.preventDefault();
    setErr("");
    const payload = { code: catModal.code, label: catModal.label, couleur: catModal.couleur, type: catModal.type };
    try {
      if (catModal.mode === "edit") await api.patch(`/ai/categories/${catModal.id}`, payload);
      else await api.post("/ai/categories", payload);
      setCatModal(null);
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: catModal.mode }));
    }
  }

  async function removeCat(category) {
    if (!window.confirm(`Supprimer la catégorie « ${category.label} » ?`)) return;
    try {
      await api.del(`/ai/categories/${category.id}`);
      await loadStudio();
    } catch (error) {
      setErr(captureError(error, { feature: "ai-studio", action: "delete-category" }));
    }
  }

  return (
    <>
      <PageHeader
        title="Sandbox IA & Vision"
        subtitle="Composez, versionnez et déployez les capacités de perception de vos robots"
        actions={(
          <div className="row-actions">
            {canDeploy && <button className="btn-shell" data-testid="box-add" onClick={() => openBox()}><IconLayers size={16} /> Nouvelle Box</button>}
            {canUpload && <button className="btn-shell primary" data-testid="model-upload" onClick={openModel}><IconUpload size={16} /> Importer un modèle</button>}
          </div>
        )}
      />

      <div className="platform-content ai-vision-page" data-testid="sandbox-page">
        {err && !modelModal && !boxModal && !catModal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}

        <section className="ai-studio-summary" aria-label="État de la Sandbox IA & Vision">
          <div className="ai-studio-metrics">
            <div><strong>{models.length}</strong><span>modèles</span></div>
            <div><strong>{productionModels.length}</strong><span>en production</span></div>
            <div><strong>{publishedBoxes.length}</strong><span>Boxes publiées</span></div>
            <div><strong>{assignments.filter((item) => item.enabled).length}</strong><span>affectations actives</span></div>
          </div>
        </section>

        <section className="ai-runtime-strip" aria-label="Architecture du moteur de vision">
          <div><IconUpload size={17} /><span><strong>1. Importer</strong><small>Artefact, manifeste et empreinte</small></span></div>
          <div><IconLayers size={17} /><span><strong>2. Composer</strong><small>Modèles et réglages dans une Box</small></span></div>
          <div><IconRobot size={17} /><span><strong>3. Affecter</strong><small>Robot, flotte ou site</small></span></div>
          <div><IconCpu size={17} /><span><strong>4. Exécuter</strong><small>Worker isolé, cockpit temps réel</small></span></div>
        </section>

        <div className="ai-vision-grid">
          <section className="card-shell ai-boxes-card">
            <div className="card-head ai-card-head">
              <div><h3><IconLayers size={16} /> Model Boxes ({boxes.length})</h3><small>Une version publiée est immuable et devient l'unité de déploiement.</small></div>
              <div className="row-actions"><button className="btn-shell small" onClick={loadStudio} title="Actualiser"><IconRefresh size={13} /></button>{canDeploy && <button className="btn-shell small primary" onClick={() => openBox()}><IconPlus size={13} /> Composer</button>}</div>
            </div>
            <div className="card-body">
              <div className="ai-box-grid">
                {loading && <p className="ai-empty compact">Chargement des Boxes...</p>}
                {!loading && boxes.map((box) => (
                  <article className={`ai-box-card ${box.statut}`} key={box.id} data-testid="box-card">
                    <div className="ai-box-card-top"><span className="ai-box-symbol"><IconLayers size={17} /></span><span className={`status-chip ${BOX_CHIP[box.statut] || "neutral"}`}>{box.statut === "published" ? "publiée" : "brouillon"}</span></div>
                    <div className="ai-box-title"><h4>{box.nom}</h4><span>v{box.version}</span></div>
                    <p>{box.description || "Composition de perception sans description."}</p>
                    <div className="ai-box-models">
                      {box.items.slice(0, 3).map((item) => <span key={item.id || item.model_id}>{item.model_name}<small>{item.inference_fps} FPS · {item.confidence}%</small></span>)}
                      {box.items.length === 0 && <em>Aucun modèle sélectionné</em>}
                      {box.items.length > 3 && <em>+ {box.items.length - 3} autre{box.items.length > 4 ? "s" : ""}</em>}
                    </div>
                    <footer><span><strong>{box.items.length}</strong> modèle{box.items.length > 1 ? "s" : ""} · <strong>{box.assignment_count}</strong> cible{box.assignment_count > 1 ? "s" : ""}</span>{canDeploy && <div className="row-actions">{box.statut === "draft" && <button className="btn-shell small" onClick={() => openBox(box)}><IconEdit size={12} /> Modifier</button>}{box.statut === "draft" && <button className="btn-shell small primary" onClick={() => publishBox(box)}><IconCheck size={12} /> Publier</button>}{box.statut === "published" && <button className="btn-shell small" onClick={() => cloneBox(box)}><IconPlus size={12} /> Nouvelle version</button>}</div>}</footer>
                  </article>
                ))}
                {!loading && boxes.length === 0 && <div className="ai-box-empty"><IconLayers size={22} /><strong>Aucune Model Box</strong><span>Composez plusieurs modèles pour créer une capacité déployable.</span>{canDeploy && <button className="btn-shell small primary" onClick={() => openBox()}>Créer la première Box</button>}</div>}
              </div>
            </div>
          </section>

          <aside className="card-shell ai-deploy-card">
            <div className="card-head"><div><h3><IconRobot size={16} /> Affectations</h3><small>La priorité est robot, puis flotte, puis site.</small></div></div>
            <div className="card-body">
              <div className="ai-assignment-form">
                <label className="auth-label" htmlFor="ai-box-target-type">Portée</label>
                <div className="ai-scope-switch" id="ai-box-target-type">{[["robot", "Robot"], ["fleet", "Flotte"], ["site", "Site"]].map(([value, label]) => <button type="button" className={assignmentDraft.targetType === value ? "active" : ""} key={value} onClick={() => changeTargetType(value)}>{label}</button>)}</div>
                <label className="auth-label" htmlFor="ai-box-target">Cible</label>
                <select id="ai-box-target" className="field-shell" value={assignmentDraft.targetId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, targetId: event.target.value })}>{targetOptions.length === 0 && <option value="">Aucune cible disponible</option>}{targetOptions.map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</select>
                <label className="auth-label" htmlFor="ai-box-select">Box publiée</label>
                <select id="ai-box-select" className="field-shell" value={assignmentDraft.boxId} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, boxId: event.target.value })}>{publishedBoxes.length === 0 && <option value="">Aucune Box publiée</option>}{publishedBoxes.map((box) => <option key={box.id} value={box.id}>{box.nom} · v{box.version}</option>)}</select>
                <button className="btn-shell primary ai-assign-button" disabled={!canDeploy || !assignmentDraft.targetId || !assignmentDraft.boxId || savingAssignment} onClick={() => saveAssignment(assignmentDraft.boxId, assignmentDraft.targetType, assignmentDraft.targetId)}><IconCheck size={14} /> Affecter la Box</button>
              </div>
              <div className="ai-assignment-list">
                {assignments.map((assignment) => {
                  const type = assignment.robot_id ? "robot" : assignment.fleet_id ? "fleet" : "site";
                  const targetId = assignment.robot_id || assignment.fleet_id || assignment.site_id;
                  const key = `${assignment.box_id}:${type}:${targetId}`;
                  return <div className={`ai-assignment-row${assignment.enabled ? "" : " muted"}`} key={assignment.id}><span><strong>{assignment.box_name} · v{assignment.box_version}</strong><small>{targetName(assignment)}</small></span>{canDeploy && <button className="btn-shell small" disabled={savingAssignment === key} onClick={() => saveAssignment(assignment.box_id, type, targetId, !assignment.enabled)}>{assignment.enabled ? "Désactiver" : "Réactiver"}</button>}</div>;
                })}
                {assignments.length === 0 && <p className="ai-empty compact">Aucune affectation enregistrée.</p>}
              </div>
            </div>
          </aside>

          <section className="card-shell ai-models-card">
            <div className="card-head ai-card-head"><div><h3><IconCpu size={16} /> Registre de modèles ({models.length})</h3><small>Artefacts indépendants, catégorisés et validés avant composition.</small></div>{canUpload && <button className="btn-shell small" onClick={openModel}><IconUpload size={13} /> Importer</button>}</div>
            <div className="card-body flush table-wrap">
              <table className="data-table ai-model-table"><thead><tr><th>Modèle</th><th>Catégories</th><th>Artefact</th><th>Cycle</th><th>Validation</th><th>Actions</th></tr></thead><tbody>
                {loading && <tr><td colSpan={6} className="ai-empty">Chargement des modèles...</td></tr>}
                {!loading && models.map((model) => <tr key={model.id} data-testid="model-row"><td><div className="ai-model-identity"><span className="ai-model-icon"><IconSparkles size={15} /></span><span><strong data-testid="model-name">{model.nom}</strong><small>{model.tache} · v{model.version}</small></span></div></td><td><div className="ai-category-chips">{(model.category_ids || []).map((id) => <span key={id}>{cats.find((cat) => cat.id === id)?.label || id}</span>)}{!model.category_ids?.length && <small>Non classé</small>}</div></td><td><strong className="ai-runtime-name">{model.runtime || model.framework}</strong><small>{formatBytes(model.artifact_size)}</small></td><td><span className={`status-chip ${MODEL_CHIP[model.statut] || "neutral"}`}>{model.statut}</span></td><td><span className={`status-chip ${model.validation_status === "manifest_valid" ? "online" : "warning"}`}>{model.validation_status || "à valider"}</span></td><td className="row-actions">{canPromote && model.statut === "sandbox" && <button className="btn-shell small" data-testid="model-promote" onClick={() => promote(model)}><IconArrowUpRight size={13} /> Promouvoir</button>}</td></tr>)}
                {!loading && models.length === 0 && <tr><td colSpan={6} className="ai-empty">Aucun modèle chargé pour cette organisation.</td></tr>}
              </tbody></table>
            </div>
          </section>

          <aside className="card-shell ai-integration-card">
            <div className="card-head"><div><h3><IconInfo size={16} /> Contrat constructeur</h3><small>Ce qu'un partenaire doit fournir.</small></div></div>
            <div className="card-body"><ol className="ai-integration-steps"><li><span>01</span><div><strong>Poids exportés</strong><small>ONNX recommandé. `.pt` réservé aux artefacts de confiance.</small></div></li><li><span>02</span><div><strong>Manifeste d'inférence</strong><small>Tâche, entrée, labels, runtime et version.</small></div></li><li><span>03</span><div><strong>Métriques et limites</strong><small>Dataset, précision, rappel et usages exclus.</small></div></li></ol><div className="ai-privacy-note"><IconInfo size={15} /><small>Aucun script Python arbitraire n'est exécuté sur la plateforme.</small></div></div>
          </aside>

          <section className="card-shell ai-categories-card">
            <div className="card-head"><div><h3><IconGrid size={16} /> Catégories</h3><small>Taxonomie transverse utilisée pour retrouver et documenter les modèles.</small></div>{canCatCreate && <button className="btn-shell small" data-testid="category-add" onClick={() => openCat()}><IconPlus size={13} /> Ajouter</button>}</div>
            <div className="card-body"><div className="legend-list">{cats.map((category) => <div className="legend-item" key={category.id} data-testid="category-item"><span className="ai-category-name"><i style={{ "--legend-color": category.couleur || "var(--shell-blue)" }} /><strong>{category.label}</strong><small>{category.code}</small></span><span className="row-actions"><span className="status-chip neutral">{category.type || "retail"}</span>{canCatUpdate && <button className="btn-shell small" data-testid="category-edit" onClick={() => openCat(category)} title="Modifier"><IconEdit size={12} /></button>}{canCatDelete && <button className="btn-shell small danger" data-testid="category-delete" onClick={() => removeCat(category)} title="Supprimer"><IconTrash size={12} /></button>}</span></div>)}{cats.length === 0 && <p className="ai-empty compact">Aucune catégorie configurée.</p>}</div><div className="ai-privacy-note"><IconInfo size={15} /><small>La détection de personnes reste non nominative : présence et trajectoire uniquement.</small></div></div>
          </section>
        </div>
      </div>

      {modelModal && (
        <div className="modal-backdrop show"><form className="modal-shell ai-model-modal" onSubmit={submitModel} data-testid="model-modal">
          <div className="modal-head"><h3><IconUpload size={18} /> Importer un modèle</h3><button type="button" className="icon-btn" onClick={() => setModelModal(null)} aria-label="Fermer"><IconX size={16} /></button></div>
          <div className="modal-body">
            <div className="ai-upload-guidance"><IconInfo size={16} /><span><strong>ONNX est le format recommandé pour les constructeurs.</strong><small>Un fichier `.pt` ne peut être accepté que comme artefact explicitement approuvé par un super-administrateur.</small></span></div>
            <div className="ai-form-grid full"><div><label className="auth-label">Artefact</label><input className="field-shell" type="file" ref={fileRef} data-testid="model-file" accept=".pt,.onnx,.engine,.torchscript,.tflite" required /></div></div>
            <div className="ai-form-grid"><div><label className="auth-label">Nom</label><input className="field-shell" data-testid="model-nom" value={modelModal.nom} onChange={(event) => setModelModal({ ...modelModal, nom: event.target.value })} placeholder="Détection rayon vide" required /></div><div><label className="auth-label">Version</label><input className="field-shell" data-testid="model-version" value={modelModal.version} onChange={(event) => setModelModal({ ...modelModal, version: event.target.value })} required /></div></div>
            <div className="ai-form-grid"><div><label className="auth-label">Tâche</label><select className="field-shell" data-testid="model-tache" value={modelModal.tache} onChange={(event) => setModelModal({ ...modelModal, tache: event.target.value })}>{TASKS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label className="auth-label">Runtime</label><select className="field-shell" data-testid="model-framework" value={modelModal.runtime} onChange={(event) => setModelModal({ ...modelModal, runtime: event.target.value })}>{RUNTIMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
            <div className="ai-form-grid three"><div><label className="auth-label">Largeur</label><input className="field-shell" type="number" min="32" max="4096" value={modelModal.input_width} onChange={(event) => setModelModal({ ...modelModal, input_width: event.target.value })} /></div><div><label className="auth-label">Hauteur</label><input className="field-shell" type="number" min="32" max="4096" value={modelModal.input_height} onChange={(event) => setModelModal({ ...modelModal, input_height: event.target.value })} /></div><div><label className="auth-label">Couleur</label><select className="field-shell" value={modelModal.color_space} onChange={(event) => setModelModal({ ...modelModal, color_space: event.target.value })}><option>RGB</option><option>BGR</option></select></div></div>
            <label className="auth-label">Catégories</label><div className="ai-category-picker">{cats.map((category) => <label key={category.id}><input type="checkbox" checked={modelModal.category_ids.includes(category.id)} onChange={() => setModelModal({ ...modelModal, category_ids: modelModal.category_ids.includes(category.id) ? modelModal.category_ids.filter((id) => id !== category.id) : [...modelModal.category_ids, category.id] })} /><i style={{ "--category-color": category.couleur }} />{category.label}</label>)}{cats.length === 0 && <small>Créez d'abord une catégorie si vous souhaitez classer ce modèle.</small>}</div>
            <label className="auth-label">Classes, séparées par des virgules</label><input className="field-shell" value={modelModal.labels} onChange={(event) => setModelModal({ ...modelModal, labels: event.target.value })} placeholder="produit, personne, rayon_vide" />
            <div className="ai-form-grid three"><div><label className="auth-label">mAP50</label><input className="field-shell" type="number" min="0" max="1" step="0.0001" value={modelModal.map50} onChange={(event) => setModelModal({ ...modelModal, map50: event.target.value })} placeholder="0.9261" /></div><div><label className="auth-label">Précision</label><input className="field-shell" type="number" min="0" max="1" step="0.0001" value={modelModal.precision} onChange={(event) => setModelModal({ ...modelModal, precision: event.target.value })} placeholder="0.78" /></div><div><label className="auth-label">Rappel</label><input className="field-shell" type="number" min="0" max="1" step="0.0001" value={modelModal.recall} onChange={(event) => setModelModal({ ...modelModal, recall: event.target.value })} placeholder="0.75" /></div></div>
            <label className="auth-label">Description</label><textarea className="field-shell" rows={3} value={modelModal.description} onChange={(event) => setModelModal({ ...modelModal, description: event.target.value })} placeholder="Usage prévu, dataset, métriques et limites connues." />
            {user?.is_superadmin && <label className="ai-trust-checkbox"><input type="checkbox" checked={modelModal.trusted_artifact} onChange={(event) => setModelModal({ ...modelModal, trusted_artifact: event.target.checked })} /><span><strong>Artefact PyTorch de confiance</strong><small>À cocher uniquement pour des poids `.pt` produits ou audités par l'équipe OSCAR.</small></span></label>}
            {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
          </div>
          <div className="modal-foot"><button type="button" className="btn-shell" onClick={() => setModelModal(null)}>Annuler</button><button type="submit" className="btn-shell primary" data-testid="model-save"><IconCheck size={14} /> Importer en sandbox</button></div>
        </form></div>
      )}

      {boxModal && (
        <div className="modal-backdrop show"><form className="modal-shell ai-box-modal" onSubmit={submitBox} data-testid="box-modal">
          <div className="modal-head"><h3><IconLayers size={18} /> {boxModal.id ? "Modifier la Model Box" : "Nouvelle Model Box"}</h3><button type="button" className="icon-btn" onClick={() => setBoxModal(null)} aria-label="Fermer"><IconX size={16} /></button></div>
          <div className="modal-body">
            <div className="ai-form-grid"><div><label className="auth-label">Nom</label><input className="field-shell" value={boxModal.nom} onChange={(event) => setBoxModal({ ...boxModal, nom: event.target.value })} placeholder="Anomalies magasin" required /></div><div><label className="auth-label">Version</label><input className="field-shell" value={boxModal.version} onChange={(event) => setBoxModal({ ...boxModal, version: event.target.value })} required /></div></div>
            <label className="auth-label">Description</label><textarea className="field-shell" rows={2} value={boxModal.description} onChange={(event) => setBoxModal({ ...boxModal, description: event.target.value })} placeholder="Capacité métier et contexte d'utilisation." />
            <div className="ai-box-builder-head"><div><label className="auth-label">Modèles de la Box</label><small>{boxModal.items.length} sélectionné{boxModal.items.length > 1 ? "s" : ""}</small></div><span>Réglages embarqués par version</span></div>
            <div className="ai-model-picker">{models.map((model) => { const selected = boxModal.items.some((item) => item.model_id === model.id); const ready = model.statut === "production" && model.validation_status === "manifest_valid" && isDeployable(model); return <button type="button" className={selected ? "selected" : ""} key={model.id} onClick={() => toggleModelInBox(model.id)}><span className="ai-picker-check">{selected && <IconCheck size={12} />}</span><span><strong>{model.nom}</strong><small>v{model.version} · {ready ? "prêt à publier" : "sandbox / adaptateur requis"}</small></span></button>; })}{models.length === 0 && <p className="ai-empty compact">Importez d'abord un modèle.</p>}</div>
            <div className="ai-box-item-list">{boxModal.items.map((item) => { const model = models.find((entry) => entry.id === item.model_id); return <article className="ai-box-item" key={item.model_id}><header><span><IconCpu size={14} /><strong>{model?.nom || item.model_id}</strong></span><button type="button" className="icon-btn" onClick={() => toggleModelInBox(item.model_id)} aria-label="Retirer"><IconX size={13} /></button></header><div className="ai-box-item-fields"><label>Caméra<input className="field-shell" value={item.camera} onChange={(event) => updateBoxItem(item.model_id, { camera: event.target.value })} /></label><label>FPS<input className="field-shell" type="number" min="1" max="30" value={item.inference_fps} onChange={(event) => updateBoxItem(item.model_id, { inference_fps: event.target.value })} /></label><label>Confiance %<input className="field-shell" type="number" min="0" max="100" value={item.confidence} onChange={(event) => updateBoxItem(item.model_id, { confidence: event.target.value })} /></label><label>IoU %<input className="field-shell" type="number" min="0" max="100" value={item.iou_threshold} onChange={(event) => updateBoxItem(item.model_id, { iou_threshold: event.target.value })} /></label></div><div className="ai-box-item-options"><label><input type="checkbox" checked={item.overlay_enabled} onChange={(event) => updateBoxItem(item.model_id, { overlay_enabled: event.target.checked })} /> Overlay cockpit</label><label><input type="checkbox" checked={item.incident_enabled} onChange={(event) => updateBoxItem(item.model_id, { incident_enabled: event.target.checked })} /> Création d'incident</label></div></article>; })}</div>
            {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
          </div>
          <div className="modal-foot"><span className="ai-modal-hint">La publication se fait après enregistrement et vérification.</span><button type="button" className="btn-shell" onClick={() => setBoxModal(null)}>Annuler</button><button type="submit" className="btn-shell primary"><IconCheck size={14} /> Enregistrer le brouillon</button></div>
        </form></div>
      )}

      {catModal && (
        <div className="modal-backdrop show"><form className="modal-shell" onSubmit={submitCat} data-testid="category-modal">
          <div className="modal-head"><h3>{catModal.mode === "edit" ? "Modifier la catégorie" : "Nouvelle catégorie"}</h3><button type="button" className="icon-btn" onClick={() => setCatModal(null)} aria-label="Fermer"><IconX size={16} /></button></div>
          <div className="modal-body"><label className="auth-label">Code système</label><input className="field-shell" data-testid="category-code" value={catModal.code} onChange={(event) => setCatModal({ ...catModal, code: event.target.value })} placeholder="rayon_vide" required /><label className="auth-label">Libellé</label><input className="field-shell" data-testid="category-label" value={catModal.label} onChange={(event) => setCatModal({ ...catModal, label: event.target.value })} placeholder="Rayon vide" required /><div className="ai-form-grid"><div><label className="auth-label">Couleur d'overlay</label><input className="field-shell" type="color" data-testid="category-couleur" value={catModal.couleur} onChange={(event) => setCatModal({ ...catModal, couleur: event.target.value })} /></div><div><label className="auth-label">Famille</label><select className="field-shell" data-testid="category-type" value={catModal.type} onChange={(event) => setCatModal({ ...catModal, type: event.target.value })}><option value="retail">Retail / Produits</option><option value="securite">Sécurité / Incidents</option><option value="humain">Flux humain</option></select></div></div>{err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}</div>
          <div className="modal-foot"><button type="button" className="btn-shell" onClick={() => setCatModal(null)}>Annuler</button><button type="submit" className="btn-shell primary" data-testid="category-save"><IconCheck size={14} /> Enregistrer</button></div>
        </form></div>
      )}
    </>
  );
}
