import { AlertCircle, AlertTriangle, CheckCircle2, LocateFixed, X } from 'lucide-react';
import type { ValidationIssue } from '../../feature-domain/types';

interface ValidationPanelProps {
  issues: ValidationIssue[];
  onClose: () => void;
  onLocate: (nodeId: string) => void;
}

export default function ValidationPanel({ issues, onClose, onLocate }: ValidationPanelProps) {
  const errors = issues.filter((issue) => issue.level === 'ERREUR').length;
  const warnings = issues.filter((issue) => issue.level === 'ATTENTION').length;
  return (
    <section className="validation-panel">
      <header>
        <div>
          <span className="validation-panel__eyebrow">Vérification continue</span>
          <strong>{errors ? `${errors} erreur${errors > 1 ? 's' : ''} à corriger` : warnings ? `${warnings} point${warnings > 1 ? 's' : ''} à examiner` : 'Configuration cohérente'}</strong>
        </div>
        <button className="icon-button" onClick={onClose} title="Fermer" type="button"><X size={16} /></button>
      </header>
      <div className="validation-list">
        {issues.map((issue) => {
          const Icon = issue.level === 'ERREUR' ? AlertCircle : issue.level === 'ATTENTION' ? AlertTriangle : CheckCircle2;
          return (
            <article className={`validation-item validation-item--${issue.level.toLowerCase()}`} key={issue.id}>
              <Icon size={17} />
              <div><strong>{issue.title}</strong><p>{issue.detail}</p></div>
              {issue.nodeId && <button onClick={() => onLocate(issue.nodeId!)} title="Afficher le composant" type="button"><LocateFixed size={15} /></button>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
