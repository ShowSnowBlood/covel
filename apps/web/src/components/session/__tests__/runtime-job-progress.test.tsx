import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PackageSummary } from "@/services/api.js";
import {
  SessionActionsContext,
  SessionStateContext,
  type SessionActions,
} from "@/stores/session-store/context.js";
import { initialState } from "@/stores/session-store/reducer.js";
import type {
  RuntimeJobStatus,
  SessionState,
} from "@/stores/session-store/types.js";
import { RuntimeJobProgress } from "../runtime-job-progress.js";

const actions = {} as SessionActions;

function renderWithState(state: SessionState): void {
  render(
    <SessionActionsContext.Provider value={actions}>
      <SessionStateContext.Provider value={state}>
        <RuntimeJobProgress />
      </SessionStateContext.Provider>
    </SessionActionsContext.Provider>,
  );
}

function job(overrides: Partial<RuntimeJobStatus> = {}): RuntimeJobStatus {
  return {
    sessionId: "session-1",
    progressScopeId: "execution-1",
    pluginId: "dice-check",
    runtimeId: "dice-check/roller",
    jobId: "dice-pool",
    state: "progress",
    progress: 70,
    message: "Dice rolled",
    sequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    turnId: "turn-1",
    ...overrides,
  };
}

describe("RuntimeJobProgress", () => {
  it("renders the latest job status and accessible progress value", () => {
    const packages = [
      {
        name: "dice-check",
        displayName: { "en-US": "Dice Check" },
        enabled: true,
      } as PackageSummary,
    ];
    renderWithState({
      ...initialState,
      packages,
      jobStatuses: [job()],
    });

    expect(screen.getByTestId("runtime-job-progress")).toBeTruthy();
    expect(screen.getByText("Dice Check / roller")).toBeTruthy();
    expect(screen.getByText("Dice rolled")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "70",
    );
  });

  it("keeps only the current turn while retaining uncorrelated jobs", () => {
    renderWithState({
      ...initialState,
      jobStatuses: [
        job({ jobId: "old", turnId: "turn-old" }),
        job({ jobId: "current", turnId: "turn-current" }),
        job({ jobId: "background", turnId: undefined }),
      ],
    });

    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("current")).toBeTruthy();
    expect(screen.getByText("background")).toBeTruthy();
  });

  it("renders instant turn dispatching state when executing is true without active jobs", () => {
    renderWithState({
      ...initialState,
      executing: true,
      jobStatuses: [],
    });

    expect(screen.getByTestId("runtime-job-progress")).toBeTruthy();
    expect(screen.getByText("turn")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("renders instant dispatching state when executing is true and only completed jobs exist", () => {
    renderWithState({
      ...initialState,
      executing: true,
      jobStatuses: [
        job({ jobId: "previous-complete", state: "succeeded" }),
      ],
    });

    expect(screen.getByTestId("runtime-job-progress")).toBeTruthy();
    expect(screen.getByText("turn")).toBeTruthy();
  });

  it("returns null when not executing and jobStatuses is empty", () => {
    renderWithState({
      ...initialState,
      executing: false,
      jobStatuses: [],
    });

    expect(screen.queryByTestId("runtime-job-progress")).toBeNull();
  });
});
