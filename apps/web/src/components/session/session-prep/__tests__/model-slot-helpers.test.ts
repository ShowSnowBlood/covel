import { describe, expect, it } from "vitest";
import {
  isDeclaredSlotMissing,
  resolveDeclaredSlot,
  resolveProviderSlot,
} from "../model-slot-helpers.js";

// The configured slots in this scenario include one image role but not an
// optional second image role.
const configured = new Set(["story", "plugin", "image"]);
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

  it("rejects a declared image slot for an agent runtime", () => {
    expect(resolveDeclaredSlot(slots, "image")).toBeNull();
    expect(isDeclaredSlotMissing(slots, "image")).toBe(true);
  });
});

describe("resolveProviderSlot", () => {
  it("uses the manifest default when there is no override", () => {
    const r = resolveProviderSlot({
      manifestDefault: "image",
      override: undefined,
      isMissing,
    });
    expect(r.effectiveSlot).toBe("image");
    expect(r.missing).toBe(false);
    expect(r.isOverridden).toBe(false);
  });

  it("flags a manifest default that is not configured as missing", () => {
    const r = resolveProviderSlot({
      manifestDefault: "image-secondary",
      override: undefined,
      isMissing,
    });
    expect(r.effectiveSlot).toBe("image-secondary");
    expect(r.missing).toBe(true);
  });

  it("clears the missing warning once overridden to a configured slot", () => {
    // A plugin can still opt into a separately configured role explicitly.
    const r = resolveProviderSlot({
      manifestDefault: "image-secondary",
      override: "image",
      isMissing,
    });
    expect(r.effectiveSlot).toBe("image");
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
