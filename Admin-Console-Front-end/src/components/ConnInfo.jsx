import { useState } from "react";
import { IconCopy, IconCheck, IconExternalLink, IconKey } from "./Icons.jsx";

export default function ConnInfo({ data }) {
  const [copied, setCopied] = useState("");

  if (!data) return null;

  function copy(text, label) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  return (
    <div className="card-shell" style={{ background: "rgba(0, 0, 0, 0.35)" }}>
      <div className="card-head">
        <h3><IconKey size={16} /> Informations de connexion LiveKit</h3>
        {data.cockpit_url && (
          <a
            href={data.cockpit_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shell small primary"
            style={{ textDecoration: "none" }}
          >
            Ouvrir Cockpit <IconExternalLink size={13} />
          </a>
        )}
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="auth-label">URL Serveur LiveKit</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field-shell" readOnly value={data.livekit_url || data.url || ""} />
            <button
              type="button"
              className="btn-shell small"
              onClick={() => copy(data.livekit_url || data.url || "", "url")}
            >
              {copied === "url" ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="auth-label">Room</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="field-shell" readOnly value={data.room || ""} />
            <button
              type="button"
              className="btn-shell small"
              onClick={() => copy(data.room || "", "room")}
            >
              {copied === "room" ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </div>
        </div>

        {data.token && (
          <div>
            <label className="auth-label">Jeton d'authentification (JWT)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="field-shell"
                readOnly
                type="password"
                value={data.token}
                style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
              <button
                type="button"
                className="btn-shell small"
                onClick={() => copy(data.token, "token")}
              >
                {copied === "token" ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
