import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import { buildCockpitUrl } from "@/lib/cockpitLink.js";
import { captureError } from "@/shared/kernel/observability";
import OrganisationSwitcher from "@/components/OrganisationSwitcher.jsx";
import {
  IconRobot,
  IconGrid,
  IconLogOut,
  IconArrowRight,
  IconShield,
} from "@/components/Icons.jsx";

export default function CockpitLauncher() {
  const { logout, activeOrganisationId, switchingOrganisation } = useAuth();
  const navigate = useNavigate();
  const [robots, setRobots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRobots([]);
    setConnectingId(null);
    setError("");
    api.get("/robots/assigned", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setRobots(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(captureError(err, { feature: "cockpit", action: "list-robots" }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [activeOrganisationId]);

  useEffect(() => {
    const resetTransientState = () => {
      setConnectingId(null);
      setError("");
    };
    window.addEventListener("pageshow", resetTransientState);
    window.addEventListener("focus", resetTransientState);
    return () => {
      window.removeEventListener("pageshow", resetTransientState);
      window.removeEventListener("focus", resetTransientState);
    };
  }, []);

  async function openCockpit(robot) {
    setConnectingId(robot.id);
    setError("");
    try {
      const session = await api.post(`/robots/${robot.id}/supervise`, {});
      setConnectingId(null);
      window.location.assign(buildCockpitUrl(session));
    } catch (err) {
      setError(captureError(err, { feature: "cockpit", action: "open-session" }));
      setConnectingId(null);
    }
  }

  return (
    <div className="cockpit-launch-wrap" data-testid="cockpit-launcher">
      <header className="op-head">
        <div>
          <span className="cockpit-eyebrow">TÉLÉOPÉRATION</span>
          <h1>Ouvrir un cockpit</h1>
          <p>Sélectionnez le robot à superviser en 2D ou en WebXR.</p>
        </div>
        <div className="op-head-actions">
          <OrganisationSwitcher compact />
          <button className="btn-shell" onClick={() => navigate("/")}>
            <IconGrid size={15} /> Changer d'espace
          </button>
          <button className="btn-shell" data-testid="logout" onClick={logout}>
            <IconLogOut size={15} /> Déconnexion
          </button>
        </div>
      </header>

      <main className="cockpit-launch-content">
        <section className="card-shell cockpit-picker">
          <div className="card-head">
            <div>
              <h3><IconRobot size={16} /> Robots affectés</h3>
              <p>Machines accessibles avec votre compte.</p>
            </div>
            <span className="status-chip info">{robots.length}</span>
          </div>
          <div className="card-body cockpit-robot-grid">
            {loading && <p className="cockpit-loading">Chargement des robots...</p>}
            {!loading && robots.length === 0 && !error && (
              <div className="cockpit-empty">
                <IconRobot size={40} color="var(--shell-dim)" style={{ marginBottom: 12 }} />
                <strong>Aucun robot affecté</strong>
                <span>Un administrateur doit d'abord vous affecter un robot dans la console.</span>
              </div>
            )}
            {robots.map((robot) => {
              const connecting = connectingId === robot.id;
              return (
                <button
                  key={robot.id}
                  className="cockpit-robot-card"
                  data-testid="cockpit-robot"
                  disabled={!!connectingId || switchingOrganisation || loading}
                  onClick={() => openCockpit(robot)}
                >
                  <div className="cockpit-robot-icon">
                    <IconRobot size={20} />
                  </div>
                  <div className="cockpit-robot-copy">
                    <strong>{robot.nom}</strong>
                    <small>{robot.serial || robot.firmware || "Robot OSCAR standard"}</small>
                  </div>
                  <span className={`status-chip ${robot.statut === "online" ? "online" : "neutral"}`}>
                    {connecting ? "Connexion..." : robot.statut}
                  </span>
                  <div className="cockpit-robot-arrow">
                    <IconArrowRight size={18} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card-shell cockpit-session-info">
          <div className="card-head">
            <h3><IconShield size={16} /> Ouverture de session</h3>
          </div>
          <div className="card-body cockpit-steps">
            <div>
              <span>1</span>
              <p>
                <strong>Contrôle d'accès</strong>
                <small>Vérification de vos droits sur le robot.</small>
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                <strong>Session LiveKit</strong>
                <small>Création d'un accès temporaire au flux et au canal <code>oscar.xr.input</code>.</small>
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                <strong>Cockpit 2D ou VR</strong>
                <small>Connexion vidéo et commandes opérateur.</small>
              </p>
            </div>
          </div>
        </aside>
      </main>

      {error && <div className="auth-error cockpit-error" role="alert">{error}</div>}
    </div>
  );
}
