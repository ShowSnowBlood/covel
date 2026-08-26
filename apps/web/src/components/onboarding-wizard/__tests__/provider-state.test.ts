import { describe, expect, it } from "vitest";
import type { FrostFoxModelCatalog, PresetSummary } from "@/services/api.js";
import {
  defaultManagedFormState,
  defaultModelForProvider,
  emptyFormState,
  managedFormIsReady,
  managedModelOptions,
  modelOptionsForProvider,
  providerOptionLabel,
} from "../provider-state.js";

const presets: PresetSummary[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    model: "deepseek-chat",
    enabled: true,
    isDefault: true,
    scope: "builtin",
  },
  {
    id: "deepseek-chat-duplicate",
    name: "DeepSeek Chat duplicate",
    provider: "deepseek",
    model: "deepseek-chat",
    enabled: true,
    isDefault: false,
    scope: "builtin",
  },
  {
    id: "deepseek-disabled",
    name: "DeepSeek Disabled",
    provider: "deepseek",
    model: "deepseek-reasoner",
    enabled: false,
    isDefault: false,
    scope: "builtin",
  },
  {
    id: "openai",
    name: "OpenAI",
    provider: "openai",
    model: "gpt-4o",
    enabled: true,
    isDefault: false,
    scope: "builtin",
  },
];

describe("onboarding provider state helpers", () => {
  it("creates the default form state", () => {
    expect(emptyFormState()).toEqual({
      selected: "deepseek",
      apiKey: "",
      keyVisible: false,
      builtInModel: "",
      customBaseUrl: "",
      customModel: "",
      customProviderName: "",
      managedModelRef: "",
      modelSource: "local",
    });
  });

  it("deduplicates enabled provider models in catalog order", () => {
    expect(modelOptionsForProvider(presets, "deepseek")).toEqual([
      "deepseek-chat",
    ]);
  });

  it("uses the first enabled model as the default", () => {
    expect(defaultModelForProvider(presets, "openai")).toBe("gpt-4o");
    expect(defaultModelForProvider(presets, "missing")).toBe("");
  });

  it("labels known providers and preserves unknown provider ids", () => {
    expect(providerOptionLabel("deepseek")).toBe("DeepSeek");
    expect(providerOptionLabel("local-ai")).toBe("local-ai");
  });

  it("offers only healthy text models from a managed catalog", () => {
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
            {
              id: "image-model",
              name: "Image Model",
              capability: { input: ["text"], output: ["image"] },
            },
          ],
        },
        {
          channelKey: "disabled",
          providerId: "frostfox-disabled",
          displayName: "Disabled",
          enabled: false,
          protocol: "openai-chat-v1",
          baseUrl: "https://router.example/v1",
          models: [
            {
              id: "hidden",
              name: "Hidden",
              capability: { input: ["text"], output: ["text"] },
            },
          ],
        },
      ],
    };

    const options = managedModelOptions(catalog, "story");
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      ref: "frostfox:story:story-model",
      channelName: "Story Channel",
      model: "story-model",
    });

    const form = defaultManagedFormState(
      { ...emptyFormState(), modelSource: "managed" },
      catalog,
      "story",
    );
    expect(form.managedModelRef).toBe(options[0]!.ref);
    expect(managedFormIsReady(form, catalog, "story")).toBe(true);
  });
});
