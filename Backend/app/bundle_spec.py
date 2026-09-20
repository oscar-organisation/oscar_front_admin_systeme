"""Composition Studio : validation, projection runtime et empreinte.

Le Studio produit un document d'édition (positions des blocs, panneaux
dépliés, sélection en cours). Le robot, lui, n'a que faire d'un plan : il lui
faut la liste des services, de leurs agents et de leurs canaux. Ce module fait
la traduction, et c'est sur cette traduction — pas sur le document — que
l'empreinte est calculée. Déplacer un bloc ne change donc pas la version qui
tourne, alors que renommer un canal, si.

Le format servi au robot est identifié par `RUNTIME_FORMAT` : l'agent embarqué
refuse ce qu'il ne sait pas lire plutôt que de deviner.
"""

import hashlib
import json
from typing import Any

RUNTIME_FORMAT = "oscar.bundle.runtime.v1"

KIND_BUNDLE = "BUNDLE_DEPLOIEMENT"


def _noeuds(spec: dict) -> list[dict]:
    noeuds = spec.get("nodes")
    return [n for n in noeuds if isinstance(n, dict)] if isinstance(noeuds, list) else []


def _liens(spec: dict) -> list[dict]:
    liens = spec.get("edges")
    return [e for e in liens if isinstance(e, dict)] if isinstance(liens, list) else []


def _donnees(noeud: dict) -> dict:
    data = noeud.get("data")
    return data if isinstance(data, dict) else {}


def _agents(noeud: dict) -> list[dict]:
    agents = _donnees(noeud).get("agents")
    return [a for a in agents if isinstance(a, dict)] if isinstance(agents, list) else []


def _canaux(agent: dict, champ: str) -> list[dict]:
    canaux = agent.get(champ)
    return [c for c in canaux if isinstance(c, dict)] if isinstance(canaux, list) else []


def _canal_par_poignee(spec: dict, noeud_id: Any, poignee: Any) -> dict | None:
    """Retrouve un canal depuis une poignée `in:<agent>:<canal>` / `out:...`."""
    if not isinstance(poignee, str) or not isinstance(noeud_id, str):
        return None
    morceaux = poignee.split(":")
    if len(morceaux) != 3:
        return None
    _, agent_id, canal_id = morceaux
    for noeud in _noeuds(spec):
        if noeud.get("id") != noeud_id:
            continue
        for agent in _agents(noeud):
            if agent.get("id") != agent_id:
                continue
            for canal in _canaux(agent, "inputs") + _canaux(agent, "outputs"):
                if canal.get("id") == canal_id:
                    return canal
    return None


def valider_specification(spec: dict) -> tuple[list[str], list[str]]:
    """Revalide la composition côté serveur.

    Le navigateur valide déjà pendant la saisie, mais il n'est pas l'autorité :
    une composition peut arriver par l'API sans être jamais passée par le
    Studio. Publier sans revalider reviendrait à faire confiance au client sur
    ce qui finira par s'exécuter sur un robot.
    """
    erreurs: list[str] = []
    avertissements: list[str] = []

    if not isinstance(spec, dict):
        return ["La composition doit être un objet."], []

    noeuds = _noeuds(spec)
    if not noeuds:
        return ["La composition est vide."], []

    bundles = [n for n in noeuds if _donnees(n).get("kind") == KIND_BUNDLE]
    if not bundles:
        erreurs.append("Aucun bundle de déploiement : ajoutez le regroupement qui sera publié.")
    elif len(bundles) > 1:
        erreurs.append("Plusieurs bundles de déploiement : un seul est publié à la fois.")

    codes: dict[str, int] = {}
    for noeud in noeuds:
        donnees = _donnees(noeud)
        code = donnees.get("technicalCode")
        if not code:
            erreurs.append(f"Un bloc « {donnees.get('name') or noeud.get('id')} » n'a pas d'identifiant technique.")
        else:
            codes[code] = codes.get(code, 0) + 1
        agents = _agents(noeud)
        # Un composant qui ne fait que reveiller le chassis n'a pas d'agent, et
        # c'est normal : le signaler en permanence apprendrait a ignorer les
        # avertissements.
        if donnees.get("kind") != KIND_BUNDLE and not agents and not donnees.get("bringupKey"):
            avertissements.append(f"{donnees.get('name') or code} ne contient aucun agent.")
        for agent in agents:
            code_agent = agent.get("technicalCode")
            if not code_agent:
                erreurs.append(f"Un agent de « {donnees.get('name') or code} » n'a pas d'identifiant technique.")
            else:
                codes[code_agent] = codes.get(code_agent, 0) + 1
            for canal in _canaux(agent, "inputs") + _canaux(agent, "outputs"):
                code_canal = canal.get("technicalCode")
                if not code_canal:
                    erreurs.append(f"Un canal de « {agent.get('name') or code_agent} » n'a pas d'identifiant technique.")
                else:
                    codes[code_canal] = codes.get(code_canal, 0) + 1

    for code, occurrences in sorted(codes.items()):
        if occurrences > 1:
            erreurs.append(f"Identifiant technique dupliqué : {code} apparaît {occurrences} fois.")

    for lien in _liens(spec):
        if (lien.get("data") or {}).get("edgeKind") != "DONNEES":
            continue
        source = _canal_par_poignee(spec, lien.get("source"), lien.get("sourceHandle"))
        cible = _canal_par_poignee(spec, lien.get("target"), lien.get("targetHandle"))
        if source is None or cible is None:
            erreurs.append("Liaison incomplète : un canal relié n'existe plus.")
            continue
        if source.get("dataFormat") != cible.get("dataFormat"):
            erreurs.append(
                f"Formats incompatibles : {source.get('name')} émet {source.get('dataFormat')}, "
                f"{cible.get('name')} attend {cible.get('dataFormat')}."
            )

    return erreurs, avertissements


def boites_ia(spec: dict) -> list[str]:
    """Identifiants des Box IA declarees par les composants robot.

    Une composition qui embarque de la perception nomme la Box a appliquer :
    modeles, seuils et cameras voyagent alors avec la version du bundle, au
    lieu d'etre accroches au robot par un geste separe qu'on oublie.
    """
    trouvees = []
    for noeud in _noeuds(spec):
        identifiant = _donnees(noeud).get("aiBoxId")
        if isinstance(identifiant, str) and identifiant and identifiant not in trouvees:
            trouvees.append(identifiant)
    return trouvees


def manifeste_runtime(spec: dict) -> dict:
    """Projette la composition en manifeste exécutable, trié et sans mise en page."""
    noeuds = _noeuds(spec)
    bundle = next((n for n in noeuds if _donnees(n).get("kind") == KIND_BUNDLE), None)
    donnees_bundle = _donnees(bundle) if bundle else {}

    composants = []
    for noeud in noeuds:
        donnees = _donnees(noeud)
        if donnees.get("kind") == KIND_BUNDLE:
            continue
        agents = []
        for agent in _agents(noeud):
            agents.append({
                "code": agent.get("technicalCode"),
                "nom": agent.get("name"),
                "type": agent.get("agentType"),
                "traitement": agent.get("processingName"),
                "interface": agent.get("interfaceName"),
                "bande_donnees": agent.get("dataBandName"),
                "bus_reception": agent.get("receiveBusName"),
                "bus_emission": agent.get("sendBusName"),
                "publie_audio": bool(agent.get("canPublishAudio")),
                "publie_video": bool(agent.get("canPublishVideo")),
                "entrees": sorted(
                    ({
                        "code": canal.get("technicalCode"),
                        "nom": canal.get("name"),
                        "type": canal.get("channelType"),
                        "format": canal.get("dataFormat"),
                    } for canal in _canaux(agent, "inputs")),
                    key=lambda canal: canal["code"] or "",
                ),
                "sorties": sorted(
                    ({
                        "code": canal.get("technicalCode"),
                        "nom": canal.get("name"),
                        "type": canal.get("channelType"),
                        "format": canal.get("dataFormat"),
                    } for canal in _canaux(agent, "outputs")),
                    key=lambda canal: canal["code"] or "",
                ),
            })
        composant = {
            "code": donnees.get("technicalCode"),
            "nom": donnees.get("name"),
            "kind": donnees.get("kind"),
            "cible": donnees.get("target"),
            "agents": sorted(agents, key=lambda agent: agent["code"] or ""),
        }
        if donnees.get("aiBoxId"):
            composant["box_ia"] = donnees["aiBoxId"]
        # Mise en route du chassis : la composition nomme le besoin (« base »,
        # « camera »), le profil du robot fournit la commande. Un plan reste
        # ainsi lisible sur n'importe quel chassis, et un chassis qui ne sait
        # pas satisfaire un besoin le refuse au lieu de l'ignorer.
        if donnees.get("bringupKey"):
            composant["mise_en_route"] = str(donnees["bringupKey"]).strip().lower()
            try:
                composant["ordre"] = int(donnees.get("bringupOrder") or 100)
            except (TypeError, ValueError):
                composant["ordre"] = 100
        composants.append(composant)

    liaisons = []
    for lien in _liens(spec):
        if (lien.get("data") or {}).get("edgeKind") != "DONNEES":
            continue
        source = _canal_par_poignee(spec, lien.get("source"), lien.get("sourceHandle"))
        cible = _canal_par_poignee(spec, lien.get("target"), lien.get("targetHandle"))
        if source is None or cible is None:
            continue
        liaisons.append({
            "de": source.get("technicalCode"),
            "vers": cible.get("technicalCode"),
            "format": source.get("dataFormat"),
        })

    return {
        "format": RUNTIME_FORMAT,
        "bundle": {
            "code": donnees_bundle.get("technicalCode"),
            "nom": donnees_bundle.get("name"),
            "cible": donnees_bundle.get("target"),
        },
        "composants": sorted(composants, key=lambda composant: composant["code"] or ""),
        "liaisons": sorted(liaisons, key=lambda liaison: (liaison["de"] or "", liaison["vers"] or "")),
    }


def empreinte(manifeste: dict) -> str:
    canonique = json.dumps(manifeste, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonique.encode("utf-8")).hexdigest()
