import { AlertTriangle, Check, Clock3, LoaderCircle } from "lucide-react";
import { libelleEtatDeploiement } from "./deploymentStatus";

interface DeploymentProgressProps {
  statut: string;
  compact?: boolean;
}

type EtatEtape = "pending" | "current" | "done" | "warning" | "failed" | "neutral";

function etatsPour(statut: string): [EtatEtape, EtatEtape, EtatEtape] {
  switch (statut) {
    case "pending": return ["current", "pending", "pending"];
    case "delivered": return ["done", "current", "pending"];
    case "prepared": return ["done", "done", "warning"];
    case "active": return ["done", "done", "done"];
    case "failed": return ["done", "done", "failed"];
    case "rolled_back": return ["done", "done", "warning"];
    default: return ["neutral", "neutral", "neutral"];
  }
}

function IconeEtape({ etat }: { etat: EtatEtape }) {
  if (etat === "done") return <Check size={11} />;
  if (etat === "current") return <LoaderCircle className="spin" size={11} />;
  if (etat === "failed") return <AlertTriangle size={11} />;
  return <Clock3 size={10} />;
}

export default function DeploymentProgress({ statut, compact = false }: DeploymentProgressProps) {
  const etats = etatsPour(statut);
  const libelles = [
    "Planifié",
    "Reçu par le robot",
    statut === "prepared" ? "Configuration préparée"
      : statut === "failed" ? "Application échouée"
        : statut === "rolled_back" ? "Retour arrière"
          : "Runtime confirmé",
  ];

  return (
    <div
      className={`deployment-progress${compact ? " deployment-progress--compact" : ""}`}
      aria-label={`Progression : ${libelleEtatDeploiement(statut)}`}
    >
      {libelles.map((libelle, index) => (
        <div className={`deployment-progress__step is-${etats[index]}`} key={libelle}>
          <span className="deployment-progress__marker"><IconeEtape etat={etats[index]!} /></span>
          <span className="deployment-progress__label">{libelle}</span>
        </div>
      ))}
    </div>
  );
}
