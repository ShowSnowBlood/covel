import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiStack } from "../../src/ai-setup.js";
import {
  deriveFrostFoxGatewayKey,
  FrostFoxService,
  type FrostFoxHostEnvironment,
} from "../../src/frostfox/service.js";
import {
  createMemoryCredentialStore,
  openSecret,
  sealSecret,
} from "../../src/frostfox/credentials.js";
const CLIENT_SECRET = "ffsc_test_secret";
const CREDENTIAL_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_KEY = "ffak_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CHANNEL_ID = "01a031bd-3263-72eb-802b-419902b8165f";

const HOST_ENV: FrostFoxHostEnvironment = {
  storeBackend: "sqlite",
  databaseUrl: undefined,
  sqlitePath: ":memory:",
  deploymentTier: "commercial",
};

const SOURCE = {
  COVEL_FROSTFOX_SAAS_ENABLED: "1",
  COVEL_FROSTFOX_ROUTER_BASE_URL: "https://market.example",
  COVEL_FROSTFOX_CLIENT_ID: "covel",
  COVEL_FROSTFOX_CLIENT_SECRET: CLIENT_SECRET,
  COVEL_FROSTFOX_CALLBACK_URL: "https://covel.example/auth/frostfox/callback",
  COVEL_FROSTFOX_CREDENTIAL_KEY: CREDENTIAL_KEY,
};

const services: FrostFoxService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  vi.restoreAllMocks();
});

describe("FrostFox first-party SaaS", () => {
  it("matches the protocol v2 Gateway-key vector", () => {
    expect(deriveFrostFoxGatewayKey(ACCOUNT_KEY, "frostfox-engine")).toBe(
      "sk-ff-J8pedIxw2vqiB3Smv6kstCQaXlfOBHIXFGLBJm7RU_M",
    );
  });

  it("binds an account and routes model discovery through the selected channel", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let accountAvailable = true;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/account/v1/saas/client-config")) {
          return json({
            protocolVersion: "2.0",
            clientId: "covel",
            displayName: "Covel",
            callbackUrl: "https://covel.example/auth/frostfox/callback",
            channelSelectorHeader: "X-FrostFox-Channel-Id",
            configurationVersion: "1970-01-01T00:00:00.0000001+00:00",
            channelMappings: [
              {
                channelKey: "deepseek",
                routerChannelId: CHANNEL_ID,
                routerChannelName: "deepseek",
                routerChannelDisplayName: "DeepSeek",
                enabled: true,
              },
            ],
          });
        }
        if (url.endsWith("/api/account/v1/saas/exchange")) {
          return json({ accountKey: ACCOUNT_KEY });
        }
        if (url.endsWith("/api/account/v1/me")) {
          return accountAvailable
            ? json({ id: "account-1", name: "Player One", balance: 42.5 })
            : json({ error: "invalid_account_key" }, 401);
        }
        if (url.endsWith("/v1/models")) {
          return json({
            object: "list",
            data: [
              { id: "openai/gpt-5.6-sol", name: "GPT 5.6" },
              { id: "openai/gpt-5.6-sol", name: "duplicate" },
            ],
          });
        }
        return json({ error: { code: "not_found" } }, 404);
      },
    );

    const ai = createAiStack();
    const service = await FrostFoxService.create({
      env: HOST_ENV,
      ai,
      source: SOURCE,
      fetchImpl: fetchImpl as typeof fetch,
      credentialStore: createMemoryCredentialStore(),
    });
    expect(service).not.toBeNull();
    services.push(service!);

    const start = await service!.startAuthorization();
    const authorizeUrl = new URL(start.redirectUrl);
    expect(authorizeUrl.origin).toBe("https://market.example");
    expect(authorizeUrl.pathname).toBe("/saas/authorize");
    expect(authorizeUrl.searchParams.get("codeChallengeMethod")).toBe("S256");
    expect(authorizeUrl.searchParams.get("state")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    const connected = await service!.completeAuthorization({
      code: "ffac_test_code",
      state: authorizeUrl.searchParams.get("state")!,
      transactionToken: start.transactionToken,
      currentSessionToken: undefined,
    });
    expect(connected.principal).toMatchObject({
      routerAccountId: "account-1",
      accountName: "Player One",
      balance: 42.5,
      credentialState: "active",
    });
    expect(JSON.stringify(connected.principal)).not.toContain("ffak_");
    expect(await service!.resolvePrincipal(connected.sessionToken)).toEqual(
      connected.principal,
    );
    expect(await service!.getProgression(connected.principal)).toEqual({
      completedLevel: 0,
      unlockedLevel: 1,
      totalLevels: 3,
      updatedAt: null,
    });
    await expect(
      service!.completeLevel(connected.principal, "haruka-academy"),
    ).rejects.toMatchObject({
      code: "frostfox_level_locked",
      status: 409,
    });
    expect(
      await service!.completeLevel(connected.principal, "mistport"),
    ).toMatchObject({ completedLevel: 1, unlockedLevel: 2, totalLevels: 3 });
    expect(
      await service!.completeLevel(connected.principal, "mistport"),
    ).toMatchObject({ completedLevel: 1, unlockedLevel: 2 });
    expect(
      await service!.completeLevel(connected.principal, "haruka-academy"),
    ).toMatchObject({ completedLevel: 2, unlockedLevel: 3 });

    const context = await service!.prepareAiContext(connected.principal);
    const providerId = service!.clientConfig.providers()[0]!.providerId;
    expect(context?.apiKeys[providerId]).toBe(
      deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel"),
    );
    const managedPresetId =
      context?.managedSlotDefaults?.slotPresetOverrides?.story;
    expect(managedPresetId).toMatch(/^frostfox-managed-[0-9a-f]{24}$/);
    expect(context?.managedSlotDefaults?.slotPresetOverrides).toEqual({
      story: managedPresetId,
      plugin: managedPresetId,
      default: managedPresetId,
    });
    expect(context?.managedSlotDefaults?.customPresets).toEqual([
      expect.objectContaining({
        id: managedPresetId,
        provider: providerId,
        baseUrl: "https://market.example/v1",
        model: "deepseek-v4-flash",
        protocol: "openai-chat-v1",
      }),
    ]);
    const resolvedStory = ai.gateway.resolveSlot("story", {
      apiKeys: context!.apiKeys,
      slotOverrides: context!.managedSlotDefaults,
    });
    expect(resolvedStory).toMatchObject({
      presetId: managedPresetId,
      provider: providerId,
      protocol: "openai-chat-v1",
      baseUrl: "https://market.example/v1",
      apiKey: deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel"),
      model: "deepseek-v4-flash",
      headers: { "X-FrostFox-Channel-Id": CHANNEL_ID },
    });

    const models = await service!.listModels(connected.principal);
    expect(models.channels).toEqual([
      expect.objectContaining({
        channelKey: "deepseek",
        providerId,
        models: [{ id: "openai/gpt-5.6-sol", name: "GPT 5.6" }],
      }),
    ]);
    const modelRequest = requests.find((request) =>
      request.url.endsWith("/v1/models"),
    );
    expect(modelRequest?.init?.headers).toMatchObject({
      authorization: `Bearer ${deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel")}`,
      "X-FrostFox-Channel-Id": CHANNEL_ID,
    });

    await expect(
      service!.completeAuthorization({
        code: "ffac_test_code",
        state: authorizeUrl.searchParams.get("state")!,
        transactionToken: start.transactionToken,
        currentSessionToken: connected.sessionToken,
      }),
    ).rejects.toMatchObject({
      code: "frostfox_login_transaction_invalid",
    });

    accountAvailable = false;
    await service!.handleGatewayUnauthorized(connected.principal);
    expect(
      await service!.resolvePrincipal(connected.sessionToken),
    ).toMatchObject({
      credentialState: "recovery_required",
    });

    await service!.unbind(connected.principal);
    expect(await service!.resolvePrincipal(connected.sessionToken)).toBeNull();
  });

  it("rejects a client-config snapshot for another callback", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        protocolVersion: "2.0",
        clientId: "covel",
        displayName: "Covel",
        callbackUrl: "https://attacker.example/callback",
        channelSelectorHeader: "X-FrostFox-Channel-Id",
        configurationVersion: "1",
        channelMappings: [],
      }),
    );
    await expect(
      FrostFoxService.create({
        env: HOST_ENV,
        ai: createAiStack(),
        source: SOURCE,
        fetchImpl: fetchImpl as typeof fetch,
        credentialStore: createMemoryCredentialStore(),
      }),
    ).rejects.toThrow("client-config callbackUrl mismatch");
  });

  it("authenticates credential envelopes against their binding identity", () => {
    const key = Buffer.alloc(32, 7);
    const sealed = sealSecret("ffak_secret", key, "binding\naccount-1");
    expect(openSecret(sealed, key, "binding\naccount-1")).toBe("ffak_secret");
    expect(() => openSecret(sealed, key, "binding\naccount-2")).toThrow();
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
