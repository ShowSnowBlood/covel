import { describe, expect, it, vi } from "vitest";
import type {
  DataStore,
  EmbeddingModelIdentity,
  VectorTarget,
} from "@covel/store";
import type { AiStack } from "../../src/ai-setup.js";
import { createEmbeddingLockHelper } from "../../src/embedding-lock.js";

function vectorStoreHarness() {
  const target: VectorTarget = {
    modelRegistryId: 7,
    modelId: "frostfox-embed/embed-v2",
    dim: 3,
    tableName: "vec_mem_m7",
  };
  const ensureVectorModel = vi.fn(
    async (_identity: EmbeddingModelIdentity): Promise<VectorTarget> => target,
  );
  const lockSessionEmbeddingModel = vi.fn(async () => undefined);
  const store = {
    resolveSessionVectorTarget: vi.fn(async () => null),
    ensureVectorModel,
    lockSessionEmbeddingModel,
    upsertVector: vi.fn(async () => undefined),
    searchVectors: vi.fn(async () => []),
    deleteVectors: vi.fn(async () => undefined),
  } as unknown as DataStore;
  return { store, target, ensureVectorModel, lockSessionEmbeddingModel };
}

describe("createEmbeddingLockHelper", () => {
  it("locks the session to the request-scoped managed embedding target", async () => {
    const harness = vectorStoreHarness();
    const resolveSlot = vi.fn(() => ({
      presetId: "managed-embed",
      provider: "frostfox-embed",
      protocol: "openai-chat-v1" as const,
      baseUrl: "https://market.example/v1",
      model: "embed-v2",
      tag: "embedding",
      metadata: {},
    }));
    const embed = vi.fn(async () => ({
      embeddings: [[0.1, 0.2, 0.3]],
      usage: { inputTokens: 1, outputTokens: 0 },
    }));
    const ai = {
      gateway: { resolveSlot, embed },
      presetRegistry: {
        resolveEmbeddingTarget: vi.fn(() => {
          throw new Error("global embedding target must not be used");
        }),
      },
    } as unknown as AiStack;
    const options = {
      apiKeys: { "frostfox-embed": "derived-key" },
      managedModelPolicy: {
        presetIdsByTag: { embedding: "managed-embed" },
      },
      slotOverrides: {
        slotPresetOverrides: { embedding: "managed-embed" },
      },
    };
    const ensureLock = createEmbeddingLockHelper({
      store: harness.store,
      ai,
      resolveEmbeddingRequest: async () => ({
        presetId: "managed-embed",
        options,
      }),
    });

    await ensureLock("session-managed");

    expect(resolveSlot).toHaveBeenCalledWith("managed-embed", {
      ...options,
      fallbackTag: "embedding",
    });
    expect(embed).toHaveBeenCalledWith(
      { presetId: "managed-embed", values: ["covel-embed-probe"] },
      options,
    );
    expect(harness.ensureVectorModel).toHaveBeenCalledWith({
      provider: "frostfox-embed",
      modelName: "embed-v2",
      dim: 3,
      modelId: "frostfox-embed/embed-v2",
    });
    expect(harness.lockSessionEmbeddingModel).toHaveBeenCalledWith(
      "session-managed",
      harness.target,
    );
  });

  it("fails closed when an account-bound session has no managed route", async () => {
    const harness = vectorStoreHarness();
    const embed = vi.fn();
    const ai = {
      gateway: { resolveSlot: vi.fn(), embed },
      presetRegistry: { resolveEmbeddingTarget: vi.fn() },
    } as unknown as AiStack;
    const ensureLock = createEmbeddingLockHelper({
      store: harness.store,
      ai,
      resolveEmbeddingRequest: async () => null,
    });

    await ensureLock("session-unresolved");

    expect(embed).not.toHaveBeenCalled();
    expect(harness.ensureVectorModel).not.toHaveBeenCalled();
    expect(harness.lockSessionEmbeddingModel).not.toHaveBeenCalled();
  });
});
