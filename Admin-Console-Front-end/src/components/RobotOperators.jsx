import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import ConnInfo from "./ConnInfo.jsx";
import SearchSelect from "./SearchSelect.jsx";
import { IconUsers, IconPlus, IconTrash, IconKey, IconX, IconCheck } from "./Icons.jsx";
import { captureError } from "@/shared/kernel/observability";

export default function RobotOperators({ robotId, showInfo = true }) {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ user_id: "", op_role: "pilote" });
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(null);

  const canManage = can("robot:assign");

  const reload = useCallback(() => {
    setLoading(true);
    api.get(`/robots/${robotId}/assignments`)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((error) => {
        setRows([]);
        setErr(captureError(error, { feature: "robot-operators", action: "list" }));
      })
      .finally(() => setLoading(false));
  }, [robotId]);

  useEffect(() => {
    reload();
    api.get("/users").then((d) => setUsers(Array.isArray(d) ? d : [])).catch((error) => {
      setUsers([]);
      setErr(captureError(error, { feature: "robot-operators", action: "list-users" }));
    });
  }, [reload]);

  async function remove(userId) {
    if (!window.confirm("Dissocier cet opérateur ?")) return;
    try {
      await api.del(`/robots/${robotId}/assignments/${userId}`);
      reload();
      if (info?.userId === userId) setInfo(null);
    } catch (error) {
      setErr(captureError(error, { feature: "robot-operators", action: "remove" }));
    }
  }

  async function add(e) {
    e.preventDefault();
    setErr("");
    try {
      await api.post(`/robots/${robotId}/assign`, {
        user_id: form.user_id,
        role: form.op_role,
      });
      setAdding(false);
      setForm({ user_id: "", op_role: "pilote" });
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "robot-operators", action: "assign" }));
    }
  }

  async function loadConn(userId) {
    setInfo({ loading: true, userId });
    try {
      const data = await api.get(`/robots/${robotId}/integration/operator/${userId}`);
      setInfo({ data, userId });
    } catch (error) {
      setInfo({ error: captureError(error, { feature: "robot-operators", action: "integration-token" }), userId });
    }
  }

  const assignedIds = new Set(rows.map((r) => r.user_id));
  const options = users
    .filter((u) => !assignedIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.nom, sub: u.email }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={{ margin: 0, fontSize: 14, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
          <IconUsers size={16} /> Opérateurs habilités ({rows.length})
        </h4>
        {canManage && (
          <button
            type="button"
            className="btn-shell small primary"
            data-testid="operator-add-btn"
            onClick={() => setAdding(true)}
          >
            <IconPlus size={14} /> Affecter
          </button>
        )}
      </div>

      <div className="legend-list" data-testid="operators-list">
        {loading && <p style={{ color: "var(--shell-dim)", fontSize: 13 }}>Chargement des opérateurs...</p>}
        {!loading && rows.length === 0 && (
          <p style={{ color: "var(--shell-muted)", fontSize: 13 }}>Aucun opérateur affecté pour l'instant.</p>
        )}
        {!loading && rows.map((r) => (
          <div key={r.user_id} className="legend-item" data-testid="operator-item">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(255,255,255,0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--shell-blue)",
                }}
              >
                {(r.user_nom || "OP").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong style={{ color: "#fff", display: "block", fontSize: 13 }}>{r.user_nom}</strong>
                <span className="status-chip neutral" style={{ fontSize: 10, padding: "1px 6px" }}>{r.role}</span>
              </div>
            </div>
            <span className="row-actions">
              {showInfo && (
                <button
                  type="button"
                  className="btn-shell small"
                  data-testid="operator-conn-btn"
                  onClick={() => loadConn(r.user_id)}
                >
                  <IconKey size={13} /> Jeton
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  className="btn-shell small danger"
                  data-testid="operator-remove"
                  onClick={() => remove(r.user_id)}
                >
                  <IconTrash size={13} /> Dissocier
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {info?.loading && <p style={{ color: "var(--shell-dim)", fontSize: 12 }}>Génération du lien sécurisé...</p>}
      {info?.error && <div className="auth-error">{info.error}</div>}
      {info?.data && (
        <div style={{ marginTop: 8 }} data-testid="operator-conn">
          <ConnInfo data={info.data} />
        </div>
      )}

      {adding && (
        <div className="modal-backdrop show">
          <form className="modal-shell" data-testid="op-add-modal" onSubmit={add} style={{ maxWidth: 480 }}>
            <div className="modal-head">
              <h3>Affecter un opérateur</h3>
              <button type="button" className="icon-btn" onClick={() => setAdding(false)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Sélection de l'utilisateur</label>
              <SearchSelect
                testid="op-search"
                options={options}
                value={form.user_id}
                onChange={(v) => setForm({ ...form, user_id: v })}
                placeholder="Rechercher par nom ou email..."
              />

              <label className="auth-label">Rôle opérationnel</label>
              <select
                className="field-shell"
                data-testid="op-role-select"
                value={form.op_role}
                onChange={(e) => setForm({ ...form, op_role: e.target.value })}
              >
                <option value="pilote">Pilote téléopération (accès complet cockpit)</option>
                <option value="superviseur">Superviseur (monitoring & télémétrie)</option>
              </select>

              {err && <div className="auth-error">{err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setAdding(false)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="op-add-save" disabled={!form.user_id}>
                <IconCheck size={14} /> Confirmer l'affectation
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
