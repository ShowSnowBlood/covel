import { describe, it, expect } from "vitest";
import { getPendingProposals, tool, z } from "@covel/tools";
import createGenerateGuide from "../tools/generate-guide.js";

const CONTEXT = {
  sessionId: "sess-1",
  pluginId: "guide",
  runtimeId: "guide",
  turnId: "turn-1",
};

describe("generate-guide tool", () => {
  const guideTool = createGenerateGuide({ tool, z });

  it("returns the three fixed categories with bilingual labels", async () => {
    const result = await guideTool.execute(
      {
        topic: "How to enter the harbor",
        safe: ["Ask the guard"],
        aggressive: ["Challenge the blockade"],
        creative: ["Pose as a dock worker"],
      },
      CONTEXT,
    );

    expect(result.topic).toBe("How to enter the harbor");
    expect(result.categories).toHaveLength(3);
    expect(result.categories.map((category) => category.style)).toEqual([
      "safe",
      "aggressive",
      "creative",
    ]);
    expect(result.categories.map((category) => category.label)).toEqual([
      { zh: "稳妥", en: "Safe" },
      { zh: "激进", en: "Aggressive" },
      { zh: "创意", en: "Creative" },
    ]);
  });

  it("emits one plugin.data.batch proposal covering the full message block", async () => {
    const result = await guideTool.execute(
      {
        topic: "Decision point",
        safe: ["a", "b"],
        aggressive: ["c"],
        creative: ["d"],
      },
      CONTEXT,
    );

    const proposals = getPendingProposals(result);
    expect(proposals).toHaveLength(1);
    const [proposal] = proposals;
    expect(proposal.type).toBe("plugin.data.batch");
    expect(proposal.sessionId).toBe("sess-1");
    expect(proposal.turnId).toBe("turn-1");
    expect(proposal.source).toEqual({ pluginId: "guide", runtimeId: "guide" });

    const items = proposal.payload.items;
    // 2 header keys + 3 categories × (3 meta + 3 suggestion slots).
    expect(items).toHaveLength(2 + 3 * 6);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["key", "namespace", "value"]);
      expect(item.namespace).toBe("message");
    }

    const byKey = new Map(items.map((item) => [item.key, item.value]));
    expect(byKey.get("__turnId")).toBe("turn-1");
    expect(byKey.get("topic")).toBe("Decision point");
    expect(byKey.get("category1Suggestion1")).toBe("a");
    expect(byKey.get("category1Suggestion2")).toBe("b");
    expect(byKey.get("category1Suggestion3")).toBe("");
    expect(byKey.get("category2Suggestion1")).toBe("c");
    expect(byKey.get("category3Suggestion1")).toBe("d");
  });
});
