import { useSyncExternalStore } from "react";
import { initialProjects, saveProjects } from "./model";
import type { OscarProject } from "./types";

/**
 * Brouillons du Studio, conserves dans le navigateur.
 *
 * La liste et l'editeur sont deux routes distinctes : elles partagent cet etat
 * pour qu'un projet modifie dans l'editeur apparaisse a jour dans la liste sans
 * rechargement. Le stockage local reste la source pour le mode hors ligne ; la
 * synchronisation serveur viendra s'ajouter par-dessus, sans le remplacer.
 */
let projets: OscarProject[] | null = null;
const abonnes = new Set<() => void>();

function etat(): OscarProject[] {
  if (!projets) projets = initialProjects();
  return projets;
}

function publier(suivants: OscarProject[]): void {
  projets = suivants;
  saveProjects(suivants);
  for (const abonne of abonnes) abonne();
}

function abonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

export function useStudioProjects(): OscarProject[] {
  return useSyncExternalStore(abonner, etat, etat);
}

export function ajouterProjet(projet: OscarProject): void {
  publier([projet, ...etat()]);
}

export function enregistrerProjet(projet: OscarProject): void {
  publier(etat().map((item) => (item.id === projet.id ? projet : item)));
}

export function supprimerProjet(projetId: string): void {
  publier(etat().filter((item) => item.id !== projetId));
}
