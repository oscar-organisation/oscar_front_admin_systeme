import { useEffect } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Cpu,
  Database,
  Mic,
  PackageOpen,
  Plus,
  Radio,
  ServerCog,
  Video,
} from 'lucide-react';
import { formatLabel } from '../../feature-domain/model';
import type { ArchitectureNode as ArchitectureNodeType, ChannelConfig } from '../../feature-domain/types';

const KIND_LABELS = {
  BUNDLE_DEPLOIEMENT: 'Bundle de déploiement',
  INSTANCE_SERVICE: 'Service',
  INSTANCE_APPLICATION: 'Application',
};

function ChannelRow({
  channel,
  agentId,
  onSelect,
}: {
  channel: ChannelConfig;
  agentId: string;
  onSelect: () => void;
}) {
  const receiving = channel.direction === 'RECEPTION';
  return (
    <button
      className={`channel-row nodrag ${receiving ? 'channel-row--input' : 'channel-row--output'}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      title={`${channel.technicalCode} — ${formatLabel(channel.dataFormat)}`}
      type="button"
    >
      {receiving && (
        <Handle
          className="channel-handle channel-handle--input"
          id={`in:${agentId}:${channel.id}`}
          type="target"
          position={Position.Left}
        />
      )}
      <span className="channel-dot" />
      <span className="channel-copy">
        <strong>{channel.name}</strong>
        <small>{formatLabel(channel.dataFormat)}</small>
      </span>
      {!receiving && (
        <Handle
          className="channel-handle channel-handle--output"
          id={`out:${agentId}:${channel.id}`}
          type="source"
          position={Position.Right}
        />
      )}
    </button>
  );
}

export default function ArchitectureNode({ id, data, selected }: NodeProps<ArchitectureNodeType>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const isBundle = data.kind === 'BUNDLE_DEPLOIEMENT';
  const Icon = data.kind === 'INSTANCE_SERVICE'
    ? ServerCog
    : data.kind === 'INSTANCE_APPLICATION'
      ? AppWindow
      : PackageOpen;

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.agents, id, updateNodeInternals]);

  return (
    <article
      className={`architecture-node architecture-node--${data.kind.toLowerCase()} ${selected ? 'is-selected' : ''}`}
      onDoubleClick={() => data.onSelect?.({ type: 'node', nodeId: id })}
    >
      {!isBundle && (
        <Handle className="structure-handle structure-handle--input" id="component-input" type="target" position={Position.Left} />
      )}

      <header className="architecture-node__header">
        <span className="architecture-node__icon"><Icon size={18} /></span>
        <span className="architecture-node__heading">
          <span className="architecture-node__eyebrow">{KIND_LABELS[data.kind]}</span>
          <strong>{data.name}</strong>
        </span>
        <span className={`node-state ${data.status === 'PRET' ? 'node-state--ready' : ''}`}>
          {data.status === 'PRET' ? 'Prêt' : 'Brouillon'}
        </span>
      </header>

      <div className="architecture-node__meta">
        <code>{data.technicalCode}</code>
        <span>{data.target.replace('ENVIRONNEMENT_EXECUTION_', '').replaceAll('_', ' ').toLowerCase()}</span>
      </div>

      {data.description && <p className="architecture-node__description">{data.description}</p>}

      {isBundle ? (
        <div className="bundle-summary">
          <PackageOpen size={20} />
          <span>Les traits pointillés indiquent les composants publiés avec ce bundle.</span>
        </div>
      ) : (
        <div className="agent-list">
          {data.agents.map((agent) => (
            <section
              className="agent-card nodrag"
              key={agent.id}
              onClick={(event) => {
                event.stopPropagation();
                data.onSelect?.({ type: 'agent', nodeId: id, agentId: agent.id });
              }}
            >
              <div className="agent-card__header">
                <button
                  className="icon-button icon-button--tiny nodrag"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onToggleAgent?.(id, agent.id);
                  }}
                  title={agent.expanded ? 'Réduire la structure' : 'Afficher la structure'}
                  type="button"
                >
                  {agent.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="agent-card__icon"><Cpu size={15} /></span>
                <span className="agent-card__title">
                  <strong>{agent.name}</strong>
                  <code>{agent.technicalCode}</code>
                </span>
                <span className="agent-card__media">
                  {agent.canPublishAudio && <Mic size={13} aria-label="Peut émettre de l’audio" />}
                  {agent.canPublishVideo && <Video size={13} aria-label="Peut émettre de la vidéo" />}
                </span>
              </div>

              {agent.expanded && (
                <div className="agent-scaffold">
                  <div><CircleDot size={12} /><span>{agent.processingName.replaceAll('_', ' ').toLowerCase()}</span></div>
                  <div><Radio size={12} /><span>{agent.interfaceName.replaceAll('_', ' ').toLowerCase()}</span></div>
                  <div><Database size={12} /><span>{agent.dataBandName.replaceAll('_', ' ').toLowerCase()}</span></div>
                </div>
              )}

              <div className="bus-grid">
                <div className="bus-column bus-column--input">
                  <div className="bus-title">
                    <span>Réception</span><small>{agent.inputs.length}</small>
                  </div>
                  {agent.inputs.length ? agent.inputs.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      agentId={agent.id}
                      onSelect={() => data.onSelect?.({ type: 'channel', nodeId: id, agentId: agent.id, channelId: channel.id })}
                    />
                  )) : <span className="empty-port">Aucune entrée</span>}
                </div>
                <div className="bus-column bus-column--output">
                  <div className="bus-title">
                    <span>Émission</span><small>{agent.outputs.length}</small>
                  </div>
                  {agent.outputs.length ? agent.outputs.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      agentId={agent.id}
                      onSelect={() => data.onSelect?.({ type: 'channel', nodeId: id, agentId: agent.id, channelId: channel.id })}
                    />
                  )) : <span className="empty-port">Aucune sortie</span>}
                </div>
              </div>
            </section>
          ))}

          {data.agents.length === 0 && (
            <div className="agent-empty">
              <Cpu size={20} />
              <span>Déposez un agent ici ou utilisez le bouton.</span>
            </div>
          )}

          <button
            className="add-agent-button nodrag"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddAgent?.(id);
            }}
            type="button"
          >
            <Plus size={15} /> Ajouter un agent
          </button>
        </div>
      )}

      {isBundle && (
        <Handle className="structure-handle structure-handle--output" id="bundle-output" type="source" position={Position.Right} />
      )}
    </article>
  );
}
