import { ERROR_PREVIEW_MAX_CHARS } from "./constants.js";

export async function parseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    throw new Error(
      `Provider returned empty response (HTTP ${response.status} ${response.statusText})`,
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Provider returned non-JSON response (HTTP ${response.status}): ${text.slice(0, ERROR_PREVIEW_MAX_CHARS)}`,
    );
  }
}

function parseSseFrame(frame: string): Record<string, unknown> | null {
  const data = frame
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Provider returned malformed SSE payload: ${data.slice(0, ERROR_PREVIEW_MAX_CHARS)}`,
    );
  }
}

/**
 * Parse provider SSE payloads while reporting raw response-body activity.
 * The callback fires before frame parsing, so split/incomplete frames still
 * renew a caller's liveness window.
 */
export async function* iterateSsePayloads(
  response: Response,
  onActivity?: (byteCount: number) => void,
): AsyncIterable<Record<string, unknown>> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value && value.byteLength > 0) onActivity?.(value.byteLength);
      if (done) break;

      // Notify before frame parsing: a provider can send a large reasoning
      // token or a split SSE frame that contains no complete JSON payload yet.
      // The retry layer must treat those bytes as proof of life.
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = /\r?\n\r?\n|\r\r/.exec(buffer);
        if (!boundary || boundary.index === undefined) break;
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const payload = parseSseFrame(frame);
        if (payload) yield payload;
      }
    }

    buffer += decoder.decode();
    const payload = parseSseFrame(buffer);
    if (payload) yield payload;
  } finally {
    reader.releaseLock();
  }
}

export function assertSuccess(
  response: Response,
  payload: Record<string, unknown>,
  provider: string,
): void {
  if (response.ok) return;

  const errorObj = payload.error as Record<string, unknown> | undefined;
  const errorType = errorObj?.type;
  const errorMessage =
    typeof errorObj?.message === "string"
      ? errorObj.message
      : typeof payload.message === "string"
        ? payload.message
        : undefined;
  const isRateLimit =
    response.status === 429 || errorType === "rate_limit_error";

  throw new Error(
    JSON.stringify({
      name: "AiProviderError",
      code: isRateLimit ? "RATE_LIMITED" : "PROVIDER_ERROR",
      provider,
      retriable: isRateLimit || response.status >= 500,
      statusCode: response.status,
      details: errorMessage
        ? { message: errorMessage, type: errorType }
        : (errorObj ?? undefined),
    }),
  );
}

export function createStructuredOutputError(provider: string): Error {
  return new Error(
    JSON.stringify({
      name: "AiProviderError",
      code: "SCHEMA_VALIDATION_FAILED",
      provider,
      retriable: false,
    }),
  );
}

export function createUnsupportedModeError(
  provider: string,
  mode: string,
): Error {
  return new Error(
    JSON.stringify({
      name: "AiProviderError",
      code: "PROVIDER_ERROR",
      provider,
      retriable: false,
      details: { mode },
    }),
  );
}

export function appendProviderMetadata(
  formData: FormData,
  metadata: Record<string, unknown> | undefined,
): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      formData.set(key, String(value));
    }
  }
}
