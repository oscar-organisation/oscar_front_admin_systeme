export type AppErrorCategory =
  | "network"
  | "timeout"
  | "cancelled"
  | "authentication"
  | "authorization"
  | "validation"
  | "business"
  | "conflict"
  | "not-found"
  | "rate-limit"
  | "unavailable"
  | "render"
  | "configuration"
  | "unknown";

export interface AppErrorShape {
  code: string;
  category: AppErrorCategory;
  userMessage: string;
  technicalMessage?: string | undefined;
  fieldErrors?: Record<string, string> | undefined;
  status?: number | undefined;
  correlationId?: string | undefined;
  retryable: boolean;
  cause?: unknown;
}

export class AppError extends Error implements AppErrorShape {
  readonly code: string;
  readonly category: AppErrorCategory;
  readonly userMessage: string;
  readonly technicalMessage: string | undefined;
  readonly fieldErrors: Record<string, string> | undefined;
  readonly status: number | undefined;
  readonly correlationId: string | undefined;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(shape: AppErrorShape) {
    super(shape.userMessage);
    this.name = "AppError";
    this.code = shape.code;
    this.category = shape.category;
    this.userMessage = shape.userMessage;
    this.technicalMessage = shape.technicalMessage;
    this.fieldErrors = shape.fieldErrors;
    this.status = shape.status;
    this.correlationId = shape.correlationId;
    this.retryable = shape.retryable;
    this.cause = shape.cause;
  }
}
