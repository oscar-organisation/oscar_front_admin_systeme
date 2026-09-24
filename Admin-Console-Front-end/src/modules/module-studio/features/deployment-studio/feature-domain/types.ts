import type { Edge, Node } from '@xyflow/react';

export type ProjectTarget =
  | 'ENVIRONNEMENT_EXECUTION_ROBOT'
  | 'ENVIRONNEMENT_EXECUTION_SERVEUR'
  | 'ENVIRONNEMENT_EXECUTION_NAVIGATEUR_WEB'
  | 'ENVIRONNEMENT_EXECUTION_APPLICATION_METIER';

export type ArchitectureKind = 'BUNDLE_DEPLOIEMENT' | 'INSTANCE_SERVICE' | 'INSTANCE_APPLICATION';

export type InputChannelType =
  | 'TYPE_ENTREE_INJECTION_APPLICATION'
  | 'TYPE_ENTREE_ABONNEMENT_TEMPS_REEL'
  | 'TYPE_ENTREE_SERVICE_LOCAL'
  | 'TYPE_ENTREE_CONSOMMATION_COURTIER_MESSAGES'
  | 'TYPE_ENTREE_ABONNEMENT_ROS_2';

export type OutputChannelType =
  | 'TYPE_SORTIE_PUBLICATION_TEMPS_REEL_CANAL_AGENT'
  | 'TYPE_SORTIE_PUBLICATION_TEMPS_REEL_PLUSIEURS_CANAUX'
  | 'TYPE_SORTIE_RAPPEL_APPLICATION'
  | 'TYPE_SORTIE_SERVICE_LOCAL'
  | 'TYPE_SORTIE_PUBLICATION_COURTIER_MESSAGES'
  | 'TYPE_SORTIE_PUBLICATION_ROS_2';

export type DataFormat = 'NOMBRE' | 'BOOLEEN' | 'TEXTE' | 'OBJET_JSON' | 'BINAIRE_COMPACT' | 'IMAGE';

export interface ChannelConfig {
  id: string;
  name: string;
  technicalCode: string;
  direction: 'RECEPTION' | 'EMISSION';
  channelType: InputChannelType | OutputChannelType;
  dataFormat: DataFormat;
  description: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  technicalCode: string;
  agentType: string;
  processingName: string;
  interfaceName: string;
  dataBandName: string;
  receiveBusName: string;
  sendBusName: string;
  inputs: ChannelConfig[];
  outputs: ChannelConfig[];
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  expanded: boolean;
}

export interface ArchitectureNodeData extends Record<string, unknown> {
  kind: ArchitectureKind;
  name: string;
  technicalCode: string;
  description: string;
  target: ProjectTarget;
  status: 'BROUILLON' | 'PRET';
  /** Box IA appliquee par ce composant, si sa mission comporte de la perception. */
  aiBoxId?: string | undefined;
  /** Besoin de mise en route du chassis (« base », « camera »...). La commande
   *  correspondante vit dans le profil du robot, pas ici. */
  bringupKey?: string | undefined;
  /** Rang de demarrage : la base avant la camera, la camera avant les agents. */
  bringupOrder?: number | undefined;
  agents: AgentConfig[];
  onSelect?: (selection: Selection) => void;
  onAddAgent?: (nodeId: string) => void;
  onToggleAgent?: (nodeId: string, agentId: string) => void;
}

export type ArchitectureNode = Node<ArchitectureNodeData, 'architecture'>;
export type ArchitectureEdge = Edge;

export type Selection =
  | { type: 'node'; nodeId: string }
  | { type: 'agent'; nodeId: string; agentId: string }
  | { type: 'channel'; nodeId: string; agentId: string; channelId: string }
  | null;

export interface OscarProject {
  id: string;
  name: string;
  description: string;
  target: ProjectTarget;
  status: 'BROUILLON' | 'PRET_A_DEPLOYER';
  version: number;
  updatedAt: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  /** Bundle serveur correspondant. Absent : le projet n'existe que dans ce navigateur. */
  bundleId?: string;
  /** Version brouillon cote serveur, cible des enregistrements automatiques. */
  draftVersionId?: string;
  sourceVersionId?: string;
  /** Horodatage du dernier accord avec le serveur ; absent tant qu'il n'y en a pas eu. */
  syncedAt?: string;
  /** Compteurs servis par la liste, quand la composition n'est pas encore chargee. */
  summary?: { composants: number; agents: number; robots: number };
}

/** Etat de l'accord entre le brouillon local et sa copie serveur. */
export type SyncState = 'LOCAL' | 'SYNCHRONISE' | 'EN_COURS' | 'ECHEC';

export interface RobotCible {
  id: string;
  nom: string;
  slug?: string | null;
  statut: string;
  site_id?: string | null;
}

export interface DeploiementServeur {
  id: string;
  robot_id: string;
  robot_nom?: string | null;
  robot_slug?: string | null;
  statut: string;
  version_numero?: number | null;
  bundle_nom?: string | null;
  message?: string | null;
  report?: Record<string, unknown> | null;
  created_at?: string | null;
  delivered_at?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
}

export interface ValidationIssue {
  id: string;
  level: 'ERREUR' | 'ATTENTION' | 'INFORMATION';
  title: string;
  detail: string;
  nodeId?: string;
}
