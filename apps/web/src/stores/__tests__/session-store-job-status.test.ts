import { describe, expect, it } from "vitest";
import type { SseEnvelope } from "@/services/api";
import { initialState, reducer } from "../session-store/reducer.js";
import { createSseEventHandler } from "../session-store/sse-handler.js";
import { isDurableExecutionStep } from "../session-store/execution-steps.js";
import type {
  RuntimeJobStatus,
  SessionAction,
  SessionState,
} from "../session-store/types.js";
import type { SseEventHandlerDeps } from "../session-store/sse-handler.js";

function envelope(type: string, payload: Record<string, unknown>): SseEnvelope {
  return {
    type,
    requestId: "req-1",
    traceId: "trace-1",
    sessionId: "sess-1",
    turnId: "turn-1",
    flowId: "trace-1",
    seq: 1,
    timestamp: "2026-08-28T00:00:00.000Z",
    payload,
  };
}

function makeHandler(dispatch: (action: SessionAction) => void) {
  return createSseEventHandler({
    dispatch,
    ds: {} as SseEventHandlerDeps["ds"],
    sessionIdRef: { current: "sess-1" },
    stateRef: { current: initialState },
    runtimeKindRef: { current: new Map() },
    deltaBufferRef: { current: new Map() },
    deltaRafRef: { current: null },
    lastBackfilledTurnIdRef: { current: "turn-1" },
  });
}

function jobStatus(
  sequence: number,
  overrides: Partial<RuntimeJobStatus> = {},
): RuntimeJobStatus {
  return {
    sessionId: "sess-1",
    progressScopeId: "exec-1",
    pluginId: "dice-check",
    runtimeId: "dice-check/roller",
    jobId: "dice-pool",
    state: "progress",
    progress: 70,
    message: "Dice rolled",
    sequence,
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("runtime job progress SSE", () => {
  it("stores a job update with the action envelope turn id", () => {
    let state: SessionState = initialState;
    const handle = makeHandler((action) => {
      state = reducer(state, action);
    });

    handle(envelope("job-status.updated", { ...jobStatus(1) }));

    expect(state.jobStatuses).toEqual([
      expect.objectContaining({
        jobId: "dice-pool",
        runtimeId: "dice-check/roller",
        progress: 70,
        turnId: "turn-1",
      }),
    ]);
  });

  it("ignores older updates and preserves turn correlation on subscription duplicates", () => {
    let state: SessionState = initialState;
    state = reducer(state, {
      type: "UPSERT_JOB_STATUS",
      status: jobStatus(4, { turnId: "turn-1" }),
    });
    const current = state.jobStatuses[0]!;

    const older = reducer(state, {
      type: "UPSERT_JOB_STATUS",
      status: jobStatus(3, { progress: 20 }),
    });
    expect(older).toBe(state);

    const equalDuplicate = reducer(state, {
      type: "UPSERT_JOB_STATUS",
      status: jobStatus(4, { state: "failed", turnId: undefined }),
    });
    expect(equalDuplicate).toBe(state);
    expect(equalDuplicate.jobStatuses[0]).toBe(current);

    const terminal = reducer(state, {
      type: "UPSERT_JOB_STATUS",
      status: jobStatus(5, {
        state: "succeeded",
        progress: undefined,
        message: undefined,
      }),
    });
    expect(terminal.jobStatuses[0]).toEqual(
      expect.objectContaining({ state: "succeeded", turnId: "turn-1" }),
    );
    expect(terminal.jobStatuses[0]?.progress).toBeUndefined();
    expect(terminal.jobStatuses[0]?.message).toBeUndefined();
  });
});

describe("runtime trace execution preview", () => {
  it("projects LLM and tool boundaries onto the runtime step", () => {
    let state: SessionState = initialState;
    const handle = makeHandler((action) => {
      state = reducer(state, action);
    });

    handle(
      envelope("llm.calling", {
        runtimeId: "narrator",
        pluginId: "narrator",
        model: "deepseek-chat",
      }),
    );
    expect(state.executionSteps[0]).toEqual(
      expect.objectContaining({
        runtimeId: "narrator",
        status: "llm",
        turnId: "turn-1",
      }),
    );

    handle(
      envelope("tool.calling", {
        runtimeId: "narrator",
        pluginId: "narrator",
        toolName: "runtime-done",
        label: "narrator/runtime-done",
      }),
    );
    expect(state.executionSteps[0]).toEqual(
      expect.objectContaining({
        status: "tool",
        toolName: "runtime-done",
      }),
    );
  });
});

describe("execution step persistence", () => {
  it("persists terminal rows but not live llm/tool projections", () => {
    expect(
      isDurableExecutionStep({ runtimeId: "r", pluginId: "p", status: "llm" }),
    ).toBe(false);
    expect(
      isDurableExecutionStep({ runtimeId: "r", pluginId: "p", status: "tool" }),
    ).toBe(false);
    expect(
      isDurableExecutionStep({
        runtimeId: "r",
        pluginId: "p",
        status: "completed",
      }),
    ).toBe(true);
    expect(
      isDurableExecutionStep({
        runtimeId: "r",
        pluginId: "p",
        status: "failed",
      }),
    ).toBe(true);
  });
});
