import type { Connection } from '@xyflow/react';
import type {
  AgentConfig,
  ArchitectureEdge,
  ArchitectureKind,
  ArchitectureNode,
  ChannelConfig,
  DataFormat,
  OscarProject,
  ProjectTarget,
  ValidationIssue,
} from './types';

export const STORAGE_KEY = 'oscar.studio.configuration.v1.projects';

export function makeId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${suffix}`;
}

export function technicalCode(prefix: string, name: string, fallback: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 38);
  return `${prefix}_${normalized || fallback}`;
}

export function createChannel(direction: 'RECEPTION' | 'EMISSION', index: number): ChannelConfig {
  const receiving = direction === 'RECEPTION';
  const id = makeId(receiving ? 'rx' : 'tx');
  return {
    id,
    name: receiving ? `Entrée ${index}` : `Sortie ${index}`,
    technicalCode: `${receiving ? 'CANAL_RECEPTION' : 'CANAL_EMISSION'}_${String(index).padStart(2, '0')}`,
    direction,
    channelType: receiving
      ? 'TYPE_ENTREE_ABONNEMENT_TEMPS_REEL'
      : 'TYPE_SORTIE_PUBLICATION_TEMPS_REEL_CANAL_AGENT',
    dataFormat: 'OBJET_JSON',
    description: '',
  };
}

export function createAgent(index: number, withChannels = false): AgentConfig {
  const name = `Agent ${index}`;
  return {
    id: makeId('agent'),
    name,
    technicalCode: technicalCode('INSTANCE_AGENT', name, String(index).padStart(2, '0')),
    agentType: 'TYPE_AGENT_STANDARD',
    processingName: 'TRAITEMENT_METIER_AGENT_PRINCIPAL',
    interfaceName: 'INTERFACE_COMMUNICATION_AGENT_PRINCIPALE',
    dataBandName: 'BANDE_DONNEES_PRINCIPALE',
    receiveBusName: 'BUS_RECEPTION_PRINCIPAL',
    sendBusName: 'BUS_EMISSION_PRINCIPAL',
    inputs: withChannels ? [createChannel('RECEPTION', 1)] : [],
    outputs: withChannels ? [createChannel('EMISSION', 1)] : [],
    canPublishAudio: false,
    canPublishVideo: false,
    expanded: true,
  };
}

export function createArchitectureNode(
  kind: ArchitectureKind,
  index: number,
  target: ProjectTarget,
  position: { x: number; y: number },
): ArchitectureNode {
  const labels: Record<ArchitectureKind, string> = {
    BUNDLE_DEPLOIEMENT: `Bundle ${index}`,
    INSTANCE_SERVICE: `Service ${index}`,
    INSTANCE_APPLICATION: `Application ${index}`,
  };
  const prefixes: Record<ArchitectureKind, string> = {
    BUNDLE_DEPLOIEMENT: 'BUNDLE_DEPLOIEMENT',
    INSTANCE_SERVICE: 'INSTANCE_SERVICE',
    INSTANCE_APPLICATION: 'INSTANCE_APPLICATION',
  };
  const name = labels[kind];
  return {
    id: makeId(kind.toLowerCase()),
    type: 'architecture',
    position,
    data: {
      kind,
      name,
      technicalCode: technicalCode(prefixes[kind], name, String(index).padStart(2, '0')),
      description: '',
      target,
      status: 'BROUILLON',
      agents: [],
    },
  };
}

function demoProject(): OscarProject {
  const bundle = createArchitectureNode('BUNDLE_DEPLOIEMENT', 1, 'ENVIRONNEMENT_EXECUTION_ROBOT', { x: 40, y: 245 });
  bundle.data.name = 'Robot magasin — Version initiale';
  bundle.data.technicalCode = 'BUNDLE_DEPLOIEMENT_ROBOT_MAGASIN';
  bundle.data.description = 'Déploiement coordonné des fonctions de pilotage et de perception.';

  const media = createArchitectureNode('INSTANCE_SERVICE', 1, 'ENVIRONNEMENT_EXECUTION_ROBOT', { x: 420, y: 40 });
  media.data.name = 'Service média du robot';
  media.data.technicalCode = 'INSTANCE_SERVICE_MEDIA_ROBOT';
  const camera = createAgent(1, false);
  camera.name = 'Caméra avant';
  camera.technicalCode = 'INSTANCE_AGENT_CAMERA_AVANT';
  camera.agentType = 'TYPE_AGENT_MEDIA_ROBOT';
  camera.canPublishVideo = true;
  camera.inputs = [{
    ...createChannel('RECEPTION', 1),
    name: 'Image caméra brute',
    technicalCode: 'CANAL_RECEPTION_IMAGE_CAMERA_BRUTE',
    channelType: 'TYPE_ENTREE_ABONNEMENT_ROS_2',
    dataFormat: 'IMAGE',
  }];
  camera.outputs = [{
    ...createChannel('EMISSION', 1),
    name: 'État du flux vidéo',
    technicalCode: 'CANAL_EMISSION_ETAT_FLUX_VIDEO',
    dataFormat: 'OBJET_JSON',
  }];
  media.data.agents = [camera];

  const action = createArchitectureNode('INSTANCE_SERVICE', 2, 'ENVIRONNEMENT_EXECUTION_ROBOT', { x: 420, y: 470 });
  action.data.name = 'Service actions du robot';
  action.data.technicalCode = 'INSTANCE_SERVICE_ACTIONS_ROBOT';
  const motion = createAgent(1, true);
  motion.name = 'Pilotage du déplacement';
  motion.technicalCode = 'INSTANCE_AGENT_PILOTAGE_DEPLACEMENT';
  motion.agentType = 'TYPE_AGENT_CONTROLE_ACTION_ROBOT';
  const motionInput: ChannelConfig = {
    ...createChannel('RECEPTION', 1),
    name: 'Commande de déplacement',
    technicalCode: 'CANAL_RECEPTION_COMMANDE_DEPLACEMENT',
    dataFormat: 'BINAIRE_COMPACT',
  };
  const motionOutput: ChannelConfig = {
    ...createChannel('EMISSION', 1),
    name: 'État du déplacement',
    technicalCode: 'CANAL_EMISSION_ETAT_DEPLACEMENT',
    dataFormat: 'OBJET_JSON',
  };
  motion.inputs = [motionInput];
  motion.outputs = [motionOutput];
  action.data.agents = [motion];

  const remote = createArchitectureNode('INSTANCE_APPLICATION', 1, 'ENVIRONNEMENT_EXECUTION_NAVIGATEUR_WEB', { x: 930, y: 245 });
  remote.data.name = 'Télécommande opérateur web';
  remote.data.technicalCode = 'INSTANCE_APPLICATION_TELECOMMANDE_WEB';
  const operator = createAgent(1, true);
  operator.name = 'Commandes opérateur';
  operator.technicalCode = 'INSTANCE_AGENT_COMMANDES_OPERATEUR';
  operator.agentType = 'TYPE_AGENT_CONTROLEUR_DISTANT_WEB';
  const operatorInput: ChannelConfig = {
    ...createChannel('RECEPTION', 1),
    name: 'État du robot',
    technicalCode: 'CANAL_RECEPTION_ETAT_ROBOT',
    dataFormat: 'OBJET_JSON',
  };
  const operatorOutput: ChannelConfig = {
    ...createChannel('EMISSION', 1),
    name: 'Commande de déplacement',
    technicalCode: 'CANAL_EMISSION_COMMANDE_DEPLACEMENT',
    dataFormat: 'BINAIRE_COMPACT',
  };
  operator.inputs = [operatorInput];
  operator.outputs = [operatorOutput];
  remote.data.agents = [operator];

  const hierarchyEdges: ArchitectureEdge[] = [media, action, remote].map((node) => ({
    id: `structure-${bundle.id}-${node.id}`,
    source: bundle.id,
    target: node.id,
    type: 'smoothstep',
    selectable: false,
    animated: false,
    style: { stroke: '#a8b3c7', strokeDasharray: '5 6', strokeWidth: 1.5 },
    data: { edgeKind: 'STRUCTURE' },
    sourceHandle: 'bundle-output',
    targetHandle: 'component-input',
  }));

  const dataEdges: ArchitectureEdge[] = [
    {
      id: makeId('liaison'),
      source: remote.id,
      sourceHandle: `out:${operator.id}:${operatorOutput.id}`,
      target: action.id,
      targetHandle: `in:${motion.id}:${motionInput.id}`,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#3766f5', strokeWidth: 2.5 },
      data: { edgeKind: 'DONNEES' },
    },
    {
      id: makeId('liaison'),
      source: action.id,
      sourceHandle: `out:${motion.id}:${motionOutput.id}`,
      target: remote.id,
      targetHandle: `in:${operator.id}:${operatorInput.id}`,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#13a8a8', strokeWidth: 2.5 },
      data: { edgeKind: 'DONNEES' },
    },
  ];

  return {
    id: 'projet-demonstration-oscar',
    name: 'Robot magasin — Démonstration',
    description: 'Projet exemple montrant les services embarqués et la télécommande web.',
    target: 'ENVIRONNEMENT_EXECUTION_ROBOT',
    status: 'BROUILLON',
    version: 3,
    updatedAt: new Date().toISOString(),
    nodes: [bundle, media, action, remote],
    edges: [...hierarchyEdges, ...dataEdges],
  };
}

export function createProject(
  name: string,
  description: string,
  target: ProjectTarget,
  template: 'DEMONSTRATION' | 'ROBOT_MINIMAL' | 'VIDE',
): OscarProject {
  if (template === 'DEMONSTRATION') {
    const demo = demoProject();
    return { ...demo, id: makeId('projet'), name, description, target, version: 1 };
  }
  const bundle = createArchitectureNode('BUNDLE_DEPLOIEMENT', 1, target, { x: 60, y: 180 });
  bundle.data.name = `Bundle — ${name}`;
  bundle.data.technicalCode = technicalCode('BUNDLE_DEPLOIEMENT', name, 'PRINCIPAL');
  const nodes: ArchitectureNode[] = [bundle];
  const edges: ArchitectureEdge[] = [];
  if (template === 'ROBOT_MINIMAL') {
    const service = createArchitectureNode('INSTANCE_SERVICE', 1, target, { x: 480, y: 130 });
    service.data.name = 'Service principal du robot';
    service.data.technicalCode = 'INSTANCE_SERVICE_PRINCIPAL_ROBOT';
    service.data.agents = [createAgent(1, true)];
    nodes.push(service);
    edges.push({
      id: `structure-${bundle.id}-${service.id}`,
      source: bundle.id,
      sourceHandle: 'bundle-output',
      target: service.id,
      targetHandle: 'component-input',
      type: 'smoothstep',
      selectable: false,
      style: { stroke: '#a8b3c7', strokeDasharray: '5 6', strokeWidth: 1.5 },
      data: { edgeKind: 'STRUCTURE' },
    });
  }
  return {
    id: makeId('projet'),
    name,
    description,
    target,
    status: 'BROUILLON',
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

export function initialProjects(): OscarProject[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as OscarProject[];
  } catch {
    // La démonstration reste disponible si le stockage du navigateur est indisponible.
  }
  return [demoProject()];
}

export function saveProjects(projects: OscarProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Navigation privee ou stockage sature : le brouillon reste en memoire
    // pour la session en cours plutot que de faire echouer la saisie.
  }
}

export function findChannel(
  nodes: ArchitectureNode[],
  nodeId: string | null,
  handleId: string | null,
): ChannelConfig | undefined {
  if (!nodeId || !handleId) return undefined;
  const [, agentId, channelId] = handleId.split(':');
  const node = nodes.find((item) => item.id === nodeId);
  const agent = node?.data.agents.find((item) => item.id === agentId);
  return [...(agent?.inputs ?? []), ...(agent?.outputs ?? [])].find((item) => item.id === channelId);
}

export function connectionIsValid(connection: Connection): boolean {
  return Boolean(
    connection.sourceHandle?.startsWith('out:') &&
    connection.targetHandle?.startsWith('in:'),
  );
}

export function validateProject(project: OscarProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const bundles = project.nodes.filter((node) => node.data.kind === 'BUNDLE_DEPLOIEMENT');
  if (bundles.length === 0) {
    issues.push({ id: 'bundle-absent', level: 'ERREUR', title: 'Aucun bundle de déploiement', detail: 'Ajoutez le regroupement qui sera publié et déployé.' });
  }
  if (bundles.length > 1) {
    issues.push({ id: 'bundle-multiple', level: 'ATTENTION', title: 'Plusieurs bundles présents', detail: 'Un seul bundle est publié à la fois.' });
  }

  const technicalCodes = new Map<string, number>();
  const connectedHandles = new Set(project.edges.flatMap((edge) => [edge.sourceHandle, edge.targetHandle].filter(Boolean)) as string[]);
  for (const node of project.nodes) {
    technicalCodes.set(node.data.technicalCode, (technicalCodes.get(node.data.technicalCode) ?? 0) + 1);
    if (node.data.kind !== 'BUNDLE_DEPLOIEMENT' && node.data.agents.length === 0) {
      issues.push({
        id: `agent-absent-${node.id}`,
        level: 'ATTENTION',
        title: `${node.data.name} ne contient aucun agent`,
        detail: 'Ajoutez au moins un agent pour porter le traitement et la communication.',
        nodeId: node.id,
      });
    }
    for (const agent of node.data.agents) {
      technicalCodes.set(agent.technicalCode, (technicalCodes.get(agent.technicalCode) ?? 0) + 1);
      for (const channel of [...agent.inputs, ...agent.outputs]) {
        technicalCodes.set(channel.technicalCode, (technicalCodes.get(channel.technicalCode) ?? 0) + 1);
        const handle = `${channel.direction === 'RECEPTION' ? 'in' : 'out'}:${agent.id}:${channel.id}`;
        if (!connectedHandles.has(handle) && channel.channelType.includes('TEMPS_REEL')) {
          issues.push({
            id: `canal-isole-${channel.id}`,
            level: 'ATTENTION',
            title: `Canal non câblé : ${channel.name}`,
            detail: 'Ce canal temps réel ne transporte encore aucune donnée.',
            nodeId: node.id,
          });
        }
      }
    }
  }

  for (const [code, count] of technicalCodes) {
    if (count > 1) {
      issues.push({ id: `doublon-${code}`, level: 'ERREUR', title: 'Identifiant technique dupliqué', detail: `${code} est utilisé ${count} fois.` });
    }
  }

  for (const edge of project.edges.filter((item) => item.data?.edgeKind === 'DONNEES')) {
    const source = findChannel(project.nodes, edge.source, edge.sourceHandle ?? null);
    const target = findChannel(project.nodes, edge.target, edge.targetHandle ?? null);
    if (!source || !target) {
      issues.push({ id: `liaison-invalide-${edge.id}`, level: 'ERREUR', title: 'Liaison incomplète', detail: 'Un canal lié a été retiré. Recréez cette liaison.' });
    } else if (source.dataFormat !== target.dataFormat) {
      issues.push({
        id: `format-${edge.id}`,
        level: 'ERREUR',
        title: 'Formats de données incompatibles',
        detail: `${source.name} émet ${source.dataFormat}, mais ${target.name} attend ${target.dataFormat}.`,
      });
    }
  }

  if (issues.length === 0) {
    issues.push({ id: 'configuration-valide', level: 'INFORMATION', title: 'Configuration prête', detail: 'La structure et les liaisons sont cohérentes.' });
  }
  return issues;
}

export function formatLabel(format: DataFormat): string {
  return {
    NOMBRE: 'Nombre',
    BOOLEEN: 'Vrai / faux',
    TEXTE: 'Texte',
    OBJET_JSON: 'Objet structuré',
    BINAIRE_COMPACT: 'Binaire compact',
    IMAGE: 'Image',
  }[format];
}
