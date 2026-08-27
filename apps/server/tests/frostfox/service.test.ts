import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiStack } from "../../src/ai-setup.js";
import {
  deriveFrostFoxGatewayKey,
  FrostFoxService,
  type FrostFoxHostEnvironment,
  type FrostFoxPrincipal,
} from "../../src/frostfox/service.js";
import {
  createFrostFoxCredentialStore,
  createMemoryCredentialStore,
  openSecret,
  sealSecret,
  type FrostFoxBinding,
} from "../../src/frostfox/credentials.js";
const CLIENT_SECRET = "ffsc_test_secret";
const CREDENTIAL_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ACCOUNT_KEY = "ffak_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CHANNEL_ID = "01a031bd-3263-72eb-802b-419902b8165f";
const IMAGE_CHANNEL_ID = "01a031bd-3263-72eb-802b-419902b8165e";

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
  vi.unstubAllGlobals();
});

async function createBoundService(
  isAdmin: boolean,
  options: { staleImageDefault?: boolean; imageCatalog?: boolean } = {},
) {
  const store = createMemoryCredentialStore();
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/account/v1/saas/client-config")) {
      return json({
        protocolVersion: "2.0",
        clientId: "covel",
        displayName: "Covel",
        callbackUrl: SOURCE.COVEL_FROSTFOX_CALLBACK_URL,
        channelSelectorHeader: "X-FrostFox-Channel-Id",
        configurationVersion: "test-schedule-v1",
        channelMappings: [
          {
            channelKey: "story",
            routerChannelId: CHANNEL_ID,
            routerChannelName: "story",
            routerChannelDisplayName: "Story",
            enabled: true,
          },
        ],
      });
    }
    if (url.endsWith("/v1/models")) {
      return json({
        object: "list",
        data: [
          { id: "story-primary", name: "Story Primary" },
          { id: "story-backup", name: "Story Backup" },
          ...(options.imageCatalog
            ? [
                {
                  id: "router-image",
                  name: "Router Image",
                  mode: "image_generation",
                },
              ]
            : []),
        ],
      });
    }
    return json({ error: "not_found" }, 404);
  });
  const ai = createAiStack();
  if (options.staleImageDefault) {
    ai.config.presets.push({
      id: "slot-image",
      name: "Stale local image",
      provider: "story",
      model: "stale-local-image",
      tier: "medium",
      supportedModes: ["image"],
      enabled: true,
      defaultSlot: "image",
      tag: "image",
    });
  }
  const service = await FrostFoxService.create({
    env: HOST_ENV,
    ai,
    source: SOURCE,
    fetchImpl: fetchImpl as typeof fetch,
    credentialStore: store,
  });
  if (!service) throw new Error("expected FrostFox test service");
  services.push(service);

  const now = new Date().toISOString();
  const issuer = SOURCE.COVEL_FROSTFOX_ROUTER_BASE_URL;
  const routerAccountId = isAdmin ? "admin-account" : "player-account";
  const localUserId = isAdmin ? "admin-local" : "player-local";
  const binding: FrostFoxBinding = {
    localUserId,
    issuer,
    routerAccountId,
    accountName: isAdmin ? "Admin" : "Player",
    balance: 10,
    isAdmin,
    accountKeyCiphertext: sealSecret(
      ACCOUNT_KEY,
      Buffer.from(CREDENTIAL_KEY, "base64url"),
      `binding\n${issuer}\n${routerAccountId}\ncovel`,
    ),
    credentialState: "active",
    credentialGenerationUpdatedAt: now,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await store.upsertBinding(binding);
  const principal: FrostFoxPrincipal = {
    localUserId,
    routerAccountId,
    accountName: binding.accountName,
    balance: binding.balance,
    isAdmin,
    credentialState: "active",
    lastVerifiedAt: now,
  };
  return { service, principal };
}

describe("FrostFox first-party SaaS", () => {
  it("matches the protocol v2 Gateway-key vector", () => {
    expect(deriveFrostFoxGatewayKey(ACCOUNT_KEY, "frostfox-engine")).toBe(
      "sk-ff-J8pedIxw2vqiB3Smv6kstCQaXlfOBHIXFGLBJm7RU_M",
    );
  });
  it("rejects model schedule writes for non-admin accounts", async () => {
    const { service, principal } = await createBoundService(false);

    await expect(
      service.setModelSchedule(principal, [
        { channelKey: "story", modelId: "story-primary" },
      ]),
    ).rejects.toMatchObject({
      code: "frostfox_admin_required",
      status: 403,
    });
  });

  it("publishes the ordered story fallback chain for admins", async () => {
    const { service, principal } = await createBoundService(true);

    await service.setModelSchedule(principal, [
      { channelKey: "story", modelId: "story-primary" },
      { channelKey: "story", modelId: "story-backup" },
    ]);
    const context = await service.prepareAiContext(principal);
    const defaults = context?.managedSlotDefaults;
    expect(context?.managedModelPolicy).toBeUndefined();
    const primaryId = defaults?.slotPresetOverrides?.story;
    expect(primaryId).toMatch(/^frostfox-managed-[0-9a-f]{24}$/);
    expect(defaults?.slotPresetOverrides).toMatchObject({
      story: primaryId,
      plugin: primaryId,
      default: primaryId,
    });
    expect(defaults?.customPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: primaryId,
          model: "story-primary",
          fallbackPresetIds: [
            expect.stringMatching(/^frostfox-managed-[0-9a-f]{24}$/),
          ],
        }),
        expect.objectContaining({ model: "story-backup" }),
      ]),
    );
  });
  it("replaces stale image defaults with the current Router catalog model", async () => {
    const { service, principal } = await createBoundService(false, {
      staleImageDefault: true,
      imageCatalog: true,
    });

    const context = await service.prepareAiContext(principal);
    const imagePresetId =
      context?.managedSlotDefaults?.slotPresetOverrides?.image;

    expect(imagePresetId).toMatch(/^frostfox-managed-[0-9a-f]{24}$/);
    expect(context?.managedSlotDefaults?.customPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: imagePresetId,
          model: "router-image",
          tag: "image",
        }),
      ]),
    );
    expect(context?.managedSlotDefaults?.customPresets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "stale-local-image", tag: "image" }),
      ]),
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
              {
                channelKey: "image",
                routerChannelId: IMAGE_CHANNEL_ID,
                routerChannelName: "image",
                routerChannelDisplayName: "Image",
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
        if (url.endsWith("/v1/images/generations/async")) {
          return json({ error: { code: "not_found" } }, 404);
        }
        if (url.endsWith("/v1/images/generations") && init?.method === "POST") {
          return json({ id: "image-task-1", status: "pending" }, 202);
        }
        if (url.endsWith("/v1/tasks/image-task-1")) {
          return json({
            id: "image-task-1",
            status: "success",
            progress: 100,
            artifacts: [
              {
                id: "image-artifact-1",
                role: "image",
                media_type: "image/png",
                url: "/v1/tasks/image-task-1/artifacts/image-artifact-1",
              },
            ],
          });
        }
        if (url.endsWith("/v1/tasks/image-task-1/artifacts/image-artifact-1")) {
          return new Response(Buffer.alloc(64, 1), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }
        if (url.endsWith("/v1/models")) {
          const headers = new Headers(init?.headers);
          if (headers.get("X-FrostFox-Channel-Id") === IMAGE_CHANNEL_ID) {
            return json({
              object: "list",
              data: [
                { id: "openai/gpt-image-2-2k", name: "GPT Image 2 · 2K" },
                { id: "banana-pro-4k", name: "ZZ Banana Pro · 4K" },
              ],
            });
          }
          return json({
            object: "list",
            data: [
              { id: "openai/gpt-5.6-sol", name: "GPT 5.6" },
              { id: "openai/gpt-5.6-sol", name: "duplicate" },
              {
                id: "vendor-art-v1",
                name: "Vendor Art",
                mode: "image_generation",
              },
            ],
          });
        }
        return json({ error: { code: "not_found" } }, 404);
      },
    );

    vi.stubGlobal("fetch", fetchImpl);
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

    const [context, models] = await Promise.all([
      service!.prepareAiContext(connected.principal),
      service!.listModels(connected.principal),
    ]);
    const providers = service!.clientConfig.providers();
    const providerId = providers.find(
      (provider) => provider.channelKey === "deepseek",
    )!.providerId;
    const imageProviderId = providers.find(
      (provider) => provider.channelKey === "image",
    )!.providerId;
    expect(context?.apiKeys[providerId]).toBe(
      deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel"),
    );
    const managedPresetId =
      context?.managedSlotDefaults?.slotPresetOverrides?.story;
    const managedImagePresetId =
      context?.managedSlotDefaults?.slotPresetOverrides?.image;
    expect(context?.managedModelPolicy).toEqual({
      presetIdsByTag: {
        text: managedPresetId,
        image: managedImagePresetId,
      },
    });
    expect(managedPresetId).toMatch(/^frostfox-managed-[0-9a-f]{24}$/);
    expect(managedImagePresetId).toMatch(/^frostfox-managed-[0-9a-f]{24}$/);
    expect(context?.managedSlotDefaults?.slotPresetOverrides).toEqual({
      story: managedPresetId,
      plugin: managedPresetId,
      default: managedPresetId,
      image: managedImagePresetId,
    });
    expect(context?.managedSlotDefaults?.customPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: managedPresetId,
          provider: providerId,
          baseUrl: "https://market.example/v1",
          model: "deepseek-v4-flash",
          protocol: "openai-chat-v1",
        }),
        expect.objectContaining({
          id: managedImagePresetId,
          provider: imageProviderId,
          baseUrl: "https://market.example/v1",
          model: "openai/gpt-image-2-2k",
          protocol: "openai-chat-v1",
        }),
      ]),
    );
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

    expect(models.channels).toEqual([
      expect.objectContaining({
        channelKey: "deepseek",
        models: [
          expect.objectContaining({
            id: "openai/gpt-5.6-sol",
            name: "GPT 5.6",
            capability: expect.objectContaining({ output: ["text"] }),
          }),
          expect.objectContaining({
            id: "vendor-art-v1",
            name: "Vendor Art",
            capability: expect.objectContaining({ output: ["image"] }),
          }),
        ],
      }),
      expect.objectContaining({
        channelKey: "image",
        models: [
          expect.objectContaining({
            id: "openai/gpt-image-2-2k",
            capability: {
              input: ["text", "image"],
              output: ["image"],
            },
          }),
          expect.objectContaining({
            id: "banana-pro-4k",
            capability: {
              input: ["text", "image"],
              output: ["image"],
            },
          }),
        ],
      }),
    ]);
    const modelRequest = requests.find((request) =>
      request.url.endsWith("/v1/models"),
    );
    expect(modelRequest?.init?.headers).toMatchObject({
      authorization: `Bearer ${deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel")}`,
      "X-FrostFox-Channel-Id": CHANNEL_ID,
    });
    const modelRequestCount = () =>
      requests.filter((request) => request.url.endsWith("/v1/models")).length;
    expect(modelRequestCount()).toBe(2);
    const modelRequestsBefore = modelRequestCount();
    const baseline = Date.now();
    const dateNow = vi
      .spyOn(Date, "now")
      .mockReturnValue(baseline + 10 * 60_000);
    try {
      expect(await service!.listModels(connected.principal)).toBe(models);
    } finally {
      dateNow.mockRestore();
    }
    expect(modelRequestCount()).toBe(modelRequestsBefore);

    const generated = await ai.gateway.generateImage(
      {
        presetId: "image",
        prompt: "A lighthouse above a silver sea",
        size: "1024x1024",
      },
      {
        apiKeys: context!.apiKeys,
        slotOverrides: context!.managedSlotDefaults,
      },
    );
    expect(generated).toMatchObject({
      model: "openai/gpt-image-2-2k",
      provider: imageProviderId,
      images: [{ kind: "bytes", mime: "image/png" }],
    });
    const imageRequest = requests.find((request) =>
      request.url.endsWith("/v1/images/generations"),
    );
    expect(imageRequest?.init?.headers).toMatchObject({
      authorization: `Bearer ${deriveFrostFoxGatewayKey(ACCOUNT_KEY, "covel")}`,
      "X-FrostFox-Channel-Id": IMAGE_CHANNEL_ID,
      "Idempotency-Key": expect.any(String),
    });
    expect(JSON.parse(String(imageRequest?.init?.body))).toMatchObject({
      model: "openai/gpt-image-2-2k",
      prompt: "A lighthouse above a silver sea",
      size: "2048x2048",
      n: 1,
    });
    expect(
      requests.some((request) =>
        request.url.endsWith("/v1/tasks/image-task-1"),
      ),
    ).toBe(true);
    expect(
      requests.some((request) =>
        request.url.endsWith(
          "/v1/tasks/image-task-1/artifacts/image-artifact-1",
        ),
      ),
    ).toBe(true);

    await expect(
      service!.completeAuthorization({
        code: "ffac_test_code",
        state: authorizeUrl.searchParams.get("state")!,
        transactionToken: start.transactionToken,
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
  it("switches accounts without reusing the previous local identity", async () => {
    const accountAKey = "ffak_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const accountBKey = "ffak_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const accountByKey: Record<
      string,
      { id: string; name: string; balance: number }
    > = {
      [accountAKey]: { id: "account-a", name: "Account A", balance: 11 },
      [accountBKey]: { id: "account-b", name: "Account B", balance: 22 },
    };
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/account/v1/saas/client-config")) {
          return json({
            protocolVersion: "2.0",
            clientId: "covel",
            displayName: "Covel",
            callbackUrl: SOURCE.COVEL_FROSTFOX_CALLBACK_URL,
            channelSelectorHeader: "X-FrostFox-Channel-Id",
            configurationVersion: "account-switch-test",
            channelMappings: [],
          });
        }
        if (url.endsWith("/api/account/v1/saas/exchange")) {
          const body = JSON.parse(String(init?.body)) as { code?: string };
          return json({
            accountKey:
              body.code === "ffac_account_a" ? accountAKey : accountBKey,
          });
        }
        if (url.endsWith("/api/account/v1/me")) {
          const authorization = new Headers(init?.headers).get("authorization");
          const account =
            accountByKey[authorization?.replace(/^Bearer /, "") ?? ""];
          return account ? json(account) : json({ error: "invalid_key" }, 401);
        }
        return json({ error: "not_found" }, 404);
      },
    );
    const store = await createFrostFoxCredentialStore(HOST_ENV);
    const service = await FrostFoxService.create({
      env: HOST_ENV,
      ai: createAiStack(),
      source: SOURCE,
      fetchImpl: fetchImpl as typeof fetch,
      credentialStore: store,
    });
    expect(service).not.toBeNull();
    services.push(service!);

    const firstStart = await service!.startAuthorization();
    const first = await service!.completeAuthorization({
      code: "ffac_account_a",
      state: new URL(firstStart.redirectUrl).searchParams.get("state")!,
      transactionToken: firstStart.transactionToken,
    });
    const secondStart = await service!.startAuthorization();
    const second = await service!.completeAuthorization({
      code: "ffac_account_b",
      state: new URL(secondStart.redirectUrl).searchParams.get("state")!,
      transactionToken: secondStart.transactionToken,
    });

    expect(second.principal).toMatchObject({
      routerAccountId: "account-b",
      accountName: "Account B",
      balance: 22,
    });
    expect(second.principal.localUserId).not.toBe(first.principal.localUserId);
    expect(await service!.resolvePrincipal(first.sessionToken)).toMatchObject({
      routerAccountId: "account-a",
      localUserId: first.principal.localUserId,
    });
    expect(await service!.resolvePrincipal(second.sessionToken)).toMatchObject({
      routerAccountId: "account-b",
      localUserId: second.principal.localUserId,
    });
    expect(
      await store.getBindingBySubject(
        SOURCE.COVEL_FROSTFOX_ROUTER_BASE_URL,
        "account-a",
      ),
    ).toMatchObject({ localUserId: first.principal.localUserId });
  });

  it("rewrites the retired Router origin before SaaS authorization", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        protocolVersion: "2.0",
        clientId: "covel",
        displayName: "Covel",
        callbackUrl: SOURCE.COVEL_FROSTFOX_CALLBACK_URL,
        channelSelectorHeader: "X-FrostFox-Channel-Id",
        configurationVersion: "1",
        channelMappings: [],
      }),
    );
    const service = await FrostFoxService.create({
      env: HOST_ENV,
      ai: createAiStack(),
      source: {
        ...SOURCE,
        COVEL_FROSTFOX_ROUTER_BASE_URL: "https://market.dstopology.com",
      },
      fetchImpl: fetchImpl as typeof fetch,
      credentialStore: createMemoryCredentialStore(),
    });
    expect(service).not.toBeNull();
    services.push(service!);

    expect(service!.runtimeConfig.routerBaseUrl).toBe(
      "https://market.frostfox.ai",
    );
    const start = await service!.startAuthorization();
    expect(new URL(start.redirectUrl).origin).toBe(
      "https://market.frostfox.ai",
    );
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
