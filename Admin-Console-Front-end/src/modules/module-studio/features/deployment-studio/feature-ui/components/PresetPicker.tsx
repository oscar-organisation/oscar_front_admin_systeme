import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Server, X } from "lucide-react";
import type { PresetServeur } from "../../feature-data/studioApi";

/**
 * Parcours du catalogue de présets.
 *
 * Une liste déroulante suffisait à trois entrées ; elle ne tient pas à cent.
 * Le catalogue a donc sa propre surface, avec une recherche et un filtre par
 * châssis, et la création de projet n'affiche plus que le choix retenu.
 *
 * La recherche porte sur ce qu'on a en tête quand on cherche un préset : le
 * nom, le constructeur, la famille de châssis et la description. Pas de
 * correspondance approximative, mais un accent ou une casse ne doivent pas
 * faire manquer un résultat.
 */

function normaliser(valeur: string): string {
  return valeur
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function correspond(preset: PresetServeur, recherche: string): boolean {
  if (!recherche) return true;
  const champs = [preset.nom, preset.constructeur ?? "", preset.famille, preset.description ?? ""];
  const aiguille = normaliser(recherche);
  return champs.some((champ) => normaliser(champ).includes(aiguille));
}

interface Props {
  presets: PresetServeur[];
  choisi?: string | undefined;
  onChoisir: (preset: PresetServeur) => void;
  onFermer: () => void;
}

export default function PresetPicker({ presets, choisi, onChoisir, onFermer }: Props) {
  const [recherche, setRecherche] = useState("");
  const [famille, setFamille] = useState("");
  const champRecherche = useRef<HTMLInputElement>(null);

  useEffect(() => { champRecherche.current?.focus(); }, []);

  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [onFermer]);

  const familles = useMemo(() => {
    const vues = new Map<string, number>();
    presets.forEach((item) => vues.set(item.famille, (vues.get(item.famille) ?? 0) + 1));
    return [...vues.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [presets]);

  const visibles = useMemo(
    () => presets.filter((item) => (!famille || item.famille === famille) && correspond(item, recherche)),
    [presets, famille, recherche],
  );

  return (
    <div className="modal-backdrop" onClick={onFermer} role="presentation">
      <div className="preset-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
           aria-label="Catalogue de présets">
        <header className="dialog-header">
          <div className="dialog-icon dialog-icon--blue"><Server size={19} /></div>
          <div>
            <span>Catalogue</span>
            <h2>Choisir un préset</h2>
          </div>
          <button className="icon-button" onClick={onFermer} type="button" aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="preset-search">
          <Search size={15} />
          <input
            ref={champRecherche}
            type="search"
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder="Rechercher un châssis, un constructeur, un usage"
            aria-label="Rechercher un préset"
          />
        </div>

        {familles.length > 1 && (
          <div className="preset-filters" role="group" aria-label="Filtrer par châssis">
            <button className={famille === "" ? "is-active" : ""} onClick={() => setFamille("")} type="button">
              Tous <em>{presets.length}</em>
            </button>
            {familles.map(([nom, total]) => (
              <button className={famille === nom ? "is-active" : ""} key={nom}
                      onClick={() => setFamille(nom)} type="button">
                {nom} <em>{total}</em>
              </button>
            ))}
          </div>
        )}

        <div className="preset-grid">
          {visibles.map((item) => {
            const actif = choisi === item.slug;
            const noeuds = item.spec?.nodes?.length ?? 0;
            return (
              <button
                className={`preset-card${actif ? " is-selected" : ""}`}
                key={item.slug}
                onClick={() => onChoisir(item)}
                type="button"
              >
                <div className="preset-card__head">
                  <strong>{item.nom}</strong>
                  {actif && <Check size={15} />}
                </div>
                <div className="preset-card__tags">
                  {item.constructeur && <span className="preset-tag">{item.constructeur}</span>}
                  <span className="preset-tag preset-tag--famille">{item.famille}</span>
                </div>
                <p>{item.description}</p>
                <small>{noeuds} composant{noeuds > 1 ? "s" : ""} · révision {item.revision}</small>
              </button>
            );
          })}
          {visibles.length === 0 && (
            <p className="preset-vide">
              Aucun préset ne correspond. Essaie un autre terme, ou pars d'une forme vierge.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
