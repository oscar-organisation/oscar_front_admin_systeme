import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Blocks,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Layers3,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { TARGETS } from "../../feature-domain/catalogue";
import { createProject } from "../../feature-domain/model";
import { ajouterProjet, useStudioProjects } from "../../feature-domain/projectStore";
import type { ProjectTarget } from "../../feature-domain/types";
import "../../feature-styles/studio.css";

type Template = "DEMONSTRATION" | "ROBOT_MINIMAL" | "VIDE";

const TEMPLATES: { value: Template; label: string; hint: string; icon: typeof Bot }[] = [
  { value: "ROBOT_MINIMAL", label: "Robot minimal", hint: "Bundle, service, agent et premiers canaux.", icon: Bot },
  { value: "DEMONSTRATION", label: "Démonstration complète", hint: "Robot, média et télécommande déjà câblés.", icon: Sparkles },
  { value: "VIDE", label: "Plan vide", hint: "Uniquement un bundle de déploiement.", icon: Layers3 },
];

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(date));
}

export default function StudioProjectsPage() {
  const projects = useStudioProjects();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Nouveau projet robot");
  const [description, setDescription] = useState("Configuration des services et agents OSCAR.");
  const [target, setTarget] = useState<ProjectTarget>("ENVIRONNEMENT_EXECUTION_ROBOT");
  const [template, setTemplate] = useState<Template>("ROBOT_MINIMAL");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const project = createProject(name.trim(), description.trim(), target, template);
    ajouterProjet(project);
    setOpen(false);
    navigate(`/studio/${project.id}`);
  };

  return (
    <div className="studio-scope">
      <div className="studio-projects">
        <section className="projects-section">
          <div className="section-heading">
            <div>
              <span>Studio de déploiement</span>
              <h2>Projets de configuration</h2>
            </div>
            <button className="primary-button" onClick={() => setOpen(true)} type="button">
              <Plus size={16} /> Nouveau projet
            </button>
          </div>

          {projects.length === 0 ? (
            <p>Aucun projet pour l’instant. Créez-en un pour composer un bundle de déploiement.</p>
          ) : (
            <div className="project-grid">
              {projects.map((project) => {
                const targetLabel = TARGETS.find((item) => item.value === project.target)?.label;
                const agents = project.nodes.reduce((sum, node) => sum + node.data.agents.length, 0);
                return (
                  <button
                    className="project-card"
                    key={project.id}
                    onClick={() => navigate(`/studio/${project.id}`)}
                    type="button"
                  >
                    <div className="project-card__preview">
                      <Layers3 size={26} />
                      <span className="preview-node preview-node--a" />
                      <span className="preview-node preview-node--b" />
                      <span className="preview-node preview-node--c" />
                    </div>
                    <div className="project-card__body">
                      <div className="project-card__title">
                        <div>
                          <span>{project.status === "PRET_A_DEPLOYER" ? "Prêt à déployer" : "Brouillon"}</span>
                          <h3>{project.name}</h3>
                        </div>
                        <ChevronRight size={18} />
                      </div>
                      <p>{project.description}</p>
                      <div className="project-card__meta">
                        <span><Blocks size={14} /> {project.nodes.length} blocs · {agents} agents</span>
                        <span><CalendarClock size={14} /> {formatDate(project.updatedAt)}</span>
                      </div>
                      <small>{targetLabel}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {open && (
        <div className="modal-backdrop">
          <form className="project-dialog" onSubmit={submit}>
            <header className="dialog-header">
              <div className="dialog-icon"><Plus size={21} /></div>
              <div><span>Nouveau</span><h2>Créer un projet OSCAR</h2></div>
              <button className="icon-button" onClick={() => setOpen(false)} type="button"><X size={18} /></button>
            </header>
            <div className="project-dialog__body">
              <label className="form-field">
                <span>Nom du projet</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <label className="form-field">
                <span>Environnement principal</span>
                <select value={target} onChange={(event) => setTarget(event.target.value as ProjectTarget)}>
                  {TARGETS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                </select>
                <small>{TARGETS.find((item) => item.value === target)?.hint}</small>
              </label>
              <fieldset className="template-field">
                <legend>Point de départ</legend>
                {TEMPLATES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className={template === item.value ? "is-selected" : ""}
                      key={item.value}
                      onClick={() => setTemplate(item.value)}
                      type="button"
                    >
                      <Icon size={18} />
                      <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                      {template === item.value && <Check size={16} />}
                    </button>
                  );
                })}
              </fieldset>
            </div>
            <footer className="dialog-footer">
              <button className="secondary-button" onClick={() => setOpen(false)} type="button">Annuler</button>
              <button className="primary-button" type="submit"><Plus size={16} /> Créer et ouvrir</button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
