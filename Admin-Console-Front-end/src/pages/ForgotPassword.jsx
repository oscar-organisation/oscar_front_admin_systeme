import { useState } from "react";
import { api } from "@/shared/kernel/api";
import { IconArrowRight, IconCheck } from "../components/Icons.jsx";
import AuthShell, { LienRetourConnexion } from "./AuthShell.jsx";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } catch {
      // L'API repond 204 qu'un compte existe ou non. Une erreur reseau ne doit
      // pas davantage reveler quoi que ce soit : on affiche le meme ecran.
    } finally {
      setLoading(false);
      setEnvoye(true);
    }
  }

  if (envoye) {
    return (
      <AuthShell
        testId="forgot-password-sent"
        titre="Vérifiez votre messagerie"
        intro={`Si un compte est associé à ${email}, un lien de réinitialisation vient d'être envoyé.`}
      >
        <div className="auth-notice" role="status">
          <IconCheck size={16} />
          <span>
            Le lien expire dans une heure et ne peut servir qu'une fois.
            Pensez à regarder vos indésirables.
          </span>
        </div>
        <div className="auth-secondary">
          <LienRetourConnexion />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      testId="forgot-password-page"
      titre="Mot de passe oublié"
      intro="Indiquez votre adresse professionnelle. Nous vous enverrons un lien pour en choisir un nouveau."
      pied={<LienRetourConnexion />}
    >
      <form onSubmit={handleSubmit} className="auth-form" data-testid="forgot-form">
        <div className="auth-field">
          <label className="auth-label" htmlFor="forgot-email">Adresse email</label>
          <input
            id="forgot-email"
            type="email"
            className="field-shell"
            data-testid="forgot-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="operateur@exemple.fr"
            required
            autoFocus
          />
        </div>
        <button type="submit" className="btn-shell primary" disabled={loading} aria-busy={loading}>
          {loading ? "Envoi..." : "Envoyer le lien"} <IconArrowRight size={15} />
        </button>
      </form>
    </AuthShell>
  );
}
