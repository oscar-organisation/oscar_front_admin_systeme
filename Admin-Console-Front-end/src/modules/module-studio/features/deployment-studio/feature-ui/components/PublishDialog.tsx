import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  Cpu,
  LoaderCircle,
  Rocket,
  Server,
  X,
} from 'lucide-react';
import { useAuth } from '@/shared/kernel/auth/AuthProvider';
import {
  deployer, listerFlottes, listerPresetsTous, listerRobots, listerSites, publier, verifier,
} from '../../feature-data/studioApi';
import type { Flotte, SiteCible } from '../../feature-data/studioApi';
import PresetVersementDialog from './PresetVersementDialog';
import type { DeploiementServeur, OscarProject, RobotCible, ValidationIssue } from '../../feature-domain/types';

interface PublishDialogProps {
  project: OscarProject;
  issues: ValidationIssue[];
  canDeploy: boolean;
  onClose: () => void;
  onPublished: (numero: number) => void;
}

type Etape = 'VERIFICATION' | 'PRET' | 'PUBLICATION' | 'CIBLES' | 'DEPLOIEMENT' | 'TERMINE';

export default function PublishDialog({ project, issues, canDeploy, onClose, onPublished }: PublishDialogProps) {
  const [etape, setEtape] = useState<Etape>('VERIFICATION');
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [panne, setPanne] = useState<string | null>(null);
  const [versionPubliee, setVersionPubliee] = useState<{ id: string; numero: number } | null>(null);
  const [robots, setRobots] = useState<RobotCible[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  // Trois portees possibles, exclusives a la saisie. Cocher cent robots un par
  // un n'est pas une methode des qu'une flotte existe.
  const [portee, setPortee] = useState<'ROBOTS' | 'FLOTTE' | 'SITE'>('ROBOTS');
  const [flottes, setFlottes] = useState<Flotte[]>([]);
  const [sites, setSites] = useState<SiteCible[]>([]);
  const [flotteId, setFlotteId] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [deploiements, setDeploiements] = useState<DeploiementServeur[]>([]);
  // Verser au catalogue est reserve a qui le maintient : le serveur refuse de
  // toute facon, autant ne pas proposer un geste voue a l'echec.
  const { user } = useAuth();
  const maintientLeCatalogue = Boolean(user?.is_superadmin);
  const [versementOuvert, setVersementOuvert] = useState(false);
  const [verse, setVerse] = useState<string | null>(null);
  const [famillesConnues, setFamillesConnues] = useState<string[]>([]);

  useEffect(() => {
    if (!maintientLeCatalogue) return;
    let vivant = true;
    listerPresetsTous()
      .then((liste) => { if (vivant) setFamillesConnues([...new Set(liste.map((p) => p.famille))]); })
      .catch(() => { if (vivant) setFamillesConnues([]); });
    return () => { vivant = false; };
  }, [maintientLeCatalogue]);

  // Ce que la portee choisie vise reellement. Le nombre exact d'une flotte ou
  // d'un site est arrete par le serveur au moment du deploiement, pas ici :
  // resoudre au clic figerait un groupe qui peut changer entre-temps.
  const cibleRetenue = portee === 'FLOTTE'
    ? flottes.find((f) => f.id === flotteId)
    : undefined;
  const nombreVise = portee === 'ROBOTS'
    ? selection.length
    : portee === 'FLOTTE'
      ? (flottes.find((f) => f.id === flotteId)?.robot_ids?.length ?? 0)
      : robots.filter((r) => Boolean(r.site_id && siteIds.includes(r.site_id))).length;
  const porteePrete = portee === 'ROBOTS'
    ? selection.length > 0
    : portee === 'FLOTTE' ? Boolean(cibleRetenue) : siteIds.length > 0;

  const bloquantsLocaux = useMemo(
    () => issues.filter((issue) => issue.level === 'ERREUR').map((issue) => issue.title),
    [issues],
  );

  // Verification serveur a l'ouverture : c'est le serveur qui decide si une
  // composition est publiable, pas le plan affiche.
  useEffect(() => {
    let vivant = true;
    if (!project.bundleId) {
      setEtape('PRET');
      return () => { vivant = false; };
    }
    verifier(project.bundleId)
      .then((resultat) => {
        if (!vivant) return;
        setErreurs(resultat.erreurs);
        setEtape('PRET');
      })
      .catch(() => {
        if (!vivant) return;
        setPanne("Le serveur n'a pas répondu : la publication reste impossible hors ligne.");
        setEtape('PRET');
      });
    return () => { vivant = false; };
  }, [project.bundleId]);

  const lancerPublication = async () => {
    if (!project.bundleId) return;
    setEtape('PUBLICATION');
    setPanne(null);
    try {
      const version = await publier(project.bundleId, project.description);
      setVersionPubliee({ id: version.id, numero: version.numero });
      onPublished(version.numero);
      if (!canDeploy) {
        setEtape('TERMINE');
        return;
      }
      // Les portees de groupe sont un confort : si l'appel echoue, la
      // selection robot par robot reste possible et la publication n'est pas
      // perdue.
      const [liste, groupes, lieux] = await Promise.all([
        listerRobots(),
        listerFlottes().catch(() => [] as Flotte[]),
        listerSites().catch(() => [] as SiteCible[]),
      ]);
      setRobots(liste);
      setFlottes(groupes);
      setSites(lieux);
      setEtape('CIBLES');
    } catch (erreur) {
      setPanne(erreur instanceof Error ? erreur.message : 'Publication refusée par le serveur.');
      setEtape('PRET');
    }
  };

  const lancerDeploiement = async () => {
    if (!versionPubliee || !porteePrete) return;
    setEtape('DEPLOIEMENT');
    setPanne(null);
    try {
      const cible = portee === 'FLOTTE' ? { flotteId }
        : portee === 'SITE' ? { siteIds }
        : { robotIds: selection };
      setDeploiements(await deployer(versionPubliee.id, cible, project.name));
      setEtape('TERMINE');
    } catch (erreur) {
      setPanne(erreur instanceof Error ? erreur.message : 'Déploiement refusé par le serveur.');
      setEtape('CIBLES');
    }
  };

  const basculer = (robotId: string) => {
    setSelection((current) => current.includes(robotId)
      ? current.filter((item) => item !== robotId)
      : [...current, robotId]);
  };

  const basculerSite = (siteId: string) => {
    setSiteIds((current) => current.includes(siteId)
      ? current.filter((item) => item !== siteId)
      : [...current, siteId]);
  };

  const bloquants = [...bloquantsLocaux, ...erreurs];
  const enCours = etape === 'VERIFICATION' || etape === 'PUBLICATION' || etape === 'DEPLOIEMENT';

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <header className="dialog-header">
          <div className="dialog-icon dialog-icon--blue"><Rocket size={21} /></div>
          <div>
            <span>Publication</span>
            <h2 id="publish-title">Publier la version et la déployer</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="publish-summary">
          <div><Box size={17} /><span><small>Projet</small><strong>{project.name}</strong></span></div>
          <div>
            <CloudUpload size={17} />
            <span>
              <small>Version</small>
              <strong>{versionPubliee ? `version ${versionPubliee.numero} publiée` : `version ${project.version}`}</strong>
            </span>
          </div>
          <div>
            <Cpu size={17} />
            <span>
              <small>Composants</small>
              <strong>
                {project.nodes.length} blocs · {project.nodes.reduce((somme, noeud) => somme + noeud.data.agents.length, 0)} agents
              </strong>
            </span>
          </div>
        </div>

        {!project.bundleId && (
          <div className="publish-blocked">
            <span>Projet local</span>
            <strong>Ce projet n’existe que dans ce navigateur.</strong>
            <p>Il sera publiable dès que la console aura pu l’enregistrer sur le serveur.</p>
          </div>
        )}

        {panne && (
          <div className="publish-blocked">
            <span><CloudOff size={12} /> Serveur</span>
            <strong>{panne}</strong>
          </div>
        )}

        {project.bundleId && bloquants.length > 0 && (
          <div className="publish-blocked">
            <span>Publication bloquée</span>
            <strong>
              {bloquants.length} erreur{bloquants.length > 1 ? 's' : ''} empêche{bloquants.length > 1 ? 'nt' : ''} de figer une version cohérente.
            </strong>
            {bloquants.slice(0, 4).map((erreur) => <p key={erreur}>{erreur}</p>)}
          </div>
        )}

        {etape === 'CIBLES' && (
          <>
            {(flottes.length > 0 || sites.length > 0) && (
              <div className="portee-selecteur" role="radiogroup" aria-label="Portée du déploiement">
                <button className={portee === 'ROBOTS' ? 'is-active' : ''} role="radio"
                        aria-checked={portee === 'ROBOTS'}
                        onClick={() => setPortee('ROBOTS')} type="button">
                  Robots <em>{robots.length}</em>
                </button>
                {flottes.length > 0 && (
                  <button className={portee === 'FLOTTE' ? 'is-active' : ''} role="radio"
                          aria-checked={portee === 'FLOTTE'}
                          onClick={() => setPortee('FLOTTE')} type="button">
                    Flottes <em>{flottes.length}</em>
                  </button>
                )}
                {sites.length > 0 && (
                  <button className={portee === 'SITE' ? 'is-active' : ''} role="radio"
                          aria-checked={portee === 'SITE'}
                          onClick={() => setPortee('SITE')} type="button">
                    Sites <em>{sites.length}</em>
                  </button>
                )}
              </div>
            )}

            {portee === 'FLOTTE' && (
              <div className="deployment-targets">
                {flottes.map((flotte) => (
                  <label className="deployment-target" key={flotte.id}>
                    <span><Server size={18} /></span>
                    <div>
                      <strong>{flotte.nom}</strong>
                      <small>
                        {flotte.robot_ids?.length ?? 0} robot
                        {(flotte.robot_ids?.length ?? 0) > 1 ? 's' : ''} · {flotte.code}
                      </small>
                    </div>
                    <input checked={flotteId === flotte.id} type="radio" name="flotte"
                           onChange={() => setFlotteId(flotte.id)} />
                  </label>
                ))}
              </div>
            )}

            {portee === 'SITE' && (
              <div className="deployment-targets">
                {sites.map((site) => {
                  const compte = robots.filter((r) => r.site_id === site.id).length;
                  return (
                    <label className="deployment-target" key={site.id}>
                      <span><Server size={18} /></span>
                      <div>
                        <strong>{site.nom}</strong>
                        <small>{compte} robot{compte > 1 ? 's' : ''} rattaché{compte > 1 ? 's' : ''}</small>
                      </div>
                      <input checked={siteIds.includes(site.id)} type="checkbox"
                             onChange={() => basculerSite(site.id)} />
                    </label>
                  );
                })}
              </div>
            )}

            {portee === 'ROBOTS' && (
              <div className="deployment-targets">
                {robots.length === 0 && (
                  <div className="deployment-target">
                    <span><AlertTriangle size={18} /></span>
                    <div><strong>Aucun robot disponible</strong><small>Rattachez un robot à cette organisation.</small></div>
                  </div>
                )}
                {robots.map((robot) => (
                  <label className="deployment-target" key={robot.id}>
                    <span><Server size={18} /></span>
                    <div>
                      <strong>{robot.nom}</strong>
                      <small>
                        {robot.slug || robot.id} · {robot.statut}
                        {robot.modele ? ` · ${robot.modele}` : ''}
                      </small>
                    </div>
                    <input
                      checked={selection.includes(robot.id)}
                      onChange={() => basculer(robot.id)}
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="deployment-steps">
              <div className="is-done"><Check size={15} /><span>Version {versionPubliee?.numero} publiée et figée</span></div>
              <div className={porteePrete ? 'is-current' : ''}>
                <Server size={15} />
                <span>
                  {cibleRetenue
                    ? `${cibleRetenue.nom} · ${nombreVise} robot${nombreVise > 1 ? 's' : ''}`
                    : portee === 'SITE' && siteIds.length > 0
                      ? `${siteIds.length} site${siteIds.length > 1 ? 's' : ''} · ${nombreVise} robot${nombreVise > 1 ? 's' : ''}`
                      : `${nombreVise} robot${nombreVise > 1 ? 's' : ''} sélectionné${nombreVise > 1 ? 's' : ''}`}
                </span>
              </div>
            </div>
          </>
        )}

        {maintientLeCatalogue && versionPubliee && (etape === 'CIBLES' || etape === 'TERMINE') && (
          <div className="versement-catalogue">
            {verse ? (
              <p><Check size={14} /> Versé au catalogue sous « {verse} ».</p>
            ) : (
              <>
                <p>
                  Cette composition peut devenir un point de départ proposé à toutes
                  les organisations.
                </p>
                <button className="secondary-button" onClick={() => setVersementOuvert(true)} type="button">
                  <Server size={15} /> Verser au catalogue
                </button>
              </>
            )}
          </div>
        )}

        {etape === 'TERMINE' && (
          <div className="simulation-success">
            <CheckCircle2 size={20} />
            <div>
              <strong>Version {versionPubliee?.numero} publiée</strong>
              <span>
                {deploiements.length > 0
                  ? `Demande transmise à ${deploiements.length} robot${deploiements.length > 1 ? 's' : ''} : elle s’applique au prochain contact de l’agent embarqué.`
                  : 'Aucun déploiement demandé pour l’instant.'}
              </span>
            </div>
          </div>
        )}

        {versementOuvert && versionPubliee && (
          <PresetVersementDialog
            versionId={versionPubliee.id}
            nomSuggere={project.name}
            {...(project.description ? { descriptionSuggeree: project.description } : {})}
            famillesConnues={famillesConnues}
            onVerse={(preset) => { setVerse(preset.nom); setVersementOuvert(false); }}
            onFermer={() => setVersementOuvert(false)}
          />
        )}

        <footer className="dialog-footer">
          <button className="secondary-button" onClick={onClose} type="button">
            {etape === 'TERMINE' ? 'Fermer' : 'Annuler'}
          </button>
          {etape === 'PRET' && (
            <button
              className="primary-button"
              disabled={!project.bundleId || bloquants.length > 0 || Boolean(panne)}
              onClick={() => void lancerPublication()}
              type="button"
            >
              <Rocket size={16} /> Publier la version {project.version}
            </button>
          )}
          {etape === 'CIBLES' && (
            <button
              className="primary-button"
              disabled={!porteePrete}
              onClick={() => void lancerDeploiement()}
              type="button"
            >
              <Server size={16} /> Déployer sur {nombreVise} robot{nombreVise > 1 ? 's' : ''}
            </button>
          )}
          {enCours && (
            <button className="primary-button" disabled type="button">
              <LoaderCircle className="spin" size={16} /> En cours…
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
