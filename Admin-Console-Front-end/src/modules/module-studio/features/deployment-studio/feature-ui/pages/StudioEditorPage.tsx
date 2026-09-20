import { Link, useNavigate, useParams } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import { useAuth } from "@/auth/AuthContext.jsx";
import { enregistrerProjet, useStudioProjects } from "../../feature-domain/projectStore";
import { DEPLOYMENT_STUDIO_PERMISSIONS } from "../../feature-permissions/deploymentStudio.permissions";
import StudioCanvas from "../components/StudioCanvas";
import "../../feature-styles/studio.css";

export default function StudioEditorPage() {
  const { projectId } = useParams();
  const projects = useStudioProjects();
  const navigate = useNavigate();
  const { can } = useAuth();
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    return (
      <div className="studio-scope">
        <div className="studio-projects">
          <h2>Projet introuvable</h2>
          <p>Ce brouillon n’existe pas dans ce navigateur.</p>
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
      />
    </div>
  );
}
