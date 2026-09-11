import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { ADMIN_UI_FEATURES, canAny, canSee } from "../lib/permissions.js";
import {
  IconActivity,
  IconShield,
  IconRobot,
  IconVideo,
  IconLogOut,
  IconArrowRight,
} from "../components/Icons.jsx";
import OrganisationSwitcher from "@/components/OrganisationSwitcher.jsx";

const SPACES = [
  {
    id: "admin",
    to: "/admin",
    testId: "space-admin",
    Icon: IconShield,
    title: "Administration",
    description: "Flotte, sites, utilisateurs, droits et modèles de vision.",
    check: (perms) => canAny(perms, ADMIN_UI_FEATURES),
  },
  {
    id: "cockpit",
    to: "/cockpit",
    testId: "space-cockpit",
    Icon: IconRobot,
    title: "Cockpit XR",
    description: "Téléopération temps réel sur écran, manette ou casque VR.",
    check: (perms) => canSee(perms, "ui:cockpit.page"),
  },
  {
    id: "operator",
    to: "/operator",
    testId: "space-operator",
    Icon: IconVideo,
    title: "Supervision 2D",
    description: "Vidéo robot, état de connexion et événements en direct.",
    check: (perms) => canSee(perms, "ui:operator.page"),
  },
];

export default function SpaceSelection() {
  const { user, permissions, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="space-select-wrap" data-testid="space-selection" id="main-content" tabIndex={-1}>
      <div className="space-select-header">
        <div className="space-select-brand"><IconActivity size={18} /><span>OSCAR CONTROL PLANE</span></div>
        <div className="space-select-heading">
          <div>
            <h1>Espace de travail</h1>
            <p>Sélectionnez votre environnement opérationnel.</p>
          </div>
          <div className="space-user-summary">
            <strong>{user?.nom}</strong>
            <span>{user?.email}</span>
          </div>
        </div>
        <OrganisationSwitcher compact />
      </div>

      <div className="space-cards-grid">
        {SPACES.map((space) => {
          const accessible = space.check(permissions);
          const Icon = space.Icon;
          return (
            <button
              key={space.id}
              className="space-card"
              data-testid={space.testId}
              disabled={!accessible}
              onClick={() => accessible && navigate(space.to)}
            >
              <div className="space-card-icon">
                <Icon size={24} />
              </div>
              <h2 className="space-card-title">{space.title}</h2>
              <p className="space-card-desc">{space.description}</p>
              <div className="space-card-footer">
                <span className={`status-chip ${accessible ? "online" : "neutral"}`}>
                  {accessible ? "Disponible" : "Accès restreint"}
                </span>
                {accessible && <IconArrowRight size={16} color="var(--shell-blue)" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="space-select-footer">
        <button className="btn-shell" data-testid="logout" onClick={logout}>
          <IconLogOut size={15} /> Déconnexion
        </button>
      </div>
    </main>
  );
}
