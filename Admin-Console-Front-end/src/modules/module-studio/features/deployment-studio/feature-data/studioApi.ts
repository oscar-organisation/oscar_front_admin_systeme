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

export function deployer(versionId: string, robotIds: string[], message?: string): Promise<DeploiementServeur[]> {
  return api.post<DeploiementServeur[]>("/studio/deployments", {
    version_id: versionId,
    robot_ids: robotIds,
    message: message || null,
  });
}

export function listerDeploiements(bundleId: string): Promise<DeploiementServeur[]> {
  return api.get<DeploiementServeur[]>(`/studio/deployments?bundle_id=${encodeURIComponent(bundleId)}`);
}

/** Construit le projet d'édition à partir d'un bundle et de sa composition. */
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
