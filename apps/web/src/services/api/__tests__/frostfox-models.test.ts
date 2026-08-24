import { afterEach, describe, expect, it } from "vitest";
import {
  frostFoxModelRef,
  getManagedFrostFoxPresets,
  setManagedFrostFoxCatalog,
} from "../frostfox-models.js";

afterEach(() => setManagedFrostFoxCatalog(null));

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
          models: [{ id: "openai/gpt-5.6-sol", name: "GPT 5.6" }],
        },
        {
          channelKey: "disabled",
          providerId: "frostfox-64697361626c6564",
          displayName: "Disabled",
          enabled: false,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [{ id: "should-not-appear", name: "Hidden" }],
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
      },
    ]);
  });
});
