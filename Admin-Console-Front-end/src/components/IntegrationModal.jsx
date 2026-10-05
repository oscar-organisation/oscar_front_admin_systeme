import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import ConnInfo from "./ConnInfo.jsx";
import { IconX, IconCpu, IconRefresh, IconCheck, IconCopy, IconKey } from "./Icons.jsx";
import { captureError } from "@/shared/kernel/observability";

export default function IntegrationModal({ robot, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customForm, setCustomForm] = useState({ ttl_hours: 24, identity_suffix: "agent" });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  // La cle d'agent n'est lisible qu'a l'instant de son emission : le serveur
  // n'en garde que l'empreinte. Elle vit donc dans l'etat de cette fenetre,
  // et nulle part ailleurs.
  const [agentKey, setAgentKey] = useState(null);
  const [issuingKey, setIssuingKey] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get(`/robots/${robot.id}/integration`)
      .then(setData)
      .catch((cause) => setError(captureError(cause, { feature: "robot-integration", action: "read" })))
      .finally(() => setLoading(false));
  }, [robot.id]);

  async function generateCustom(e) {
    e.preventDefault();
    setGenerating(true);
    setError("");
    try {
      const res = await api.post(`/robots/${robot.id}/integration/custom`, customForm);
      setData(res);
    } catch (cause) {
      setError(captureError(cause, { feature: "robot-integration", action: "generate-token" }));
    } finally {
      setGenerating(false);
    }
  }

  async function issueAgentKey() {
    setIssuingKey(true);
    setError("");
    try {
      setAgentKey(await api.post(`/robots/${robot.id}/agent-key`));
    } catch (cause) {
      setError(captureError(cause, { feature: "robot-integration", action: "issue-agent-key" }));
    } finally {
      setIssuingKey(false);
    }
  }

  function copyEnvSnippet() {
    if (!data) return;
    const snippet = `LIVEKIT_URL="${data.livekit_url || data.url}"\nLIVEKIT_ROOM="${data.room}"\nLIVEKIT_TOKEN="${data.token || ""}"\n`;
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-backdrop show">
      <div className="modal-shell" data-testid="integration-modal" style={{ maxWidth: 640, width: "94%" }}>
        <div className="modal-head">
          <h3>
            <IconCpu size={18} /> Intégration & Clés — {robot.nom}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {loading && <p style={{ color: "var(--shell-dim)" }}>Chargement des paramètres d'intégration...</p>}
          {error && <div className="auth-error">{error}</div>}

          {data && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ margin: 0, color: "var(--shell-muted)", fontSize: 13 }}>
                  Configuration temps réel pour le robot physique, Isaac Sim ou le SDK.
                </p>
                <button type="button" className="btn-shell small" onClick={copyEnvSnippet}>
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} Copier .env
                </button>
              </div>

              <ConnInfo data={data} />

              <div className="card-shell" style={{ background: "rgba(0,0,0,0.25)" }}>
                <div className="card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h4 style={{ margin: 0, fontSize: 13, color: "#fff" }}>Clé d'agent embarqué</h4>
                  <button type="button" className="btn-shell small" onClick={issueAgentKey} disabled={issuingKey}>
                    <IconKey size={14} /> {issuingKey ? "..." : agentKey ? "Réémettre" : "Émettre"}
                  </button>
                </div>
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <p style={{ margin: 0, color: "var(--shell-muted)", fontSize: 12.5 }}>
                    Elle autorise ce robot — et lui seul — à récupérer les bundles qui lui sont
                    destinés. Réémettre révoque la précédente.
                  </p>
                  {agentKey && (
                    <>
                      <code
                        data-testid="agent-key"
                        style={{ fontSize: 12, wordBreak: "break-all", padding: "8px 10px", borderRadius: 6, background: "rgba(0,0,0,0.35)" }}
                      >
                        {agentKey.agent_key}
                      </code>
                      <p style={{ margin: 0, color: "var(--shell-dim)", fontSize: 12 }}>
                        Affichée une seule fois. La perdre coûte une réémission.
                      </p>
                      {/* Deux situations, deux commandes. Un robot neuf n'a rien :
                          la commande d'enrôlement fait tout. Un robot déjà en
                          service dont on révoque la clé n'a besoin que d'elle. */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button
                          type="button"
                          className="btn-shell small"
                          data-testid="copier-enrolement"
                          disabled={!agentKey.installation?.commande_enrolement}
                          title="Robot neuf : pose la clé, tire le paquet, installe et met en service"
                          onClick={() => navigator.clipboard?.writeText(
                            agentKey.installation?.commande_enrolement || "")}
                        >
                          <IconCopy size={14} /> Copier la commande d'enrôlement
                        </button>
                        <button
                          type="button"
                          className="btn-shell small"
                          data-testid="copier-cle"
                          title="Robot déjà installé : remplace seulement la clé"
                          onClick={() => navigator.clipboard?.writeText(
                            agentKey.installation?.commande || agentKey.agent_key)}
                        >
                          <IconCopy size={14} /> Copier la clé seule
                        </button>
                      </div>
                      <p style={{ margin: 0, color: "var(--shell-dim)", fontSize: 11.5 }}>
                        À coller sur le robot, après <code>ssh</code>. Vérifiez la famille de
                        châssis dans la commande : elle est déduite du modèle saisi tant que le
                        robot n'a rien déclaré.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="card-shell" style={{ background: "rgba(0,0,0,0.25)" }}>
                <div className="card-head">
                  <h4 style={{ margin: 0, fontSize: 13, color: "#fff" }}>Émettre un nouveau jeton d'agent</h4>
                </div>
                <form onSubmit={generateCustom} className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
                  <div>
                    <label className="auth-label">Validité (heures)</label>
                    <input
                      className="field-shell"
                      type="number"
                      min="1"
                      max="8760"
                      value={customForm.ttl_hours}
                      onChange={(e) => setCustomForm({ ...customForm, ttl_hours: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="auth-label">Suffixe d'identité</label>
                    <input
                      className="field-shell"
                      value={customForm.identity_suffix}
                      onChange={(e) => setCustomForm({ ...customForm, identity_suffix: e.target.value })}
                      placeholder="ex: ros2-bridge"
                    />
                  </div>
                  <button type="submit" className="btn-shell primary" disabled={generating}>
                    <IconRefresh size={14} /> {generating ? "..." : "Générer"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn-shell primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
