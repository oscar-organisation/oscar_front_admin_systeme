export default function OscarBrand({ compact = false, className = "" }) {
  const base = compact ? "oscar-brand oscar-brand-compact" : "oscar-brand";
  const lightAsset = compact
    ? "/brand/oscar-symbol-light.png"
    : "/brand/oscar-logo-horizontal-light.png";
  const darkAsset = compact
    ? "/brand/oscar-symbol-dark.png"
    : "/brand/oscar-logo-horizontal-dark.png";

  return (
    <span className={`${base}${className ? ` ${className}` : ""}`} aria-label="OSCAR" translate="no">
      <img className="oscar-brand-on-dark" src={lightAsset} alt="" aria-hidden="true" translate="no" />
      <img className="oscar-brand-on-light" src={darkAsset} alt="" aria-hidden="true" translate="no" />
    </span>
  );
}
