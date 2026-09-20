import { useSyncExternalStore } from "react";
import {
  creerBundle,
  enregistrerBrouillon,
  listerBundles,
  lireVersion,
  projetDepuisBundle,
} from "../feature-data/studioApi";
import { initialProjects, saveProjects } from "./model";
import type { OscarProject, ProjectTarget, SyncState } from "./types";

/**
 * Projets du Studio : brouillon local d'abord, accord avec le serveur ensuite.
 *
 * Le Studio doit rester utilisable sans réseau — c'est une exigence de
 * terrain, pas un confort : on configure un robot dans une réserve de magasin.
 * L'édition écrit donc toujours dans le navigateur, et pousse ensuite vers le
 * serveur. Un projet qui n'a jamais atteint le serveur reste `LOCAL` : il peut
 * se composer mais pas se publier, parce que publier engage une flotte.
 */

interface Etat {
  projets: OscarProject[];
  sync: Record<string, SyncState>;
  chargement: boolean;
  horsLigne: boolean;
}

let etat: Etat = { projets: [], sync: {}, chargement: false, horsLigne: false };
let amorce = false;
const abonnes = new Set<() => void>();
const minuteries = new Map<string, number>();

function lire(): Etat {
  if (!amorce) {
    amorce = true;
    etat = { ...etat, projets: initialProjects() };
  }
  return etat;
}

function publier(suivant: Partial<Etat>): void {
  etat = { ...lire(), ...suivant };
  saveProjects(etat.projets);
  for (const abonne of abonnes) abonne();
}

function abonner(abonne: () => void): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

function marquer(projetId: string, valeur: SyncState): void {
  publier({ sync: { ...lire().sync, [projetId]: valeur } });
}

export function useStudioProjects(): OscarProject[] {
  return useSyncExternalStore(abonner, () => lire().projets, () => lire().projets);
}

export function useStudioEtat(): Omit<Etat, "projets"> {
  const instantane = useSyncExternalStore(abonner, lire, lire);
  return { sync: instantane.sync, chargement: instantane.chargement, horsLigne: instantane.horsLigne };
}

export function etatSync(projet: OscarProject): SyncState {
  return lire().sync[projet.id] ?? (projet.bundleId ? "SYNCHRONISE" : "LOCAL");
}

/** Recharge la liste depuis le serveur et la fusionne avec les projets locaux. */
export async function rafraichir(): Promise<void> {
  publier({ chargement: true });
  try {
    const bundles = await listerBundles();
    const distants = bundles.map((bundle) => {
      const connu = lire().projets.find((projet) => projet.bundleId === bundle.id);
      const projet = projetDepuisBundle(bundle, null);
      return {
        ...projet,
        // La composition n'est pas dans la liste : on garde celle qu'on a deja
        // en memoire plutot que d'afficher un plan vide le temps d'un clic.
        nodes: connu?.nodes ?? [],
        edges: connu?.edges ?? [],
        summary: {
          composants: bundle.component_count,
          agents: bundle.agent_count,
          robots: bundle.robot_count,
        },
      };
    });
    const locaux = lire().projets.filter((projet) => !projet.bundleId);
    publier({ projets: [...distants, ...locaux], chargement: false, horsLigne: false });
  } catch {
    // Hors ligne : la liste locale reste la verite affichee.
    publier({ chargement: false, horsLigne: true });
  }
}

/** Charge la composition complète d'un projet serveur (la liste ne la porte pas). */
export async function chargerComposition(projetId: string): Promise<void> {
  const projet = lire().projets.find((item) => item.id === projetId);
  if (!projet?.bundleId || projet.nodes.length > 0) return;
  const versionId = projet.draftVersionId;
  if (!versionId) return;
  try {
    const version = await lireVersion(versionId);
    enregistrerLocalement({
      ...projet,
      nodes: version.spec?.nodes ?? [],
      edges: version.spec?.edges ?? [],
      syncedAt: new Date().toISOString(),
    });
  } catch {
    publier({ horsLigne: true });
  }
}

export async function creerProjet(projet: OscarProject, cible: ProjectTarget): Promise<OscarProject> {
  try {
    const bundle = await creerBundle({
      nom: projet.name,
      description: projet.description,
      target: cible,
    });
    const lie: OscarProject = { ...projet, id: bundle.id, bundleId: bundle.id };
    publier({ projets: [lie, ...lire().projets], horsLigne: false });
    await synchroniser(lie, { immediat: true });
    return lie;
  } catch {
    // Sans serveur, le projet existe quand meme : il sera pousse plus tard.
    publier({ projets: [projet, ...lire().projets], horsLigne: true });
    marquer(projet.id, "LOCAL");
    return projet;
  }
}

function enregistrerLocalement(projet: OscarProject): void {
  publier({
    projets: lire().projets.map((item) => (item.id === projet.id ? projet : item)),
  });
}

/** Pousse le brouillon vers le serveur, en lissant les frappes successives. */
export function synchroniser(projet: OscarProject, options?: { immediat?: boolean }): Promise<void> {
  const bundleId = projet.bundleId;
  if (!bundleId) {
    marquer(projet.id, "LOCAL");
    return Promise.resolve();
  }
  const enAttente = minuteries.get(projet.id);
  if (enAttente) window.clearTimeout(enAttente);

  const envoyer = async () => {
    minuteries.delete(projet.id);
    marquer(projet.id, "EN_COURS");
    try {
      const version = await enregistrerBrouillon(bundleId, projet);
      enregistrerLocalement({
        ...projet,
        draftVersionId: version.id,
        version: version.numero,
        syncedAt: new Date().toISOString(),
      });
      marquer(projet.id, "SYNCHRONISE");
      publier({ horsLigne: false });
    } catch {
      marquer(projet.id, "ECHEC");
      publier({ horsLigne: true });
    }
  };

  if (options?.immediat) return envoyer();
  return new Promise((resoudre) => {
    // 1,2 s : assez pour ne pas ecrire a chaque pixel deplace, assez court pour
    // qu'un collegue qui ouvre le projet juste apres voie le meme plan.
    const minuterie = window.setTimeout(() => void envoyer().then(resoudre), 1200);
    minuteries.set(projet.id, minuterie);
  });
}

export function enregistrerProjet(projet: OscarProject): void {
  enregistrerLocalement(projet);
  void synchroniser(projet);
}

export function ajouterProjet(projet: OscarProject): void {
  publier({ projets: [projet, ...lire().projets] });
}

export function supprimerProjet(projetId: string): void {
  publier({ projets: lire().projets.filter((item) => item.id !== projetId) });
}

export function remplacerProjet(projet: OscarProject): void {
  enregistrerLocalement(projet);
}
