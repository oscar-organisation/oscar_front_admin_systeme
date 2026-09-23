import { useEffect, useState } from 'react';
import { LoaderCircle, Server, X } from 'lucide-react';
import { verserAuCatalogue } from '../../feature-data/studioApi';
import type { PresetServeur } from '../../feature-data/studioApi';

/**
 * Versement d'une composition publiée au catalogue de la plateforme.
 *
 * Le slug se déduit du nom, parce que personne n'a envie d'inventer un
 * identifiant technique, mais il reste modifiable : une fois posé il ne
 * changera plus, c'est lui qui désigne le préset dans les URL.
 *
 * La famille de châssis n'est pas une étiquette libre. Elle doit porter le
 * même identifiant que le profil embarqué du robot, celui-là même qui nomme
 * l'image du runtime. Un préset rangé sous une famille inexistante ne
 * trouverait jamais de robot pour l'exécuter.
 */

function slugifier(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface Props {
  versionId: string;
  nomSuggere: string;
  descriptionSuggeree?: string;
  famillesConnues: string[];
  onVerse: (preset: PresetServeur) => void;
  onFermer: () => void;
}

export default function PresetVersementDialog({
  versionId, nomSuggere, descriptionSuggeree, famillesConnues, onVerse, onFermer,
}: Props) {
  const [nom, setNom] = useState(nomSuggere);
  const [slug, setSlug] = useState(slugifier(nomSuggere));
  const [slugTouche, setSlugTouche] = useState(false);
  const [famille, setFamille] = useState(famillesConnues[0] ?? '');
  const [constructeur, setConstructeur] = useState('');
  const [description, setDescription] = useState(descriptionSuggeree ?? '');
  const [envoi, setEnvoi] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);

  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => { if (e.key === 'Escape' && !envoi) onFermer(); };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [onFermer, envoi]);

  const verser = async (evenement: React.FormEvent) => {
    evenement.preventDefault();
    if (!nom.trim() || !slug.trim() || !famille.trim()) return;
    setEnvoi(true);
    setPanne(null);
    try {
      const preset = await verserAuCatalogue(versionId, {
        slug: slug.trim(),
        nom: nom.trim(),
        famille: famille.trim(),
        ...(constructeur.trim() ? { constructeur: constructeur.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      onVerse(preset);
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      setPanne(/409/.test(message)
        ? `Un préset porte déjà l'identifiant « ${slug.trim()} ».`
        : `Le versement a échoué : ${message}`);
      setEnvoi(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="project-dialog" onSubmit={verser}>
        <header className="dialog-header">
          <div className="dialog-icon dialog-icon--blue"><Server size={19} /></div>
          <div>
            <span>Catalogue</span>
            <h2>Verser au catalogue</h2>
          </div>
          <button className="icon-button" onClick={onFermer} type="button" disabled={envoi}
                  aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="project-dialog__body">
          <p className="template-note">
            Cette composition deviendra un point de départ proposé à toutes les organisations.
          </p>

          <label className="form-field">
            <span>Nom affiché</span>
            <input value={nom} onChange={(e) => {
              setNom(e.target.value);
              if (!slugTouche) setSlug(slugifier(e.target.value));
            }} required />
          </label>

          <label className="form-field">
            <span>Identifiant</span>
            <input value={slug} onChange={(e) => { setSlugTouche(true); setSlug(slugifier(e.target.value)); }}
                   pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
            <small>Minuscules et tirets. Il ne changera plus une fois posé.</small>
          </label>

          <label className="form-field">
            <span>Famille de châssis</span>
            <input value={famille} onChange={(e) => setFamille(slugifier(e.target.value))}
                   list="familles-connues" placeholder="rosmaster-m3pro" required />
            <datalist id="familles-connues">
              {famillesConnues.map((item) => <option value={item} key={item} />)}
            </datalist>
            <small>Le même identifiant que le profil embarqué du robot.</small>
          </label>

          <label className="form-field">
            <span>Constructeur</span>
            <input value={constructeur} onChange={(e) => setConstructeur(e.target.value)}
                   placeholder="Yahboom, Unitree…" />
          </label>

          <label className="form-field">
            <span>Description</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                      placeholder="Ce que cette composition fait faire au robot." />
          </label>

          {panne && <p className="dialog-erreur">{panne}</p>}
        </div>

        <footer className="dialog-footer">
          <button className="secondary-button" onClick={onFermer} type="button" disabled={envoi}>
            Annuler
          </button>
          <button className="primary-button" type="submit" disabled={envoi}>
            {envoi ? <LoaderCircle size={16} className="spin" /> : <Server size={16} />}
            {envoi ? 'Versement…' : 'Verser au catalogue'}
          </button>
        </footer>
      </form>
    </div>
  );
}
