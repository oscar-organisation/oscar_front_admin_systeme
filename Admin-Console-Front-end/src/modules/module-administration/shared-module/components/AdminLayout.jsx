import { Fragment, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext.jsx";
import { consoleNavigation } from "@/app/module-registry";
import { useTheme } from "@/shared/design-system/themes";
import { evaluatePolicy } from "@/shared/kernel/permissions";
import OrganisationSwitcher from "@/components/OrganisationSwitcher.jsx";
import OscarBrand from "@/components/OscarBrand.jsx";
import {
  IconHome,
  IconHistory,
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
  IconLayers,
  IconBlocks,
  IconChevronLeft,
  IconChevronRight,
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
  history: IconHistory,
  layers: IconLayers,
  blocks: IconBlocks,
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
  const items = consoleNavigation.filter((item) => evaluatePolicy(permissions, item.policy));
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
        <button
          className="sidebar-collapse"
          type="button"
          title={collapsed ? "Déployer la navigation" : "Réduire la navigation"}
          aria-label={collapsed ? "Déployer la navigation" : "Réduire la navigation"}
          aria-pressed={collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
        </button>
        <div className="sidebar-top-row">
          <a className="brand" href="/" title={branding.applicationName} aria-label={`${branding.applicationName} - espaces`} onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            <OscarBrand compact={collapsed} />
          </a>
          <div className="sidebar-controls">
            <button className="sidebar-close" aria-label="Fermer le menu" onClick={close}>
              <IconX size={18} />
            </button>
          </div>
        </div>

        <div className="module-badge">Supervision & Opérations</div>

        <OrganisationSwitcher />

        <nav className="side-nav" data-testid="admin-nav">
          <div className="side-nav-title">Administration</div>
          {items.map((n, index) => {
            const Icon = ICONS[n.icon] || IconHome;
            return (
              <Fragment key={n.to}>
                {index > 0 && items[index - 1]?.section !== n.section && (
                  <div className="side-nav-divider" aria-hidden="true" />
                )}
                <NavLink
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
              </Fragment>
            );
          })}

          <div className="side-nav-title">Espaces</div>
          <button className="nav-link" title="Changer d'espace" aria-label="Changer d'espace" onClick={() => { close(); navigate("/"); }}>
            <span className="nav-icon"><IconGrid size={17} /></span>
            <span className="nav-label">Changer d'espace</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          {/* La pastille porte le compte : c'est la qu'on le cherche
              instinctivement, et le survol l'annonce comme un lien. Une entree
              « Mon compte » juste en dessous doublait la meme destination. */}
          <NavLink
            to="/admin/compte"
            className={({ isActive }) => `user-chip user-chip-link${isActive ? " active" : ""}`}
            title="Mon compte"
            data-testid="nav-account"
            onClick={close}
          >
            <div className="avatar">{initials(user?.nom)}</div>
            <div className="user-chip-copy">
              <strong>{user?.nom || "Opérateur"}</strong>
              <small>{user?.email || "Compte local"}</small>
            </div>
          </NavLink>
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
