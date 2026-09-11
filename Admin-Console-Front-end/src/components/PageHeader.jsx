import React from "react";

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header-shell">
      <div className="page-header-inner">
        <div className="page-header-left">
          <h1 className="page-header-title">{title}</h1>
          {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  );
}
