import { AiProviderError } from "./errors.js";
import type {
  OperationMode,
  ProviderLifecycleHook,
  ProviderProtocol,
  ResolvedTarget,
  UsageSummary,
} from "./types.js";

export function targetProvider(target: ResolvedTarget): string {
  return target.preset?.provider ?? target.profile.provider;
}

export function targetModel(target: ResolvedTarget): string {
  return target.preset?.model ?? target.profile.model;
}

export function shouldFallback(
  error: AiProviderError,
  options: { allowProviderFallbackOnClientError?: boolean } = {},
): boolean {
  // A managed schedule explicitly opts into trying the next provider for
  // authentication, availability, and rate-limit failures. Malformed
  // requests and schema / configuration failures remain non-fallbackable.
  if (
    error.statusCode &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    !(
      options.allowProviderFallbackOnClientError &&
      (error.code === "PROVIDER_ERROR" || error.code === "RATE_LIMITED")
    )
  ) {
    return false;
  }
  return error.code === "RATE_LIMITED" || error.code === "PROVIDER_ERROR";
}

export function normalizeError(
  error: unknown,
  provider: string,
): AiProviderError {
  if (error instanceof AiProviderError) return error;

  const inferredStatusCode =
    error instanceof Error
      ? Number.parseInt(
          /\bHTTP\s+(\d{3})\b/i.exec(error.message)?.[1] ?? "",
          10,
        )
      : Number.NaN;
  const statusCode = Number.isFinite(inferredStatusCode)
    ? inferredStatusCode
    : undefined;

  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as {
        code?: string;
        provider?: string;
        retriable?: boolean;
        statusCode?: number;
        details?: Record<string, unknown>;
      };
      if (parsed.code && parsed.provider) {
        const detailMsg = parsed.details
          ? ` — ${typeof parsed.details.message === "string" ? parsed.details.message : JSON.stringify(parsed.details)}`
          : "";
        const parsedStatusCode =
          typeof parsed.statusCode === "number"
            ? parsed.statusCode
            : statusCode;
        return new AiProviderError({
          code: parsed.code as AiProviderError["code"],
          message: `[${parsed.provider}] HTTP ${parsedStatusCode ?? "?"}${detailMsg}`,
          provider: parsed.provider,
          retriable: Boolean(parsed.retriable),
          ...(parsedStatusCode === undefined
            ? {}
            : { statusCode: parsedStatusCode }),
          details: parsed.details,
        });
      }
    } catch {
      // Not a JSON error message.
    }
  }

  return new AiProviderError({
    code: "PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "Unknown provider error.",
    provider,
    retriable: false,
    ...(statusCode === undefined ? {} : { statusCode }),
    cause: error,
  });
}

export async function notifyStart(
  hooks: ProviderLifecycleHook[],
  provider: string,
  protocol: ProviderProtocol,
  mode: OperationMode,
  model: string,
  traceId?: string,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.onRequestStart?.({ provider, protocol, mode, model, traceId });
    } catch (err) {
      console.warn(
        `[ai-provider] Hook onRequestStart failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function notifySuccess(
  hooks: ProviderLifecycleHook[],
  provider: string,
  protocol: ProviderProtocol,
  mode: OperationMode,
  model: string,
  usage: UsageSummary | null,
  durationMs: number,
  traceId?: string,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.onRequestSuccess?.({
        provider,
        protocol,
        mode,
        model,
        usage,
        durationMs,
        traceId,
      });
    } catch (err) {
      console.warn(
        `[ai-provider] Hook onRequestSuccess failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function notifyError(
  hooks: ProviderLifecycleHook[],
  provider: string,
  protocol: ProviderProtocol,
  mode: OperationMode,
  model: string,
  error: unknown,
  durationMs: number,
  traceId?: string,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook.onRequestError?.({
        provider,
        protocol,
        mode,
        model,
        error,
        durationMs,
        traceId,
      });
    } catch (err) {
      console.warn(
        `[ai-provider] Hook onRequestError failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
