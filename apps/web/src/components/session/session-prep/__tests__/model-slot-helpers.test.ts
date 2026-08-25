import { describe, expect, it } from "vitest";
import {
  isDeclaredSlotMissing,
  resolveDeclaredSlot,
  resolveProviderSlot,
} from "../model-slot-helpers.js";

// The configured slots in this scenario: the user has `gpt-image` but NOT the
// plugin's manifest default `openai-image`.
const configured = new Set(["story", "plugin", "gpt-image"]);
const isMissing = (slot: string) => !configured.has(slot);

const slots = [
  {
    slotId: "image",
    presetId: "image-model",
    preset: null,
    label: "image",
    tag: "image",
  },
  {
    slotId: "story",
    presetId: "story-model",
    preset: null,
    label: "story",
    tag: "text",
  },
];

describe("agent runtime slot fallback", () => {
  it("uses a directly configured role slot", () => {
    expect(resolveDeclaredSlot(slots, "story")?.slotId).toBe("story");
  });

  it("falls back from a missing plugin role to the first text slot", () => {
    expect(resolveDeclaredSlot(slots, "plugin")?.slotId).toBe("story");
    expect(isDeclaredSlotMissing(slots, "plugin")).toBe(false);
  });

  it("does not route an agent runtime through an image-only slot", () => {
    expect(resolveDeclaredSlot(slots.slice(0, 1), "plugin")).toBeNull();
    expect(isDeclaredSlotMissing(slots.slice(0, 1), "plugin")).toBe(true);
  });
});

describe("resolveProviderSlot", () => {
  it("uses the manifest default when there is no override", () => {
    const r = resolveProviderSlot({
      manifestDefault: "gpt-image",
      override: undefined,
      isMissing,
    });
    expect(r.effectiveSlot).toBe("gpt-image");
    expect(r.missing).toBe(false);
    expect(r.isOverridden).toBe(false);
  });

  it("flags a manifest default that is not configured as missing", () => {
    const r = resolveProviderSlot({
      manifestDefault: "openai-image",
      override: undefined,
      isMissing,
    });
    expect(r.effectiveSlot).toBe("openai-image");
    expect(r.missing).toBe(true);
  });

  it("clears the missing warning once overridden to a configured slot", () => {
    // The reported bug: default `openai-image` is missing, but the player
    // overrides to `gpt-image` which they do have configured.
    const r = resolveProviderSlot({
      manifestDefault: "openai-image",
      override: "gpt-image",
      isMissing,
    });
    expect(r.effectiveSlot).toBe("gpt-image");
    expect(r.missing).toBe(false);
    expect(r.isOverridden).toBe(true);
  });

  it("treats an override equal to the manifest default as not overridden", () => {
    const r = resolveProviderSlot({
      manifestDefault: "gpt-image",
      override: "gpt-image",
      isMissing,
    });
    expect(r.isOverridden).toBe(false);
  });

  it("reports an override to a still-missing slot as missing", () => {
    const r = resolveProviderSlot({
      manifestDefault: "gpt-image",
      override: "dashscope-image",
      isMissing,
    });
    expect(r.effectiveSlot).toBe("dashscope-image");
    expect(r.missing).toBe(true);
    expect(r.isOverridden).toBe(true);
  });

  it("is not missing when neither default nor override is set", () => {
    const r = resolveProviderSlot({
      manifestDefault: undefined,
      override: undefined,
      isMissing,
    });
    expect(r.effectiveSlot).toBeUndefined();
    expect(r.missing).toBe(false);
    expect(r.isOverridden).toBe(false);
  });
});
