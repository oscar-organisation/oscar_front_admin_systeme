export const STATUTS_DEPLOIEMENT_EN_COURS = new Set(["pending", "delivered"]);

export function deploiementEnCours(statut: string): boolean {
  return STATUTS_DEPLOIEMENT_EN_COURS.has(statut);
}

export function libelleEtatDeploiement(statut: string): string {
  const libelles: Record<string, string> = {
    pending: "En attente du robot",
    delivered: "Reçu, application en cours",
    prepared: "Configuration préparée",
    active: "Runtime actif",
    failed: "Échec d’application",
    rolled_back: "Retour arrière effectué",
    cancelled: "Déploiement annulé",
    superseded: "Remplacé par une version récente",
  };
  return libelles[statut] ?? statut;
}
