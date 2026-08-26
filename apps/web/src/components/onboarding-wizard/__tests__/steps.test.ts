import { describe, expect, it } from "vitest";
import type { FrostFoxModelCatalog } from "@/services/api.js";
import {
  isPluginContinueDisabled,
  isStoryContinueDisabled,
  summarizeStoryProvider,
} from "../steps.js";
import { emptyFormState, managedModelOptions } from "../provider-state.js";

const catalog: FrostFoxModelCatalog = {
  configurationVersion: "1",
  channels: [
    {
      channelKey: "story",
      providerId: "frostfox-story",
      displayName: "Story Channel",
      enabled: true,
      protocol: "openai-chat-v1",
      baseUrl: "https://router.example/v1",
      models: [
        {
          id: "story-model",
          name: "Story Model",
          capability: { input: ["text"], output: ["text"] },
        },
      ],
    },
  ],
};

describe("onboarding managed model rules", () => {
  it("allows a managed narrator without a browser API key", () => {
    const ref = managedModelOptions(catalog, "story")[0]!.ref;
    const form = {
      ...emptyFormState(),
      modelSource: "managed" as const,
      managedModelRef: ref,
    };

    expect(isStoryContinueDisabled(form, catalog)).toBe(false);
    expect(summarizeStoryProvider(form, catalog)).toBe(
      "Story Channel — Story Model",
    );
  });

  it("uses the same managed binding for plugins by default", () => {
    const ref = managedModelOptions(catalog, "plugin")[0]!.ref;
    const form = {
      ...emptyFormState(),
      modelSource: "managed" as const,
      managedModelRef: ref,
    };

    expect(isPluginContinueDisabled("same", form, catalog)).toBe(false);
    expect(isPluginContinueDisabled("different", form, catalog)).toBe(false);
  });
});
