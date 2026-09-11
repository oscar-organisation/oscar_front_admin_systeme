import { AppError } from "../kernel/errors";

export type ThemeMode = "light" | "dark" | "system";

export interface RuntimeConfig {
  apiBaseUrl: string;
  cockpitUrl: string | undefined;
  basePath: string;
  applicationName: string;
  shortName: string;
  defaultThemeMode: ThemeMode;
  requestTimeoutMs: number;
  environment: string;
  version: string;
  supportEmail: string | undefined;
  enableDemoOrganisations: boolean;
}

declare global {
  interface Window {
    __OSCAR_RUNTIME_CONFIG__?: Partial<RuntimeConfig>;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function themeMode(value: unknown): ThemeMode {
  return value === "light" || value === "system" || value === "dark" ? value : "dark";
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function booleanFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

const injected = window.__OSCAR_RUNTIME_CONFIG__ || {};
const apiBaseUrl = optionalString(injected.apiBaseUrl) || optionalString(import.meta.env.VITE_API_URL);

if (!apiBaseUrl && import.meta.env.PROD) {
  throw new AppError({
    code: "CONFIG_API_URL_MISSING",
    category: "configuration",
    userMessage: "La console ne peut pas démarrer : l’adresse du service API est absente.",
    technicalMessage: "Set apiBaseUrl in runtime config or VITE_API_URL at build time.",
    retryable: false,
  });
}

export const runtimeConfig: Readonly<RuntimeConfig> = Object.freeze({
  apiBaseUrl: apiBaseUrl || "http://localhost:8000/api",
  cockpitUrl: optionalString(injected.cockpitUrl) || optionalString(import.meta.env.VITE_COCKPIT_URL),
  basePath: optionalString(injected.basePath) || optionalString(import.meta.env.BASE_URL) || "/",
  applicationName: optionalString(injected.applicationName) || optionalString(import.meta.env.VITE_APP_NAME) || "OSCAR",
  shortName: optionalString(injected.shortName) || optionalString(import.meta.env.VITE_APP_SHORT_NAME) || "OSCAR",
  defaultThemeMode: themeMode(injected.defaultThemeMode || import.meta.env.VITE_DEFAULT_THEME),
  requestTimeoutMs: positiveNumber(injected.requestTimeoutMs || import.meta.env.VITE_API_TIMEOUT_MS, 15_000),
  environment: optionalString(injected.environment) || optionalString(import.meta.env.MODE) || "development",
  version: optionalString(injected.version) || optionalString(import.meta.env.VITE_APP_VERSION) || "dev",
  supportEmail: optionalString(injected.supportEmail) || optionalString(import.meta.env.VITE_SUPPORT_EMAIL),
  enableDemoOrganisations: booleanFlag(import.meta.env.VITE_ENABLE_DEMO_ORGANISATIONS),
});
