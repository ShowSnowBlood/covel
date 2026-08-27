import { describe, expect, it, vi } from "vitest";
import type { LLMAdapter, LLMResponse } from "@covel/runtime";
import type { TurnMessageRecord } from "@covel/store";
import { createMemoryStore } from "@covel/store";
import { createBootstrapCompactorRunner } from "../../src/routes/api/bootstrap/compactor.js";

function makeMessage(
  index: number,
  role: "user" | "assistant",
): TurnMessageRecord {
  return {
    id: `message-${index}`,
    sessionId: "session-request-scoped",
    turnId: `turn-${index}`,
    sourceType: role === "user" ? "player" : "runtime",
    role,
    content: `${role} ${index} `.repeat(20),
    order: index,
    createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  };
}

function response(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe("bootstrap compactor request adapter", () => {
  it("uses the turn adapter instead of the startup adapter", async () => {
    const startupGenerate = vi.fn(async () => {
      throw new Error("startup adapter must not be used");
    });
    const requestGenerate = vi.fn(async () => response("request summary"));
    const startup: LLMAdapter = { generate: startupGenerate };
    const request: LLMAdapter = { generate: requestGenerate };

    const runner = createBootstrapCompactorRunner({
      manifestCache: new Map(),
      store: createMemoryStore(),
      llmAdapter: startup,
      contextWindowOverride: 1,
    });

    const result = await runner.run(
      "session-request-scoped",
      "",
      [
        makeMessage(0, "user"),
        makeMessage(1, "assistant"),
        makeMessage(2, "user"),
        makeMessage(3, "assistant"),
        makeMessage(4, "user"),
        makeMessage(5, "assistant"),
        makeMessage(6, "user"),
        makeMessage(7, "assistant"),
      ],
      "en-US",
      undefined,
      request,
    );

    expect(result.compacted).toBe(true);
    expect(startupGenerate).not.toHaveBeenCalled();
    expect(requestGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "fast" }),
    );
  });
});
