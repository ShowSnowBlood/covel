import type { JobStatusRecord, JobStatusState } from "@covel/shared";
import type { RuntimeJobStatus } from "./types.js";

const JOB_STATUS_STATES: ReadonlySet<string> = new Set<JobStatusState>([
  "queued",
  "running",
  "progress",
  "waiting-input",
  "succeeded",
  "failed",
  "cancelled",
]);

export interface RuntimeJobStatusEnvelopeIdentity {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly timestamp: string;
}

/**
 * Validate the wire payload once before it enters the session reducer. The
 * action-stream envelope supplies the authoritative turn correlation; a
 * subscription event may instead carry an optional payload turnId.
 */
export function parseRuntimeJobStatus(
  payload: Readonly<Record<string, unknown>>,
  identity: RuntimeJobStatusEnvelopeIdentity,
): RuntimeJobStatus | null {
  const progressScopeId = payload.progressScopeId;
  const pluginId = payload.pluginId;
  const runtimeId = payload.runtimeId;
  const jobId = payload.jobId;
  const state = payload.state;
  const sequence = payload.sequence;

  if (
    typeof progressScopeId !== "string" ||
    progressScopeId.length === 0 ||
    typeof pluginId !== "string" ||
    pluginId.length === 0 ||
    typeof runtimeId !== "string" ||
    runtimeId.length === 0 ||
    typeof jobId !== "string" ||
    jobId.length === 0 ||
    typeof state !== "string" ||
    !JOB_STATUS_STATES.has(state) ||
    !Number.isSafeInteger(sequence) ||
    (sequence as number) < 0
  ) {
    return null;
  }

  const record: JobStatusRecord = {
    sessionId: identity.sessionId,
    progressScopeId,
    pluginId,
    runtimeId,
    jobId,
    state: state as JobStatusState,
    sequence: sequence as number,
    createdAt:
      typeof payload.createdAt === "string" && payload.createdAt.length > 0
        ? payload.createdAt
        : identity.timestamp,
    ...(typeof payload.progress === "number" &&
    Number.isFinite(payload.progress) &&
    payload.progress >= 0 &&
    payload.progress <= 100
      ? { progress: payload.progress }
      : {}),
    ...(typeof payload.message === "string"
      ? { message: payload.message }
      : {}),
    ...(payload.data !== undefined
      ? { data: payload.data as JobStatusRecord["data"] }
      : {}),
  };
  const turnId =
    identity.turnId ??
    (typeof payload.turnId === "string" && payload.turnId.length > 0
      ? payload.turnId
      : undefined);
  return turnId ? { ...record, turnId } : record;
}

export function runtimeJobStatusKey(status: RuntimeJobStatus): string {
  return `${status.progressScopeId}|${status.pluginId}|${status.runtimeId}|${status.jobId}`;
}
