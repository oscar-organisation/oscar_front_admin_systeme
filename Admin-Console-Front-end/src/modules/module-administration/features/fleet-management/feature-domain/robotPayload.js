/**
 * Corps envoye a l'API pour creer ou modifier un robot.
 *
 * Extrait du formulaire pour etre testable : la page envoyait
 * `organisation_id` la ou l'API attend `org_id`. Pydantic ignorant une cle
 * inconnue sans rien dire, chaque robot cree depuis l'interface naissait sans
 * organisation — invisible dans une liste filtree, hors de portee d'un
 * deploiement par flotte ou par site, et en dehors du cloisonnement.
 *
 * La lecture, elle, tolerait les deux noms, ce qui masquait l'ecart : on
 * relisait bien l'organisation d'un robot qui en avait une, donc rien ne
 * paraissait cassé tant qu'on n'en creait pas un.
 */
export function corpsRobot(modal) {
  return {
    nom: modal.nom,
    org_id: modal.org_id || null,
    site_id: modal.site_id || null,
    serial: modal.serial,
    modele: modal.modele || null,
    firmware: modal.firmware,
    statut: modal.statut,
    batterie: Number(modal.batterie),
    capacites: modal.capacites
      ? modal.capacites.split(",").map((valeur) => valeur.trim()).filter(Boolean)
      : [],
  };
}
