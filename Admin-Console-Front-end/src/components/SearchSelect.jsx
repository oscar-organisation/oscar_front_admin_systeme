import { useEffect, useRef, useState } from "react";

export default function SearchSelect({ options = [], value, onChange, placeholder = "Rechercher...", testid }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const shown = options.filter((o) =>
    (o.label + " " + (o.sub || "")).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="search-select" ref={ref}>
      <input
        className="field-shell"
        data-testid={testid ? `${testid}-input` : undefined}
        placeholder={placeholder}
        value={open ? q : (selected ? selected.label : "")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { setQ(""); setOpen(true); }}
      />
      {open && (
        <div className="search-select-list">
          {shown.length === 0 && <div className="search-select-empty">Aucun résultat</div>}
          {shown.map((o) => (
            <button
              type="button"
              key={o.value}
              className="search-select-option"
              data-testid={testid ? `${testid}-option` : undefined}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.sub && <small style={{ color: "var(--shell-dim)", fontSize: 11 }}>{o.sub}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
