import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: {
    "ui.onboardedVersion": 3,
    "ui.onboardedAccountId": "account-a",
  } as Record<string, unknown>,
  slotConfig: {} as Record<string, Record<string, string>>,
  store: {
    get: vi.fn((key: string) => state.values[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      state.values[key] = value;
    }),
    clear: vi.fn(async (key: string) => {
      delete state.values[key];
    }),
  },
}));

vi.mock("@/settings/store", () => ({
  getSettings: () => state.store,
}));
vi.mock("@/components/shared/ping-button.js", () => ({
  invalidatePingResult: vi.fn(),
}));
vi.mock("@/services/api.js", () => ({
  getProviderKeys: () => ({}),
  setProviderKeys: vi.fn(),
  getCustomPresets: () => [],
  setCustomPresets: vi.fn(),
  listPresets: vi.fn(async () => []),
  getSlotConfig: () => state.slotConfig,
  setSlotConfig: vi.fn((next: Record<string, Record<string, string>>) => {
    state.slotConfig = next;
  }),
  isManagedFrostFoxModelRef: () => false,
  slotBindingId: () => undefined,
}));

const { isOnboarded, markOnboarded, persistPluginModeSame, resetOnboarding } =
  await import("../persistence.js");

describe("account-scoped onboarding persistence", () => {
  beforeEach(() => {
    state.values = {
      "ui.onboardedVersion": 3,
      "ui.onboardedAccountId": "account-a",
    };
    state.slotConfig = {};
    vi.clearAllMocks();
  });

  it("accepts the completed account and replays for a different account", () => {
    expect(isOnboarded("account-a")).toBe(true);
    expect(isOnboarded("account-b")).toBe(false);
    expect(isOnboarded()).toBe(true);
  });

  it("persists the account marker with the completion version", async () => {
    await markOnboarded("account-b");
    expect(state.values).toEqual({
      "ui.onboardedVersion": 3,
      "ui.onboardedAccountId": "account-b",
    });
  });

  it("propagates completion persistence failures", async () => {
    state.store.set.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(markOnboarded("account-b")).rejects.toThrow(
      "disk unavailable",
    );
    expect(state.values).toEqual({
      "ui.onboardedVersion": 3,
      "ui.onboardedAccountId": "account-a",
    });
  });
  it("does not leave a new version when the first write had no prior marker", async () => {
    state.values = {};
    state.store.set.mockRejectedValueOnce(new Error("version write failed"));

    await expect(markOnboarded("account-b")).rejects.toThrow(
      "version write failed",
    );
    expect(state.values).toEqual({});
  });

  it("clears both markers when the tutorial is reset", async () => {
    resetOnboarding();
    await Promise.resolve();
    expect(state.values).toEqual({});
  });

  it("copies the narrator binding when plugin mode uses the same model", () => {
    state.slotConfig = {
      story: { modelRef: "frostfox:text:story-model" },
      plugin: { modelRef: "frostfox:text:old-plugin-model" },
    };

    persistPluginModeSame();

    expect(state.slotConfig).toEqual({
      story: { modelRef: "frostfox:text:story-model" },
      plugin: { modelRef: "frostfox:text:story-model" },
    });
  });
});
