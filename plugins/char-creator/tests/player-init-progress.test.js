import { describe, expect, it, vi } from "vitest";
import handler from "../runtimes/player-init/handler.js";

function makeContext(overrides = {}) {
  return {
    sessionId: "sess-1",
    turnId: "turn-1",
    locale: "en-US",
    inputs: {
      worldSchema: {
        value: {
          attributes: [
            { id: "background", type: "string", name: "Background" },
          ],
        },
      },
      opening: { value: "" },
    },
    ...overrides,
  };
}

describe("char-creator player-init progress", () => {
  it("reports waiting-input while building the opening form", async () => {
    const report = vi.fn().mockResolvedValue(undefined);

    const result = await handler(makeContext({ progress: { report } }));

    expect(result.value.preGameDone).toBe(false);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls.map(([effect]) => effect.state)).toEqual([
      "running",
      "waiting-input",
    ]);
    expect(report.mock.calls.map(([effect]) => effect.sequence)).toEqual([
      0, 2,
    ]);
    expect(
      report.mock.calls.every(([effect]) => effect.jobId === "player-init"),
    ).toBe(true);
  });

  it("continues building the form when progress reporting fails", async () => {
    const report = vi.fn().mockRejectedValue(new Error("progress unavailable"));

    await expect(
      handler(makeContext({ progress: { report } })),
    ).resolves.toMatchObject({ value: { preGameDone: false } });
  });
});
