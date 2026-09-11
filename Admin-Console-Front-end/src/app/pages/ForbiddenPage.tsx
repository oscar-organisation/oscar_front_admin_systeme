import { Link } from "react-router-dom";

export default function ForbiddenPage({ message }: { message?: string }) {
  return (
    <main className="system-state-page" id="main-content" tabIndex={-1}>
      <div className="system-state-panel">
        <span className="system-state-code">403 · Accès refusé</span>
        <h1>Cette fonction n’est pas autorisée</h1>
        <p>{message || "Votre profil ne dispose pas des droits nécessaires pour consulter cette page."}</p>
        <div className="system-state-actions">
          <Link className="btn-shell primary" to="/">Changer d’espace</Link>
          <button className="btn-shell" type="button" onClick={() => window.history.back()}>Retour</button>
        </div>
      </div>
    </main>
  );
}
