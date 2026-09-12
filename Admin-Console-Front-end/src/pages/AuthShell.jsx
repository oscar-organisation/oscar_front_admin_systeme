import { Link } from "react-router-dom";
import { useTheme } from "@/shared/design-system/themes";
import OscarBrand from "@/components/OscarBrand.jsx";

/**
 * Ossature commune aux pages d'identité : connexion, oubli de mot de passe,
 * réinitialisation, activation d'invitation.
 *
 * Elle existe pour que ces quatre écrans partagent réellement la même mise en
 * page plutôt que quatre copies qui divergent à la première retouche. Le
 * marquage est identique à celui de Login, donc les styles `.auth-*` déjà
 * mesurés pour le contraste s'appliquent sans duplication.
 */
export default function AuthShell({ titre, intro, children, pied = null, testId }) {
  const { branding } = useTheme();

  return (
    <main className="auth-page-wrap" data-testid={testId} id="main-content" tabIndex={-1}>
      <section className="auth-login-panel">
        <div className="auth-brand-header">
          <OscarBrand className="auth-oscar-brand" />
          <span className="auth-brand-tag">Control Plane</span>
        </div>

        <div className="auth-card-shell">
          <div className="auth-login-heading">
            <h1>{titre}</h1>
            {intro && <p>{intro}</p>}
          </div>
          {children}
          {pied && <div className="auth-secondary">{pied}</div>}
        </div>

        <footer className="auth-login-footer">
          <span>{branding.applicationName}</span>
          <small>Accès réservé aux utilisateurs autorisés</small>
        </footer>
      </section>

      <aside className="auth-visual-panel" aria-label="Plateforme d'opérations OSCAR" />
    </main>
  );
}

export function LienRetourConnexion({ libelle = "Retour à la connexion" }) {
  return <Link to="/login" className="auth-link">{libelle}</Link>;
}
