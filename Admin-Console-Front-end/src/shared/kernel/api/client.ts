import { runtimeConfig } from "../../config";
import { AppError, normalizeError } from "../errors";

const ACCESS_KEY = "oscar_access";
const REFRESH_KEY = "oscar_refresh";
const SESSION_EXPIRED_EVENT = "oscar:session-expired";

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
  skipRefresh?: boolean;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

interface ApiScope {
  tenantId?: string;
  organizationId?: string;
}

let activeScope: ApiScope = {};
let refreshPromise: Promise<void> | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function setTokens(access?: string, refresh?: string): void {
  const store = storage();
  if (access) store?.setItem(ACCESS_KEY, access);
  if (refresh) store?.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  const store = storage();
  store?.removeItem(ACCESS_KEY);
  store?.removeItem(REFRESH_KEY);
}

export function getAccess(): string | null {
  return storage()?.getItem(ACCESS_KEY) || null;
}

function getRefresh(): string | null {
  return storage()?.getItem(REFRESH_KEY) || null;
}

function requestId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildHeaders(hasBody: boolean, form: boolean): Headers {
  const headers = new Headers({ Accept: "application/json", "X-Request-ID": requestId() });
  const token = getAccess();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (hasBody && !form) headers.set("Content-Type", "application/json");
  if (activeScope.tenantId) headers.set("X-Tenant-ID", activeScope.tenantId);
  if (activeScope.organizationId) headers.set("X-Organization-ID", activeScope.organizationId);
  return headers;
}

function createSignal(external: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      external?.removeEventListener("abort", abort);
    },
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response.text();
  return response.json().catch(() => null);
}

function responseError(response: Response, data: unknown): AppError {
  const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const detail = typeof record.detail === "string" ? record.detail : undefined;
  const correlationId = response.headers.get("x-request-id") || response.headers.get("x-correlation-id") || undefined;
  return normalizeError({
    status: response.status,
    detail,
    message: `HTTP ${response.status}`,
    correlationId,
    fieldErrors: typeof record.errors === "object" && record.errors !== null
      ? record.errors as Record<string, string>
      : undefined,
  });
}

async function refreshSession(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getRefresh();
  if (!refreshToken) throw normalizeError({ status: 401 });

  refreshPromise = (async () => {
    const { signal, cleanup } = createSignal(undefined, runtimeConfig.requestTimeoutMs);
    try {
      const response = await fetch(`${runtimeConfig.apiBaseUrl}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal,
      });
      const data = await parseResponse(response);
      if (!response.ok) throw responseError(response, data);
      const tokens = data as Partial<TokenResponse>;
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new AppError({
          code: "AUTH_REFRESH_INVALID_RESPONSE",
          category: "authentication",
          userMessage: "La session n’a pas pu être renouvelée. Reconnectez-vous.",
          retryable: false,
        });
      }
      setTokens(tokens.access_token, tokens.refresh_token);
    } finally {
      cleanup();
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, form, signal: externalSignal, timeoutMs = runtimeConfig.requestTimeoutMs } = options;
  const { signal, cleanup } = createSignal(externalSignal, timeoutMs);
  const hasBody = body !== undefined || form !== undefined;

  try {
    const requestInit: RequestInit = {
      method,
      headers: buildHeaders(hasBody, Boolean(form)),
      signal,
    };
    const requestBody = form || (body !== undefined ? JSON.stringify(body) : undefined);
    if (requestBody !== undefined) requestInit.body = requestBody;

    const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, requestInit);
    const data = await parseResponse(response);

    if (response.status === 401 && !options.skipRefresh && !path.startsWith("/auth/")) {
      cleanup();
      try {
        await refreshSession();
        return request<T>(method, path, { ...options, skipRefresh: true });
      } catch (error) {
        clearTokens();
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
        throw normalizeError(error);
      }
    }

    if (!response.ok) throw responseError(response, data);
    return data as T;
  } catch (error) {
    if (signal.aborted && !externalSignal?.aborted) {
      throw new AppError({
        code: "REQUEST_TIMEOUT",
        category: "timeout",
        userMessage: "Le serveur a mis trop de temps à répondre. Réessayez.",
        retryable: true,
        cause: error,
      });
    }
    throw normalizeError(error);
  } finally {
    cleanup();
  }
}

export const api = {
  base: runtimeConfig.apiBaseUrl,
  get: <T = unknown>(path: string, options?: Omit<RequestOptions, "body" | "form">) => request<T>("GET", path, options),
  post: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "form">) => request<T>("POST", path, { ...options, body }),
  put: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "form">) => request<T>("PUT", path, { ...options, body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: Omit<RequestOptions, "body" | "form">) => request<T>("PATCH", path, { ...options, body }),
  del: <T = unknown>(path: string, options?: Omit<RequestOptions, "body" | "form">) => request<T>("DELETE", path, options),
  postForm: <T = unknown>(path: string, form: FormData, options?: Omit<RequestOptions, "body" | "form">) => request<T>("POST", path, { ...options, form }),
  setTokens,
  clearTokens,
  getAccess,
  setScope: (scope: ApiScope) => { activeScope = { ...scope }; },
};

export { SESSION_EXPIRED_EVENT };
