import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext.jsx";
import { ADMINISTRATION_NAVIGATION } from "@/modules/module-administration/module.manifest";
import { useTheme } from "@/shared/design-system/themes";
import { evaluatePolicy } from "@/shared/kernel/permissions";
import OrganisationSwitcher from "@/components/OrganisationSwitcher.jsx";
import OscarBrand from "@/components/OscarBrand.jsx";
import {
  IconHome,
  IconBuilding,
  IconStore,
  IconUsers,
  IconShield,
  IconRobot,
  IconCpu,
  IconActivity,
  IconGrid,
  IconLogOut,
  IconMenu,
  IconPanelLeftClose,
  IconPanelLeftOpen,
  IconLayers,
  IconX,
} from "@/components/Icons.jsx";

const ICONS = {
  home: IconHome,
  building: IconBuilding,
  store: IconStore,
  users: IconUsers,
  shield: IconShield,
  robot: IconRobot,
  cpu: IconCpu,
  activity: IconActivity,
  layers: IconLayers,
};

function initials(name = "") {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "AD";
}

export default function AdminLayout() {
  const { user, permissions, logout, activeOrganisationId } = useAuth();
  const { branding } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("oscar.admin.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const items = ADMINISTRATION_NAVIGATION.filter((item) => evaluatePolicy(permissions, item.policy));
  const close = () => setOpen(false);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("oscar.admin.sidebar.collapsed", String(next));
      } catch {
        // The sidebar remains usable when browser storage is unavailable.
      }
      return next;
    });
  };

  return (
    <div className={`platform-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <button
        className="mobile-menu-toggle"
        data-testid="mobile-menu"
        aria-label="Ouvrir le menu"
        onClick={() => setOpen(true)}
      >
        <IconMenu size={20} />
      </button>

      {open && <div className="sidebar-backdrop" onClick={close} />}

      <aside className={`platform-sidebar${open ? " open" : ""}${collapsed ? " collapsed" : ""}`}>
        <div className="sidebar-top-row">
          <a className="brand" href="/" title={branding.applicationName} aria-label={`${branding.applicationName} - espaces`} onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            <OscarBrand compact={collapsed} />
          </a>
          <div className="sidebar-controls">
            <button
              className="sidebar-collapse"
              type="button"
              title={collapsed ? "Déployer la navigation" : "Réduire la navigation"}
              aria-label={collapsed ? "Déployer la navigation" : "Réduire la navigation"}
              aria-pressed={collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <IconPanelLeftOpen size={17} /> : <IconPanelLeftClose size={17} />}
            </button>
            <button className="sidebar-close" aria-label="Fermer le menu" onClick={close}>
              <IconX size={18} />
            </button>
          </div>
        </div>

        <div className="module-badge">Supervision & Opérations</div>

        <OrganisationSwitcher />

        <nav className="side-nav" data-testid="admin-nav">
          <div className="side-nav-title">Administration</div>
          {items.map((n) => {
            const Icon = ICONS[n.icon] || IconHome;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
                data-testid={`nav-${n.to.split("/").pop() || "dashboard"}`}
                title={n.label}
                aria-label={n.label}
                onClick={close}
              >
                <span className="nav-icon"><Icon size={17} /></span>
                <span className="nav-label">{n.label}</span>
              </NavLink>
            );
          })}

          <div className="side-nav-title">Espaces</div>
          <button className="nav-link" title="Changer d'espace" aria-label="Changer d'espace" onClick={() => { close(); navigate("/"); }}>
            <span className="nav-icon"><IconGrid size={17} /></span>
            <span className="nav-label">Changer d'espace</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{initials(user?.nom)}</div>
            <div className="user-chip-copy">
              <strong>{user?.nom || "Opérateur"}</strong>
              <small>{user?.email || "Compte local"}</small>
            </div>
          </div>
          <button className="nav-link" data-testid="logout" title="Déconnexion" aria-label="Déconnexion" onClick={() => { close(); logout(); }}>
            <span className="nav-icon"><IconLogOut size={16} /></span>
            <span className="nav-label">Déconnexion</span>
          </button>
        </div>
      </aside>

      <main className="platform-main" id="main-content" tabIndex={-1}>
        <Outlet key={activeOrganisationId || "global"} />
      </main>
    </div>
  );
}
