import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, LoaderCircle, MonitorSmartphone, Trash2, X } from "lucide-react";
import "@xyflow/react/dist/style.css";
import { useAuth } from "@/auth/AuthContext.jsx";
import {
  archiverProjet,
  chargerComposition,
  enregistrerProjet,
  etatSync,
  supprimerProjet,
  useStudioEtat,
  useStudioProjects,
  useStudioPerimetre,
} from "../../feature-domain/projectStore";
import { DEPLOYMENT_STUDIO_PERMISSIONS } from "../../feature-permissions/deploymentStudio.permissions";
import PresetVersementDialog from "../components/PresetVersementDialog";
import StudioCanvas from "../components/StudioCanvas";
import { listerPresetsTous } from "../../feature-data/studioApi";
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
  const perimetre = useStudioPerimetre();
  const { projectId } = useParams();
  const projects = useStudioProjects();
  const { sync } = useStudioEtat();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const ecranSuffisant = useEcranSuffisant();
  const project = projects.find((item) => item.id === projectId);
  // Le versement au catalogue est un geste de plateforme : ce qu'on y depose
  // sert de point de depart a toutes les organisations.
  const peutVerser = Boolean(user?.is_superadmin);
  const [aSupprimer, setASupprimer] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);
  const [versementOuvert, setVersementOuvert] = useState(false);
  const [familles, setFamilles] = useState<string[]>([]);

  // La liste ne transporte pas les compositions : on va chercher celle-ci à
  // l'ouverture, une seule fois.
  useEffect(() => {
    if (projectId) void chargerComposition(projectId);
  }, [projectId, perimetre]);

  // Les familles deja presentes au catalogue servent de suggestions au
  // versement. Leur absence ne bloque rien : le champ reste libre.
  useEffect(() => {
    if (!peutVerser) return;
    let vivant = true;
    listerPresetsTous()
      .then((liste) => { if (vivant) setFamilles([...new Set(liste.map((item) => item.famille))]); })
      .catch(() => { if (vivant) setFamilles([]); });
    return () => { vivant = false; };
  }, [peutVerser, perimetre]);

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
        canManage={can(DEPLOYMENT_STUDIO_PERMISSIONS.BUNDLE_WRITE, "update")}
        canVerser={peutVerser}
        onArchiver={(archive) => archiverProjet(project, archive)}
        onSupprimer={() => { setPanne(null); setASupprimer(true); }}
        onVerser={() => setVersementOuvert(true)}
        syncEtat={sync[project.id] ?? etatSync(project)}
      />

      {versementOuvert && project.publishedVersionId && (
        <PresetVersementDialog
          versionId={project.publishedVersionId}
          nomSuggere={project.name}
          {...(project.description ? { descriptionSuggeree: project.description } : {})}
          famillesConnues={familles}
          onVerse={() => setVersementOuvert(false)}
          onFermer={() => setVersementOuvert(false)}
        />
      )}

      {aSupprimer && (
        <div className="modal-backdrop">
          <section className="project-dialog project-delete-dialog" role="dialog" aria-modal="true"
                   aria-labelledby="supprimer-projet-titre">
            <header className="dialog-header">
              <div className="dialog-icon dialog-icon--danger"><Trash2 size={20} /></div>
              <div>
                <span>Suppression</span>
                <h2 id="supprimer-projet-titre">Supprimer ce projet ?</h2>
              </div>
              <button className="icon-button" disabled={suppression} type="button"
                      onClick={() => setASupprimer(false)}><X size={18} /></button>
            </header>
            <div className="project-delete-dialog__body">
              <strong>{project.name}</strong>
              <p>Le projet et ses versions non déployées seront supprimés. Cette action est définitive.</p>
              <small>
                <AlertTriangle size={14} /> S’il a déjà été déployé, son historique le protège :
                le serveur refusera, et l’archivage reste la bonne sortie.
              </small>
              {panne && <div className="dialog-erreur">{panne}</div>}
            </div>
            <footer className="dialog-footer">
              <button className="secondary-button" disabled={suppression} type="button"
                      onClick={() => setASupprimer(false)}>Annuler</button>
              <button className="danger-button" disabled={suppression} type="button"
                      onClick={async () => {
                        setSuppression(true);
                        setPanne(null);
                        try {
                          await supprimerProjet(project);
                          navigate("/studio");
                        } catch (erreur) {
                          setPanne(erreur instanceof Error
                            ? erreur.message
                            : "Le projet n’a pas pu être supprimé.");
                        } finally {
                          setSuppression(false);
                        }
                      }}>
                {suppression
                  ? <><LoaderCircle className="spin" size={15} /> Suppression…</>
                  : <><Trash2 size={15} /> Supprimer le projet</>}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
