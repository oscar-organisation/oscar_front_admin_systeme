import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client.js";
import PageHeader from "@/components/PageHeader.jsx";
import { runtimeConfig } from "@/shared/config";
import { captureError } from "@/shared/kernel/observability";
import {
  IconRobot,
  IconUsers,
  IconStore,
  IconCpu,
  IconActivity,
  IconArrowRight,
} from "@/components/Icons.jsx";

export default function Dashboard() {
  const [data, setData] = useState({
    robots: [],
    users: [],
    sites: [],
    models: [],
    orgs: [],
    audit: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState("");

  useEffect(() => {
    Promise.allSettled([
      api.get("/robots"),
      api.get("/users"),
      api.get("/sites"),
      api.get("/ai/models"),
      api.get("/organisations"),
      api.get("/audit?limit=6"),
    ]).then(([r, u, s, m, o, a]) => {
      const rejected = [r, u, s, m, o, a].filter((result) => result.status === "rejected");
      if (rejected.length) {
        setLoadWarning(captureError(rejected[0].reason, { feature: "fleet-overview", action: "load-dashboard" }));
      }
      setData({
        robots: r.status === "fulfilled" && Array.isArray(r.value) ? r.value : [],
        users: u.status === "fulfilled" && Array.isArray(u.value) ? u.value : [],
        sites: s.status === "fulfilled" && Array.isArray(s.value) ? s.value : [],
        models: m.status === "fulfilled" && Array.isArray(m.value) ? m.value : [],
        orgs: o.status === "fulfilled" && Array.isArray(o.value) ? o.value : [],
        audit: a.status === "fulfilled" && Array.isArray(a.value) ? a.value : [],
      });
      setLoading(false);
    });
  }, []);

  const onlineRobots = data.robots.filter((r) => r.statut === "online").length;
  const maintenanceRobots = data.robots.filter((r) => r.statut === "maintenance").length;
  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        subtitle={`État de la flotte, des sites et des services ${runtimeConfig.shortName}`}
      />

      <div className="platform-content" data-testid="admin-dashboard">
        {loadWarning && (
          <div className="auth-error" role="alert">
            Certaines données n’ont pas pu être actualisées. {loadWarning}
          </div>
        )}
        {/* KPI Grid */}
        <div className="metrics-grid">
          <div className="kpi-card" data-testid="kpi-robots">
            <div className="kpi-card-header">
              <span className="kpi-title">Robots</span>
              <div className="kpi-icon-badge green">
                <IconRobot size={20} />
              </div>
            </div>
            <div className="kpi-value">{loading ? "—" : data.robots.length}</div>
            <div className="kpi-subtext">
              <span className="status-chip online" style={{ padding: "2px 8px", fontSize: 10 }}>
                {onlineRobots} en ligne
              </span>
              {maintenanceRobots > 0 && (
                <span className="status-chip warning" style={{ padding: "2px 8px", fontSize: 10 }}>
                  {maintenanceRobots} maint.
                </span>
              )}
            </div>
          </div>

          <div className="kpi-card" data-testid="kpi-users">
            <div className="kpi-card-header">
              <span className="kpi-title">Utilisateurs</span>
              <div className="kpi-icon-badge">
                <IconUsers size={20} />
              </div>
            </div>
            <div className="kpi-value">{loading ? "—" : data.users.length}</div>
            <div className="kpi-subtext" style={{ color: "var(--shell-dim)" }}>
              Comptes opérateurs et administrateurs
            </div>
          </div>

          <div className="kpi-card" data-testid="kpi-sites">
            <div className="kpi-card-header">
              <span className="kpi-title">Sites</span>
              <div className="kpi-icon-badge amber">
                <IconStore size={20} />
              </div>
            </div>
            <div className="kpi-value">{loading ? "—" : data.sites.length}</div>
            <div className="kpi-subtext" style={{ color: "var(--shell-dim)" }}>
              {data.orgs.length} organisation(s)
            </div>
          </div>

          <div className="kpi-card" data-testid="kpi-models">
            <div className="kpi-card-header">
              <span className="kpi-title">Modèles IA déployés</span>
              <div className="kpi-icon-badge purple">
                <IconCpu size={20} />
              </div>
            </div>
            <div className="kpi-value">{loading ? "—" : data.models.length}</div>
            <div className="kpi-subtext" style={{ color: "var(--shell-dim)" }}>
              Services de détection configurés
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="content-grid">
          {/* Recent Robots Fleet Status */}
          <div className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconRobot size={16} /> État de la flotte</h3>
                <small>Disponibilité et niveau de batterie</small>
              </div>
              <Link to="/admin/robots" className="btn-shell small" data-testid="quick-robots">
                Voir tous <IconArrowRight size={13} />
              </Link>
            </div>

            <div className="card-body flush table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Robot</th>
                    <th>Organisation</th>
                    <th>Batterie</th>
                    <th>Statut</th>
                    <th>Firmware</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--shell-dim)", padding: 24 }}>
                        Chargement des données de flotte...
                      </td>
                    </tr>
                  )}
                  {!loading && data.robots.slice(0, 5).map((r) => {
                    const battery = r.batterie ?? 100;
                    const batClass = battery < 20 ? "critical" : battery < 45 ? "low" : "";
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong style={{ color: "#fff" }}>{r.nom}</strong>
                          <div style={{ fontSize: 11, color: "var(--shell-dim)", fontFamily: "var(--font-mono)" }}>
                            {r.serial || "OSC-STD"}
                          </div>
                        </td>
                        <td>{r.org_nom || r.site_nom || "—"}</td>
                        <td>
                          <div className="battery-gauge" style={{ width: 110 }}>
                            <div className="battery-bar-wrap">
                              <div className={`battery-bar-fill ${batClass}`} style={{ width: `${battery}%` }} />
                            </div>
                            <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)" }}>{battery}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-chip ${r.statut === "online" ? "online" : r.statut === "maintenance" ? "warning" : "offline"}`}>
                            {r.statut}
                          </span>
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.firmware || "1.0.0"}</td>
                      </tr>
                    );
                  })}
                  {!loading && data.robots.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--shell-dim)", padding: 24 }}>
                        Aucun robot enregistré dans la flotte.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Real-time Activity Stream */}
          <div className="card-shell">
            <div className="card-head">
              <div>
                <h3><IconActivity size={16} /> Activité récente</h3>
                <small>Derniers événements enregistrés</small>
              </div>
              <Link to="/admin/audit" className="btn-shell small">
                Journal <IconArrowRight size={13} />
              </Link>
            </div>

            <div className="card-body" style={{ padding: "16px 20px" }}>
              <div className="audit-timeline">
                {loading && <p style={{ color: "var(--shell-dim)", fontSize: 13 }}>Chargement...</p>}
                {!loading && data.audit.slice(0, 5).map((a, idx) => (
                  <div key={a.id || idx} className="audit-entry" style={{ padding: "10px 12px" }}>
                    <div className="audit-icon" style={{ width: 28, height: 28 }}>
                      <IconActivity size={14} />
                    </div>
                    <div className="audit-content">
                      <div className="audit-header">
                        <span className="audit-title" style={{ fontSize: 12.5 }}>{a.action || a.event}</span>
                        <span className="audit-time">
                          {a.created_at ? new Date(a.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </span>
                      </div>
                      <p className="audit-desc" style={{ fontSize: 11.5 }}>
                        {a.details || a.description || `Par ${a.user_nom || "Système"}`}
                      </p>
                    </div>
                  </div>
                ))}
                {!loading && data.audit.length === 0 && (
                  <p style={{ color: "var(--shell-dim)", fontSize: 13, textAlign: "center", margin: "20px 0" }}>
                    Aucune activité récente enregistrée.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
