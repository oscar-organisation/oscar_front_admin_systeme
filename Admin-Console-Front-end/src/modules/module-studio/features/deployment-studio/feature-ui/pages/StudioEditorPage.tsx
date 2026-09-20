import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MonitorSmartphone } from "lucide-react";
import "@xyflow/react/dist/style.css";
import { useAuth } from "@/auth/AuthContext.jsx";
import {
  chargerComposition,
  enregistrerProjet,
  etatSync,
  useStudioEtat,
  useStudioProjects,
} from "../../feature-domain/projectStore";
import { DEPLOYMENT_STUDIO_PERMISSIONS } from "../../feature-permissions/deploymentStudio.permissions";
import StudioCanvas from "../components/StudioCanvas";
import "../../feature-styles/studio.css";

/** Largeur en deçà de laquelle le plan de composition n'est plus manipulable. */
const LARGEUR_MINIMALE = 1100;

function useEcranSuffisant(): boolean {
  const [suffisant, setSuffisant] = useState(() =>
    typeof window === "undefined" || window.innerWidth >= LARGEUR_MINIMALE);
  useEffect(() => {
    const mesurer = () => setSuffisant(window.innerWidth >= LARGEUR_MINIMALE);
    mesurer();
    window.addEventListener("resize", mesurer);
    return () => window.removeEventListener("resize", mesurer);
  }, []);
  return suffisant;
}

export default function StudioEditorPage() {
  const { projectId } = useParams();
  const projects = useStudioProjects();
  const { sync } = useStudioEtat();
  const navigate = useNavigate();
  const { can } = useAuth();
  const ecranSuffisant = useEcranSuffisant();
  const project = projects.find((item) => item.id === projectId);

  // La liste ne transporte pas les compositions : on va chercher celle-ci à
  // l'ouverture, une seule fois.
  useEffect(() => {
    if (projectId) void chargerComposition(projectId);
  }, [projectId]);

  if (!project) {
    return (
      <div className="studio-scope">
        <div className="studio-projects">
          <h2>Projet introuvable</h2>
          <p>Ce projet n’est ni sur le serveur ni dans ce navigateur.</p>
          <Link to="/studio">Revenir aux projets</Link>
        </div>
      </div>
    );
  }

  if (!ecranSuffisant) {
    // Un plan de composition se manipule à deux mains sur un écran large. Le
    // dire franchement vaut mieux qu'un canevas qu'on ne peut ni lire ni
    // brancher, et la liste des projets reste consultable en mobilité.
    return (
      <div className="studio-scope">
        <div className="studio-projects studio-trop-etroit">
          <MonitorSmartphone size={28} />
          <h2>{project.name}</h2>
          <p>
            Le plan de composition demande un écran d’au moins {LARGEUR_MINIMALE} px.
            Ouvrez ce projet depuis un poste de travail pour le modifier.
          </p>
          <Link to="/studio">Revenir aux projets</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-scope studio-scope--editor">
      <StudioCanvas
        project={project}
        onChange={enregistrerProjet}
        onBack={() => navigate("/studio")}
        canPublish={can(DEPLOYMENT_STUDIO_PERMISSIONS.BUNDLE_PUBLISH, "execute")}
        canDeploy={can(DEPLOYMENT_STUDIO_PERMISSIONS.DEPLOYMENT_EXECUTE, "execute")}
        syncEtat={sync[project.id] ?? etatSync(project)}
      />
    </div>
  );
}
