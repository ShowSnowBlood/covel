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

type PingCompletionResult = {
  text: string;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  reasoningContent?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
};

function makeHarness(
  streamEvents: readonly Record<string, unknown>[] = [
    { type: "text-delta", textDelta: "hello" },
  ],
  generateText?: (
    input: unknown,
    options: unknown,
  ) => Promise<PingCompletionResult>,
  streamError?: Error,
  principalOverride: FrostFoxPrincipal = principal,
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
          for (const event of streamEvents) {
            if (event.type === "wait-for-abort") {
              const signal = (options as { signal?: AbortSignal }).signal;
              if (signal && !signal.aborted) {
                await new Promise<void>((resolve) => {
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
                });
              }
              continue;
            }
            yield event;
          }
          if (streamError) throw streamError;
        })(),
      ...(generateText ? { generateText } : {}),
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
    c.set("frostFoxPrincipal", principalOverride);
    await next();
  });
  app.route(
    "/",
    createMiscApiRoutes(
      ai as never,
      {} as never,
      createMemoryStore(),
      frostFox,
      { deepseek: "env-key" },
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
    expect(streamCalls[0]?.options).toMatchObject({
      envApiKeys: { deepseek: "env-key" },
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

  it("falls back to a completion when the stream has no content", async () => {
    let completionCalls = 0;
    const { app } = makeHarness(
      [{ type: "done", usage: { inputTokens: 1, outputTokens: 0 } }],
      async () => {
        completionCalls += 1;
        return {
          text: "OK",
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 1 },
        };
      },
      new Error("Provider returned no content"),
    );
    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "slot-story" }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      latencyMs: number;
      ttfbMs?: number;
      usage?: { inputTokens: number; outputTokens: number };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      usage: { inputTokens: 3, outputTokens: 1 },
    });
    expect(body.latencyMs).toEqual(expect.any(Number));
    expect(body.ttfbMs).toBeUndefined();
    expect(completionCalls).toBe(1);
  });

  it("falls back to completion when streaming never emits content", async () => {
    vi.useFakeTimers();
    try {
      let completionCalls = 0;
      const { app } = makeHarness([{ type: "wait-for-abort" }], async () => {
        completionCalls += 1;
        return {
          text: "OK",
          finishReason: "stop",
          usage: { inputTokens: 2, outputTokens: 1 },
        };
      });
      const responsePromise = app.request("/api/ai/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presetId: "slot-story" }),
      });

      await vi.advanceTimersByTimeAsync(10_000);
      const response = await responsePromise;
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        usage: { inputTokens: 2, outputTokens: 1 },
      });
      expect(completionCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("falls back to completion when the stream response is not parseable", async () => {
    const generateText = vi.fn(async () => ({
      text: "OK",
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 1 },
    }));
    const { app } = makeHarness(
      [{ type: "done", usage: { inputTokens: 1, outputTokens: 0 } }],
      generateText,
      new Error("Provider returned non-JSON response (HTTP 200): <html>"),
    );

    const response = await app.request("/api/ai/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "slot-story" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      usage: { inputTokens: 2, outputTokens: 1 },
    });
    expect(generateText).toHaveBeenCalledOnce();
  });
  it("rejects an invalid browser model binding before registering an overlay", async () => {
    const { app, frostFox } = makeHarness(undefined, undefined, undefined, {
      ...principal,
      isAdmin: true,
    });
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
