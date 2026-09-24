import { useEffect, useState } from "react";
import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import PageHeader from "@/components/PageHeader.jsx";
import RobotOperators from "@/components/RobotOperators.jsx";
import IntegrationModal from "@/components/IntegrationModal.jsx";
import { captureError } from "@/shared/kernel/observability";
import {
  IconRobot,
  IconPlus,
  IconSearch,
  IconEdit,
  IconTrash,
  IconUsers,
  IconKey,
  IconActivity,
  IconSliders,
  IconX,
  IconRefresh,
  IconCheck,
  IconAlertCircle,
} from "@/components/Icons.jsx";

const CHIP = {
  online: "online",
  maintenance: "warning",
  offline: "offline",
};

export default function Robots() {
  const { can } = useAuth();
  const [robots, setRobots] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [sites, setSites] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [stFilter, setStFilter] = useState("all");

  const [modal, setModal] = useState(null); // { mode: 'create'|'edit', ... }
  const [err, setErr] = useState("");
  const [ops, setOps] = useState(null); // robot for operators modal
  const [integ, setInteg] = useState(null); // robot for integration modal
  const [issued, setIssued] = useState(null); // token result modal
  const [diag, setDiag] = useState(null); // diagnostic modal
  const [sel, setSel] = useState(null); // selected client in diagnostic

  const canCreate = can("robot:create");
  const canUpdate = can("robot:update");
  const canDelete = can("robot:delete");
  const canTokens = can("robot:tokens");
  const canDiag = can("robot:diagnose");

  function reload() {
    setLoading(true);
    setErr("");
    // Les familles connues sont un confort de saisie : si l'appel echoue, le
    // champ reste libre et la creation n'est pas bloquee.
    Promise.all([
      api.get("/robots"),
      api.get("/organisations"),
      api.get("/sites"),
      api.get("/robots/modeles").catch(() => []),
    ])
      .then(([r, o, s, m]) => {
        setRobots(Array.isArray(r) ? r : []);
        setOrgs(Array.isArray(o) ? o : []);
        setSites(Array.isArray(s) ? s : []);
        setModeles(Array.isArray(m) ? m : []);
      })
      .catch((error) => {
        setRobots([]);
        setOrgs([]);
        setSites([]);
        setErr(captureError(error, { feature: "fleet-robots", action: "list" }));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = robots.filter((r) => {
    const matchQ =
      !q ||
      (r.nom + " " + (r.serial || "") + " " + (r.modele || "") + " "
        + (r.org_nom || "") + " " + (r.site_nom || ""))
        .toLowerCase()
        .includes(q.toLowerCase());
    const matchSt = stFilter === "all" || r.statut === stFilter;
    return matchQ && matchSt;
  });

  function openCreate() {
    setErr("");
    setModal({
      mode: "create",
      nom: "",
      org_id: orgs[0]?.id || "",
      site_id: "",
      serial: "",
      modele: "",
      firmware: "1.0.0",
      statut: "online",
      batterie: 100,
      capacites: "navigation, vision",
    });
  }

  function openEdit(r) {
    setErr("");
    setModal({
      mode: "edit",
      id: r.id,
      nom: r.nom,
      org_id: r.organisation_id || r.org_id || "",
      site_id: r.site_id || "",
      serial: r.serial || "",
      modele: r.modele || "",
      firmware: r.firmware || "1.0.0",
      statut: r.statut || "online",
      batterie: r.batterie != null ? r.batterie : 100,
      capacites: Array.isArray(r.capacites) ? r.capacites.join(", ") : r.capacites || "",
    });
  }

  async function submitModal(e) {
    e.preventDefault();
    setErr("");
    const payload = {
      nom: modal.nom,
      organisation_id: modal.org_id,
      site_id: modal.site_id || null,
      serial: modal.serial,
      modele: modal.modele || null,
      firmware: modal.firmware,
      statut: modal.statut,
      batterie: Number(modal.batterie),
      capacites: modal.capacites
        ? modal.capacites.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    };
    try {
      if (modal.mode === "edit") {
        await api.patch(`/robots/${modal.id}`, payload);
      } else {
        await api.post("/robots", payload);
      }
      setModal(null);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "fleet-robots", action: modal.mode }));
    }
  }

  async function remove(r) {
    if (!window.confirm(`Supprimer définitivement le robot « ${r.nom} » ?`)) return;
    try {
      await api.del(`/robots/${r.id}`);
      reload();
    } catch (error) {
      setErr(captureError(error, { feature: "fleet-robots", action: "delete" }));
    }
  }

  async function issueTokens(r) {
    setIssued({ robot: r.nom, loading: true });
    try {
      const res = await api.post(`/robots/${r.id}/tokens`, { ttl_hours: 24 });
      setIssued({
        robot: r.nom,
        room: res.room,
        url: res.livekit_url || res.url,
        token: res.robot_token || res.token,
      });
    } catch (error) {
      setIssued({ robot: r.nom, error: captureError(error, { feature: "fleet-robots", action: "issue-token" }) });
    }
  }

  async function openDiag(r) {
    setDiag({ robot: r, loading: true });
    setSel(null);
    try {
      const res = await api.get(`/robots/${r.id}/diagnostics`);
      setDiag({ robot: r, data: res });
    } catch (error) {
      setDiag({ robot: r, error: captureError(error, { feature: "fleet-robots", action: "diagnose" }) });
    }
  }

  const modalSites = sites.filter((s) => !modal?.org_id || s.organisation_id === modal.org_id);

  const hchip = (v) => (v === "ok" || v === "healthy" ? "online" : v === "warning" ? "warning" : "offline");
  const hlabel = (v) => (v === "ok" || v === "healthy" ? "Opérationnel" : v === "warning" ? "Dégradé" : "Hors ligne");

  return (
    <>
      <PageHeader
        title="Gestion de la Flotte Robotique"
        subtitle="Inventaire, télémétrie temps réel, assignations et diagnostics LiveKit"
        actions={
          canCreate && (
            <button className="btn-shell primary" data-testid="robot-create-btn" onClick={openCreate}>
              <IconPlus size={16} /> Ajouter un robot
            </button>
          )
        }
      />

      <div className="platform-content" data-testid="robots-page">
        {err && !modal && <div className="auth-error" role="alert"><IconAlertCircle size={15} /> {err}</div>}
        {/* Filter Bar */}
        <div className="card-shell" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
              <input
                className="field-shell"
                data-testid="robot-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher par nom, numéro de série, magasin..."
                style={{ paddingLeft: 34 }}
              />
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--shell-dim)" }}>
                <IconSearch size={15} />
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--shell-dim)", fontWeight: 600 }}>STATUT :</span>
              <select
                className="field-shell"
                data-testid="robot-status-filter"
                value={stFilter}
                onChange={(e) => setStFilter(e.target.value)}
                style={{ width: 140 }}
              >
                <option value="all">Tous les états</option>
                <option value="online">En ligne</option>
                <option value="maintenance">Maintenance</option>
                <option value="offline">Hors ligne</option>
              </select>
            </div>
          </div>
        </div>

        {/* Robots Table */}
        <div className="card-shell">
          <div className="card-head">
            <div>
              <h3><IconRobot size={16} /> Flotte ({filtered.length})</h3>
              <small>Robots opérationnels et machines de simulation</small>
            </div>
            <button className="btn-shell small" onClick={reload}>
              <IconRefresh size={13} /> Actualiser
            </button>
          </div>

          <div className="card-body flush table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Robot & Série</th>
                  <th>Affectation Site</th>
                  <th>Batterie</th>
                  <th>Statut</th>
                  <th>Firmware</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Chargement de la flotte...
                    </td>
                  </tr>
                )}
                {!loading && filtered.map((r) => {
                  const battery = r.batterie ?? 100;
                  const batClass = battery < 20 ? "critical" : battery < 45 ? "low" : "";
                  return (
                    <tr key={r.id} data-testid="robot-row">
                      <td>
                        <strong data-testid="robot-name" style={{ color: "#fff" }}>{r.nom}</strong>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          {r.modele && (
                            <span className="modele-chip" data-testid="robot-modele">{r.modele}</span>
                          )}
                          {/* Le robot est la seule source qui sache sur quel chassis il
                              tourne. Quand sa declaration contredit la saisie, on le
                              montre : une famille mal orthographiee empeche le
                              catalogue de presets de retrouver ses robots. */}
                          {r.modele_constate && r.modele_constate !== r.modele && (
                            <span
                              className="modele-chip modele-chip--ecart"
                              data-testid="robot-modele-ecart"
                              title={`Le robot declare ${r.modele_constate}`}
                            >
                              robot : {r.modele_constate}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--shell-dim)", fontFamily: "var(--font-mono)" }}>
                          {r.serial || "OSC-STD"}
                        </div>
                      </td>
                      <td>
                        <div>{r.org_nom || "Organisation"}</div>
                        <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>{r.site_nom || "Site principal"}</small>
                      </td>
                      <td>
                        <div className="battery-gauge" style={{ width: 110 }}>
                          <div className="battery-bar-wrap">
                            <div className={`battery-bar-fill ${batClass}`} style={{ width: `${battery}%` }} />
                          </div>
                          <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)" }}>{battery}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={"status-chip " + (CHIP[r.statut] || "neutral")}>
                          {r.statut}
                        </span>
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.firmware || "1.0.0"}</td>
                      <td className="row-actions">
                        {canDiag && (
                          <button
                            className="btn-shell small"
                            data-testid="robot-diagnostic"
                            title="Diagnostic LiveKit"
                            onClick={() => openDiag(r)}
                          >
                            <IconActivity size={13} /> Diag
                          </button>
                        )}
                        {canTokens && (
                          <button
                            className="btn-shell small"
                            data-testid="robot-token"
                            title="Émettre des jetons LiveKit"
                            onClick={() => issueTokens(r)}
                          >
                            <IconKey size={13} /> Jetons
                          </button>
                        )}
                        <button
                          className="btn-shell small"
                          data-testid="robot-operators"
                          title="Gérer les opérateurs affectés"
                          onClick={() => setOps(r)}
                        >
                          <IconUsers size={13} /> Pilotes
                        </button>
                        <button
                          className="btn-shell small"
                          data-testid="robot-integration"
                          title="Paramètres d'intégration"
                          onClick={() => setInteg(r)}
                        >
                          <IconSliders size={13} />
                        </button>
                        {canUpdate && (
                          <button
                            className="btn-shell small"
                            data-testid="robot-edit"
                            title="Modifier"
                            onClick={() => openEdit(r)}
                          >
                            <IconEdit size={13} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="btn-shell small danger"
                            data-testid="robot-delete"
                            title="Supprimer"
                            onClick={() => remove(r)}
                          >
                            <IconTrash size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--shell-dim)" }}>
                      Aucun robot correspondant aux filtres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Création / Modification Robot */}
      {modal && (
        <div className="modal-backdrop show">
          <form className="modal-shell" onSubmit={submitModal} data-testid="robot-modal" style={{ maxWidth: 540 }}>
            <div className="modal-head">
              <h3>{modal.mode === "create" ? "Ajouter un robot" : "Modifier le robot"}</h3>
              <button type="button" className="icon-btn" onClick={() => setModal(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <label className="auth-label">Nom du robot</label>
              <input
                className="field-shell"
                data-testid="robot-nom"
                value={modal.nom}
                onChange={(e) => setModal({ ...modal, nom: e.target.value })}
                placeholder="ex: OSCAR-01 (Rayon Frais)"
                required
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Organisation</label>
                  <select
                    className="field-shell"
                    data-testid="robot-org"
                    value={modal.org_id}
                    onChange={(e) => setModal({ ...modal, org_id: e.target.value, site_id: "" })}
                    required
                  >
                    <option value="">- choisir -</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.nom}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="auth-label">Site / Magasin</label>
                  <select
                    className="field-shell"
                    data-testid="robot-site"
                    value={modal.site_id}
                    onChange={(e) => setModal({ ...modal, site_id: e.target.value })}
                    disabled={!modal.org_id}
                  >
                    <option value="">- aucun / global -</option>
                    {modalSites.map((s) => (
                      <option key={s.id} value={s.id}>{s.nom}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Modèle de châssis</label>
                  <input
                    className="field-shell"
                    data-testid="robot-modele"
                    list="modeles-connus"
                    placeholder="rosmaster-m3pro"
                    value={modal.modele}
                    onChange={(e) => setModal({ ...modal, modele: e.target.value })}
                  />
                  {/* Liste et non menu ferme : un chassis d'un nouveau
                      constructeur doit pouvoir entrer sans attendre une mise a
                      jour. Mais proposer les familles connues evite d'inventer
                      une orthographe que le robot ne reconnaitra pas. */}
                  <datalist id="modeles-connus">
                    {modeles.map((m) => <option value={m} key={m} />)}
                  </datalist>
                  <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>
                    Le même identifiant que le profil embarqué du robot.
                  </small>
                </div>
                <div>
                  <label className="auth-label">Numéro de série</label>
                  <input
                    className="field-shell"
                    data-testid="robot-serial"
                    value={modal.serial}
                    onChange={(e) => setModal({ ...modal, serial: e.target.value })}
                    placeholder="OSC-000-000"
                  />
                </div>
                <div>
                  <label className="auth-label">Firmware</label>
                  <input
                    className="field-shell"
                    data-testid="robot-firmware"
                    value={modal.firmware}
                    onChange={(e) => setModal({ ...modal, firmware: e.target.value })}
                    placeholder="1.0.0"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="auth-label">Statut</label>
                  <select
                    className="field-shell"
                    value={modal.statut}
                    onChange={(e) => setModal({ ...modal, statut: e.target.value })}
                  >
                    <option value="online">En ligne</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="offline">Hors ligne</option>
                  </select>
                </div>
                <div>
                  <label className="auth-label">Batterie (%)</label>
                  <input
                    className="field-shell"
                    type="number"
                    min="0"
                    max="100"
                    value={modal.batterie}
                    onChange={(e) => setModal({ ...modal, batterie: e.target.value })}
                    placeholder="0 à 100"
                  />
                </div>
              </div>

              <label className="auth-label">Capacités matérielles (séparées par virgules)</label>
              <input
                className="field-shell"
                value={modal.capacites}
                onChange={(e) => setModal({ ...modal, capacites: e.target.value })}
                placeholder="navigation, vision, 360-equirect, arm-manipulation"
              />

              {err && <div className="auth-error"><IconAlertCircle size={15} /> {err}</div>}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => setModal(null)}>Annuler</button>
              <button type="submit" className="btn-shell primary" data-testid="robot-save">
                <IconCheck size={14} /> {modal.mode === "create" ? "Créer le robot" : "Enregistrer"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Opérateurs */}
      {ops && (
        <div className="modal-backdrop show">
          <div className="modal-shell" data-testid="operators-modal" style={{ maxWidth: 640, width: "94%" }}>
            <div className="modal-head">
              <h3><IconUsers size={18} /> Affectation des Opérateurs — {ops.nom}</h3>
              <button type="button" className="icon-btn" onClick={() => setOps(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              <RobotOperators robotId={ops.id} showInfo={false} />
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell primary" onClick={() => setOps(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Token Result */}
      {issued && (
        <div className="modal-backdrop show">
          <div className="modal-shell" data-testid="token-result" style={{ maxWidth: 540 }}>
            <div className="modal-head">
              <h3><IconKey size={18} /> Jetons de Session LiveKit — {issued.robot}</h3>
              <button type="button" className="icon-btn" onClick={() => setIssued(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              {issued.loading && <p style={{ color: "var(--shell-dim)" }}>Génération des jetons en cours...</p>}
              {issued.error && <div className="auth-error"><IconAlertCircle size={15} /> {issued.error}</div>}
              {issued.room && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label className="auth-label">Room LiveKit assignée</label>
                    <input className="field-shell" readOnly data-testid="token-room" value={issued.room} />
                  </div>
                  <div>
                    <label className="auth-label">URL Serveur</label>
                    <input className="field-shell" readOnly value={issued.url} />
                  </div>
                  <p style={{ color: "var(--shell-muted)", fontSize: 12.5, margin: 0 }}>
                    Les jetons émis autorisent la publication vidéo/audio robot et la réception des ordres de téléopération (topic <code>oscar.xr.input</code>).
                  </p>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell primary" onClick={() => setIssued(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Diagnostics LiveKit */}
      {diag && (
        <div className="modal-backdrop show">
          <div className="modal-shell" data-testid="diagnostic-modal" style={{ maxWidth: 640, width: "94%" }}>
            <div className="modal-head">
              <h3><IconActivity size={18} /> Diagnostic Temps Réel — {diag.robot.nom}</h3>
              <button type="button" className="icon-btn" onClick={() => setDiag(null)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-body">
              {diag.loading && <p style={{ color: "var(--shell-dim)" }}>Sondage de la room LiveKit en cours...</p>}
              {diag.error && <div className="auth-error"><IconAlertCircle size={15} /> {diag.error}</div>}
              {diag.data && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <span className={"status-chip " + hchip(diag.data.health.livekit)}>
                      LiveKit : {hlabel(diag.data.health.livekit)}
                    </span>
                    <span className={"status-chip " + hchip(diag.data.health.robot)}>
                      Robot : {hlabel(diag.data.health.robot)}
                    </span>
                    <span className={"status-chip " + hchip(diag.data.health.commande)}>
                      Téléopération : {hlabel(diag.data.health.commande)}
                    </span>
                    <span className={"status-chip " + hchip(diag.data.health.sdk)}>
                      Agent SDK : {hlabel(diag.data.health.sdk)}
                    </span>
                  </div>

                  <div className="card-shell" style={{ background: "rgba(0,0,0,0.25)", padding: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12.5 }}>
                      <div><span style={{ color: "var(--shell-dim)" }}>Room :</span> <strong data-testid="diagnostic-room">{diag.data.room}</strong></div>
                      <div><span style={{ color: "var(--shell-dim)" }}>Jetons actifs :</span> <strong>{diag.data.tokens_actifs}</strong></div>
                      <div style={{ gridColumn: "1/-1" }}><span style={{ color: "var(--shell-dim)" }}>Serveur :</span> <code>{diag.data.livekit_url}</code></div>
                    </div>
                  </div>

                  <h4 style={{ margin: "4px 0 0", fontSize: 13, color: "#fff" }}>
                    Clients et Agents connectés ({diag.data.clients_count})
                  </h4>

                  {diag.data.clients_count === 0 && (
                    <p style={{ color: "var(--shell-dim)", fontSize: 12.5 }}>
                      Aucun participant connecté à cette room pour le moment (en attente du robot ou du pilote).
                    </p>
                  )}

                  <div className="legend-list">
                    {diag.data.clients.map((c) => (
                      <div
                        key={c.identity}
                        className="legend-item"
                        data-testid="diagnostic-client"
                        style={{ cursor: "pointer" }}
                        onClick={() => setSel(c)}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {c.is_robot ? <IconRobot size={15} /> : <IconUsers size={15} />}
                          <strong>{c.name}</strong>
                        </span>
                        <span className="status-chip neutral" style={{ fontSize: 11 }}>
                          {c.tracks.length} piste(s)
                        </span>
                      </div>
                    ))}
                  </div>

                  {sel && (
                    <div className="card-shell" style={{ marginTop: 6, background: "rgba(216, 88, 16, 0.04)", border: "1px solid rgba(216, 88, 16, 0.2)" }}>
                      <div className="card-body" style={{ padding: 14 }}>
                        <strong>{sel.name}</strong> <span style={{ color: "var(--shell-dim)" }}>({sel.identity})</span>
                        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--shell-muted)" }}>
                          {sel.tracks.map((t, i) => (
                            <li key={i}>{t.type} / {t.source} {t.muted ? "(muet)" : ""}</li>
                          ))}
                          {sel.tracks.length === 0 && <li>Aucune piste publiée</li>}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn-shell" onClick={() => openDiag(diag.robot)}>
                <IconRefresh size={14} /> Rafraîchir
              </button>
              <button type="button" className="btn-shell primary" onClick={() => setDiag(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {integ && <IntegrationModal robot={integ} onClose={() => setInteg(null)} />}
    </>
  );
}
