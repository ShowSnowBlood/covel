import { beforeEach, describe, expect, it } from "vitest";
import {
  getPendingProposals,
  shortIdBatch,
  tool,
  withPendingProposals,
  z,
} from "@covel/tools";
import makeUpdateFactionReputation from "../tools/update-faction-reputation.js";
import {
  REPUTATION_TIERS,
  clampReputation,
  reputationTier,
} from "../tier-metadata.js";

function createStore() {
  const data = new Map();
  const compositeKey = (sessionId, pluginId, namespace, key) =>
    `${sessionId}:${pluginId}:${namespace}:${key}`;

  return {
    async setPluginData(record) {
      data.set(
        compositeKey(
          record.sessionId,
          record.pluginId,
          record.namespace,
          record.key,
        ),
        {
          namespace: record.namespace,
          key: record.key,
          value: record.value,
          updatedAt: record.updatedAt,
        },
      );
    },
    async getPluginData(sessionId, pluginId, namespace, key) {
      return (
        data.get(compositeKey(sessionId, pluginId, namespace, key)) ?? null
      );
    },
    async listPluginData(sessionId, pluginId, namespace) {
      const prefix = `${sessionId}:${pluginId}:${namespace}:`;
      return [...data]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value);
    },
  };
}

async function applyPending(result, store) {
  for (const proposal of getPendingProposals(result)) {
    if (proposal.type !== "plugin.data.batch") continue;
    for (const item of proposal.payload.items) {
      await store.setPluginData({
        sessionId: proposal.sessionId,
        pluginId: proposal.source.pluginId,
        namespace: item.namespace,
        key: item.key,
        value: item.value,
        updatedAt: proposal.timestamp,
      });
    }
  }
}

const context = {
  sessionId: "session-1",
  turnId: "turn-3",
  pluginId: "faction-reputation",
  runtimeId: "faction-reputation",
  turnNumber: 3,
};

describe("reputation tiers", () => {
  it("maps every boundary and clamps scores", () => {
    expect(clampReputation(-120)).toBe(-100);
    expect(clampReputation(120)).toBe(100);
    expect(reputationTier(-60).id).toBe("hostile");
    expect(reputationTier(-59).id).toBe("distrusted");
    expect(reputationTier(-20).id).toBe("distrusted");
    expect(reputationTier(-19).id).toBe("neutral");
    expect(reputationTier(19).id).toBe("neutral");
    expect(reputationTier(20).id).toBe("respected");
    expect(reputationTier(60).id).toBe("allied");
    expect(reputationTier(85).id).toBe("revered");
  });

  it("provides bilingual labels and badge colors", () => {
    for (const tier of REPUTATION_TIERS) {
      expect(tier.label.zh).toBeTruthy();
      expect(tier.label.en).toBeTruthy();
      expect(tier.color).toBeTruthy();
    }
  });
});

describe("update-faction-reputation", () => {
  let store;
  let updateReputation;

  beforeEach(() => {
    store = createStore();
    updateReputation = makeUpdateFactionReputation({
      tool,
      z,
      shortIdBatch,
      withPendingProposals,
      store,
    });
  });

  it("creates a faction record and matching turn message", async () => {
    const result = await updateReputation.execute(
      {
        changes: [
          {
            name: "悬钩堂",
            delta: 8,
            reason: "你救回了被困的拾荒队",
          },
        ],
      },
      context,
    );
    await applyPending(result, store);

    expect(result.applied).toBe(1);
    expect(result.results[0]).toMatchObject({
      name: "悬钩堂",
      score: 8,
      standing: "neutral",
      status: "created",
    });

    const id = result.results[0].id;
    const record = await store.getPluginData(
      context.sessionId,
      context.pluginId,
      "reputation",
      id,
    );
    expect(record.value).toMatchObject({
      id,
      name: "悬钩堂",
      score: 8,
      scoreBar: 108,
      standing: "neutral",
      standingLabel: { zh: "中立", en: "Neutral" },
      lastDelta: "+8",
      lastReason: "你救回了被困的拾荒队",
    });
    expect(record.value.history).toEqual([
      { turn: 3, delta: 8, reason: "你救回了被困的拾荒队" },
    ]);

    const message = await store.getPluginData(
      context.sessionId,
      context.pluginId,
      "message",
      "changes",
    );
    expect(message.value).toEqual([
      expect.objectContaining({ id, name: "悬钩堂", deltaText: "+8" }),
    ]);
  });

  it("accumulates case-insensitively, clamps, and preserves world notes", async () => {
    await store.setPluginData({
      sessionId: context.sessionId,
      pluginId: context.pluginId,
      namespace: "reputation",
      key: "faction-chainhook",
      value: {
        id: "faction-chainhook",
        name: "Chainhook Hall",
        score: 95,
        notes: "Controls the western salvage routes",
      },
    });

    const result = await updateReputation.execute(
      {
        changes: [
          {
            name: "chainhook hall",
            delta: 20,
            reason: "You defended its route from raiders",
          },
        ],
      },
      context,
    );
    await applyPending(result, store);

    const record = await store.getPluginData(
      context.sessionId,
      context.pluginId,
      "reputation",
      "faction-chainhook",
    );
    expect(result.results[0].status).toBe("updated");
    expect(record.value.score).toBe(100);
    expect(record.value.standing).toBe("revered");
    expect(record.value.notes).toBe("Controls the western salvage routes");
  });

  it("overlays an earlier uncommitted write in the same tool loop", async () => {
    const first = await updateReputation.execute(
      {
        changes: [{ name: "司辰阁", delta: -4, reason: "你公开违抗封锚令" }],
      },
      context,
    );
    const pendingProposals = getPendingProposals(first);

    const second = await updateReputation.execute(
      {
        changes: [{ name: "司辰阁", delta: -3, reason: "你帮助嫌犯逃离巡查" }],
      },
      { ...context, pendingProposals },
    );

    expect(second.results[0]).toMatchObject({
      score: -7,
      status: "updated",
    });
  });

  it("rejects zero deltas", async () => {
    await expect(
      updateReputation.execute(
        {
          changes: [{ name: "司辰阁", delta: 0, reason: "没有变化" }],
        },
        context,
      ),
    ).rejects.toThrow("Tool parameter validation failed");
  });
});
