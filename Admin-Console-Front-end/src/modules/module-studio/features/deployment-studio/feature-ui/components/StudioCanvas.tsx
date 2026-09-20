import { useCallback, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  CloudUpload,
  CircleHelp,
  PanelRightClose,
  Rocket,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import ComponentLibrary from './ComponentLibrary';
import Inspector from './Inspector';
import ArchitectureNode from './ArchitectureNode';
import PublishDialog from './PublishDialog';
import ValidationPanel from './ValidationPanel';
import {
  connectionIsValid,
  createAgent,
  createArchitectureNode,
  createChannel,
  findChannel,
  makeId,
  validateProject,
} from '../../feature-domain/model';
import type {
  AgentConfig,
  ArchitectureEdge,
  ArchitectureKind,
  ArchitectureNode as ArchitectureNodeType,
  ChannelConfig,
  OscarProject,
  Selection,
  SyncState,
} from '../../feature-domain/types';

const nodeTypes = { architecture: ArchitectureNode };

// Dire ou en est le brouillon, sans jargon : l'operateur veut savoir si son
// travail existe ailleurs que sur son poste.
const ETAT_SYNC: Record<SyncState, { court: string; long: string; icone: JSX.Element }> = {
  SYNCHRONISE: { court: 'Enregistré', long: 'Brouillon synchronisé', icone: <Check size={13} /> },
  EN_COURS: { court: 'Enregistrement…', long: 'Enregistrement en cours', icone: <CloudUpload size={13} /> },
  ECHEC: { court: 'Non enregistré', long: 'Serveur injoignable — brouillon local', icone: <CloudOff size={13} /> },
  LOCAL: { court: 'Local', long: 'Projet local à ce navigateur', icone: <CloudOff size={13} /> },
};

interface StudioProps {
  project: OscarProject;
  onChange: (project: OscarProject) => void;
  onBack: () => void;
  /** Sans `api:bundle.publish`, la composition reste possible mais pas la publication. */
  canPublish: boolean;
  /** Sans `api:deployment.execute`, on publie une version sans la pousser sur un robot. */
  canDeploy: boolean;
  /** Accord entre le brouillon local et sa copie serveur. */
  syncEtat: SyncState;
}

function Canvas({ project, onChange, onBack, canPublish, canDeploy, syncEtat }: StudioProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();
  const [selection, setSelection] = useState<Selection>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem('oscar.studio.guide.dismissed') !== 'true');
  const [toast, setToast] = useState<string | null>(null);

  const update = useCallback((changes: Partial<OscarProject>) => {
    onChange({ ...project, ...changes, updatedAt: new Date().toISOString() });
  }, [onChange, project]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const updateNode = useCallback((nodeId: string, changes: Partial<ArchitectureNodeType['data']>) => {
    update({ nodes: project.nodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...changes } } : node) });
  }, [project.nodes, update]);

  const updateAgent = useCallback((nodeId: string, agentId: string, changes: Partial<AgentConfig>) => {
    update({
      nodes: project.nodes.map((node) => node.id === nodeId ? {
        ...node,
        data: { ...node.data, agents: node.data.agents.map((agent) => agent.id === agentId ? { ...agent, ...changes } : agent) },
      } : node),
    });
  }, [project.nodes, update]);

  const updateChannel = useCallback((nodeId: string, agentId: string, channelId: string, changes: Partial<ChannelConfig>) => {
    update({
      nodes: project.nodes.map((node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          agents: node.data.agents.map((agent) => agent.id === agentId ? {
            ...agent,
            inputs: agent.inputs.map((channel) => channel.id === channelId ? { ...channel, ...changes } : channel),
            outputs: agent.outputs.map((channel) => channel.id === channelId ? { ...channel, ...changes } : channel),
          } : agent),
        },
      } : node),
    });
  }, [project.nodes, update]);

  const addAgent = useCallback((nodeId: string) => {
    const node = project.nodes.find((item) => item.id === nodeId);
    if (!node || node.data.kind === 'BUNDLE_DEPLOIEMENT') return;
    const agent = createAgent(node.data.agents.length + 1);
    updateNode(nodeId, { agents: [...node.data.agents, agent] });
    setSelection({ type: 'agent', nodeId, agentId: agent.id });
    flash('Agent ajouté avec sa structure de communication complète.');
  }, [flash, project.nodes, updateNode]);

  const addChannel = useCallback((nodeId: string, agentId: string, direction: 'RECEPTION' | 'EMISSION') => {
    const node = project.nodes.find((item) => item.id === nodeId);
    const agent = node?.data.agents.find((item) => item.id === agentId);
    if (!agent) return;
    const list = direction === 'RECEPTION' ? agent.inputs : agent.outputs;
    const channel = createChannel(direction, list.length + 1);
    updateAgent(nodeId, agentId, direction === 'RECEPTION'
      ? { inputs: [...agent.inputs, channel], expanded: true }
      : { outputs: [...agent.outputs, channel], expanded: true });
    setSelection({ type: 'channel', nodeId, agentId, channelId: channel.id });
    flash(direction === 'RECEPTION' ? 'Canal ajouté au bus de réception.' : 'Canal ajouté au bus d’émission.');
  }, [flash, project.nodes, updateAgent]);

  const toggleAgent = useCallback((nodeId: string, agentId: string) => {
    const agent = project.nodes.find((node) => node.id === nodeId)?.data.agents.find((item) => item.id === agentId);
    if (agent) updateAgent(nodeId, agentId, { expanded: !agent.expanded });
  }, [project.nodes, updateAgent]);

  const interactiveNodes = useMemo(() => project.nodes.map((node) => ({
    ...node,
    selected: selection?.nodeId === node.id,
    data: {
      ...node.data,
      onSelect: setSelection,
      onAddAgent: addAgent,
      onToggleAgent: toggleAgent,
    },
  })), [addAgent, project.nodes, selection?.nodeId, toggleAgent]);

  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((issue) => issue.level === 'ERREUR').length;
  const warnings = issues.filter((issue) => issue.level === 'ATTENTION').length;

  const addComponent = useCallback((type: string, position?: { x: number; y: number }, droppedNodeId?: string) => {
    if (type === 'INSTANCE_AGENT') {
      const selectedNodeId = droppedNodeId ?? selection?.nodeId;
      const target = project.nodes.find((node) => node.id === selectedNodeId && node.data.kind !== 'BUNDLE_DEPLOIEMENT')
        ?? project.nodes.find((node) => node.data.kind !== 'BUNDLE_DEPLOIEMENT');
      if (!target) {
        flash('Ajoutez d’abord un service ou une application pour y placer l’agent.');
        return;
      }
      addAgent(target.id);
      return;
    }
    if (type === 'CANAL_RECEPTION' || type === 'CANAL_EMISSION') {
      const chosenNode = project.nodes.find((node) => node.id === (droppedNodeId ?? selection?.nodeId));
      const chosenAgentId = selection?.type === 'agent' || selection?.type === 'channel' ? selection.agentId : undefined;
      const agent = chosenNode?.data.agents.find((item) => item.id === chosenAgentId) ?? chosenNode?.data.agents[0];
      if (!chosenNode || !agent) {
        flash('Sélectionnez d’abord un agent, puis ajoutez son canal.');
        return;
      }
      addChannel(chosenNode.id, agent.id, type === 'CANAL_RECEPTION' ? 'RECEPTION' : 'EMISSION');
      return;
    }
    if (!['BUNDLE_DEPLOIEMENT', 'INSTANCE_SERVICE', 'INSTANCE_APPLICATION'].includes(type)) return;
    const kind = type as ArchitectureKind;
    const count = project.nodes.filter((node) => node.data.kind === kind).length + 1;
    const node = createArchitectureNode(kind, count, project.target, position ?? { x: 380 + count * 35, y: 100 + count * 45 });
    const bundle = project.nodes.find((item) => item.data.kind === 'BUNDLE_DEPLOIEMENT');
    const edges = [...project.edges];
    if (kind !== 'BUNDLE_DEPLOIEMENT' && bundle) {
      edges.push({
        id: `structure-${bundle.id}-${node.id}`,
        source: bundle.id,
        sourceHandle: 'bundle-output',
        target: node.id,
        targetHandle: 'component-input',
        type: 'smoothstep',
        selectable: false,
        style: { stroke: '#a8b3c7', strokeDasharray: '5 6', strokeWidth: 1.5 },
        data: { edgeKind: 'STRUCTURE' },
      });
    }
    update({ nodes: [...project.nodes, node], edges });
    setSelection({ type: 'node', nodeId: node.id });
    flash(`${kind === 'BUNDLE_DEPLOIEMENT' ? 'Bundle' : kind === 'INSTANCE_SERVICE' ? 'Service' : 'Application'} ajouté au plan.`);
  }, [addAgent, addChannel, flash, project.edges, project.nodes, project.target, selection, update]);

  const findDropTarget = useCallback((position: { x: number; y: number }) => {
    return [...project.nodes].reverse().find((node) => {
      if (node.data.kind === 'BUNDLE_DEPLOIEMENT') return false;
      const width = node.measured?.width ?? 390;
      const height = node.measured?.height ?? 250;
      return position.x >= node.position.x && position.x <= node.position.x + width
        && position.y >= node.position.y && position.y <= node.position.y + height;
    })?.id;
  }, [project.nodes]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/oscar-component');
    if (!type) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addComponent(type, position, findDropTarget(position));
  }, [addComponent, findDropTarget, screenToFlowPosition]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connectionIsValid(connection)) {
      flash('Une liaison doit toujours aller d’une sortie vers une entrée.');
      return;
    }
    const sourceChannel = findChannel(project.nodes, connection.source, connection.sourceHandle ?? null);
    const targetChannel = findChannel(project.nodes, connection.target, connection.targetHandle ?? null);
    const incompatible = sourceChannel && targetChannel && sourceChannel.dataFormat !== targetChannel.dataFormat;
    const edge: ArchitectureEdge = {
      ...connection,
      id: makeId('liaison'),
      type: 'smoothstep',
      animated: !incompatible,
      markerEnd: { type: MarkerType.ArrowClosed, color: incompatible ? '#e35454' : '#3766f5' },
      style: { stroke: incompatible ? '#e35454' : '#3766f5', strokeWidth: 2.5 },
      data: { edgeKind: 'DONNEES' },
    };
    update({ edges: addEdge(edge, project.edges) });
    flash(incompatible ? 'Liaison créée, mais les formats sont incompatibles.' : 'Canaux reliés avec succès.');
  }, [flash, project.edges, project.nodes, update]);

  const onNodesChange = useCallback((changes: NodeChange<ArchitectureNodeType>[]) => {
    update({ nodes: applyNodeChanges(changes, project.nodes) });
  }, [project.nodes, update]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    update({ edges: applyEdgeChanges(changes, project.edges) });
  }, [project.edges, update]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.type === 'node') {
      update({
        nodes: project.nodes.filter((node) => node.id !== selection.nodeId),
        edges: project.edges.filter((edge) => edge.source !== selection.nodeId && edge.target !== selection.nodeId),
      });
    } else if (selection.type === 'agent') {
      update({
        nodes: project.nodes.map((node) => node.id === selection.nodeId ? { ...node, data: { ...node.data, agents: node.data.agents.filter((agent) => agent.id !== selection.agentId) } } : node),
        edges: project.edges.filter((edge) => !edge.sourceHandle?.includes(`:${selection.agentId}:`) && !edge.targetHandle?.includes(`:${selection.agentId}:`)),
      });
    } else {
      update({
        nodes: project.nodes.map((node) => node.id === selection.nodeId ? {
          ...node,
          data: { ...node.data, agents: node.data.agents.map((agent) => agent.id === selection.agentId ? { ...agent, inputs: agent.inputs.filter((channel) => channel.id !== selection.channelId), outputs: agent.outputs.filter((channel) => channel.id !== selection.channelId) } : agent) },
        } : node),
        edges: project.edges.filter((edge) => !edge.sourceHandle?.endsWith(`:${selection.channelId}`) && !edge.targetHandle?.endsWith(`:${selection.channelId}`)),
      });
    }
    setSelection(null);
    flash('Élément retiré du projet.');
  }, [flash, project.edges, project.nodes, selection, update]);

  const locate = useCallback((nodeId: string) => {
    const node = project.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setSelection({ type: 'node', nodeId });
    setCenter(node.position.x + 180, node.position.y + 120, { zoom: 0.9, duration: 500 });
  }, [project.nodes, setCenter]);

  // La version n'est plus incrementee ici : c'est le serveur qui numerote, et
  // l'editeur se contente d'afficher ce qu'il a fige.
  const publishVersion = (numero: number) => {
    update({ version: numero, status: 'PRET_A_DEPLOYER' });
    flash(`Version ${numero} publiée.`);
  };

  return (
    <main className="studio-shell">
      <header className="studio-topbar">
        <button className="back-button" onClick={onBack} title="Retour aux projets" type="button"><ArrowLeft size={18} /></button>
        <div className="topbar-divider" />
        <div className="project-heading"><span>Projet</span><strong>{project.name}</strong></div>
        <button className="version-button" type="button">Version {project.version} <ChevronDown size={13} /></button>
        <span className="save-state">{ETAT_SYNC[syncEtat].icone} {ETAT_SYNC[syncEtat].court}</span>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => setShowGuide(true)} type="button"><CircleHelp size={15} /> Guide</button>
          <button className={`secondary-button validation-button ${errors ? 'has-errors' : ''}`} onClick={() => setShowValidation((value) => !value)} type="button"><AlertCircle size={15} /> Vérifier {errors + warnings > 0 && <b>{errors + warnings}</b>}</button>
          {canPublish && <button className="primary-button" onClick={() => setShowPublish(true)} type="button"><Rocket size={16} /> Publier</button>}
        </div>
      </header>

      <div className="studio-layout">
        <ComponentLibrary nodes={project.nodes} selection={selection} onAdd={addComponent} onSelect={setSelection} />
        <div className="canvas-shell" ref={wrapperRef}>
          <div className="canvas-label"><span>Plan de composition</span><small>Glissez les blocs · reliez une sortie à une entrée</small></div>
          <ReactFlow
            nodes={interactiveNodes}
            edges={project.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
            onNodeClick={(_, node) => setSelection({ type: 'node', nodeId: node.id })}
            onPaneClick={() => setSelection(null)}
            onInit={() => window.setTimeout(() => fitView({ padding: 0.18, duration: 500 }), 100)}
            connectionLineStyle={{ stroke: '#3766f5', strokeWidth: 2.5 }}
            deleteKeyCode={null}
            fitView
            minZoom={0.25}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#ccd5e4" gap={24} size={1.2} variant={BackgroundVariant.Dots} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              nodeColor={(node) => node.data.kind === 'BUNDLE_DEPLOIEMENT' ? '#7c5ce7' : node.data.kind === 'INSTANCE_APPLICATION' ? '#11a7b6' : '#3766f5'}
              maskColor="rgba(241,245,250,.74)"
              position="bottom-right"
              pannable
              zoomable
            />
          </ReactFlow>

          {showGuide && (
            <aside className="guide-card">
              <button className="icon-button" onClick={() => { setShowGuide(false); localStorage.setItem('oscar.studio.guide.dismissed', 'true'); }} type="button"><X size={15} /></button>
              <span className="guide-card__eyebrow"><Sparkles size={14} /> Démarrage rapide</span>
              <strong>Composez de gauche à droite</strong>
              <ol><li><b>Ajoutez</b> un service ou une application.</li><li><b>Placez</b> un ou plusieurs agents.</li><li><b>Ajoutez</b> leurs canaux d’entrée et de sortie.</li><li><b>Reliez</b> les points colorés entre eux.</li></ol>
              <button onClick={() => setShowGuide(false)} type="button">J’ai compris</button>
            </aside>
          )}

          {showValidation && <ValidationPanel issues={issues} onClose={() => setShowValidation(false)} onLocate={locate} />}
          {toast && <div className="toast"><Check size={15} /> {toast}</div>}
        </div>
        <Inspector
          nodes={project.nodes}
          selection={selection}
          onClose={() => setSelection(null)}
          onUpdateNode={updateNode}
          onUpdateAgent={updateAgent}
          onUpdateChannel={updateChannel}
          onAddChannel={addChannel}
          onDelete={deleteSelection}
        />
      </div>

      <footer className="studio-statusbar">
        <span><i className="status-dot status-dot--online" /> {ETAT_SYNC[syncEtat].long}</span>
        <span>{project.nodes.length} composants</span>
        <span>{project.nodes.reduce((sum, node) => sum + node.data.agents.length, 0)} agents</span>
        <span>{project.edges.filter((edge) => edge.data?.edgeKind === 'DONNEES').length} liaisons de données</span>
        <span className="statusbar-spacer" />
        <span><Save size={13} /> Brouillon conservé dans ce navigateur</span>
        <span><PanelRightClose size={13} /> Panneau de propriétés</span>
      </footer>

      {showPublish && (
        <PublishDialog
          project={project}
          issues={issues}
          canDeploy={canDeploy}
          onClose={() => setShowPublish(false)}
          onPublished={publishVersion}
        />
      )}
    </main>
  );
}

export default function Studio(props: StudioProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
