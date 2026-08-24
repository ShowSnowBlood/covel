import { describe, expect, it } from "vitest";
import {
  createGatewayAdapter,
  type GatewayLike,
} from "../src/llm/gateway-llm-adapter.js";

describe("createGatewayAdapter target resolution", () => {
  it("resolves the trace identity with the same request-scoped slot config", () => {
    const calls: Array<{
      slot: string | undefined;
      options: Parameters<GatewayLike["resolveSlot"]>[1];
    }> = [];
    const gateway: GatewayLike = {
      resolveSlot(slot, options) {
        calls.push({ slot, options });
        return { provider: "deepseek-proxy", model: "deepseek-chat" };
      },
      async generateText() {
        throw new Error("unused");
      },
    };
    const slotOverrides = {
      slotPresetOverrides: { story: "custom-story" },
    };
    const adapter = createGatewayAdapter(gateway, {
      apiKeys: { "deepseek-proxy": "request-key" },
      envApiKeys: { deepseek: "env-key" },
      slotOverrides,
    });

    expect(adapter.resolveTarget?.("story")).toEqual({
      provider: "deepseek-proxy",
      model: "deepseek-chat",
    });
    expect(calls).toEqual([
      {
        slot: "story",
        options: {
          apiKeys: { "deepseek-proxy": "request-key" },
          envApiKeys: { deepseek: "env-key" },
          slotOverrides,
          fallbackTag: "text",
        },
      },
    ]);
  });

  it("returns undefined when slot resolution fails", () => {
    const gateway: GatewayLike = {
      resolveSlot() {
        throw new Error("preset not found");
      },
      async generateText() {
        throw new Error("unused");
      },
    };
    const adapter = createGatewayAdapter(gateway);

    expect(adapter.resolveTarget?.("missing")).toBeUndefined();
  });
});
