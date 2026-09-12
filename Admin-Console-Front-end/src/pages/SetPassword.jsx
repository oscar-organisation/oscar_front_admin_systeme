import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/shared/kernel/api";
import { getUserErrorMessage } from "@/shared/kernel/errors";
import {
  IconAlertCircle,
  IconArrowRight,
  IconCheck,
  IconEye,
  IconEyeOff,
} from "../components/Icons.jsx";
import AuthShell, { LienRetourConnexion } from "./AuthShell.jsx";

const LONGUEUR_MINIMALE = 12;

/**
 * Écran de choix de mot de passe, partagé par deux parcours qui ne diffèrent
 * que par le vocabulaire et l'endpoint : activation d'une invitation, et
 * réinitialisation après oubli.
 *
 * Le lien est vérifié avant d'afficher le formulaire. Annoncer « lien expiré »
 * après que l'utilisateur a saisi deux fois son mot de passe est une perte de
 * temps évitable, et l'API expose `/auth/invitation/{token}` précisément pour
 * ça : elle valide sans consommer.
 */
export default function SetPassword({ mode }) {
  const invitation = mode === "invitation";
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();

  const [verification, setVerification] = useState("en-cours"); // en-cours|valide|invalide
  const [destinataire, setDestinataire] = useState(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [termine, setTermine] = useState(false);

  useEffect(() => {
    let annule = false;
    if (!token) { setVerification("invalide"); return undefined; }
    api.get(`/auth/invitation/${encodeURIComponent(token)}`)
      .then((reponse) => {
        if (annule) return;
        if (reponse?.valide) {
          setVerification("valide");
          setDestinataire({ email: reponse.email, nom: reponse.nom });
        } else {
          setVerification("invalide");
        }
      })
      .catch(() => { if (!annule) setVerification("invalide"); });
    return () => { annule = true; };
  }, [token]);

  const tropCourt = password.length > 0 && password.length < LONGUEUR_MINIMALE;
  const discordant = confirmation.length > 0 && confirmation !== password;
  const soumettable = useMemo(
    () => password.length >= LONGUEUR_MINIMALE && password === confirmation,
    [password, confirmation],
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!soumettable) return;
    setErr("");
    setLoading(true);
    try {
      await api.post(
        invitation ? "/auth/accept-invitation" : "/auth/reset-password",
        { token, password },
      );
      setTermine(true);
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (error) {
      setErr(getUserErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  if (verification === "en-cours") {
    return <AuthShell testId="set-password-loading" titre="Vérification du lien" intro="Un instant." />;
  }

  if (verification === "invalide") {
    return (
      <AuthShell
        testId="set-password-invalid"
        titre={invitation ? "Invitation expirée" : "Lien expiré"}
        intro={
          invitation
            ? "Ce lien d'invitation n'est plus valable. Il a peut-être déjà servi, ou une invitation plus récente l'a remplacé."
            : "Ce lien de réinitialisation n'est plus valable. Il a peut-être déjà servi, ou l'heure est passée."
        }
      >
        <div className="auth-error" role="alert">
          <IconAlertCircle size={16} />
          <span>Demandez un nouveau lien pour poursuivre.</span>
        </div>
        <div className="auth-secondary">
          <Link to="/forgot-password" className="auth-link">Demander un nouveau lien</Link>
          <LienRetourConnexion />
        </div>
      </AuthShell>
    );
  }

  if (termine) {
    return (
      <AuthShell
        testId="set-password-done"
        titre={invitation ? "Compte activé" : "Mot de passe modifié"}
        intro="Vous allez être redirigé vers la connexion."
      >
        <div className="auth-notice" role="status">
          <IconCheck size={16} />
          <span>Connectez-vous avec votre nouveau mot de passe.</span>
        </div>
        <div className="auth-secondary"><LienRetourConnexion libelle="Se connecter maintenant" /></div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      testId="set-password-page"
      titre={invitation ? "Activez votre accès" : "Nouveau mot de passe"}
      intro={
        destinataire?.email
          ? `Choisissez un mot de passe pour ${destinataire.email}.`
          : "Choisissez un mot de passe."
      }
      pied={<LienRetourConnexion />}
    >
      <form onSubmit={handleSubmit} className="auth-form" data-testid="set-password-form">
        <div className="auth-field">
          <label className="auth-label" htmlFor="new-password">Mot de passe</label>
          <div className="password-field">
            <input
              id="new-password"
              type={visible ? "text" : "password"}
              className="field-shell"
              data-testid="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              autoFocus
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={visible ? "Masquer la saisie" : "Afficher la saisie"}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>
          <small className={`auth-hint${tropCourt ? " warn" : ""}`}>
            {LONGUEUR_MINIMALE} caractères minimum. Une phrase dont vous vous souvenez
            vaut mieux qu'un mot court parsemé de symboles.
          </small>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="confirm-password">Confirmation</label>
          <input
            id="confirm-password"
            type={visible ? "text" : "password"}
            className="field-shell"
            data-testid="confirm-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            required
          />
          {discordant && <small className="auth-hint warn">Les deux saisies diffèrent.</small>}
        </div>

        {err && (
          <div className="auth-error" data-testid="set-password-error" role="alert">
            <IconAlertCircle size={16} /> {err}
          </div>
        )}

        <button
          type="submit"
          className="btn-shell primary"
          data-testid="set-password-submit"
          disabled={loading || !soumettable}
          aria-busy={loading}
        >
          {loading ? "Enregistrement..." : invitation ? "Activer mon compte" : "Changer le mot de passe"}
          <IconArrowRight size={15} />
        </button>
      </form>
    </AuthShell>
  );
}
