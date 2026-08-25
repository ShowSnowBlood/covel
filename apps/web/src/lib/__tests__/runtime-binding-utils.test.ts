import { describe, expect, it } from "vitest";
import { autoAssignRuntimeBindings } from "../runtime-binding-utils.js";

const targets = [
  { qualifiedId: "narrator", defaultSlot: "story" },
  { qualifiedId: "inventory", defaultSlot: "plugin" },
  { qualifiedId: "prompt-generator", defaultSlot: "default" },
];

const slots = [
  { slotId: "image", tag: "image" },
  { slotId: "story", tag: "text" },
  { slotId: "alternate", tag: "text" },
];

describe("autoAssignRuntimeBindings", () => {
  it("keeps direct matches and transparently sends missing agent roles to text", () => {
    expect(autoAssignRuntimeBindings({}, targets, slots)).toEqual({
      narrator: "story",
      inventory: "story",
      "prompt-generator": "story",
    });
  });

  it("completes a partially saved map without replacing the user choice", () => {
    expect(
      autoAssignRuntimeBindings({ narrator: "alternate" }, targets, slots),
    ).toEqual({
      narrator: "alternate",
      inventory: "story",
      "prompt-generator": "story",
    });
  });

  it("leaves a missing agent role unbound when only non-text slots exist", () => {
    expect(
      autoAssignRuntimeBindings(
        {},
        [targets[1]],
        [{ slotId: "image", tag: "image" }],
      ),
    ).toEqual({});
  });
});
