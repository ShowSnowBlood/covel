/**
 * Server-owned limits for one runtime execution.
 *
 * The policy is intentionally a partial object. An omitted field preserves the
 * runtime manifest's value (or the framework default), while an explicit field
 * applies uniformly to every runtime in a hosted deployment.
 */
export interface RuntimeExecutionPolicy {
  /** Total wall-clock budget for one runtime, in milliseconds. */
  readonly timeoutMs?: number;
  /** Maximum agent tool-loop steps. */
  readonly maxSteps?: number;
  /** Number of transient LLM retries after the first attempt. */
  readonly maxRetries?: number;
  /**
   * Wall-clock budget for one non-stream provider call, or the response-byte
   * inactivity window for a stream. Streaming activity renews the window;
   * `timeoutMs` remains the hard runtime ceiling.
   */
  readonly callTimeoutMs?: number;
  /** Maximum initial silence before the first streaming response byte. */
  readonly firstTokenTimeoutMs?: number;
  /** Identical consecutive tool calls before the loop is retried. */
  readonly loopDetectionThreshold?: number;
}

export type RuntimeExecutionPolicyField = keyof RuntimeExecutionPolicy;

export const RUNTIME_EXECUTION_POLICY_FIELDS = [
  "timeoutMs",
  "maxSteps",
  "maxRetries",
  "callTimeoutMs",
  "firstTokenTimeoutMs",
  "loopDetectionThreshold",
] as const satisfies readonly RuntimeExecutionPolicyField[];

/** Framework values shown when no administrator override is saved. */
export const RUNTIME_EXECUTION_POLICY_DEFAULTS = {
  timeoutMs: 60_000,
  maxSteps: 10,
  maxRetries: 1,
  callTimeoutMs: undefined,
  firstTokenTimeoutMs: 30_000,
  loopDetectionThreshold: 3,
} as const satisfies RuntimeExecutionPolicy;

/** Shared server/client validation bounds for administrator controls. */
export const RUNTIME_EXECUTION_POLICY_LIMITS = {
  timeoutMs: { min: 10_000, max: 900_000, step: 1_000 },
  maxSteps: { min: 1, max: 20, step: 1 },
  maxRetries: { min: 0, max: 5, step: 1 },
  callTimeoutMs: { min: 1_000, max: 900_000, step: 1_000 },
  firstTokenTimeoutMs: { min: 1_000, max: 300_000, step: 1_000 },
  loopDetectionThreshold: { min: 0, max: 20, step: 1 },
} as const;

/**
 * Parse an untrusted policy payload. Unknown keys are ignored so a future
 * client can talk to an older server without making the whole update invalid.
 * Invalid known values return null and are rejected by the API boundary.
 */
export function normalizeRuntimeExecutionPolicy(
  value: unknown,
): RuntimeExecutionPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const field of RUNTIME_EXECUTION_POLICY_FIELDS) {
    const raw = source[field];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
    const limits = RUNTIME_EXECUTION_POLICY_LIMITS[field];
    if (raw < limits.min || raw > limits.max) return null;
    result[field] = raw;
  }
  return result as RuntimeExecutionPolicy;
}
