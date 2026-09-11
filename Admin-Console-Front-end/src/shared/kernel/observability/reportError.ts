import { normalizeError } from "../errors";

export interface ErrorContext {
  route?: string;
  feature?: string;
  action?: string;
  environment?: string;
  version?: string;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const normalized = normalizeError(error);
  const safeEvent = {
    code: normalized.code,
    category: normalized.category,
    status: normalized.status,
    correlationId: normalized.correlationId,
    retryable: normalized.retryable,
    route: context.route,
    feature: context.feature,
    action: context.action,
    environment: context.environment,
    version: context.version,
  };

  // This adapter is the single handoff point for Sentry/OpenTelemetry later.
  console.error("[oscar.frontend.error]", safeEvent);
}

export function captureError(error: unknown, context: ErrorContext = {}): string {
  reportError(error, context);
  return normalizeError(error).userMessage;
}
