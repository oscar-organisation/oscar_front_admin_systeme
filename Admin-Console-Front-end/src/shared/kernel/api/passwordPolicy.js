import { api } from "./index";

/**
 * Politique de mot de passe, lue depuis l'API.
 *
 * L'interface n'a pas sa propre constante : c'est le serveur qui impose la
 * regle, donc c'est lui qui l'annonce. Une copie cote client finirait par
 * diverger, et l'utilisateur verrait « 12 caracteres minimum » pendant que le
 * serveur en exige quinze.
 *
 * La valeur de repli ne sert que si l'appel echoue ; elle est volontairement
 * prudente, un formulaire trop permissif serait rejete par le serveur.
 */
const REPLI = 12;
let promesse = null;

export function chargerPolitiqueMotDePasse() {
  if (!promesse) {
    promesse = api
      .get("/auth/password-policy")
      .then((r) => (typeof r?.min_length === "number" ? r.min_length : REPLI))
      .catch(() => REPLI);
  }
  return promesse;
}
