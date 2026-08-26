import { afterEach, describe, expect, it, vi } from "vitest";
import {
  frostFoxModelRef,
  getManagedFrostFoxCatalog,
  getManagedFrostFoxPresets,
  hydrateManagedFrostFoxModels,
  setManagedFrostFoxCatalog,
  subscribeManagedFrostFoxCatalog,
} from "../frostfox-models.js";

const api = vi.hoisted(() => ({
  fetchFrostFoxAccount: vi.fn(),
  fetchFrostFoxModels: vi.fn(),
}));

vi.mock("../frostfox.js", () => ({
  fetchFrostFoxAccount: api.fetchFrostFoxAccount,
  fetchFrostFoxModels: api.fetchFrostFoxModels,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

afterEach(() => {
  setManagedFrostFoxCatalog(null);
  vi.clearAllMocks();
});

describe("FrostFox managed model projection", () => {
  it("projects only enabled, healthy channel models into request presets", () => {
    setManagedFrostFoxCatalog({
      configurationVersion: "343",
      channels: [
        {
          channelKey: "gpt-pro",
          providerId: "frostfox-6770742d70726f",
          displayName: "GPT Pro",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "openai/gpt-5.6-sol",
              name: "GPT 5.6",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
        {
          channelKey: "disabled",
          providerId: "frostfox-64697361626c6564",
          displayName: "Disabled",
          enabled: false,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "should-not-appear",
              name: "Hidden",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
        {
          channelKey: "blocked",
          providerId: "frostfox-626c6f636b6564",
          displayName: "Blocked",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [],
          error: "channel_forbidden",
        },
      ],
    });

    expect(getManagedFrostFoxPresets()).toEqual([
      {
        id: frostFoxModelRef("gpt-pro", "openai/gpt-5.6-sol"),
        name: "GPT Pro · GPT 5.6",
        provider: "frostfox-6770742d70726f",
        baseUrl: "https://market.example/v1",
        model: "openai/gpt-5.6-sol",
        protocol: "openai-chat-v1",
        tag: "text",
        capability: { input: ["text"], output: ["text"] },
      },
    ]);
  });
});

describe("managed catalog hydration ordering", () => {
  it("does not let a stale request overwrite a newer catalog", async () => {
    const first = deferred<{ configurationVersion: string; channels: [] }>();
    const second = deferred<{ configurationVersion: string; channels: [] }>();
    api.fetchFrostFoxModels
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const account = { enabled: true, authenticated: true };

    const firstRun = hydrateManagedFrostFoxModels(account);
    const secondRun = hydrateManagedFrostFoxModels(account);
    const latestCatalog = {
      configurationVersion: "latest",
      channels: [] as [],
    };
    const staleCatalog = { configurationVersion: "stale", channels: [] as [] };

    second.resolve(latestCatalog);
    expect(await secondRun).toBe(latestCatalog);
    first.resolve(staleCatalog);
    expect(await firstRun).toBeNull();
    expect(getManagedFrostFoxCatalog()).toBe(latestCatalog);
  });

  it("notifies subscribers when the catalog is replaced or cleared", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeManagedFrostFoxCatalog(listener);

    setManagedFrostFoxCatalog({ configurationVersion: "1", channels: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setManagedFrostFoxCatalog(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
