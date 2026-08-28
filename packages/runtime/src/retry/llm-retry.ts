/**
 * Smart LLM retry helpers used by turn-executor.
 *
 * Failures that burn an entire runtime budget in one shot — hung HTTP
 * requests, streaming connections that never emit response bytes, providers
 * complicating into 5xx / rate-limit — are retried here in a bounded loop
 * that respects the outer runtime deadline. The retry strategy adds a tiny
 * perturbation to the messages on each attempt so that any provider-side KV
 * cache cannot trivially reproduce the same hang.
 *
 * Four retry triggers:
 *   - first-token-timeout: streaming call produced no response bytes before
 *     `firstTokenTimeoutMs` (default 30s) — provider socket stayed silent.
 *   - call-timeout: a streaming response stayed silent for `callTimeoutMs`,
 *     or the absolute runtime deadline was reached. Each response byte
 *     renews the inactivity window; the runtime deadline remains hard.
 *   - transient-error: AbortError / timeout / network / 5xx / RATE_LIMITED /
 *     PROVIDER_ERROR bubbling from the adapter.
 *   - tool-loop-detected: the caller reports `N` consecutive tool calls with
 *     identical `name + arguments`. Detection lives outside this module (the
 *     tool-call loop in turn-executor owns it), but a perturbation on retry
 *     is what actually breaks the loop.
 *
 * All retry errors surface as {@link LLMRetryError} so the caller can
 * distinguish "exhausted" from an unrecoverable client error.
 */

import type {
  LLMAdapter,
  LLMMessage,
  LLMResponseFormat,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
  LLMToolDefinition,
} from "../llm/llm-adapter.js";
import {
  emitLlmCalling,
  emitLlmRespondedError,
  emitLlmRespondedSuccess,
} from "../llm/llm-telemetry.js";
import { TurnAbortedError } from "../turn-executor/turn-control.js";
import { acquireLLMSlot } from "./llm-slots.js";
import {
  LLMRetryError,
  assertDeadlineNotReached,
  buildRetryPolicy,
  computeAttemptBudget,
  computeRetryBackoff,
  exhaustedError,
  extractMessage,
  isTransientError,
  perturbMessages,
  resolveRetryDeadline,
  type RetryDeadline,
  type RetryPolicy,
  type RetryReason,
} from "./retry-common.js";

// Re-export the shared retry primitives so existing import sites that pull
// these from `llm-retry.js` keep working unchanged.
export {
  LLMRetryError,
  buildRetryPolicy,
  computeRetryBackoff,
  isTransientError,
  perturbMessages,
  DEFAULT_MAX_RETRIES,
  DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  DEFAULT_LOOP_THRESHOLD,
  DEFAULT_CALL_TIMEOUT_CAP_MS,
  DEFAULT_RETRY_BACKOFF_MS,
  MAX_RETRY_BACKOFF_MS,
  MIN_CALL_TIMEOUT_MS,
} from "./retry-common.js";
export type {
  RetryDeadline,
  RetryPolicy,
  RetryReason,
} from "./retry-common.js";

// ── Tool-loop detection ─────────────────────────────────────────────

/**
 * Detect when the last `threshold` tool calls are identical. Identity is
 * `name + arguments` (arguments are JSON strings; trivial whitespace diffs
 * would count as different — that is the desired behaviour).
 *
 * `threshold` of 0 disables detection.
 */
export function detectToolLoop(
  calls: readonly { readonly name: string; readonly arguments: string }[],
  threshold: number,
): boolean {
  if (threshold <= 0) return false;
  if (calls.length < threshold) return false;
  const tail = calls.slice(-threshold);
  const first = tail[0];
  return tail.every(
    (c) => c.name === first.name && c.arguments === first.arguments,
  );
}

// ── Non-streaming retry ─────────────────────────────────────────────

export interface CallLLMWithRetryParams {
  readonly llm: LLMAdapter;
  readonly model?: string;
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly LLMToolDefinition[];
  readonly responseFormat?: LLMResponseFormat;
  readonly policy: RetryPolicy;
  /**
   * Called with the queue wait (ms) each time an attempt had to wait for an
   * LLM concurrency slot. The loop already extends its OWN deadline by the
   * wait; callers holding an enclosing deadline (the agent tool loop) use
   * this to extend theirs too — otherwise queue time still burns the loop
   * budget and a late step dies with its calls never attempted.
   */
  readonly onQueueWait?: (waitedMs: number) => void;
  /**
   * Absolute runtime deadline (ms since epoch), or a provider that returns
   * the current deadline after queue waits extend the enclosing step.
   */
  readonly deadline: RetryDeadline;
  /**
   * Optional callback fired before each retry attempt (after the first).
   * Useful for logging / tracing.
   */
  readonly onRetry?: (info: RetryInfo) => void;
  /** Emitter for llm.calling / llm.responded trace events. */
  readonly emitter?: import("../trace/turn-emitter.js").TurnEmitter;
  /** Identity for trace payload enrichment. */
  readonly runtimeId?: string;
  readonly pluginId?: string;
  /** Provider label for trace payload (e.g. 'deepseek', 'openai'). Optional. */
  readonly provider?: string;
  /**
   * Player/turn-level abort. Non-retriable: fires
   * {@link TurnAbortedError} immediately — including out of the streaming
   * salvage path, so a player abort never commits partial content.
   */
  readonly abortSignal?: AbortSignal;
}

export interface RetryInfo {
  readonly attempt: number;
  readonly reason: RetryReason;
  readonly error: unknown;
}

export async function callLLMWithRetry(
  params: CallLLMWithRetryParams,
): Promise<LLMResponse> {
  const { llm, model, messages, tools, policy, deadline, onRetry } = params;
  let effectiveDeadline = resolveRetryDeadline(deadline);
  let lastError: unknown = new Error("retry loop did not execute");
  let lastReason: RetryReason = "unknown";

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    throwIfTurnAborted(params.abortSignal);
    effectiveDeadline = Math.max(
      effectiveDeadline,
      resolveRetryDeadline(params.deadline),
    );
    assertDeadlineNotReached(effectiveDeadline, attempt, lastError);
    // Queue for a concurrency slot before arming any timers; time spent
    // queued extends the deadline — it is the gate's cost, not the runtime's.
    const slot = await acquireLLMSlot();
    let retryDelayMs = 0;
    try {
      throwIfTurnAborted(params.abortSignal);
      effectiveDeadline += slot.waitedMs;
      if (slot.waitedMs > 0) params.onQueueWait?.(slot.waitedMs);

      const budget = computeAttemptBudget(policy, effectiveDeadline);
      // A queue release and the deadline check can straddle the clock tick.
      // Do not call the provider with AbortSignal.timeout(0); surface the same
      // terminal retry error and, importantly, release the acquired slot.
      if (budget <= 0) {
        throw new LLMRetryError({
          reason: "call-timeout",
          attempts: attempt,
          cause: lastError,
          message:
            "Runtime deadline reached before LLM call could be attempted",
        });
      }
      const timeoutSignal = AbortSignal.timeout(budget);
      const signal = params.abortSignal
        ? AbortSignal.any([timeoutSignal, params.abortSignal])
        : timeoutSignal;
      const attemptMessages = perturbMessages(messages, attempt, lastReason);

      const callStart = Date.now();
      try {
        await emitLlmCalling(params.emitter, {
          runtimeId: params.runtimeId,
          pluginId: params.pluginId,
          slot: params.model,
          model: params.model,
          provider: params.provider,
          messages: attemptMessages,
          tools: params.tools,
          attempt,
        });
        const response = await llm.generate({
          model,
          messages: attemptMessages,
          tools,
          responseFormat: params.responseFormat,
          signal,
        });
        await emitLlmRespondedSuccess(params.emitter, {
          runtimeId: params.runtimeId,
          pluginId: params.pluginId,
          response,
          durationMs: Date.now() - callStart,
          attempt,
        });
        return response;
      } catch (err) {
        await emitLlmRespondedError(params.emitter, {
          runtimeId: params.runtimeId,
          pluginId: params.pluginId,
          error: err,
          durationMs: Date.now() - callStart,
          attempt,
        });
        throwIfTurnAborted(params.abortSignal);
        lastError = err;
        lastReason = isCallTimeout(err, timeoutSignal)
          ? "call-timeout"
          : isTransientError(err)
            ? "transient-error"
            : "unknown";
        if (attempt >= policy.maxRetries || lastReason === "unknown") {
          throw new LLMRetryError({
            reason: lastReason,
            attempts: attempt + 1,
            cause: err,
          });
        }
        onRetry?.({ attempt: attempt + 1, reason: lastReason, error: err });
        retryDelayMs = computeRetryBackoff(attempt + 1);
      }
    } finally {
      slot.release();
    }
    if (retryDelayMs > 0) {
      await waitBeforeRetry({
        delayMs: retryDelayMs,
        deadline: Math.max(
          effectiveDeadline,
          resolveRetryDeadline(params.deadline),
        ),
        abortSignal: params.abortSignal,
        attempt: attempt + 1,
        reason: lastReason,
        error: lastError,
      });
    }
  }

  // Unreachable; the loop either returns or throws.
  throw exhaustedError(policy, lastReason, lastError);
}

function throwIfTurnAborted(abortSignal: AbortSignal | undefined): void {
  if (abortSignal?.aborted) {
    throw new TurnAbortedError();
  }
}

async function waitBeforeRetry(args: {
  readonly delayMs: number;
  readonly deadline: number;
  readonly abortSignal?: AbortSignal;
  readonly attempt: number;
  readonly reason: RetryReason;
  readonly error: unknown;
}): Promise<void> {
  // Preserve the attempt-budget floor: a retry with no real budget is a
  // terminal failure, not a delayed failure after an unproductive sleep.
  if (args.deadline - Date.now() <= args.delayMs + 1_000) {
    throw new LLMRetryError({
      reason: args.reason,
      attempts: args.attempt,
      cause: args.error,
      message: "Runtime deadline leaves no budget for retry backoff",
    });
  }
  try {
    await sleepWithAbort(args.delayMs, args.abortSignal);
  } catch (error) {
    throwIfTurnAborted(args.abortSignal);
    throw error;
  }
}

function sleepWithAbort(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | number;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal?.reason ?? new DOMException("aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (abortSignal?.aborted) onAbort();
    else abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isCallTimeout(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    const reason = (signal as AbortSignal & { reason?: unknown }).reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? "");
    if (msg.toLowerCase().includes("timeout")) return true;
  }
  const text = extractMessage(err).toLowerCase();
  return text.includes("timeout") || text.includes("timed out");
}

// ── Streaming retry (with first-token guard) ────────────────────────

export interface StreamLLMWithRetryParams extends CallLLMWithRetryParams {
  /** Optional sink for text deltas so streaming can keep its UX. */
  readonly onDelta?: (delta: string) => void | Promise<void>;
}

export interface StreamLLMResult {
  readonly response: LLMResponse;
  readonly attempt: number;
}

/**
 * Drive a streaming LLM call with TTFB and total-call guards. Returns the
 * fully reassembled response once the stream completes (or after we fall
 * back to a single non-stream call when the stream died with no content).
 *
 * The caller is responsible for replaying deltas via `onDelta` — we forward
 * every text-delta as it arrives on the first attempt. On retry we
 * intentionally stop forwarding so the user does not see duplicate text;
 * perturbation + a fresh retry means the second stream is treated as the
 * source of truth.
 */
export async function streamLLMWithRetry(
  params: StreamLLMWithRetryParams,
): Promise<StreamLLMResult> {
  const { llm, model, messages, tools, policy, deadline, onDelta, onRetry } =
    params;
  let effectiveDeadline = resolveRetryDeadline(deadline);
  if (!llm.stream) {
    // No streaming support — fall back to non-streaming retry so callers can
    // use the same entrypoint uniformly.
    const response = await callLLMWithRetry(params);
    return { response, attempt: 0 };
  }

  let lastError: unknown = new Error("stream retry loop did not execute");
  let lastReason: RetryReason = "unknown";

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    throwIfTurnAborted(params.abortSignal);
    effectiveDeadline = Math.max(
      effectiveDeadline,
      resolveRetryDeadline(params.deadline),
    );
    assertDeadlineNotReached(effectiveDeadline, attempt, lastError);
    // Queue for a concurrency slot before arming any timers; time spent
    // queued extends the deadline — it is the gate's cost, not the runtime's.
    const slot = await acquireLLMSlot();
    if (params.abortSignal?.aborted) {
      slot.release();
      throw new TurnAbortedError();
    }
    effectiveDeadline += slot.waitedMs;
    if (slot.waitedMs > 0) {
      try {
        params.onQueueWait?.(slot.waitedMs);
      } catch (error) {
        slot.release();
        throw error;
      }
    }

    const budget = computeAttemptBudget(policy, effectiveDeadline);
    // A queue release and the deadline check can straddle the clock tick.
    // Avoid arming a zero-duration stream and release the slot immediately.
    if (budget <= 0) {
      slot.release();
      throw new LLMRetryError({
        reason: "call-timeout",
        attempts: attempt,
        cause: lastError,
        message: "Runtime deadline reached before LLM call could be attempted",
      });
    }
    // Compose four abort sources into one per-attempt signal:
    //   1. streaming inactivity timeout — renewed on every response byte
    //   2. absolute runtime deadline — never extended by provider activity
    //   3. first-byte guard — armed on attempt start, disarmed on activity
    //   4. player turn abort — forwarded from params.abortSignal below
    const callAborter = new AbortController();
    let firstActivitySeen = false;
    let callTimeoutHandle: NodeJS.Timeout | undefined;
    let ttfbHandle: NodeJS.Timeout | undefined;
    let attemptLive = true;

    const abortWithTimeout = (message: string): void => {
      if (!callAborter.signal.aborted) {
        callAborter.abort(new DOMException(message, "TimeoutError"));
      }
    };

    const armCallTimeout = (): void => {
      if (!attemptLive || callAborter.signal.aborted) return;
      clearTimeout(callTimeoutHandle);

      // `effectiveDeadline` was fixed after queue accounting above. Provider
      // activity may renew the idle window, but it must never move this hard
      // runtime ceiling.
      const remainingMs = effectiveDeadline - Date.now();
      if (remainingMs <= 0) {
        abortWithTimeout("call timeout");
        return;
      }
      callTimeoutHandle = setTimeout(
        () => abortWithTimeout("call timeout"),
        Math.min(policy.callTimeoutMs, remainingMs),
      );
    };

    // The provider adapter invokes this for every non-empty response-body
    // chunk, including bytes that only complete a partial SSE frame. Custom
    // adapters that do not expose the callback still get event-level activity
    // below, so the retry contract remains backward compatible.
    const markActivity = (byteCount: number): void => {
      if (!Number.isFinite(byteCount) || byteCount <= 0) return;
      firstActivitySeen = true;
      if (ttfbHandle !== undefined) {
        clearTimeout(ttfbHandle);
        ttfbHandle = undefined;
      }
      armCallTimeout();
    };

    const onExternalAbort = (): void => {
      callAborter.abort(new DOMException("turn aborted", "AbortError"));
    };
    params.abortSignal?.addEventListener("abort", onExternalAbort, {
      once: true,
    });

    ttfbHandle = setTimeout(() => {
      if (!firstActivitySeen) {
        abortWithTimeout("first-token timeout");
      }
    }, policy.firstTokenTimeoutMs);
    armCallTimeout();

    const cleanupAttempt = (): void => {
      attemptLive = false;
      if (callTimeoutHandle !== undefined) {
        clearTimeout(callTimeoutHandle);
        callTimeoutHandle = undefined;
      }
      if (ttfbHandle !== undefined) {
        clearTimeout(ttfbHandle);
        ttfbHandle = undefined;
      }
      params.abortSignal?.removeEventListener("abort", onExternalAbort);
    };

    const streamedToolCalls: LLMToolCall[] = [];
    let streamedContent = "";
    let streamedReasoningContent = "";
    let streamedUsage = { inputTokens: 0, outputTokens: 0 };
    let streamFinishReason: "stop" | "tool_calls" | "length" | "error" = "stop";
    const attemptMessages = perturbMessages(messages, attempt, lastReason);
    const forwardDeltas = attempt === 0; // avoid duplicate text on retry
    const streamStart = Date.now();

    let retryDelayMs = 0;
    try {
      await emitLlmCalling(params.emitter, {
        runtimeId: params.runtimeId,
        pluginId: params.pluginId,
        slot: params.model,
        model: params.model,
        provider: params.provider,
        messages: attemptMessages,
        tools: params.tools,
        attempt,
        streaming: true,
      });
      for await (const event of llm.stream({
        model,
        messages: attemptMessages,
        tools,
        signal: callAborter.signal,
        onActivity: markActivity,
      })) {
        // Backward-compatible custom adapters may not report raw bytes. An
        // emitted event is still a useful liveness signal for those adapters.
        markActivity(1);
        if (event.type === "text-delta") {
          streamedContent += event.textDelta;
          if (forwardDeltas) await onDelta?.(event.textDelta);
        } else if (event.type === "tool-call") {
          streamedToolCalls.push({
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
        } else if (event.type === "done") {
          streamFinishReason = event.finishReason as
            "stop" | "tool_calls" | "length" | "error";
          if (event.reasoningContent)
            streamedReasoningContent = event.reasoningContent;
          if (event.usage) streamedUsage = event.usage;
        }
      }

      cleanupAttempt();

      const finalResponse: LLMResponse = {
        content: streamedContent || null,
        toolCalls: streamedToolCalls,
        finishReason: streamFinishReason,
        usage: streamedUsage,
        ...(streamedReasoningContent
          ? { reasoningContent: streamedReasoningContent }
          : {}),
      };
      await emitLlmRespondedSuccess(params.emitter, {
        runtimeId: params.runtimeId,
        pluginId: params.pluginId,
        response: finalResponse,
        durationMs: Date.now() - streamStart,
        attempt,
        streaming: true,
      });
      return {
        response: finalResponse,
        attempt,
      };
    } catch (err) {
      cleanupAttempt();
      lastError = err;
      lastReason = classifyStreamError(
        err,
        callAborter.signal,
        firstActivitySeen,
      );

      // Pair every `llm.calling` with an `llm.responded` on the error path.
      // Without this, a streamed turn that fails mid-flight leaves a dangling
      // `llm.calling` in trace_events and breaks trace-viewer pairing. This
      // must run BEFORE the abort throw below so a player abort still emits
      // the paired `llm.responded`.
      await emitLlmRespondedError(params.emitter, {
        runtimeId: params.runtimeId,
        pluginId: params.pluginId,
        error: err,
        durationMs: Date.now() - streamStart,
        attempt,
        streaming: true,
      });

      // Player abort is non-retriable AND must bypass the salvage path
      // below — salvaged partial narrative would otherwise be committed.
      throwIfTurnAborted(params.abortSignal);

      // Salvage path: stream died mid-flight but we already received useful
      // content. Always prefer salvaging over retry — perturbation on a
      // retry would duplicate the partial text to the user, and partial
      // content is signal a provider-level retry cannot reproduce.
      if (streamedContent.length > 0 || streamedToolCalls.length > 0) {
        return {
          response: {
            content: streamedContent || null,
            toolCalls: streamedToolCalls,
            finishReason: "error",
            usage: streamedUsage,
            ...(streamedReasoningContent
              ? { reasoningContent: streamedReasoningContent }
              : {}),
          },
          attempt,
        };
      }

      if (attempt >= policy.maxRetries) {
        throw new LLMRetryError({
          reason: lastReason,
          attempts: attempt + 1,
          cause: err,
        });
      }
      // Retry on transient failures; surface "unknown" errors immediately —
      // an unclassified error usually means a bug in our code, not something
      // a retry can fix.
      if (lastReason === "unknown") {
        throw new LLMRetryError({
          reason: lastReason,
          attempts: attempt + 1,
          cause: err,
        });
      }
      onRetry?.({ attempt: attempt + 1, reason: lastReason, error: err });
      retryDelayMs = computeRetryBackoff(attempt + 1);
    } finally {
      slot.release();
    }
    if (retryDelayMs > 0) {
      await waitBeforeRetry({
        delayMs: retryDelayMs,
        deadline: Math.max(
          effectiveDeadline,
          resolveRetryDeadline(params.deadline),
        ),
        abortSignal: params.abortSignal,
        attempt: attempt + 1,
        reason: lastReason,
        error: lastError,
      });
    }
  }

  throw exhaustedError(policy, lastReason, lastError);
}

function classifyStreamError(
  err: unknown,
  signal: AbortSignal,
  firstActivitySeen: boolean,
): RetryReason {
  if (signal.aborted) {
    const reason = (signal as AbortSignal & { reason?: unknown }).reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? "");
    const lower = msg.toLowerCase();
    if (lower.includes("first-token")) return "first-token-timeout";
    if (lower.includes("timeout"))
      return !firstActivitySeen ? "first-token-timeout" : "call-timeout";
  }
  if (isTransientError(err)) return "transient-error";
  return "unknown";
}
