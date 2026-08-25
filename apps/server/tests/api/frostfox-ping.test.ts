import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createMemoryStore } from "@covel/store";
import type {
  FrostFoxService,
  FrostFoxPrincipal,
} from "../../src/frostfox/service.js";
import { createMiscApiRoutes } from "../../src/routes/misc-api.js";

const originalTier = process.env.DEPLOYMENT_TIER;
const originalOperatorToken = process.env.COVEL_DESKTOP_REST_TOKEN;

const principal: FrostFoxPrincipal = {
  localUserId: "local-user",
  routerAccountId: "router-account",
  accountName: "Player",
  balance: 12,
  credentialState: "active",
  lastVerifiedAt: "2026-08-25T00:00:00.000Z",
};

function makeHarness() {
  const streamCalls: Array<{ input: unknown; options: unknown }> = [];
  const managedPreset = {
    id: "managed-story",
    name: "Managed Story",
    provider: "frostfox-channel-1",
    model: "openai/gpt-5.6-sol",
    baseUrl: "https://market.example/v1",
    protocol: "openai-chat-v1",
  };
  const localPreset = {
    id: "local-story",
    name: "Local Story",
    provider: "openai",
    model: "gpt-5",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-chat-v1",
    enabled: true,
  };
  const presets: Array<Record<string, unknown>> = [localPreset];
  const hasPreset = (id: string) => presets.some((preset) => preset.id === id);
  const ai = {
    slotRegistry: {
      listSlots: () => ({ story: { presetId: "local-story" } }),
      resolveSlot: (slotId: string) =>
        slotId === "story" ? "local-story" : undefined,
      listSlotsByTag: () => [],
    },
    presetRegistry: {
      listPresets: () => presets,
      hasPreset,
      addPreset: (preset: Record<string, unknown>) => presets.push(preset),
      removePreset: (id: string) => {
        const index = presets.findIndex((preset) => preset.id === id);
        if (index >= 0) presets.splice(index, 1);
      },
    },
    providerRegistry: {
      resolve: () => ({
        config: { baseUrl: "https://market.example/v1" },
        protocol: "openai-chat-v1",
      }),
    },
    gateway: {
      streamText: (input: unknown, options: unknown) =>
        (async function* () {
          streamCalls.push({ input, options });
          yield { type: "text-delta", textDelta: "hello" };
        })(),
    },
  };
  const frostFox = {
    prepareAiContext: vi.fn(async () => ({
      principal,
      apiKeys: { "frostfox-channel-1": "derived-gateway-key" },
      managedSlotDefaults: {
        slotPresetOverrides: { story: "managed-story" },
        customPresets: [managedPreset],
      },
    })),
  } as unknown as FrostFoxService;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("frostFoxPrincipal", principal);
    await next();
  });
  app.route(
    "/",
    createMiscApiRoutes(
      ai as never,
      {} as never,
      createMemoryStore(),
      frostFox,
    ),
  );
  return { app, frostFox, streamCalls };
}

beforeEach(() => {
  process.env.DEPLOYMENT_TIER = "commercial";
  process.env.COVEL_DESKTOP_REST_TOKEN = "operator-secret";
});

afterEach(() => {
  if (originalTier === undefined) delete process.env.DEPLOYMENT_TIER;
  else process.env.DEPLOYMENT_TIER = originalTier;
  if (originalOperatorToken === undefined)
    delete process.env.COVEL_DESKTOP_REST_TOKEN;
  else process.env.COVEL_DESKTOP_REST_TOKEN = originalOperatorToken;
});

describe("FrostFox managed model ping", () => {
  it("allows a connected account to test its managed slot without operator auth", async () => {
    const { app, frostFox, streamCalls } = makeHarness();
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "slot-story" }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      testedTarget?: { provider: string; model: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.testedTarget).toMatchObject({
      provider: "frostfox-channel-1",
      model: "openai/gpt-5.6-sol",
    });
    expect(frostFox.prepareAiContext).toHaveBeenCalledWith(principal);
    expect(streamCalls[0]?.options).toMatchObject({
      apiKeys: { "frostfox-channel-1": "derived-gateway-key" },
    });
  });

  it("does not let an account probe a local provider through the managed route", async () => {
    const { app, streamCalls } = makeHarness();
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "local-story" }),
    });
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(403);
    expect(body.code).toBe("frostfox_managed_model_required");
    expect(streamCalls).toHaveLength(0);
  });
});
