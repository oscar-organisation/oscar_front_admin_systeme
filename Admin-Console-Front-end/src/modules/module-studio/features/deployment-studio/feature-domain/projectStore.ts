import { useLayoutEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/auth/AuthContext.jsx";
import {
  creerBundle,
  enregistrerBrouillon,
  listerBundles,
  lireVersion,
  projetDepuisBundle,
} from "../feature-data/studioApi";
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
let perimetre = "";
let generation = 0;
const abonnes = new Set<() => void>();
const minuteries = new Map<string, number>();

function lire(): Etat {
  return etat;
}

export function configurerPerimetre(userId: string | null, orgId: string | null): void {
  const suivant = userId ? `oscar.studio.projects.v2:${userId}:${orgId ?? "global"}` : "";
  if (suivant === perimetre) return;
  for (const minuterie of minuteries.values()) window.clearTimeout(minuterie);
  minuteries.clear();
  generation++;
  perimetre = suivant;
  let projets: OscarProject[] = [];
  try {
    const stocke: unknown = JSON.parse(localStorage.getItem(perimetre) ?? "[]");
    if (Array.isArray(stocke)) projets = stocke as OscarProject[];
  } catch { /* Le cache historique sans propriétaire n'est jamais importé. */ }
  etat = { projets, sync: {}, chargement: false, horsLigne: false };
  for (const abonne of abonnes) abonne();
}

export function useStudioPerimetre(): string {
  const { user, activeOrganisationId } = useAuth();
  const userId = user?.id ?? null;
  useLayoutEffect(() => {
    configurerPerimetre(userId, activeOrganisationId);
    return () => configurerPerimetre(null, null);
  }, [userId, activeOrganisationId]);
  return `${userId ?? ""}:${activeOrganisationId ?? ""}`;
}

function publier(suivant: Partial<Etat>): void {
  etat = { ...lire(), ...suivant };
  try {
    if (perimetre) localStorage.setItem(perimetre, JSON.stringify(etat.projets));
  } catch { /* Le brouillon reste en mémoire si le stockage est indisponible. */ }
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
  const contexte = generation;
  publier({ chargement: true });
  try {
    const bundles = await listerBundles();
    if (contexte !== generation) return;
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
    if (contexte !== generation) return;
    // Hors ligne : la liste locale reste la verite affichee.
    publier({ chargement: false, horsLigne: true });
  }
}

/** Charge la composition complète d'un projet serveur (la liste ne la porte pas). */
export async function chargerComposition(projetId: string): Promise<void> {
  const contexte = generation;
  if (!lire().projets.some((item) => item.id === projetId)) await rafraichir();
  if (contexte !== generation) return;
  const projet = lire().projets.find((item) => item.id === projetId);
  if (!projet?.bundleId || projet.nodes.length > 0) return;
  const versionId = projet.draftVersionId ?? projet.sourceVersionId;
  if (!versionId) return;
  try {
    const version = await lireVersion(versionId);
    if (contexte !== generation) return;
    enregistrerLocalement({
      ...projet,
      nodes: version.spec?.nodes ?? [],
      edges: version.spec?.edges ?? [],
      syncedAt: new Date().toISOString(),
    });
  } catch {
    if (contexte !== generation) return;
    publier({ horsLigne: true });
  }
}

export async function creerProjet(projet: OscarProject, cible: ProjectTarget): Promise<OscarProject> {
  const contexte = generation;
  try {
    const bundle = await creerBundle({
      nom: projet.name,
      description: projet.description,
      target: cible,
    });
    if (contexte !== generation) throw new Error("Organisation modifiée pendant la création");
    const lie: OscarProject = { ...projet, id: bundle.id, bundleId: bundle.id };
    publier({ projets: [lie, ...lire().projets], horsLigne: false });
    await synchroniser(lie, { immediat: true });
    return lie;
  } catch (erreur) {
    if (contexte !== generation) throw erreur;
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
  const contexte = generation;
  const bundleId = projet.bundleId;
  if (!bundleId) {
    marquer(projet.id, "LOCAL");
    return Promise.resolve();
  }
  const enAttente = minuteries.get(projet.id);
  if (enAttente) window.clearTimeout(enAttente);

  const envoyer = async () => {
    if (contexte !== generation) return;
    minuteries.delete(projet.id);
    marquer(projet.id, "EN_COURS");
    try {
      const version = await enregistrerBrouillon(bundleId, projet);
      if (contexte !== generation) return;
      enregistrerLocalement({
        ...projet,
        draftVersionId: version.id,
        version: version.numero,
        syncedAt: new Date().toISOString(),
      });
      marquer(projet.id, "SYNCHRONISE");
      publier({ horsLigne: false });
    } catch {
      if (contexte !== generation) return;
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
