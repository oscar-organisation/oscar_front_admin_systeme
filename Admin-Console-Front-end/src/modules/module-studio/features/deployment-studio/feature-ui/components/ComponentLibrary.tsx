import { useMemo, useState } from 'react';
import {
  Cable,
  ChevronDown,
  ChevronRight,
  Cpu,
  Layers3,
  Search,
  Sparkles,
} from 'lucide-react';
import { PALETTE_ITEMS } from '../../feature-domain/catalogue';
import type { ArchitectureNode, Selection } from '../../feature-domain/types';

interface ComponentLibraryProps {
  nodes: ArchitectureNode[];
  selection: Selection;
  onAdd: (type: string) => void;
  onSelect: (selection: Selection) => void;
}

export default function ComponentLibrary({ nodes, selection, onAdd, onSelect }: ComponentLibraryProps) {
  const [tab, setTab] = useState<'components' | 'structure'>('components');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => PALETTE_ITEMS.filter((item) =>
    `${item.label} ${item.hint} ${item.type}`.toLowerCase().includes(search.toLowerCase())), [search]);

  return (
    <aside className="library-panel">
      <div className="library-tabs">
        <button className={tab === 'components' ? 'is-active' : ''} onClick={() => setTab('components')} type="button">
          <Layers3 size={15} /> Composants
        </button>
        <button className={tab === 'structure' ? 'is-active' : ''} onClick={() => setTab('structure')} type="button">
          <Cable size={15} /> Structure
        </button>
      </div>

      {tab === 'components' ? (
        <>
          <label className="library-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un composant" />
          </label>
          <div className="library-intro">
            <Sparkles size={16} />
            <span>Glissez un composant sur le plan, ou cliquez pour l’ajouter automatiquement.</span>
          </div>
          <div className="palette-list">
            {filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={`palette-card palette-card--${item.tone}`}
                  draggable
                  key={item.type}
                  onClick={() => onAdd(item.type)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/oscar-component', item.type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  type="button"
                >
                  <span className="palette-card__icon"><Icon size={18} /></span>
                  <span className="palette-card__copy">
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                    <code>{item.type}</code>
                  </span>
                  <span className="palette-card__grip" aria-hidden="true">⠿</span>
                </button>
              );
            })}
          </div>
          <div className="library-note">
            <strong>Ajout intelligent</strong>
            <p>Un module crée automatiquement son traitement métier, son interface de communication, sa bande de données et ses deux bus.</p>
          </div>
        </>
      ) : (
        <div className="project-tree">
          <p className="project-tree__caption">Hiérarchie réelle du projet</p>
          {nodes.map((node) => {
            const selectedNode = selection?.nodeId === node.id;
            return (
              <div className="tree-node" key={node.id}>
                <button className={selectedNode && selection?.type === 'node' ? 'is-selected' : ''} onClick={() => onSelect({ type: 'node', nodeId: node.id })} type="button">
                  <ChevronDown size={13} />
                  <Layers3 size={14} />
                  <span>{node.data.name}</span>
                </button>
                {node.data.agents.map((agent) => (
                  <div className="tree-agent" key={agent.id}>
                    <button className={selectedNode && selection?.type === 'agent' && selection.agentId === agent.id ? 'is-selected' : ''} onClick={() => onSelect({ type: 'agent', nodeId: node.id, agentId: agent.id })} type="button">
                      <ChevronDown size={13} /><Cpu size={14} /><span>{agent.name}</span>
                    </button>
                    <div className="tree-generated">
                      <span><ChevronRight size={11} /> Traitement métier</span>
                      <span><ChevronRight size={11} /> Interface de communication</span>
                      <span><ChevronRight size={11} /> Bande de données</span>
                      <span className="tree-bus"><ChevronRight size={11} /> Bus de réception · {agent.inputs.length} canal(aux)</span>
                      {agent.inputs.map((channel) => (
                        <button className="tree-channel" key={channel.id} onClick={() => onSelect({ type: 'channel', nodeId: node.id, agentId: agent.id, channelId: channel.id })} type="button">↳ {channel.name}</button>
                      ))}
                      <span className="tree-bus"><ChevronRight size={11} /> Bus d’émission · {agent.outputs.length} canal(aux)</span>
                      {agent.outputs.map((channel) => (
                        <button className="tree-channel" key={channel.id} onClick={() => onSelect({ type: 'channel', nodeId: node.id, agentId: agent.id, channelId: channel.id })} type="button">↳ {channel.name}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
