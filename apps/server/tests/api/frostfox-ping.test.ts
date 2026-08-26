import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createMemoryStore } from "@covel/store";
import {
  FrostFoxServiceError,
  type FrostFoxPrincipal,
  type FrostFoxService,
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

function makeHarness(
  streamEvents: readonly Record<string, unknown>[] = [
    { type: "text-delta", textDelta: "hello" },
  ],
): {
  app: Hono;
  frostFox: FrostFoxService;
  streamCalls: Array<{ input: unknown; options: unknown }>;
} {
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
    id: "slot-story",
    name: "Local Story Alias",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    protocol: "openai-chat-v1",
    enabled: true,
  };
  const directLocalPreset = {
    id: "local-story",
    name: "Local Story",
    provider: "openai",
    model: "gpt-5",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-chat-v1",
    enabled: true,
  };
  const presets: Array<Record<string, unknown>> = [
    localPreset,
    directLocalPreset,
  ];
  const hasPreset = (id: string) => presets.some((preset) => preset.id === id);
  const ai = {
    slotRegistry: {
      listSlots: () => ({ story: { presetId: "slot-story" } }),
      resolveSlot: (slotId: string) =>
        slotId === "story" ? "slot-story" : undefined,
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
          for (const event of streamEvents) yield event;
        })(),
    },
  };
  const frostFox = {
    sanitizeSlotOverrides: vi.fn(
      (overrides: Parameters<FrostFoxService["sanitizeSlotOverrides"]>[0]) =>
        overrides,
    ),
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

describe("FrostFox account model ping", () => {
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
    expect(streamCalls[0]?.input).toMatchObject({
      messages: [{ role: "user", content: "Reply with OK." }],
    });
    expect(streamCalls[0]?.options).toMatchObject({
      apiKeys: { "frostfox-channel-1": "derived-gateway-key" },
      parameterOverrides: {
        maxOutputTokens: 64,
        reasoningEffort: "disabled",
      },
    });
  });

  it("allows a connected account to test any configured model", async () => {
    const { app, streamCalls } = makeHarness();
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "local-story" }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      testedTarget?: { provider: string; model: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.testedTarget).toMatchObject({
      provider: "openai",
      model: "gpt-5",
    });
    expect(streamCalls).toHaveLength(1);
  });

  it("counts reasoning output as proof of provider connectivity", async () => {
    const { app, streamCalls } = makeHarness([
      { type: "reasoning-delta", reasoningDelta: "thinking" },
      { type: "done", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "slot-story" }),
    });
    const body = (await response.json()) as { ok: boolean; ttfbMs?: number };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.ttfbMs).toEqual(expect.any(Number));
    expect(
      (streamCalls[0]?.options as { signal?: AbortSignal }).signal?.aborted,
    ).toBe(true);
  });

  it("reports a deliberate no-content response instead of throwing", async () => {
    const { app } = makeHarness([{ type: "done", usage: null }]);
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "slot-story" }),
    });
    const body = (await response.json()) as { ok: boolean; error?: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: false,
      error: "Provider returned no content",
    });
  });
  it("rejects an invalid browser model binding before registering an overlay", async () => {
    const { app, frostFox } = makeHarness();
    vi.mocked(frostFox.sanitizeSlotOverrides).mockImplementationOnce(() => {
      throw new FrostFoxServiceError("frostfox_model_binding_invalid", 400);
    });
    const slotConfig = Buffer.from(
      JSON.stringify({
        slotPresetOverrides: { story: "browser-model" },
        customPresets: [
          {
            id: "browser-model",
            name: "Browser model",
            provider: "frostfox-channel-1",
            model: "remote-model",
          },
        ],
      }),
    ).toString("base64");

    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slot-config": slotConfig,
      },
      body: JSON.stringify({ presetId: "slot-story" }),
    });

    expect(response.status).toBe(400);
    expect(frostFox.sanitizeSlotOverrides).toHaveBeenCalledWith(
      expect.objectContaining({
        slotPresetOverrides: { story: "browser-model" },
      }),
      true,
    );
  });
});
