import { useEffect, useId, useRef, useState } from "react";

import { useAuth } from "@/auth/AuthContext.jsx";
import { IconBuilding, IconCheck, IconChevronDown, IconRefresh } from "@/components/Icons.jsx";
import { getUserErrorMessage } from "@/shared/kernel/errors";
import { organisationRoleLabel } from "@/shared/kernel/auth/organisationScope";

export default function OrganisationSwitcher({ compact = false }) {
  const {
    user,
    organisations,
    activeOrganisationId,
    activeOrganisation,
    switchingOrganisation,
    switchOrganisation,
  } = useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const menuId = useId();
  const value = activeOrganisationId || (user?.is_superadmin ? "*" : "");
  const canSwitch = user?.is_superadmin || organisations.length > 1;
  const activeLabel = value === "*" ? "Toutes les organisations" : activeOrganisation?.nom || "Aucune organisation";
  const contextLabel = value === "*"
    ? "Portée plateforme"
    : organisationRoleLabel(activeOrganisation || undefined);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleSelection(next) {
    setOpen(false);
    if (next === value) return;
    setError("");
    try {
      await switchOrganisation(next);
    } catch (cause) {
      setError(getUserErrorMessage(cause));
    }
  }

  return (
    <div
      ref={rootRef}
      className={`organisation-switcher${compact ? " compact" : ""}${open ? " open" : ""}`}
      data-demo={activeOrganisation?.is_demo || undefined}
    >
      <button
        type="button"
        className="organisation-switcher-trigger"
        disabled={switchingOrganisation || !canSwitch}
        aria-label={`Organisation active : ${activeLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="organisation-switcher"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="organisation-switcher-icon" aria-hidden="true">
          {switchingOrganisation ? <IconRefresh className="spin" size={15} /> : <IconBuilding size={15} />}
        </span>
        <span className="organisation-switcher-copy">
          <span>Organisation active</span>
          <strong>{activeLabel}</strong>
          <small id="organisation-context" title={contextLabel}>
            {contextLabel}
            {activeOrganisation?.is_demo && <span className="organisation-switcher-demo">Démo</span>}
          </small>
        </span>
        {canSwitch && <IconChevronDown className="organisation-switcher-chevron" size={14} aria-hidden="true" />}
      </button>

      {open && (
        <div className="organisation-switcher-menu" id={menuId} role="listbox" aria-label="Changer d’organisation">
          <div className="organisation-switcher-menu-title">Changer de périmètre</div>
          {user?.is_superadmin && (
            <button
              type="button"
              role="option"
              aria-selected={value === "*"}
              className={`organisation-option${value === "*" ? " selected" : ""}`}
              data-testid="organisation-option-global"
              onClick={() => handleSelection("*")}
            >
              <span className="organisation-option-mark"><IconBuilding size={15} /></span>
              <span><strong>Toutes les organisations</strong><small>Vue consolidée de la plateforme</small></span>
              {value === "*" && <IconCheck size={15} />}
            </button>
          )}
          {organisations.map((organisation) => {
            const selected = value === organisation.id;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                key={organisation.id}
                className={`organisation-option${selected ? " selected" : ""}`}
                data-testid={`organisation-option-${organisation.id}`}
                onClick={() => handleSelection(organisation.id)}
              >
                <span className="organisation-option-mark">{organisation.nom.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{organisation.nom}</strong>
                  <small>{organisationRoleLabel(organisation)}</small>
                </span>
                {organisation.is_primary && <span className="organisation-primary">Principale</span>}
                {selected && <IconCheck size={15} />}
              </button>
            );
          })}
          {!user?.is_superadmin && organisations.length === 0 && (
            <div className="organisation-switcher-empty">Aucune organisation affectée.</div>
          )}
        </div>
      )}
      {error && <span className="organisation-switcher-error" role="alert">{error}</span>}
    </div>
  );
}
