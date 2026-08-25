import { beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import type {
  ModelParameterOverrides,
  ReasoningEffortProfile,
} from "@/services/api.js";
import { parseNumericParameterOverride } from "../LlmAdvancedPane.js";
import {
  clearChangedSlotReasoningEfforts,
  pruneInvalidReasoningEffortOverride,
} from "../llm-reasoning-effort.js";

const profile = (options: ReasoningEffortProfile["options"]) =>
  ({
    family: "openai",
    defaultValue: options[0]?.value,
    options,
  }) satisfies ReasoningEffortProfile;

describe("LLM settings regressions", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  it("removes a reasoning override that the newly bound model cannot use", () => {
    const overrides: Record<string, ModelParameterOverrides> = {
      story: { temperature: 0.7, reasoningEffort: "xhigh" },
    };

    expect(
      pruneInvalidReasoningEffortOverride(
        overrides,
        "story",
        profile([{ value: "high" }]),
      ),
    ).toEqual({ story: { temperature: 0.7 } });
    expect(
      pruneInvalidReasoningEffortOverride(overrides, "story", undefined),
    ).toBe(overrides);
    expect(
      pruneInvalidReasoningEffortOverride(
        overrides,
        "story",
        profile([{ value: "xhigh" }]),
      ),
    ).toBe(overrides);
  });

  it("clears reasoning synchronously when a slot binding changes", () => {
    const overrides: Record<string, ModelParameterOverrides> = {
      story: { temperature: 0.7, reasoningEffort: "xhigh" },
      fast: { reasoningEffort: "low" },
    };

    expect(
      clearChangedSlotReasoningEfforts(
        {
          story: { modelRef: "old-model" },
          fast: { modelRef: "unchanged-model" },
        },
        {
          story: { modelRef: "new-model" },
          fast: { modelRef: "unchanged-model" },
        },
        overrides,
      ),
    ).toEqual({
      story: { temperature: 0.7 },
      fast: { reasoningEffort: "low" },
    });
  });

  it("treats an empty numeric field as the provider default", () => {
    expect(parseNumericParameterOverride("", -2, 2)).toBeUndefined();
    expect(parseNumericParameterOverride("  ", -2, 2)).toBeUndefined();
    expect(parseNumericParameterOverride("5", -2, 2)).toBe(2);
    expect(parseNumericParameterOverride("-5", -2, 2)).toBe(-2);
    expect(parseNumericParameterOverride("invalid", -2, 2)).toBeUndefined();
  });
});
