/**
 * Regression test: custom preset API keys must live in the secrets
 * channel (`covel:keys`), NOT inline inside `llm.customPresets` / the
 * `covel:settings` blob.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_STORAGE_KEYS_KEY,
  LOCAL_STORAGE_SETTINGS_KEY,
} from "@covel/settings";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    __dump: () => ({ ...store }),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: false,
});

// Late import so the settings store sees the mocked localStorage.
const { getSettings, initSettings } = await import("@/settings/store");
const {
  getCustomPresets,
  getProviderPriceMultiplier,
  getSlotConfig,
  clearManagedFrostFoxSlots,
  reconcileManagedFrostFoxSlots,
  removeCustomPreset,
  setCustomPresets,
  setManagedFrostFoxCatalog,
  setParamOverrides,
  setProviderProfiles,
  setProviderPriceMultipliers,
  setSlotConfig,
} = await import("../api.js");
const { buildProviderKeysHeader, buildSlotConfigHeaderInternal } =
  await import("../api/model-settings.js");

function readSettingsBlob(): Record<string, unknown> {
  const raw = localStorageMock.getItem(LOCAL_STORAGE_SETTINGS_KEY);
  if (!raw) return {};
  return JSON.parse(raw);
}

function readKeysBlob(): Record<string, string> {
  const raw = localStorageMock.getItem(LOCAL_STORAGE_KEYS_KEY);
  if (!raw) return {};
  return JSON.parse(raw);
}

beforeEach(async () => {
  localStorageMock.clear();
  await initSettings();
});

afterEach(() => {
  setManagedFrostFoxCatalog(null);
  vi.restoreAllMocks();
});

describe("custom preset secret channel", () => {
  it("replaces a deployment image preset with the matching managed model", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "1",
      channels: [
        {
          channelKey: "image",
          providerId: "frostfox-696d616765",
          displayName: "Images",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "banana-1k",
              name: "Banana",
              capability: { input: ["text", "image"], output: ["image"] },
            },
            {
              id: "gpt-image-2-2k",
              name: "GPT Image",
              capability: { input: ["text", "image"], output: ["image"] },
            },
          ],
        },
      ],
    });
    setSlotConfig({ image: { presetId: "slot-image" } });

    reconcileManagedFrostFoxSlots("gpt-image-2-2k");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      image: {
        modelRef: "frostfox:image:gpt-image-2-2k",
      },
    });
  });

  it("migrates a legacy hashed image binding to the current catalog model", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "2",
      channels: [
        {
          channelKey: "image",
          providerId: "frostfox-696d616765",
          displayName: "Images",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "gpt-image-2-2k",
              name: "GPT Image",
              capability: { input: ["text", "image"], output: ["image"] },
            },
          ],
        },
      ],
    });
    setSlotConfig({
      image: { modelRef: "frostfox-managed-legacy-image" },
    });

    reconcileManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      image: { modelRef: "frostfox:image:gpt-image-2-2k" },
    });
  });

  it("preserves a player-owned image binding", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "1",
      channels: [
        {
          channelKey: "image",
          providerId: "frostfox-696d616765",
          displayName: "Images",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "managed-image",
              name: "Managed Image",
              capability: { input: ["text", "image"], output: ["image"] },
            },
          ],
        },
      ],
    });
    setCustomPresets([
      {
        id: "custom-image",
        name: "My Image Model",
        provider: "openai",
        baseUrl: "https://openai.example/v1",
        model: "gpt-image-1",
        capability: { input: ["text", "image"], output: ["image"] },
      },
    ]);
    setSlotConfig({ image: { presetId: "custom-image" } });

    reconcileManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      image: { modelRef: "custom-image" },
    });
  });

  it("removes account-scoped slot references missing from the current catalog", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "account-a",
      channels: [
        {
          channelKey: "text",
          providerId: "frostfox-74657874",
          displayName: "Text",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "model-b",
              name: "Model B",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
      ],
    });
    setSlotConfig({
      story: { modelRef: "frostfox:text:model-a" },
      plugin: { modelRef: "frostfox:text:model-a" },
      local: { modelRef: "custom_local" },
    });

    reconcileManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      local: { modelRef: "custom_local" },
    });
  });

  it("keeps managed bindings during a temporary empty catalog", async () => {
    setSlotConfig({ story: { modelRef: "frostfox:text:model-a" } });
    setManagedFrostFoxCatalog(null);

    reconcileManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      story: { modelRef: "frostfox:text:model-a" },
    });
  });

  it("keeps bindings from a channel that failed a partial refresh", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "partial",
      channels: [
        {
          channelKey: "healthy",
          providerId: "frostfox-healthy",
          displayName: "Healthy",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "new-model",
              name: "New Model",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
        {
          channelKey: "temporarily-unavailable",
          providerId: "frostfox-unavailable",
          displayName: "Unavailable",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [],
          error: "upstream_timeout",
        },
      ],
    });
    setSlotConfig({
      story: { modelRef: "frostfox:temporarily-unavailable:old-model" },
    });

    reconcileManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      story: { modelRef: "frostfox:temporarily-unavailable:old-model" },
    });
  });

  it("clears only managed bindings on explicit account removal", async () => {
    setSlotConfig({
      story: { modelRef: "frostfox:text:model-a" },
      plugin: { presetId: "frostfox:text:model-b" },
      local: { modelRef: "custom_local" },
    });

    clearManagedFrostFoxSlots();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSlotConfig()).toEqual({
      local: { modelRef: "custom_local" },
    });
  });

  it("does not persist account-managed presets as local provider profiles", async () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "account-a",
      channels: [
        {
          channelKey: "text",
          providerId: "frostfox-74657874",
          displayName: "Text",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "model-a",
              name: "Model A",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
      ],
    });

    setCustomPresets(getCustomPresets());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.stringify(readSettingsBlob())).not.toContain("frostfox:");
  });

  it("filters stale managed references even after the catalog is cleared", async () => {
    setManagedFrostFoxCatalog(null);
    setCustomPresets([
      {
        id: "frostfox:old-channel:old-model",
        name: "Old managed model",
        provider: "frostfox-old",
        baseUrl: "https://market.example/v1",
        model: "old-model",
      },
      {
        id: "frostfox-managed-0123456789abcdef",
        name: "Legacy managed model",
        provider: "frostfox-old",
        baseUrl: "https://market.example/v1",
        model: "legacy-model",
      },
      {
        id: "custom_keep",
        name: "Local model",
        provider: "openai",
        baseUrl: "https://openai.example/v1",
        model: "gpt-5",
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCustomPresets().map((preset) => preset.id)).toEqual([
      "custom_keep",
    ]);

    const persisted = readSettingsBlob() as {
      entries?: { "llm.providers"?: Array<Record<string, unknown>> };
    };
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("old managed model");
    expect(serialized).toContain("Local model");
  });
  it("uses a 1x default and persists positive decimal provider multipliers", async () => {
    expect(getProviderPriceMultiplier("openai")).toBe(1);

    setProviderPriceMultipliers({ openai: 0.1, premium: 2.5, invalid: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getProviderPriceMultiplier("openai")).toBe(0.1);
    expect(getProviderPriceMultiplier("premium")).toBe(2.5);
    expect(getProviderPriceMultiplier("invalid")).toBe(1);
  });

  it("compiles a provider-first model reference without rewriting its model id", async () => {
    setProviderProfiles([
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://openai.example/v1",
        protocol: "openai-chat-v1",
        models: [
          {
            ref: "model_deepseek",
            modelId: "deepseek/deepseek-v4-flash",
          },
        ],
      },
    ]);
    setSlotConfig({ default: { modelRef: "model_deepseek" } });
    setParamOverrides({
      default: { temperature: 0.4, reasoningEffort: "max" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const encoded = buildSlotConfigHeaderInternal()["X-Slot-Config"];
    expect(encoded).toBeTruthy();
    const overlay = JSON.parse(atob(encoded!));
    expect(overlay.slotPresetOverrides).toEqual({
      default: "model_deepseek",
    });
    expect(overlay.parameterOverrides).toEqual({
      default: { temperature: 0.4, reasoningEffort: "max" },
    });
    expect(overlay.customPresets).toEqual([
      expect.objectContaining({
        id: "model_deepseek",
        provider: "openai",
        model: "deepseek/deepseek-v4-flash",
      }),
    ]);
  });

  it("strips apiKey from the settings blob and routes it to covel:keys", async () => {
    setCustomPresets([
      {
        id: "custom_x1",
        name: "My Qwen",
        provider: "dashscope",
        baseUrl: "https://dashscope.aliyuncs.com",
        model: "qwen3.6-flash",
        protocol: "openai-chat-v1",
        apiKey: "sk-topsecret",
      },
    ]);
    // Settings writes are async — give the mocked backend a tick.
    await new Promise((r) => setTimeout(r, 0));

    const settings = readSettingsBlob() as {
      entries?: { "llm.customPresets"?: Array<Record<string, unknown>> };
    };
    const persisted = settings.entries?.["llm.customPresets"] ?? [];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(settings)).not.toContain("sk-topsecret");

    const keys = readKeysBlob();
    expect(keys["preset:custom_x1"]).toBe("sk-topsecret");
  });

  it("rehydrates apiKey from the secrets channel on read", async () => {
    setCustomPresets([
      {
        id: "custom_x1",
        name: "My Qwen",
        provider: "dashscope",
        baseUrl: "https://dashscope.aliyuncs.com",
        model: "qwen3.6-flash",
        protocol: "openai-chat-v1",
        apiKey: "sk-topsecret",
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    const presets = getCustomPresets();
    expect(presets[0]?.apiKey).toBe("sk-topsecret");
  });

  it("clears the matching secret when the preset is removed", async () => {
    setCustomPresets([
      {
        id: "custom_x1",
        name: "My Qwen",
        provider: "dashscope",
        baseUrl: "https://dashscope.aliyuncs.com",
        model: "qwen3.6-flash",
        protocol: "openai-chat-v1",
        apiKey: "sk-topsecret",
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    removeCustomPreset("custom_x1");
    await new Promise((r) => setTimeout(r, 0));

    const keys = readKeysBlob();
    expect(keys["preset:custom_x1"]).toBeUndefined();
  });

  it("clears only preset secrets no longer referenced by provider profiles", async () => {
    setCustomPresets([
      {
        id: "model_keep",
        name: "Keep",
        provider: "openai",
        baseUrl: "https://openai.example/v1",
        model: "gpt-5",
        apiKey: "sk-keep",
      },
      {
        id: "model_remove",
        name: "Remove Model",
        provider: "openai",
        baseUrl: "https://openai.example/v1",
        model: "gpt-4.1",
        apiKey: "sk-remove-model",
      },
      {
        id: "provider_remove",
        name: "Remove Provider",
        provider: "anthropic",
        baseUrl: "https://anthropic.example/v1",
        model: "claude-sonnet-4-6",
        apiKey: "sk-remove-provider",
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    setProviderProfiles([
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://openai.example/v1",
        models: [{ ref: "model_keep", modelId: "gpt-5" }],
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    const keys = readKeysBlob();
    expect(keys["preset:model_keep"]).toBe("sk-keep");
    expect(keys["preset:model_remove"]).toBeUndefined();
    expect(keys["preset:provider_remove"]).toBeUndefined();
  });

  it("routes distinct legacy connection keys through distinct provider namespaces", async () => {
    setCustomPresets([
      {
        id: "official_model",
        name: "Official",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5",
        protocol: "openai-responses-v1",
        apiKey: "sk-official",
      },
      {
        id: "proxy_model",
        name: "Proxy",
        provider: "openai",
        baseUrl: "https://proxy.example/v1",
        model: "gpt-4.1",
        protocol: "openai-chat-v1",
        apiKey: "sk-proxy",
      },
    ]);
    await new Promise((r) => setTimeout(r, 0));

    const presets = getCustomPresets();
    expect(new Set(presets.map((preset) => preset.provider)).size).toBe(2);

    const encoded = buildProviderKeysHeader()["X-Provider-Keys"];
    expect(encoded).toBeTruthy();
    const providerKeys = JSON.parse(atob(encoded!)) as Record<string, string>;
    expect(providerKeys[presets[0]!.provider]).toBe("sk-official");
    expect(providerKeys[presets[1]!.provider]).toBe("sk-proxy");

    await getSettings().set(`keys.${presets[1]!.provider}`, "sk-proxy-new");

    const updatedEncoded = buildProviderKeysHeader()["X-Provider-Keys"];
    const updatedProviderKeys = JSON.parse(atob(updatedEncoded!)) as Record<
      string,
      string
    >;
    expect(updatedProviderKeys[presets[1]!.provider]).toBe("sk-proxy-new");
  });

  it("migrates legacy inline apiKey to the secrets channel on first read", async () => {
    // Simulate legacy persisted blob containing an inline apiKey — this is
    // exactly what shipped in `settings.json` before the fix. We reset the
    // module registry so a fresh SettingsStore singleton re-hydrates from
    // this blob on initSettings().
    vi.resetModules();
    const legacyBlob = {
      schemaVersion: 1,
      savedAt: "2026-04-24T14:30:38.775Z",
      entries: {
        "llm.customPresets": [
          {
            id: "custom_legacy",
            name: "Legacy",
            provider: "dashscope",
            baseUrl: "https://dashscope.aliyuncs.com",
            model: "qwen3.6-flash",
            protocol: "openai-chat-v1",
            apiKey: "sk-legacy-leak",
          },
        ],
      },
    };
    localStorageMock.setItem(
      LOCAL_STORAGE_SETTINGS_KEY,
      JSON.stringify(legacyBlob),
    );

    const { initSettings: init2 } = await import("@/settings/store");
    const freshApi = await import("../api.js");
    await init2();

    const presets = freshApi.getCustomPresets();
    expect(presets[0]?.apiKey).toBe("sk-legacy-leak");
    await new Promise((r) => setTimeout(r, 0));

    const postSettings = readSettingsBlob() as {
      entries?: { "llm.customPresets"?: Array<Record<string, unknown>> };
    };
    const persistedAfter = postSettings.entries?.["llm.customPresets"] ?? [];
    expect(persistedAfter[0]).not.toHaveProperty("apiKey");
    expect(JSON.stringify(postSettings)).not.toContain("sk-legacy-leak");

    const keys = readKeysBlob();
    expect(keys["preset:custom_legacy"]).toBe("sk-legacy-leak");
  });
});
