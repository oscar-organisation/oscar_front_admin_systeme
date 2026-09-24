import { useEffect, useState } from "react";
import { api } from "@/shared/kernel/api";
import { chargerPolitiqueMotDePasse } from "@/shared/kernel/api/passwordPolicy";
import { getUserErrorMessage } from "@/shared/kernel/errors";
import PageHeader from "@/components/PageHeader.jsx";
import {
  IconAlertCircle,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconKey,
  IconUser,
} from "@/components/Icons.jsx";


/**
 * Compte personnel de l'utilisateur connecté.
 *
 * Volontairement distinct de la gestion des utilisateurs : cette page n'exige
 * aucun droit d'administration et n'agit que sur le porteur de la session. Un
 * opérateur sans permission sur `api:user.write` doit pouvoir corriger son nom
 * et changer son mot de passe.
 */
export default function AccountPage() {
  const [moi, setMoi] = useState(null);
  const [err, setErr] = useState("");

  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [profilEnCours, setProfilEnCours] = useState(false);
  const [profilOk, setProfilOk] = useState(false);

  const [actuel, setActuel] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [mdpEnCours, setMdpEnCours] = useState(false);
  const [mdpOk, setMdpOk] = useState(false);
  const [mdpErr, setMdpErr] = useState("");
  const [longueurMin, setLongueurMin] = useState(null);

  async function charger() {
    try {
      const data = await api.get("/auth/me");
      setMoi(data);
      setNom(data.nom || "");
      setEmail(data.email || "");
    } catch (error) {
      setErr(getUserErrorMessage(error));
    }
  }

  useEffect(() => {
    charger();
    chargerPolitiqueMotDePasse().then(setLongueurMin);
  }, []);

  async function enregistrerProfil(e) {
    e.preventDefault();
    setErr(""); setProfilOk(false); setProfilEnCours(true);
    try {
      const data = await api.patch("/auth/me/profile", { nom, email });
      setMoi(data);
      setProfilOk(true);
    } catch (error) {
      setErr(getUserErrorMessage(error));
    } finally {
      setProfilEnCours(false);
    }
  }

  async function changerMotDePasse(e) {
    e.preventDefault();
    setMdpErr(""); setMdpOk(false);
    if (longueurMin !== null && nouveau.length < longueurMin) {
      setMdpErr(`Le nouveau mot de passe doit contenir au moins ${longueurMin} caractères.`);
      return;
    }
    if (nouveau !== confirmation) {
      setMdpErr("Les deux saisies diffèrent.");
      return;
    }
    setMdpEnCours(true);
    try {
      await api.post("/auth/me/password", { current_password: actuel, new_password: nouveau });
      setMdpOk(true);
      setActuel(""); setNouveau(""); setConfirmation("");
    } catch (error) {
      setMdpErr(getUserErrorMessage(error));
    } finally {
      setMdpEnCours(false);
    }
  }

  const roles = moi?.roles || [];

  return (
    <>
      <PageHeader title="Mon compte" subtitle="Vos informations et votre mot de passe" />

      <div className="platform-content account-page" data-testid="account-page">
        {err && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}

        <div className="account-grid">
          <section className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconUser size={16} /> Informations</h3>
                <small>Votre nom apparaît dans le journal d'audit à chaque action.</small>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={enregistrerProfil} className="account-form">
                <div className="auth-field">
                  <label className="auth-label" htmlFor="account-nom">Nom affiché</label>
                  <input id="account-nom" className="field-shell" data-testid="account-nom"
                         value={nom} onChange={(e) => setNom(e.target.value)} required />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="account-email">Adresse email</label>
                  <input id="account-email" type="email" className="field-shell" data-testid="account-email"
                         value={email} onChange={(e) => setEmail(e.target.value)} required />
                  <small className="auth-hint">
                    Elle sert aussi d'identifiant de connexion. La modifier change donc
                    l'adresse avec laquelle vous vous connectez.
                  </small>
                </div>
                <div className="account-actions">
                  <button type="submit" className="btn-shell primary" data-testid="account-save"
                          disabled={profilEnCours} aria-busy={profilEnCours}>
                    {profilEnCours ? "Enregistrement..." : "Enregistrer"}
                  </button>
                  {profilOk && (
                    <span className="account-confirm" role="status">
                      <IconCheck size={14} /> Modifications enregistrées
                    </span>
                  )}
                </div>
              </form>
            </div>
          </section>

          <section className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconKey size={16} /> Mot de passe</h3>
                <small>Le mot de passe actuel est demandé, même avec une session ouverte.</small>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={changerMotDePasse} className="account-form">
                <div className="auth-field">
                  <label className="auth-label" htmlFor="account-current">Mot de passe actuel</label>
                  <div className="password-field">
                    <input id="account-current" type={visible ? "text" : "password"}
                           className="field-shell" data-testid="account-current"
                           value={actuel} onChange={(e) => setActuel(e.target.value)}
                           autoComplete="current-password" required />
                    <button type="button" className="password-toggle"
                            aria-label={visible ? "Masquer les saisies" : "Afficher les saisies"}
                            onClick={() => setVisible((v) => !v)}>
                      {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="account-new">Nouveau mot de passe</label>
                  <input id="account-new" type={visible ? "text" : "password"}
                         className="field-shell" data-testid="account-new"
                         value={nouveau} onChange={(e) => setNouveau(e.target.value)}
                         autoComplete="new-password" required />
                  <small className="auth-hint">{longueurMin ?? "…"} caractères minimum.</small>
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="account-confirm">Confirmation</label>
                  <input id="account-confirm" type={visible ? "text" : "password"}
                         className="field-shell" data-testid="account-confirm"
                         value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                         autoComplete="new-password" required />
                </div>

                {mdpErr && (
                  <div className="auth-error" data-testid="account-password-error" role="alert">
                    <IconAlertCircle size={15} /> {mdpErr}
                  </div>
                )}

                <div className="account-actions">
                  <button type="submit" className="btn-shell primary" data-testid="account-password-save"
                          disabled={mdpEnCours} aria-busy={mdpEnCours}>
                    {mdpEnCours ? "Modification..." : "Changer le mot de passe"}
                  </button>
                  {mdpOk && (
                    <span className="account-confirm" role="status">
                      <IconCheck size={14} /> Mot de passe modifié
                    </span>
                  )}
                </div>
              </form>
            </div>
          </section>
        </div>

        <section className="card-shell">
          <div className="card-head">
            <div>
              <h3>Accès et rattachement</h3>
              <small>Ces éléments sont gérés par un administrateur et ne sont pas modifiables ici.</small>
            </div>
          </div>
          <div className="card-body">
            <dl className="account-readonly">
              <div>
                <dt>Organisation active</dt>
                <dd>{moi?.active_org_nom || (moi?.is_superadmin ? "Toutes les organisations" : "Non rattaché")}</dd>
              </div>
              <div>
                <dt>Rôles</dt>
                <dd>
                  {roles.length === 0
                    ? <span className="account-empty">Aucun rôle attribué</span>
                    : <div className="role-chip-row" title={roles.join(", ")}>
                        {roles.slice(0, 3).map((r) => (
                          <span key={r} className="status-chip info role-chip">{r}</span>
                        ))}
                        {roles.length > 3 && (
                          <span className="status-chip info role-chip role-chip-more">+{roles.length - 3}</span>
                        )}
                      </div>}
                </dd>
              </div>
              <div>
                <dt>Statut</dt>
                <dd>
                  <span className={`status-chip ${moi?.statut === "active" ? "online" : moi?.statut === "disabled" ? "danger" : "neutral"}`}>
                    {moi?.statut === "active" ? "Actif"
                      : moi?.statut === "disabled" ? "Désactivé"
                      : moi?.statut === "invited" ? "Invité"
                      : "—"}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </>
  );
}
