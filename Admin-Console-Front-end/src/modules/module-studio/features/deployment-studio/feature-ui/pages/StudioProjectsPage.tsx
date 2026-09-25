import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Blocks,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CloudOff,
  Layers3,
  LoaderCircle,
  Plus,
  Server,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { TARGETS } from "../../feature-domain/catalogue";
import { createProject } from "../../feature-domain/model";
import {
  archiverProjet,
  creerProjet,
  etatSync,
  rafraichir,
  supprimerProjet,
  useStudioEtat,
  useStudioProjects,
  useStudioPerimetre,
} from "../../feature-domain/projectStore";
import PresetPicker from "../components/PresetPicker";
import { listerPresets, projetDepuisPreset } from "../../feature-data/studioApi";
import type { PresetServeur } from "../../feature-data/studioApi";
import type { ProjectTarget } from "../../feature-domain/types";
import type { OscarProject } from "../../feature-domain/types";
import "../../feature-styles/studio.css";

type Template = "DEMONSTRATION" | "ROBOT_MINIMAL" | "VIDE";

/**
 * Un projet part soit d'un préset du catalogue, soit d'une forme générique.
 *
 * Les deux sont exclusifs, d'où un seul état plutôt que deux qui pourraient se
 * contredire. Les présets viennent du serveur ; les formes génériques restent
 * disponibles hors ligne, et servent de repli si le catalogue ne répond pas.
 */
type Depart = { sorte: "preset"; slug: string } | { sorte: "forme"; valeur: Template };

const TEMPLATES: { value: Template; label: string; hint: string; icon: typeof Bot }[] = [
  { value: "ROBOT_MINIMAL", label: "Robot minimal", hint: "Bundle, service, module et premiers canaux.", icon: Bot },
  { value: "DEMONSTRATION", label: "Démonstration complète", hint: "Robot, média et télécommande déjà câblés.", icon: Sparkles },
  { value: "VIDE", label: "Plan vide", hint: "Uniquement un bundle de déploiement.", icon: Layers3 },
];

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .format(new Date(date));
}

export default function StudioProjectsPage() {
  const perimetre = useStudioPerimetre();
  const projects = useStudioProjects();
  const { horsLigne, chargement } = useStudioEtat();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Nouveau projet robot");
  const [description, setDescription] = useState("Configuration des services et modules OSCAR.");
  const [target, setTarget] = useState<ProjectTarget>("ENVIRONNEMENT_EXECUTION_ROBOT");
  const [depart, setDepart] = useState<Depart>({ sorte: "forme", valeur: "ROBOT_MINIMAL" });
  const [presets, setPresets] = useState<PresetServeur[]>([]);
  const [catalogueOuvert, setCatalogueOuvert] = useState(false);
  const [aSupprimer, setASupprimer] = useState<OscarProject | null>(null);
  const [suppression, setSuppression] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [archivesVisibles, setArchivesVisibles] = useState(false);
  const [archivage, setArchivage] = useState<string | null>(null);
  const [erreurArchivage, setErreurArchivage] = useState<string | null>(null);

  // Le serveur fait foi pour la liste ; le cache local prend le relais s'il
  // ne repond pas.
  useEffect(() => { void rafraichir(); }, [perimetre]);

  // Le catalogue est un confort, pas une condition : s'il ne repond pas, les
  // formes generiques restent la et la creation n'est pas bloquee.
  useEffect(() => {
    let vivant = true;
    listerPresets()
      .then((liste) => { if (vivant) setPresets(liste); })
      .catch(() => { if (vivant) setPresets([]); });
    return () => { vivant = false; };
  }, [perimetre]);

  const archives = projects.filter((project) => project.archive);
  const affiches = archivesVisibles ? projects : projects.filter((project) => !project.archive);

  const presetChoisi = depart.sorte === "preset"
    ? presets.find((item) => item.slug === depart.slug)
    : undefined;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const preset = presetChoisi;
    const brouillon = preset
      ? projetDepuisPreset(preset, name.trim(), description.trim(), target)
      : createProject(name.trim(), description.trim(), target,
                      depart.sorte === "forme" ? depart.valeur : "ROBOT_MINIMAL");
    const project = await creerProjet(brouillon, target);
    setOpen(false);
    navigate(`/studio/${project.id}`);
  };

  const basculerArchive = async (project: OscarProject) => {
    setArchivage(project.id);
    setErreurArchivage(null);
    try {
      await archiverProjet(project, !project.archive);
    } catch (erreur) {
      setErreurArchivage(
        erreur instanceof Error ? erreur.message : "Le projet n\u2019a pas pu \u00eatre archiv\u00e9.",
      );
    } finally {
      setArchivage(null);
    }
  };

  const confirmerSuppression = async () => {
    if (!aSupprimer) return;
    setSuppression(true);
    setErreurSuppression(null);
    try {
      await supprimerProjet(aSupprimer);
      setASupprimer(null);
    } catch (erreur) {
      setErreurSuppression(
        erreur instanceof Error ? erreur.message : "Le projet n’a pas pu être supprimé.",
      );
    } finally {
      setSuppression(false);
    }
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

          {horsLigne && (
            <p className="studio-offline">
              <CloudOff size={14} /> Serveur injoignable : voici les projets conservés dans ce navigateur.
            </p>
          )}

          {archives.length > 0 && (
            <button className="archives-bascule" type="button"
                    onClick={() => setArchivesVisibles((visible) => !visible)}>
              {archivesVisibles ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {archivesVisibles
                ? "Masquer les projets archivés"
                : `Afficher les projets archivés (${archives.length})`}
            </button>
          )}

          {erreurArchivage && <p className="dialog-erreur">{erreurArchivage}</p>}

          {affiches.length === 0 ? (
            <p>
              {chargement
                ? "Chargement des projets…"
                : projects.length === 0
                  ? "Aucun projet pour l’instant. Créez-en un pour composer un bundle de déploiement."
                  : "Tous les projets sont archivés. Affichez-les pour en ressortir un."}
            </p>
          ) : (
            <div className="project-grid">
              {affiches.map((project) => {
                const targetLabel = TARGETS.find((item) => item.value === project.target)?.label;
                // La liste sert des compteurs : on evite de telecharger chaque
                // composition pour afficher une vignette.
                const blocs = project.nodes.length || project.summary?.composants || 0;
                const agents = project.nodes.length
                  ? project.nodes.reduce((sum, node) => sum + node.data.agents.length, 0)
                  : project.summary?.agents || 0;
                const local = etatSync(project) === "LOCAL";
                return (
                  <article className={`project-card${project.archive ? " is-archived" : ""}`} key={project.id}>
                    <button
                      className="project-card__open"
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
                            <span>
                              {local
                                ? "Local"
                                : project.status === "PRET_A_DEPLOYER" ? "Publié" : "Brouillon"}
                            </span>
                            <h3>{project.name}</h3>
                          </div>
                          <ChevronRight size={18} />
                        </div>
                        <p>{project.description}</p>
                        <div className="project-card__meta">
                          <span><Blocks size={14} /> {blocs} bloc{blocs > 1 ? "s" : ""} · {agents} module{agents > 1 ? "s" : ""}</span>
                          <span><CalendarClock size={14} /> {formatDate(project.updatedAt)}</span>
                        </div>
                        <small>
                          {targetLabel}
                          {project.summary?.robots
                            ? <> · <Server size={12} /> {project.summary.robots} robot{project.summary.robots > 1 ? "s" : ""}</>
                            : null}
                        </small>
                      </div>
                    </button>
                    <div className="project-card__actions">
                      {project.bundleId && (
                        <button
                          className="project-card__action"
                          aria-label={project.archive
                            ? `Sortir ${project.name} des archives`
                            : `Archiver le projet ${project.name}`}
                          title={project.archive
                            ? "Le remettre dans le plan de travail"
                            : "Le ranger hors du plan de travail, sans rien effacer"}
                          disabled={archivage === project.id}
                          onClick={() => void basculerArchive(project)}
                          type="button"
                        >
                          {archivage === project.id
                            ? <LoaderCircle className="spin" size={15} />
                            : project.archive ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        </button>
                      )}
                      <button
                        className="project-card__action project-card__action--danger"
                        aria-label={`Supprimer le projet ${project.name}`}
                        title="Supprimer le projet"
                        onClick={() => {
                          setErreurSuppression(null);
                          setASupprimer(project);
                        }}
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {open && (
        <div className="modal-backdrop">
          <form className="project-dialog" onSubmit={(event) => void submit(event)}>
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
              {presets.length > 0 && (
                <fieldset className="template-field">
                  <legend>Partir d'un préset</legend>
                  {presetChoisi ? (
                    <div className="preset-retenu">
                      <Server size={18} />
                      <span>
                        <strong>{presetChoisi.nom}</strong>
                        <small>
                          {presetChoisi.constructeur ? `${presetChoisi.constructeur} · ` : ""}
                          {presetChoisi.famille}
                        </small>
                      </span>
                      <button className="link-button" onClick={() => setCatalogueOuvert(true)} type="button">
                        Changer
                      </button>
                    </div>
                  ) : (
                    <button className="preset-ouvrir" onClick={() => setCatalogueOuvert(true)} type="button">
                      <Server size={18} />
                      <span>
                        <strong>Parcourir le catalogue</strong>
                        <small>
                          {presets.length} composition{presets.length > 1 ? "s" : ""} de référence
                          éprouvée{presets.length > 1 ? "s" : ""} sur un châssis réel
                        </small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  )}
                </fieldset>
              )}
              <fieldset className="template-field">
                <legend>{presets.length > 0 ? "Ou partir d'une forme vierge" : "Point de départ"}</legend>
                {TEMPLATES.map((item) => {
                  const Icon = item.icon;
                  const choisi = depart.sorte === "forme" && depart.valeur === item.value;
                  return (
                    <button
                      className={choisi ? "is-selected" : ""}
                      key={item.value}
                      onClick={() => setDepart({ sorte: "forme", valeur: item.value })}
                      type="button"
                    >
                      <Icon size={18} />
                      <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                      {choisi && <Check size={16} />}
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

      {aSupprimer && (
        <div className="modal-backdrop">
          <section className="project-dialog project-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
            <header className="dialog-header">
              <div className="dialog-icon dialog-icon--danger"><Trash2 size={20} /></div>
              <div><span>Suppression</span><h2 id="delete-project-title">Supprimer ce projet ?</h2></div>
              <button className="icon-button" disabled={suppression} onClick={() => setASupprimer(null)} type="button"><X size={18} /></button>
            </header>
            <div className="project-delete-dialog__body">
              <strong>{aSupprimer.name}</strong>
              <p>
                Le projet et ses versions non déployées seront supprimés. Cette action est définitive.
              </p>
              {aSupprimer.bundleId && (
                <small><AlertTriangle size={14} /> S’il a déjà été déployé, son historique le protège et le serveur refusera sa suppression.</small>
              )}
              {erreurSuppression && <div className="dialog-erreur">{erreurSuppression}</div>}
            </div>
            <footer className="dialog-footer">
              <button className="secondary-button" disabled={suppression} onClick={() => setASupprimer(null)} type="button">Annuler</button>
              <button className="danger-button" disabled={suppression} onClick={() => void confirmerSuppression()} type="button">
                {suppression ? <><LoaderCircle className="spin" size={15} /> Suppression…</> : <><Trash2 size={15} /> Supprimer le projet</>}
              </button>
            </footer>
          </section>
        </div>
      )}

      {catalogueOuvert && (
        <PresetPicker
          presets={presets}
          choisi={depart.sorte === "preset" ? depart.slug : undefined}
          onChoisir={(preset) => {
            setDepart({ sorte: "preset", slug: preset.slug });
            setCatalogueOuvert(false);
          }}
          onFermer={() => setCatalogueOuvert(false)}
        />
      )}
    </div>
  );
}
