import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Check,
  CheckCircle2,
  Circle,
  CloudUpload,
  Cpu,
  LoaderCircle,
  Rocket,
  Server,
  X,
} from 'lucide-react';
import type { OscarProject, ValidationIssue } from '../../feature-domain/types';

interface PublishDialogProps {
  project: OscarProject;
  issues: ValidationIssue[];
  onClose: () => void;
  onPublished: () => void;
}

export default function PublishDialog({ project, issues, onClose, onPublished }: PublishDialogProps) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const blockers = issues.filter((issue) => issue.level === 'ERREUR').length;
  const steps = useMemo(() => [
    'Compiler la configuration du bundle',
    'Vérifier les services, agents et canaux',
    'Préparer la version de déploiement',
    'Simuler l’application par le runtime',
  ], []);

  useEffect(() => {
    if (!running || step >= steps.length) return;
    const timer = window.setTimeout(() => setStep((current) => current + 1), 650);
    return () => window.clearTimeout(timer);
  }, [running, step, steps.length]);

  const complete = step >= steps.length;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <header className="dialog-header">
          <div className="dialog-icon dialog-icon--blue"><Rocket size={21} /></div>
          <div><span>Prévisualisation</span><h2 id="publish-title">Publier et simuler le déploiement</h2></div>
          <button className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="publish-summary">
          <div><Box size={17} /><span><small>Projet</small><strong>{project.name}</strong></span></div>
          <div><CloudUpload size={17} /><span><small>Version proposée</small><strong>version {project.version + 1}</strong></span></div>
          <div><Cpu size={17} /><span><small>Composants</small><strong>{project.nodes.length} blocs · {project.nodes.reduce((sum, node) => sum + node.data.agents.length, 0)} agents</strong></span></div>
        </div>

        {blockers > 0 ? (
          <div className="publish-blocked">
            <span>Déploiement bloqué</span>
            <strong>{blockers} erreur{blockers > 1 ? 's' : ''} empêche{blockers > 1 ? 'nt' : ''} de préparer une version cohérente.</strong>
            <p>Fermez cette fenêtre, ouvrez « Vérifier » et corrigez les erreurs indiquées.</p>
          </div>
        ) : (
          <>
            <div className="deployment-targets">
              <div className="deployment-target"><span><Cpu size={18} /></span><div><strong>Ordinateur du robot</strong><small>Runtime OSCAR · vérification au redémarrage</small></div><em>Simulation</em></div>
              <div className="deployment-target"><span><Server size={18} /></span><div><strong>Services serveur</strong><small>Runtime OSCAR · profil de configuration versionné</small></div><em>Simulation</em></div>
            </div>
            <div className="deployment-steps">
              {steps.map((label, index) => {
                const done = step > index;
                const current = running && step === index;
                return (
                  <div className={done ? 'is-done' : current ? 'is-current' : ''} key={label}>
                    {done ? <Check size={15} /> : current ? <LoaderCircle className="spin" size={15} /> : <Circle size={15} />}
                    <span>{label}</span>
                  </div>
                );
              })}
            </div>
            {complete && (
              <div className="simulation-success"><CheckCircle2 size={20} /><div><strong>Simulation terminée</strong><span>La version peut être enregistrée. Aucun système réel n’a été contacté.</span></div></div>
            )}
          </>
        )}

        <footer className="dialog-footer">
          <button className="secondary-button" onClick={onClose} type="button">Fermer</button>
          {!blockers && !complete && <button className="primary-button" disabled={running} onClick={() => setRunning(true)} type="button"><Rocket size={16} /> {running ? 'Simulation en cours…' : 'Lancer la simulation'}</button>}
          {complete && <button className="primary-button" onClick={onPublished} type="button"><Check size={16} /> Enregistrer la version {project.version + 1}</button>}
        </footer>
      </section>
    </div>
  );
}
