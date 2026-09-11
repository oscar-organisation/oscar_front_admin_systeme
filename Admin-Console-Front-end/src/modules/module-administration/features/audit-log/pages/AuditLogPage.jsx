import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client.js";
import PageHeader from "@/components/PageHeader.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconActivity,
  IconRefresh,
  IconSearch,
} from "@/components/Icons.jsx";

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    api.get(`/audit?limit=${limit}`)
      .then((d) => setLogs(Array.isArray(d) ? d : []))
      .catch((cause) => {
        setLogs([]);
        setError(captureError(cause, { feature: "audit-log", action: "list" }));
      })
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = logs.filter((l) => {
    const text = (
      (l.action || "") +
      " " +
      (l.user_nom || "") +
      " " +
      (l.user_email || "") +
      " " +
      (l.resource_type || "") +
      " " +
      (typeof l.details === "object" ? JSON.stringify(l.details) : l.details || "")
    ).toLowerCase();
    return !q || text.includes(q.toLowerCase());
  });

  return (
    <>
      <PageHeader
        title="Journal d'Audit & Sécurité"
        subtitle="Historique immuable des connexions, modifications de flotte et opérations critiques"
      />

      <div className="platform-content" data-testid="audit-page">
        {error && <div className="auth-error" role="alert">{error}</div>}
        {/* Controls */}
        <div className="card-shell" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 260, maxWidth: 440 }}>
              <input
                className="field-shell"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filtrer les événements par action, utilisateur..."
                style={{ paddingLeft: 34 }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--shell-dim)" }}>
                <IconSearch size={15} />
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--shell-dim)", fontWeight: 600 }}>LIGNES :</span>
              <select
                className="field-shell"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                style={{ width: 110 }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <button className="btn-shell small" onClick={reload}>
                <IconRefresh size={13} /> Actualiser
              </button>
            </div>
          </div>
        </div>

        {/* Audit Stream Table */}
        <div className="card-shell">
          <div className="card-head">
            <div>
              <h3><IconActivity size={16} /> Événements Enregistrés ({filtered.length})</h3>
              <small>Traçabilité conforme aux standards de gouvernance industrielle</small>
            </div>
            <span className="status-chip neutral">Temps réel</span>
          </div>

          <div className="card-body flush table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horodatage</th>
                  <th>Action & Événement</th>
                  <th>Auteur / Utilisateur</th>
                  <th>Cible / Ressource</th>
                  <th>Détails de l'opération</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Chargement du journal d'audit...
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((l, idx) => {
                  const isCritical = (l.action || "").includes("delete") || (l.action || "").includes("revoke") || (l.action || "").includes("error");
                  const isWarning = (l.action || "").includes("update") || (l.action || "").includes("assign");
                  const chipType = isCritical ? "danger" : isWarning ? "warning" : "info";

                  return (
                    <tr key={l.id || idx} data-testid="audit-row">
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--shell-dim)", whiteSpace: "nowrap" }}>
                        {l.created_at
                          ? new Date(l.created_at).toLocaleString("fr-FR", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td>
                        <span
                          className={`status-chip ${chipType}`}
                          data-testid="audit-action"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                        >
                          {l.action || l.event || "AUDIT_EVENT"}
                        </span>
                      </td>
                      <td data-testid="audit-user">
                        <strong style={{ color: "#fff", display: "block" }}>{l.user_nom || "Système"}</strong>
                        <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>{l.user_email || "system@oscar-bot.com"}</small>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          {l.resource_type ? `${l.resource_type} #${String(l.resource_id || "").slice(0, 6)}` : "—"}
                        </span>
                      </td>
                      <td>
                        {l.details && typeof l.details === "object" ? (
                          <pre style={{ margin: 0, padding: "4px 8px", background: "rgba(0,0,0,0.3)", borderRadius: "var(--radius-sm)", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--shell-dim)", maxHeight: 80, overflowY: "auto" }}>
                            {JSON.stringify(l.details, null, 2)}
                          </pre>
                        ) : (
                          <span style={{ color: "var(--shell-muted)", fontSize: 12.5 }}>
                            {l.details || l.description || "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Aucun événement dans le journal d'audit.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
