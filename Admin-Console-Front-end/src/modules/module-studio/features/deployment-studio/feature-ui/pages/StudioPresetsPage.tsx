import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Check, Eye, EyeOff, LoaderCircle, Search, Server, Trash2 } from "lucide-react";
import { useAuth } from "@/shared/kernel/auth/AuthProvider";
import {
  listerPresets,
  listerPresetsTous,
  modifierPreset,
  supprimerPreset,
} from "../../feature-data/studioApi";
import type { PresetServeur } from "../../feature-data/studioApi";
import "../../feature-styles/studio.css";

/**
 * Gestion du catalogue de présets.
 *
 * La bibliothèque se remplit depuis le Studio, en versant une version publiée
 * qui a fait ses preuves. Cette page-ci sert à ce qui vient après : décider ce
 * qui est proposé, corriger une description, retirer ce qui a vieilli.
 *
 * Qui n'en est pas le mainteneur la voit quand même, en lecture : savoir ce
 * que la plateforme propose n'a rien de confidentiel, et c'est utile pour
 * choisir son point de départ.
 */

const ETIQUETTES: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
};

export default function StudioPresetsPage() {
  const { user } = useAuth();
  const maintient = Boolean(user?.is_superadmin);
  const [presets, setPresets] = useState<PresetServeur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [enCours, setEnCours] = useState<string | null>(null);
  const [panne, setPanne] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      setPresets(maintient ? await listerPresetsTous() : await listerPresets());
      setPanne(null);
    } catch (erreur) {
      setPanne(erreur instanceof Error ? erreur.message : String(erreur));
    } finally {
      setChargement(false);
    }
  }, [maintient]);

  useEffect(() => { void charger(); }, [charger]);

  const agir = async (preset: PresetServeur, champs: { statut?: string }) => {
    setEnCours(preset.slug);
    try {
      const maj = await modifierPreset(preset.slug, champs);
      setPresets((liste) => liste.map((item) => (item.slug === maj.slug ? maj : item)));
      setPanne(null);
    } catch (erreur) {
      setPanne(erreur instanceof Error ? erreur.message : String(erreur));
    } finally {
      setEnCours(null);
    }
  };

  const retirer = async (preset: PresetServeur) => {
    // Retirer un preset ne touche a aucun projet : la composition y a ete
    // copiee, pas referencee. La confirmation porte donc sur le catalogue.
    if (!window.confirm(`Retirer « ${preset.nom} » du catalogue ? Les projets déjà créés ne changent pas.`)) return;
    setEnCours(preset.slug);
    try {
      await supprimerPreset(preset.slug);
      setPresets((liste) => liste.filter((item) => item.slug !== preset.slug));
      setPanne(null);
    } catch (erreur) {
      setPanne(erreur instanceof Error ? erreur.message : String(erreur));
    } finally {
      setEnCours(null);
    }
  };

  const visibles = useMemo(() => {
    const aiguille = recherche.trim().toLocaleLowerCase("fr");
    if (!aiguille) return presets;
    return presets.filter((item) =>
      [item.nom, item.famille, item.constructeur ?? "", item.description ?? ""]
        .some((champ) => champ.toLocaleLowerCase("fr").includes(aiguille)));
  }, [presets, recherche]);

  return (
    <div className="studio-scope">
      <div className="studio-projects">
        <section className="projects-section">
          <div className="section-heading">
            <div>
              <span>Catalogue</span>
              <h2>Présets de déploiement</h2>
            </div>
          </div>
          <p className="template-note">
            Compositions de référence proposées à toutes les organisations comme point de
            départ. {maintient
              ? "Elles se versent depuis le Studio, après publication d'une version."
              : "Le catalogue est maintenu par la plateforme."}
          </p>

          <div className="preset-search preset-search--page">
            <Search size={15} />
            <input
              type="search"
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder="Rechercher un châssis, un constructeur, un usage"
              aria-label="Rechercher un préset"
            />
          </div>

          {panne && <p className="dialog-erreur">{panne}</p>}

          {chargement ? (
            <p className="preset-vide"><LoaderCircle size={15} className="spin" /> Chargement du catalogue…</p>
          ) : visibles.length === 0 ? (
            <p className="preset-vide">
              {presets.length === 0
                ? "Le catalogue est vide. Publie une version dans le Studio, puis verse-la ici."
                : "Aucun préset ne correspond à cette recherche."}
            </p>
          ) : (
            <div className="preset-grid">
              {visibles.map((preset) => (
                <article className="preset-carte" key={preset.slug} data-testid="preset-carte">
                  <header className="preset-carte__tete">
                    <span className="preset-carte__icone"><Server size={16} /></span>
                    <span className={`preset-statut preset-statut--${preset.statut}`}>
                      {ETIQUETTES[preset.statut] ?? preset.statut}
                    </span>
                  </header>
                  <h3>{preset.nom}</h3>
                  <div className="preset-card__tags">
                    {preset.constructeur && <span className="preset-tag">{preset.constructeur}</span>}
                    <span className="preset-tag preset-tag--famille">{preset.famille}</span>
                  </div>
                  {preset.description && <p>{preset.description}</p>}
                  <small>{preset.spec?.nodes?.length ?? 0} composants · révision {preset.revision}</small>
                  {maintient && (
                    <div className="preset-carte__actions">
                      {enCours === preset.slug ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <>
                          {preset.statut === "published" ? (
                            <button className="preset-action" type="button"
                                    title="Le retirer du sélecteur de création, sans l'archiver"
                                    aria-label={`Retirer ${preset.nom} du sélecteur`}
                                    onClick={() => void agir(preset, { statut: "draft" })}>
                              <EyeOff size={14} />
                            </button>
                          ) : (
                            <button className="preset-action" type="button"
                                    title="Le proposer au sélecteur de création"
                                    aria-label={`Publier ${preset.nom}`}
                                    onClick={() => void agir(preset, { statut: "published" })}>
                              <Eye size={14} />
                            </button>
                          )}
                          {preset.statut !== "archived" && (
                            <button className="preset-action" type="button"
                                    title="L'archiver : il reste consultable, plus proposé"
                                    aria-label={`Archiver ${preset.nom}`}
                                    onClick={() => void agir(preset, { statut: "archived" })}>
                              <Archive size={14} />
                            </button>
                          )}
                          <button className="preset-action preset-action--danger" type="button"
                                  title="Le retirer du catalogue"
                                  aria-label={`Retirer ${preset.nom} du catalogue`}
                                  onClick={() => void retirer(preset)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
