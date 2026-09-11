import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Room, RoomEvent } from "livekit-client";

import { api } from "@/api/client.js";
import { useAuth } from "@/auth/AuthContext.jsx";
import { captureError, reportError } from "@/shared/kernel/observability";
import OrganisationSwitcher from "@/components/OrganisationSwitcher.jsx";
import {
  IconRobot,
  IconVideo,
  IconUsers,
  IconActivity,
  IconLogOut,
  IconGrid,
  IconCpu,
} from "@/components/Icons.jsx";

const STATUS = {
  idle: { chip: "neutral", label: "En attente" },
  connecting: { chip: "pending", label: "Connexion..." },
  connected: { chip: "online", label: "Connecté" },
  error: { chip: "danger", label: "Échec de connexion" },
};

function listParticipants(room) {
  return Array.from(room.remoteParticipants.values()).map((p) => ({
    identity: p.identity,
    name: p.name || p.identity,
    isRobot: (p.identity || "").startsWith("robot-"),
    tracks: p.trackPublications.size,
  }));
}

export default function OperatorConsole() {
  const { logout, activeOrganisationId, switchingOrganisation } = useAuth();
  const navigate = useNavigate();
  const [robots, setRobots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("idle");
  const [participants, setParticipants] = useState([]);
  const [logs, setLogs] = useState([]);
  const [room, setRoom] = useState(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [loadingRobots, setLoadingRobots] = useState(true);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const roomRef = useRef(null);
  const scopeGenerationRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    scopeGenerationRef.current += 1;
    const previousRoom = roomRef.current;
    roomRef.current = null;
    if (previousRoom) void previousRoom.disconnect().catch((cause) => {
      reportError(cause, { feature: "supervision", action: "scope-disconnect" });
    });
    setSelected(null);
    setStatus("idle");
    setParticipants([]);
    setHasVideo(false);
    setRoom(null);
    setLogs([]);
    setRobots([]);
    setError("");
    setLoadingRobots(true);

    api.get("/robots/assigned", { signal: controller.signal })
      .then((d) => {
        if (!controller.signal.aborted) setRobots(Array.isArray(d) ? d : []);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(captureError(cause, { feature: "supervision", action: "list-robots" }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRobots(false);
      });
    return () => controller.abort();
  }, [activeOrganisationId]);

  function addLog(msg) {
    setLogs((l) => [{ t: new Date().toLocaleTimeString("fr-FR"), msg }, ...l].slice(0, 120));
  }

  async function disconnect() {
    if (roomRef.current) {
      try {
        await roomRef.current.disconnect();
      } catch (cause) {
        reportError(cause, { feature: "supervision", action: "disconnect" });
      }
      roomRef.current = null;
    }
    setParticipants([]);
    setHasVideo(false);
  }

  async function selectRobot(r) {
    const scopeGeneration = scopeGenerationRef.current;
    await disconnect();
    if (scopeGeneration !== scopeGenerationRef.current) return;
    setSelected(r);
    setStatus("connecting");
    setLogs([]);
    setRoom(null);
    setError("");
    try {
      const s = await api.post(`/robots/${r.id}/supervise`, {});
      if (scopeGeneration !== scopeGenerationRef.current) return;
      setRoom(s.room);
      const lkRoom = new Room();
      roomRef.current = lkRoom;
      lkRoom
        .on(RoomEvent.ParticipantConnected, (p) => {
          setParticipants(listParticipants(lkRoom));
          addLog(`Client connecté : ${p.identity}`);
        })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          setParticipants(listParticipants(lkRoom));
          addLog(`Client déconnecté : ${p.identity}`);
        })
        .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
          addLog(`Piste reçue : ${track.kind} (${p.identity})`);
          if (track.kind === "video" && videoRef.current) {
            track.attach(videoRef.current);
            setHasVideo(true);
          }
          if (track.kind === "audio") {
            track.attach();
          }
          setParticipants(listParticipants(lkRoom));
        })
        .on(RoomEvent.DataReceived, (payload, p) => {
          let txt;
          try {
            txt = new TextDecoder().decode(payload);
          } catch {
            txt = "(binaire)";
          }
          addLog(`Données de ${p?.identity || "?"} : ${txt}`);
        })
        .on(RoomEvent.Disconnected, () => setStatus("idle"));

      await lkRoom.connect(s.livekit_url, s.token);
      if (scopeGeneration !== scopeGenerationRef.current) {
        await lkRoom.disconnect();
        return;
      }
      setStatus("connected");
      setParticipants(listParticipants(lkRoom));
      addLog(`Connecté à la room ${s.room}`);
    } catch (e) {
      setStatus("error");
      const message = captureError(e, { feature: "supervision", action: "connect" });
      setError(message);
      addLog(`Connexion impossible : ${message}`);
    }
  }

  useEffect(() => () => { disconnect(); }, []);

  const st = STATUS[status];

  return (
    <div className="op-wrap" data-testid="operator-page">
      <header className="op-head">
        <div>
          <h1>Supervision 2D</h1>
          <p>Vidéo, présence LiveKit et événements du robot.</p>
        </div>
        <div className="op-head-actions">
          <OrganisationSwitcher compact />
          <button className="btn-shell" onClick={() => navigate("/")}>
            <IconGrid size={15} /> Changer d'espace
          </button>
          <button className="btn-shell" data-testid="logout" onClick={logout}>
            <IconLogOut size={15} /> Déconnexion
          </button>
        </div>
      </header>

      <div className="op-body">
        {error && <div className="auth-error" role="alert">{error}</div>}
        {/* Robot list */}
        <aside className="op-robots card-shell">
          <div className="card-head">
            <h3><IconRobot size={16} /> Robots affectés</h3>
            <span className="status-chip info">{robots.length}</span>
          </div>
          <div className="card-body">
            {loadingRobots && <p className="op-empty-copy">Chargement des robots...</p>}
            {!loadingRobots && robots.length === 0 && (
              <p className="op-empty-copy">Aucun robot affecté à votre compte.</p>
            )}
            {robots.map((r) => (
              <button
                key={r.id}
                className={"op-robot" + (selected?.id === r.id ? " active" : "")}
                data-testid="operator-robot"
                disabled={switchingOrganisation || loadingRobots}
                onClick={() => selectRobot(r)}
              >
                <span className="op-robot-title">
                  <IconRobot size={16} color="var(--shell-blue)" />
                  <strong>{r.nom}</strong>
                </span>
                <span className={"status-chip " + (r.statut === "online" ? "online" : "neutral")}>
                  {r.statut}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Live viewport & Telemetry */}
        <main className="op-view">
          {!selected && (
            <div className="op-empty card-shell">
              <div className="card-body">
                <IconRobot size={36} color="var(--shell-dim)" />
                <h3>Sélectionnez un robot</h3>
                <p>
                  La connexion au flux LiveKit démarre dès la sélection.
                </p>
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="op-video-wrap">
                <video ref={videoRef} className="op-video" autoPlay playsInline muted />
                {!hasVideo && (
                  <div className="op-video-overlay" data-testid="operator-video-state">
                    <IconVideo size={48} color="var(--shell-blue)" />
                    <strong>Flux vidéo du robot</strong>
                    <span>En attente de diffusion de la caméra (robot ou simulation Isaac).</span>
                  </div>
                )}
                <div className="op-hud">
                  <span className={"status-chip " + st.chip} data-testid="operator-status">
                    {st.label}
                  </span>
                  {room && <span className="status-chip neutral">Room : {room}</span>}
                </div>
              </div>

              <div className="op-panels">
                {/* Telemetry */}
                <div className="card-shell">
                  <div className="card-head">
                    <h3><IconCpu size={16} /> {selected.nom}</h3>
                  </div>
                  <div className="card-body op-telemetry">
                    <div>
                      <strong>{selected.batterie ?? 100}%</strong>
                      <small>Batterie</small>
                    </div>
                    <div>
                      <strong>{selected.firmware || "1.0.0"}</strong>
                      <small>Firmware</small>
                    </div>
                    <div>
                      <strong>{selected.statut}</strong>
                      <small>Statut</small>
                    </div>
                    <div>
                      <strong>{participants.length}</strong>
                      <small>Clients RTC</small>
                    </div>
                  </div>
                </div>

                {/* Connected Clients */}
                <div className="card-shell">
                  <div className="card-head">
                    <h3><IconUsers size={16} /> Participants</h3>
                  </div>
                  <div className="card-body">
                    {participants.length === 0 && (
                      <p style={{ color: "var(--shell-dim)", fontSize: 12.5 }}>Aucun autre client dans la room.</p>
                    )}
                    <div className="legend-list">
                      {participants.map((p) => (
                        <div className="legend-item" key={p.identity} data-testid="operator-participant">
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {p.isRobot ? <IconRobot size={15} /> : <IconUsers size={15} />}
                            <strong>{p.name}</strong>
                          </span>
                          <strong style={{ fontSize: 11, color: "var(--shell-muted)" }}>
                            {p.tracks} piste(s)
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Logs */}
                <div className="card-shell">
                  <div className="card-head">
                    <h3><IconActivity size={16} /> Événements</h3>
                  </div>
                  <div className="card-body op-logs" data-testid="operator-logs">
                    {logs.length === 0 && <p style={{ color: "var(--shell-dim)" }}>Aucun événement.</p>}
                    {logs.map((l, i) => (
                      <div className="op-log" key={i}>
                        <time>{l.t}</time>
                        <span>{l.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
