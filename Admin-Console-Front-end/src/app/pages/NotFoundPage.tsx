import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="system-state-page" id="main-content" tabIndex={-1}>
      <div className="system-state-panel">
        <span className="system-state-code">404 · Page introuvable</span>
        <h1>Cette adresse ne correspond à aucun écran</h1>
        <p>La page a peut-être été déplacée ou le module associé n’est pas actif.</p>
        <Link className="btn-shell primary" to="/">Retour aux espaces</Link>
      </div>
    </main>
  );
}
