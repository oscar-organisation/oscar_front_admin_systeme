import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { useTheme } from "@/shared/design-system/themes";
import { getUserErrorMessage } from "@/shared/kernel/errors";
import OscarBrand from "@/components/OscarBrand.jsx";
import {
  IconAlertCircle,
  IconArrowRight,
  IconEye,
  IconEyeOff,
} from "../components/Icons.jsx";

export default function Login() {
  const { user, login } = useAuth();
  const { branding } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      const destination = typeof location.state?.from === "string" ? location.state.from : "/";
      navigate(destination, { replace: true });
    } catch (err) {
      setError(getUserErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page-wrap" data-testid="login-page" id="main-content" tabIndex={-1}>
      <section className="auth-login-panel">
        <div className="auth-brand-header">
          <OscarBrand className="auth-oscar-brand" />
          <span>Control Plane</span>
        </div>

        <div className="auth-card-shell">
          <div className="auth-login-heading">
            <h1>Connexion</h1>
            <p>Identifiez-vous pour accéder à votre environnement d'opérations.</p>
          </div>

          <form data-testid="login-form" onSubmit={handleSubmit} className="auth-form">
            <div className="auth-field">
              <label className="auth-label" htmlFor="login-email">Adresse email</label>
              <input
                id="login-email"
                type="email"
                className="field-shell"
                data-testid="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operateur@exemple.fr"
                required
                autoFocus
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="login-password">Mot de passe</label>
              <div className="password-field">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  className="field-shell"
                  data-testid="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? "Masquer la saisie" : "Afficher la saisie"}
                  title={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="auth-error" data-testid="login-error" role="alert">
                <IconAlertCircle size={16} /> {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-shell primary"
              data-testid="login-submit"
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? "Authentification..." : "Se connecter"} <IconArrowRight size={15} />
            </button>
          </form>
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
