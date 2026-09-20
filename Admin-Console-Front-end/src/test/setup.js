import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom n'expose pas toujours le stockage du navigateur (origine opaque selon
// l'URL du document). Plusieurs modules s'en servent comme cache hors ligne :
// sans ce relais, leurs tests echouent sur l'environnement et non sur le code.
if (typeof globalThis.localStorage === "undefined") {
  const creerStockage = () => {
    let donnees = new Map();
    return {
      get length() { return donnees.size; },
      key: (index) => Array.from(donnees.keys())[index] ?? null,
      getItem: (cle) => (donnees.has(String(cle)) ? donnees.get(String(cle)) : null),
      setItem: (cle, valeur) => { donnees.set(String(cle), String(valeur)); },
      removeItem: (cle) => { donnees.delete(String(cle)); },
      clear: () => { donnees = new Map(); },
    };
  };
  Object.defineProperty(globalThis, "localStorage", { writable: true, value: creerStockage() });
  Object.defineProperty(globalThis, "sessionStorage", { writable: true, value: creerStockage() });
}
