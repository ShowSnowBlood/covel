import type { ExecutionStep } from "./types.js";

export function toExecutionStepStatus(
  status: string | undefined,
): ExecutionStep["status"] {
  if (status === "running" || status === "pending") return "running";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "suspended") return "suspended";
  return "completed";
}

/**
 * Resolve the status carried by a runtime.completed terminal event.
 *
 * Some runtime paths use the generic `runtime.completed` event for skipped,
 * suspended, or post-hook-failed results. Treating every such event as a
 * successful completion loses the durable terminal state during restore.
 */
export function toRuntimeCompletedStatus(
  status: unknown,
): ExecutionStep["status"] {
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "suspended") return "suspended";
  return "completed";
}

/**
 * Persist only terminal runtime rows. LLM/tool boundary projections remain
 * in-memory so high-frequency trace events do not rewrite the execution cache.
 */
export function isDurableExecutionStep(step: ExecutionStep): boolean {
  return (
    step.status === "completed" ||
    step.status === "failed" ||
    step.status === "skipped" ||
    step.status === "suspended"
  );
}

/**
 * Project transient LLM/tool trace events onto the runtime's aggregate row.
 * These updates are intentionally in-memory only; terminal runtime events
 * remain the durable source of truth for execution-step persistence.
 */
export function createExecutionStepFromTrace(args: {
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly turnId?: string;
}): ExecutionStep | null {
  const runtimeId =
    typeof args.payload.runtimeId === "string" ? args.payload.runtimeId : "";
  if (!runtimeId) return null;
  const pluginId =
    typeof args.payload.pluginId === "string" ? args.payload.pluginId : "";
  const base: ExecutionStep = {
    runtimeId,
    pluginId,
    status: "running",
    turnId: args.turnId,
  };
  const label =
    typeof args.payload.label === "string" ? args.payload.label : undefined;
  const toolName =
    typeof args.payload.toolName === "string"
      ? args.payload.toolName
      : typeof args.payload.name === "string"
        ? args.payload.name
        : undefined;
  const detail =
    typeof args.payload.error === "string"
      ? args.payload.error
      : typeof args.payload.model === "string"
        ? args.payload.model
        : label;
  const durationMs =
    typeof args.payload.durationMs === "number"
      ? args.payload.durationMs
      : undefined;

  switch (args.eventType) {
    case "llm.calling":
      return {
        ...base,
        status: "llm",
        ...(label ? { label } : {}),
        ...(detail ? { detail } : {}),
      };
    case "llm.responded":
      return {
        ...base,
        ...(label ? { label } : {}),
        ...(detail ? { detail } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    case "tool.calling":
      return {
        ...base,
        status: "tool",
        ...(label ? { label } : {}),
        ...(toolName ? { toolName } : {}),
        ...(detail ? { detail } : {}),
      };
    case "tool.completed":
    case "tool.failed":
      return {
        ...base,
        ...(label ? { label } : {}),
        ...(toolName ? { toolName } : {}),
        ...(detail ? { detail } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      };
    default:
      return null;
  }
}

/**
 * Builds the `UPSERT_EXECUTION_STEP` payload shared by the runtime
 * completed / failed / skipped SSE branches. The terminal status is passed in
 * (each branch resolves it differently); `detail` is included only when the
 * failure carries an error string.
 */
export function createExecutionStepUpdate(args: {
  readonly payload: Record<string, unknown>;
  readonly status: ExecutionStep["status"];
  readonly turnId: string | undefined;
}): ExecutionStep {
  const { payload, status, turnId } = args;
  return {
    runtimeId: (payload.runtimeId as string) ?? "unknown",
    pluginId: (payload.pluginId as string) ?? "",
    status,
    durationMs: payload.durationMs as number | undefined,
    turnId,
    // Match the original failed branch, which always carries the `detail` key
    // (possibly undefined). Completed / skipped branches omit it entirely.
    ...(status === "failed"
      ? { detail: payload.error as string | undefined }
      : {}),
  };
}

export function buildResumedExecutionStep(
  payload: Record<string, unknown>,
  fallbackTurnId?: string,
): ExecutionStep | null {
  const runtimeId =
    typeof payload.runtimeId === "string" ? payload.runtimeId : "";
  if (!runtimeId) return null;

  return {
    runtimeId,
    pluginId: typeof payload.pluginId === "string" ? payload.pluginId : "",
    status: toExecutionStepStatus(
      typeof payload.status === "string" ? payload.status : "completed",
    ),
    turnId:
      typeof payload.turnId === "string" ? payload.turnId : fallbackTurnId,
    ...(typeof payload.durationMs === "number"
      ? { durationMs: payload.durationMs }
      : {}),
    ...(typeof payload.error === "string" ? { detail: payload.error } : {}),
  };
}
