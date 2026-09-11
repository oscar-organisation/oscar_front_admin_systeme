import { AppError, type AppErrorCategory } from "./AppError";

const STATUS_CATEGORY: Partial<Record<number, AppErrorCategory>> = {
  400: "validation",
  401: "authentication",
  403: "authorization",
  404: "not-found",
  409: "conflict",
  410: "not-found",
  412: "conflict",
  422: "validation",
  429: "rate-limit",
  500: "unavailable",
  502: "unavailable",
  503: "unavailable",
  504: "timeout",
};

const STATUS_MESSAGE: Partial<Record<number, string>> = {
  400: "La demande contient des informations invalides.",
  401: "Votre session a expiré. Reconnectez-vous pour continuer.",
  403: "Vous n’avez pas l’autorisation d’effectuer cette action.",
  404: "La ressource demandée est introuvable.",
  409: "Cette action entre en conflit avec l’état actuel des données.",
  410: "Cette ressource n’est plus disponible.",
  412: "Les données ont changé. Actualisez la page avant de recommencer.",
  422: "Certains champs sont invalides. Vérifiez les informations saisies.",
  429: "Trop de demandes ont été envoyées. Réessayez dans quelques instants.",
  500: "Le service a rencontré une erreur. Aucune confirmation de réussite n’a été reçue.",
  502: "Le service est momentanément indisponible.",
  503: "Le service est momentanément indisponible.",
  504: "Le service a mis trop de temps à répondre.",
};

interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
  detail?: unknown;
  code?: string;
  correlationId?: string;
  fieldErrors?: Record<string, string>;
}

function isErrorLike(error: unknown): error is ErrorLike {
  return typeof error === "object" && error !== null;
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof DOMException && error.name === "AbortError") {
    return new AppError({
      code: "REQUEST_CANCELLED",
      category: "cancelled",
      userMessage: "La demande a été annulée.",
      technicalMessage: error.message,
      retryable: false,
      cause: error,
    });
  }

  const candidate = isErrorLike(error) ? error : {};
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const detail = typeof candidate.detail === "string" ? candidate.detail : undefined;
  const networkFailure = error instanceof TypeError && /fetch|network|réseau/i.test(error.message);

  if (networkFailure) {
    return new AppError({
      code: "NETWORK_UNAVAILABLE",
      category: "network",
      userMessage: "Le serveur est injoignable. Vérifiez la connexion puis réessayez.",
      technicalMessage: error.message,
      retryable: true,
      cause: error,
    });
  }

  return new AppError({
    code: candidate.code || (status ? `HTTP_${status}` : "UNKNOWN_ERROR"),
    category: (status && STATUS_CATEGORY[status]) || "unknown",
    userMessage: detail || (status && STATUS_MESSAGE[status]) || "Une erreur inattendue empêche de terminer l’action.",
    technicalMessage: candidate.message,
    fieldErrors: candidate.fieldErrors,
    status,
    correlationId: candidate.correlationId,
    retryable: status === undefined || status === 408 || status === 429 || status >= 500,
    cause: error,
  });
}

export function getUserErrorMessage(error: unknown): string {
  return normalizeError(error).userMessage;
}
