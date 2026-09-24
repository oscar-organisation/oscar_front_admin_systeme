import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { listerDeploiements, listerRobots } from "../../feature-data/studioApi";
import type { FiltresDeploiements } from "../../feature-data/studioApi";
import type { DeploiementServeur, RobotCible } from "../../feature-domain/types";
import "../../feature-styles/studio.css";

const STATUTS_EN_COURS = new Set(["pending", "delivered", "prepared", "active"]);

const STATUTS = [
  { value: "", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "delivered", label: "Livré" },
  { value: "prepared", label: "Préparé" },
  { value: "active", label: "Actif" },
  { value: "failed", label: "Échec" },
  { value: "rolled_back", label: "Retour arrière" },
  { value: "cancelled", label: "Annulé" },
  { value: "superseded", label: "Remplacé" },
] as const;

const LIBELLES_STATUT: Record<string, string> = Object.fromEntries(
  STATUTS.filter((item) => item.value).map((item) => [item.value, item.label]),
);

const CLASSES_STATUT: Record<string, string> = {
  pending: "pending",
  delivered: "delivered",
  prepared: "prepared",
  active: "active",
  failed: "failed",
  rolled_back: "rolled-back",
  cancelled: "cancelled",
  superseded: "superseded",
};

function dateLisible(valeur?: string | null): string {
  if (!valeur) return "Date inconnue";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function reportPresent(report?: Record<string, unknown> | null): report is Record<string, unknown> {
  return Boolean(report && Object.keys(report).length > 0);
}

function erreurLisible(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

function horodatageDeploiement(deploiement: DeploiementServeur): string | null {
  return deploiement.updated_at
    ?? deploiement.applied_at
    ?? deploiement.delivered_at
    ?? deploiement.created_at
    ?? null;
}

function valeurHorodatage(deploiement: DeploiementServeur): number {
  const valeur = horodatageDeploiement(deploiement);
  if (!valeur) return 0;
  const date = new Date(valeur).getTime();
  return Number.isNaN(date) ? 0 : date;
}

export default function StudioDeploymentsPage() {
  const [deploiements, setDeploiements] = useState<DeploiementServeur[]>([]);
  const [robots, setRobots] = useState<RobotCible[]>([]);
  const [synthese, setSynthese] = useState<DeploiementServeur[]>([]);
  const [statut, setStatut] = useState("");
  const [robotId, setRobotId] = useState("");
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(true);
  const [panne, setPanne] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requeteCourante = useRef(0);

  useEffect(() => {
    let vivant = true;
    Promise.all([listerDeploiements(), listerRobots()])
      .then(([tous, listeRobots]) => {
        if (!vivant) return;
        setSynthese(tous);
        setRobots(listeRobots);
      })
      .catch(() => {
        // La liste principale porte l'erreur utile. Les compteurs et le filtre
        // robot peuvent rester vides sans masquer les déploiements chargés.
      });
    return () => { vivant = false; };
  }, [revision]);

  const charger = useCallback(async () => {
    const numero = requeteCourante.current + 1;
    requeteCourante.current = numero;
    setChargement(true);
    const filtres: FiltresDeploiements = {
      ...(statut ? { statut } : {}),
      ...(robotId ? { robotId } : {}),
    };
    try {
      const liste = await listerDeploiements(filtres);
      if (requeteCourante.current !== numero) return;
      setDeploiements(liste);
      setPanne(null);
    } catch (erreur) {
      if (requeteCourante.current !== numero) return;
      setPanne(erreurLisible(erreur));
    } finally {
      if (requeteCourante.current === numero) setChargement(false);
    }
  }, [robotId, statut]);

  useEffect(() => { void charger(); }, [charger, revision]);

  const visibles = useMemo(() => {
    const aiguille = recherche.trim().toLocaleLowerCase("fr");
    return [...deploiements]
      .filter((item) => !aiguille ||
        [item.robot_nom ?? "", item.robot_slug ?? "", item.bundle_nom ?? ""]
          .some((champ) => champ.toLocaleLowerCase("fr").includes(aiguille)))
      .sort((a, b) => valeurHorodatage(b) - valeurHorodatage(a));
  }, [deploiements, recherche]);

  const enCours = synthese.filter((item) => STATUTS_EN_COURS.has(item.statut)).length;
  const actifs = synthese.filter((item) => item.statut === "active").length;
  const echecs = synthese.filter((item) => item.statut === "failed").length;

  return (
    <div className="studio-scope">
      <div className="studio-projects deployment-history">
        <section className="projects-section">
          <div className="section-heading">
            <div>
              <span>Déploiement</span>
              <h2>Suivi des déploiements</h2>
            </div>
            <button className="secondary-button deployment-reload" type="button" onClick={() => setRevision((valeur) => valeur + 1)}>
              <RefreshCw size={15} /> Actualiser
            </button>
          </div>

          <p className="deployment-intro">
            État observé par les robots de l’organisation active, de la demande initiale à la confirmation d’exécution.
          </p>

          {/* Les compteurs filtrent la liste. Sans cela, un echec vieux de deux
              jours reste enterre sous les deploiements recents : on le compte
              sans pouvoir l'atteindre, ce qui est le contraire du but. */}
          <div className="deployment-overview" aria-label="Résumé des déploiements">
            <button
              className={`deployment-stat-card deployment-stat-card--running${statut === "active" ? " is-active" : ""}`}
              onClick={() => setStatut(statut === "active" ? "" : "active")}
              type="button"
              aria-pressed={statut === "active"}
            >
              <span className="deployment-stat-card__icon"><Activity size={19} /></span>
              <div className="deployment-stat-card__copy">
                <span>En cours</span>
                <strong>{enCours}</strong>
                <small>dont {actifs} actif{actifs > 1 ? "s" : ""} confirmé{actifs > 1 ? "s" : ""}</small>
              </div>
            </button>
            <button
              className={`deployment-stat-card deployment-stat-card--failed${statut === "failed" ? " is-active" : ""}`}
              onClick={() => setStatut(statut === "failed" ? "" : "failed")}
              type="button"
              aria-pressed={statut === "failed"}
              disabled={echecs === 0}
            >
              <span className="deployment-stat-card__icon"><AlertTriangle size={19} /></span>
              <div className="deployment-stat-card__copy">
                <span>Échecs</span>
                <strong>{echecs}</strong>
                <small>{echecs > 0 ? "Voir les échecs" : "Aucune intervention requise"}</small>
              </div>
            </button>
          </div>

          <div className="deployment-filterbar">
            <label className="deployment-search">
              <Search size={15} />
              <input
                type="search"
                aria-label="Rechercher un déploiement"
                placeholder="Rechercher un robot ou un bundle"
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
              />
            </label>
            <label className="deployment-filter">
              <span>Statut</span>
              <select aria-label="Filtrer par statut" value={statut} onChange={(event) => setStatut(event.target.value)}>
                {STATUTS.map((item) => <option key={item.value || "tous"} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="deployment-filter">
              <span>Robot</span>
              <select aria-label="Filtrer par robot" value={robotId} onChange={(event) => setRobotId(event.target.value)}>
                <option value="">Tous les robots</option>
                {robots.map((robot) => <option key={robot.id} value={robot.id}>{robot.nom}</option>)}
              </select>
            </label>
          </div>

          {panne && (
            <div className="deployment-page-error" role="alert">
              <AlertTriangle size={16} />
              <span><strong>Impossible de charger les déploiements.</strong>{panne}</span>
              <button type="button" onClick={() => setRevision((valeur) => valeur + 1)}>Réessayer</button>
            </div>
          )}

          <div className="deployment-list">
            <div className="deployment-list__head" aria-hidden="true">
              <span>Robot</span><span>Bundle</span><span>Statut</span><span>Horodatage</span>
            </div>

            {chargement ? (
              <p className="deployment-loading"><LoaderCircle size={16} className="spin" /> Chargement des déploiements…</p>
            ) : visibles.length === 0 ? (
              <div className="deployment-empty">
                <CheckCircle2 size={21} />
                <strong>Aucun déploiement à afficher</strong>
                <span>Modifiez les filtres ou publiez une version depuis le Studio.</span>
              </div>
            ) : visibles.map((deploiement) => {
              const rapport = reportPresent(deploiement.report);
              const classe = CLASSES_STATUT[deploiement.statut] ?? "unknown";
              const horodatage = horodatageDeploiement(deploiement);
              return (
                <article className="deployment-row" key={deploiement.id}>
                  <div className="deployment-row__main">
                    <div className="deployment-row__identity">
                      <span className="deployment-robot-icon"><Bot size={17} /></span>
                      <span>
                        <strong>{deploiement.robot_nom || "Robot inconnu"}</strong>
                        <small>{deploiement.robot_slug || deploiement.robot_id}</small>
                      </span>
                    </div>
                    <div className="deployment-row__bundle">
                      <strong>{deploiement.bundle_nom || "Bundle sans nom"}</strong>
                      <small>Version {deploiement.version_numero ?? "inconnue"}</small>
                    </div>
                    <span className={`deployment-status deployment-status--${classe}`}>
                      {LIBELLES_STATUT[deploiement.statut] ?? deploiement.statut}
                    </span>
                    <time className="deployment-row__time" dateTime={horodatage ?? undefined}>
                      <Clock3 size={13} /> {dateLisible(horodatage)}
                    </time>
                  </div>

                  {deploiement.message && (
                    <p className={`deployment-message${deploiement.statut === "failed" ? " deployment-message--failed" : ""}`}>
                      <AlertTriangle size={14} /> {deploiement.message}
                    </p>
                  )}

                  {rapport && (
                    <details className="deployment-report">
                      <summary><ChevronDown size={14} /> Compte rendu du robot</summary>
                      <pre>{JSON.stringify(deploiement.report, null, 2)}</pre>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
