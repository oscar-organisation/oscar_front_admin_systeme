import {
  Cable,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Info,
  Mic,
  Plus,
  Settings2,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { INPUT_TYPES, OUTPUT_TYPES, TARGETS } from '../../feature-domain/catalogue';
import type {
  AgentConfig,
  ArchitectureNode,
  ChannelConfig,
  DataFormat,
  ProjectTarget,
  Selection,
} from '../../feature-domain/types';

const DATA_FORMATS: Array<{ value: DataFormat; label: string }> = [
  { value: 'BINAIRE_COMPACT', label: 'Binaire compact — haute fréquence' },
  { value: 'OBJET_JSON', label: 'Objet structuré — données métier' },
  { value: 'NOMBRE', label: 'Nombre' },
  { value: 'BOOLEEN', label: 'Vrai / faux' },
  { value: 'TEXTE', label: 'Texte' },
  { value: 'IMAGE', label: 'Image' },
];

interface InspectorProps {
  nodes: ArchitectureNode[];
  selection: Selection;
  onClose: () => void;
  onUpdateNode: (nodeId: string, changes: Partial<ArchitectureNode['data']>) => void;
  onUpdateAgent: (nodeId: string, agentId: string, changes: Partial<AgentConfig>) => void;
  onUpdateChannel: (nodeId: string, agentId: string, channelId: string, changes: Partial<ChannelConfig>) => void;
  onAddChannel: (nodeId: string, agentId: string, direction: 'RECEPTION' | 'EMISSION') => void;
  onDelete: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function EmptyInspector() {
  return (
    <div className="inspector-empty">
      <span className="inspector-empty__icon"><Settings2 size={24} /></span>
      <h3>Sélectionnez un composant</h3>
      <p>Cliquez sur un bloc, un agent ou un canal pour afficher ses réglages.</p>
      <div className="tip-card">
        <Info size={16} />
        <span>Les noms sont libres. Les identifiants techniques restent stables pour éviter de casser les liaisons.</span>
      </div>
    </div>
  );
}

export default function Inspector({
  nodes,
  selection,
  onClose,
  onUpdateNode,
  onUpdateAgent,
  onUpdateChannel,
  onAddChannel,
  onDelete,
}: InspectorProps) {
  if (!selection) {
    return <aside className="inspector"><EmptyInspector /></aside>;
  }

  const node = nodes.find((item) => item.id === selection.nodeId);
  const agent = selection.type !== 'node'
    ? node?.data.agents.find((item) => item.id === selection.agentId)
    : undefined;
  const channel = selection.type === 'channel'
    ? [...(agent?.inputs ?? []), ...(agent?.outputs ?? [])].find((item) => item.id === selection.channelId)
    : undefined;

  if (!node) return <aside className="inspector"><EmptyInspector /></aside>;

  return (
    <aside className="inspector">
      <header className="inspector__header">
        <div>
          <span>Propriétés</span>
          <strong>
            {selection.type === 'node' ? 'Composant' : selection.type === 'agent' ? 'Agent' : 'Canal'}
          </strong>
        </div>
        <button className="icon-button" onClick={onClose} title="Fermer le panneau" type="button"><X size={17} /></button>
      </header>

      <div className="inspector__content">
        {selection.type === 'node' && (
          <>
            <div className="selection-path"><span>Projet</span><ChevronRight size={12} /><strong>{node.data.name}</strong></div>
            <Field label="Nom affiché" hint="Modifiable sans casser les liaisons.">
              <input value={node.data.name} onChange={(event) => onUpdateNode(node.id, { name: event.target.value })} />
            </Field>
            <Field label="Identifiant technique" hint="Préfixé pour être compréhensible dans le code et les journaux.">
              <input className="technical-input" value={node.data.technicalCode} onChange={(event) => onUpdateNode(node.id, { technicalCode: event.target.value.toUpperCase().replace(/\s+/g, '_') })} />
            </Field>
            <Field label="Environnement d’exécution">
              <select value={node.data.target} onChange={(event) => onUpdateNode(node.id, { target: event.target.value as ProjectTarget })}>
                {TARGETS.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <textarea rows={3} value={node.data.description} onChange={(event) => onUpdateNode(node.id, { description: event.target.value })} placeholder="Expliquez le rôle de ce composant…" />
            </Field>
            <Field label="État de préparation">
              <select value={node.data.status} onChange={(event) => onUpdateNode(node.id, { status: event.target.value as 'BROUILLON' | 'PRET' })}>
                <option value="BROUILLON">Brouillon</option>
                <option value="PRET">Prêt</option>
              </select>
            </Field>
          </>
        )}

        {selection.type === 'agent' && agent && (
          <>
            <div className="selection-path"><span>{node.data.name}</span><ChevronRight size={12} /><strong>{agent.name}</strong></div>
            <Field label="Nom de l’agent">
              <input value={agent.name} onChange={(event) => onUpdateAgent(node.id, agent.id, { name: event.target.value })} />
            </Field>
            <Field label="Identifiant technique">
              <input className="technical-input" value={agent.technicalCode} onChange={(event) => onUpdateAgent(node.id, agent.id, { technicalCode: event.target.value.toUpperCase().replace(/\s+/g, '_') })} />
            </Field>
            <Field label="Type d’agent" hint="Le type décrit sa fonction ; chaque instance conserve son propre nom.">
              <select value={agent.agentType} onChange={(event) => onUpdateAgent(node.id, agent.id, { agentType: event.target.value })}>
                <option value="TYPE_AGENT_STANDARD">Agent standard</option>
                <option value="TYPE_AGENT_MEDIA_ROBOT">Média du robot</option>
                <option value="TYPE_AGENT_CONTROLE_ACTION_ROBOT">Contrôle des actions du robot</option>
                <option value="TYPE_AGENT_TELEMETRIE_ROBOT">Télémétrie du robot</option>
                <option value="TYPE_AGENT_CONTROLEUR_DISTANT_WEB">Contrôleur distant web</option>
                <option value="TYPE_AGENT_DETECTION_INCIDENT">Détection d’incident</option>
              </select>
            </Field>

            <div className="section-label"><Cpu size={15} /> Structure créée automatiquement</div>
            <div className="generated-structure">
              <div><CheckCircle2 size={13} /><span>Traitement métier</span><code>{agent.processingName}</code></div>
              <div><CheckCircle2 size={13} /><span>Interface de communication</span><code>{agent.interfaceName}</code></div>
              <div><CheckCircle2 size={13} /><span>Bande de données</span><code>{agent.dataBandName}</code></div>
              <div><CheckCircle2 size={13} /><span>Bus de réception</span><code>{agent.receiveBusName}</code></div>
              <div><CheckCircle2 size={13} /><span>Bus d’émission</span><code>{agent.sendBusName}</code></div>
            </div>

            <div className="section-label"><Cable size={15} /> Canaux de données</div>
            <div className="channel-actions">
              <button onClick={() => onAddChannel(node.id, agent.id, 'RECEPTION')} type="button"><Plus size={14} /> Entrée</button>
              <button onClick={() => onAddChannel(node.id, agent.id, 'EMISSION')} type="button"><Plus size={14} /> Sortie</button>
            </div>

            <div className="section-label">Émission média</div>
            <label className="toggle-row">
              <span><Mic size={15} /> Peut émettre de l’audio</span>
              <input type="checkbox" checked={agent.canPublishAudio} onChange={(event) => onUpdateAgent(node.id, agent.id, { canPublishAudio: event.target.checked })} />
            </label>
            <label className="toggle-row">
              <span><Video size={15} /> Peut émettre de la vidéo</span>
              <input type="checkbox" checked={agent.canPublishVideo} onChange={(event) => onUpdateAgent(node.id, agent.id, { canPublishVideo: event.target.checked })} />
            </label>
          </>
        )}

        {selection.type === 'channel' && agent && channel && (
          <>
            <div className="selection-path"><span>{agent.name}</span><ChevronRight size={12} /><strong>{channel.name}</strong></div>
            <div className={`direction-banner direction-banner--${channel.direction.toLowerCase()}`}>
              {channel.direction === 'RECEPTION' ? 'Canal de réception — entrée' : 'Canal d’émission — sortie'}
            </div>
            <Field label="Nom du canal">
              <input value={channel.name} onChange={(event) => onUpdateChannel(node.id, agent.id, channel.id, { name: event.target.value })} />
            </Field>
            <Field label="Adresse logique" hint="Générée à la création, stable et unique dans le projet.">
              <input className="technical-input" value={channel.technicalCode} onChange={(event) => onUpdateChannel(node.id, agent.id, channel.id, { technicalCode: event.target.value.toUpperCase().replace(/\s+/g, '_') })} />
            </Field>
            <Field label={channel.direction === 'RECEPTION' ? 'Type d’entrée' : 'Type de sortie'}>
              <select value={channel.channelType} onChange={(event) => onUpdateChannel(node.id, agent.id, channel.id, { channelType: event.target.value as ChannelConfig['channelType'] })}>
                {(channel.direction === 'RECEPTION' ? INPUT_TYPES : OUTPUT_TYPES).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
            <div className="field-explanation">
              <Info size={14} />
              <span>{(channel.direction === 'RECEPTION' ? INPUT_TYPES : OUTPUT_TYPES).find((item) => item.value === channel.channelType)?.hint}</span>
            </div>
            <Field label="Format des données" hint="Une liaison exige le même format à l’émission et à la réception.">
              <select value={channel.dataFormat} onChange={(event) => onUpdateChannel(node.id, agent.id, channel.id, { dataFormat: event.target.value as DataFormat })}>
                {DATA_FORMATS.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <textarea rows={3} value={channel.description} onChange={(event) => onUpdateChannel(node.id, agent.id, channel.id, { description: event.target.value })} placeholder="Exemple de donnée et fréquence attendue…" />
            </Field>
          </>
        )}
      </div>

      <footer className="inspector__footer">
        <button className="danger-button" onClick={onDelete} type="button"><Trash2 size={15} /> Supprimer cet élément</button>
      </footer>
    </aside>
  );
}
