import { api } from "@/shared/kernel/api";
import type {
  ArchitectureEdge,
  ArchitectureNode,
  DeploiementServeur,
  OscarProject,
  ProjectTarget,
  RobotCible,
} from "../feature-domain/types";

/**
 * Accès au Studio côté serveur.
 *
 * Le Studio reste utilisable hors ligne : ces appels peuvent donc échouer sans
 * que l'édition s'arrête. Les fonctions lèvent, et l'appelant décide s'il
 * affiche un état « non synchronisé » ou s'il bloque l'action — publier exige
 * le serveur, dessiner non.
 */

export interface VersionServeur {
  id: string;
  bundle_id: string;
  numero: number;
  statut: string;
  checksum?: string | null;
  notes?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
}

export interface BundleServeur {
  id: string;
  org_id: string;
  nom: string;
  slug: string;
  description?: string | null;
  target: string;
  statut: string;
  updated_at?: string | null;
  draft_version?: VersionServeur | null;
  published_version?: VersionServeur | null;
  version_count: number;
  robot_count: number;
  component_count: number;
  agent_count: number;
}

interface VersionDetail extends VersionServeur {
  spec: { nodes?: ArchitectureNode[]; edges?: ArchitectureEdge[] };
}

export interface ValidationServeur {
  valide: boolean;
  erreurs: string[];
  avertissements: string[];
}

/**
 * Préset du catalogue de la plateforme.
 *
 * Il ne vient pas de l'organisation qui le consulte : c'est une composition de
 * référence que nous maintenons, éprouvée sur un châssis réel. `famille`
 * désigne ce châssis avec le même identifiant que le profil embarqué et que
 * l'image du runtime, pour qu'aucune table de correspondance n'ait à être
 * tenue à jour entre les trois.
 */
export interface PresetServeur {
  id: string;
  slug: string;
  nom: string;
  famille: string;
  constructeur?: string | null;
  description?: string | null;
  spec: { nodes?: ArchitectureNode[]; edges?: ArchitectureEdge[] };
  statut: string;
  ordre: number;
  revision: number;
}

/**
 * Catalogue publié, dans l'ordre où il doit s'afficher.
 *
 * L'appel peut échouer — le Studio s'utilise hors ligne. L'appelant retombe
 * alors sur les formes génériques plutôt que de bloquer la création.
 */
export function listerPresets(): Promise<PresetServeur[]> {
  return api.get<PresetServeur[]>("/studio/presets");
}

/** Métadonnées à poser sur un préset au moment de le verser au catalogue. */
export interface PresetEntree {
  slug: string;
  nom: string;
  famille: string;
  constructeur?: string;
  description?: string;
  ordre?: number;
  notes?: string;
}

/**
 * Catalogue complet, brouillons compris.
 *
 * Réservé à qui maintient la bibliothèque : le serveur n'honore `tous` que
 * pour un super administrateur, et se contente sinon des présets publiés.
 */
export function listerPresetsTous(): Promise<PresetServeur[]> {
  return api.get<PresetServeur[]>("/studio/presets?tous=true");
}

/**
 * Verse une version publiée au catalogue.
 *
 * C'est le chemin par lequel la bibliothèque s'enrichit : on compose, on
 * éprouve sur un robot réel, puis on propose à tous ce qui a fait ses preuves.
 */
export function verserAuCatalogue(versionId: string, entree: PresetEntree): Promise<PresetServeur> {
  return api.post<PresetServeur>(`/studio/presets/from-version/${versionId}`, entree);
}

export function modifierPreset(reference: string, champs: Partial<PresetEntree> & { statut?: string }): Promise<PresetServeur> {
  return api.patch<PresetServeur>(`/studio/presets/${reference}`, champs);
}

export function supprimerPreset(reference: string): Promise<void> {
  return api.del<void>(`/studio/presets/${reference}`);
}

export function listerBundles(): Promise<BundleServeur[]> {
  return api.get<BundleServeur[]>("/studio/bundles");
}

export function creerBundle(entree: { nom: string; description: string; target: ProjectTarget }): Promise<BundleServeur> {
  return api.post<BundleServeur>("/studio/bundles", entree);
}

export function lireBundle(bundleId: string): Promise<BundleServeur> {
  return api.get<BundleServeur>(`/studio/bundles/${bundleId}`);
}

export function lireVersion(versionId: string): Promise<VersionDetail> {
  return api.get<VersionDetail>(`/studio/versions/${versionId}`);
}

export function enregistrerBrouillon(bundleId: string, projet: OscarProject): Promise<VersionServeur> {
  return api.put<VersionServeur>(`/studio/bundles/${bundleId}/draft`, {
    spec: { nodes: projet.nodes, edges: projet.edges },
    notes: projet.description || null,
  });
}

export function verifier(bundleId: string): Promise<ValidationServeur> {
  return api.post<ValidationServeur>(`/studio/bundles/${bundleId}/validate`);
}

export function publier(bundleId: string, notes?: string): Promise<VersionServeur> {
  return api.post<VersionServeur>(`/studio/bundles/${bundleId}/publish`, { notes: notes || null });
}

export interface BoxIA {
  id: string;
  nom: string;
  version: string;
  statut: string;
}

/** Box IA publiees : seules celles-la sont deployables avec un bundle. */
export async function listerBoxIA(): Promise<BoxIA[]> {
  const boxes = await api.get<BoxIA[]>("/ai/model-boxes");
  return boxes.filter((box) => box.statut === "published");
}

export function listerRobots(): Promise<RobotCible[]> {
  return api.get<RobotCible[]>("/robots");
}

export interface Flotte {
  id: string;
  nom: string;
  code: string;
  robot_ids?: string[];
}

export interface SiteCible {
  id: string;
  nom: string;
  code: string;
}

export function listerFlottes(): Promise<Flotte[]> {
  return api.get<Flotte[]>("/fleets");
}

export function listerSites(): Promise<SiteCible[]> {
  return api.get<SiteCible[]>("/sites");
}

/**
 * Portée d'un déploiement : des robots nommés, une flotte, ou un site.
 *
 * Les trois se cumulent côté serveur et leur union est dédupliquée. On envoie
 * donc la portée telle que l'opérateur l'a exprimée, sans la résoudre nous-même
 * en liste de robots : résoudre ici figerait la flotte à l'instant du clic,
 * alors que le serveur la lit au moment où il crée les déploiements.
 */
export interface PorteeDeploiement {
  robotIds?: string[];
  flotteId?: string;
  siteId?: string;
}

export function deployer(versionId: string, portee: PorteeDeploiement,
                         message?: string): Promise<DeploiementServeur[]> {
  return api.post<DeploiementServeur[]>("/studio/deployments", {
    version_id: versionId,
    robot_ids: portee.robotIds ?? [],
    fleet_id: portee.flotteId ?? null,
    site_id: portee.siteId ?? null,
    message: message || null,
  });
}

export function listerDeploiements(bundleId: string): Promise<DeploiementServeur[]> {
  return api.get<DeploiementServeur[]>(`/studio/deployments?bundle_id=${encodeURIComponent(bundleId)}`);
}

/** Construit le projet d'édition à partir d'un bundle et de sa composition. */
/**
 * Projet neuf assis sur un préset du catalogue.
 *
 * La composition est copiée, pas référencée : à partir de là le projet
 * appartient à son organisation et vit sa vie. Corriger le préset plus tard ne
 * remonte donc pas dans les projets déjà créés — c'est voulu, un point de
 * départ n'est pas une dépendance.
 */
export function projetDepuisPreset(
  preset: PresetServeur,
  nom: string,
  description: string,
  target: ProjectTarget,
): OscarProject {
  return {
    id: `projet-${Date.now().toString(36)}`,
    name: nom,
    description: description || preset.description || "",
    target,
    status: "BROUILLON",
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: preset.spec?.nodes ?? [],
    edges: preset.spec?.edges ?? [],
  };
}

export function projetDepuisBundle(bundle: BundleServeur, detail: VersionDetail | null): OscarProject {
  const version = bundle.draft_version ?? bundle.published_version ?? null;
  return {
    id: bundle.id,
    bundleId: bundle.id,
    // `exactOptionalPropertyTypes` : une propriete optionnelle est absente ou
    // porte une valeur, jamais `undefined` explicite.
    ...(bundle.draft_version ? { draftVersionId: bundle.draft_version.id } : {}),
    ...(version ? { sourceVersionId: version.id } : {}),
    name: bundle.nom,
    description: bundle.description ?? "",
    target: bundle.target as ProjectTarget,
    status: bundle.published_version ? "PRET_A_DEPLOYER" : "BROUILLON",
    version: version?.numero ?? 1,
    updatedAt: bundle.updated_at ?? new Date().toISOString(),
    nodes: detail?.spec?.nodes ?? [],
    edges: detail?.spec?.edges ?? [],
    syncedAt: new Date().toISOString(),
  };
}
