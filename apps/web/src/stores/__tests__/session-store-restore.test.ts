import { describe, expect, it } from "vitest";
import type { SnapshotTraceEvent } from "@covel/shared";
import { toRuntimeCompletedStatus } from "../session-store/execution-steps.js";
import { buildSnapshotExecutionSteps } from "../session-store/restore-session.js";

function traceEvent(
  type: string,
  payload: Record<string, unknown>,
  overrides: Partial<SnapshotTraceEvent> = {},
): SnapshotTraceEvent {
  return {
    type,
    turnId: "turn-1",
    payload,
    timestamp: "2026-08-30T00:00:01.000Z",
    ...overrides,
  };
}

describe("session snapshot execution-step restore", () => {
  it.each([
    ["failed", "failed"],
    ["skipped", "skipped"],
    ["suspended", "suspended"],
    ["success", "completed"],
    [undefined, "completed"],
  ] as const)("resolves runtime.completed status %s", (raw, expected) => {
    expect(toRuntimeCompletedStatus(raw)).toBe(expected);
  });

  it("preserves a failed status encoded in runtime.completed", () => {
    const steps = buildSnapshotExecutionSteps([
      traceEvent("runtime.started", {
        runtimeId: "plugin/runtime",
        pluginId: "plugin",
      }),
      traceEvent("runtime.completed", {
        runtimeId: "plugin/runtime",
        pluginId: "plugin",
        status: "failed",
        error: "provider returned 401",
        durationMs: 42,
      }),
    ]);

    expect(steps).toEqual([
      expect.objectContaining({
        runtimeId: "plugin/runtime",
        pluginId: "plugin",
        turnId: "turn-1",
        status: "failed",
        detail: "provider returned 401",
        durationMs: 42,
        startedAt: "2026-08-30T00:00:01.000Z",
      }),
    ]);
  });

  it("restores lifecycle rows persisted by EventBus with _subType", () => {
    const steps = buildSnapshotExecutionSteps([
      traceEvent(
        "event",
        {
          _subTopic: "runtime",
          _subType: "runtime.failed",
          runtimeId: "plugin/runtime",
          pluginId: "plugin",
          turnId: "turn-from-payload",
          error: "timeout",
        },
        { turnId: "" },
      ),
    ]);

    expect(steps).toEqual([
      expect.objectContaining({
        runtimeId: "plugin/runtime",
        status: "failed",
        turnId: "turn-from-payload",
        detail: "timeout",
      }),
    ]);
  });
});
