import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

const api = vi.hoisted(() => ({
  clearManagedFrostFoxSlots: vi.fn(),
  fetchAccount: vi.fn(),
  fetchModels: vi.fn(),
  setCatalog: vi.fn(),
  reconcileSlots: vi.fn(),
  signOut: vi.fn(),
  disconnect: vi.fn(),
  refreshSharedAccount: vi.fn(),
}));

vi.mock("@/services/api.js", () => ({
  clearManagedFrostFoxSlots: api.clearManagedFrostFoxSlots,
  fetchFrostFoxAccount: api.fetchAccount,
  fetchFrostFoxModels: api.fetchModels,
  setManagedFrostFoxCatalog: api.setCatalog,
  reconcileManagedFrostFoxSlots: api.reconcileSlots,
  signOutFrostFox: api.signOut,
  disconnectFrostFox: api.disconnect,
}));

vi.mock("@/components/frostfox-account-summary.js", () => ({
  useFrostFoxAccount: () => ({ refresh: api.refreshSharedAccount }),
}));

const { FrostFoxAccountPane } = await import("../FrostFoxAccountPane.js");

const TEXT_CAPABILITY = {
  input: ["text"] as const,
  output: ["text"] as const,
};
const IMAGE_CAPABILITY = {
  input: ["text", "image"] as const,
  output: ["image"] as const,
};

describe("FrostFoxAccountPane", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    api.fetchAccount.mockResolvedValue({
      enabled: true,
      authenticated: true,
      account: {
        id: "account-1",
        name: "Player One",
        balance: 42.5,
        credentialState: "active",
        lastVerifiedAt: "2026-08-25T00:00:00.000Z",
      },
    });
    api.fetchModels.mockResolvedValue({
      configurationVersion: "7",
      channels: [
        {
          channelKey: "text-pro",
          providerId: "frostfox-text",
          displayName: "Text Pro",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "openai/gpt-5.6-sol",
              name: "GPT 5.6",
              capability: TEXT_CAPABILITY,
            },
          ],
        },
        {
          channelKey: "images",
          providerId: "frostfox-images",
          displayName: "Images",
          enabled: true,
          protocol: "openai-chat-v1",
          baseUrl: "https://market.example/v1",
          models: [
            {
              id: "openai/gpt-image-2-2k",
              name: "GPT Image 2 · 2K",
              capability: IMAGE_CAPABILITY,
            },
            {
              id: "openai/gpt-image-2-4k",
              name: "GPT Image 2 · 4K",
              capability: IMAGE_CAPABILITY,
            },
          ],
        },
      ],
    });
  });

  it("lists every model from every account channel with its output modality", async () => {
    render(<FrostFoxAccountPane />);

    expect(await screen.findByText("FrostFox managed models")).toBeTruthy();
    expect(screen.getByText("3 models")).toBeTruthy();
    expect(screen.getByText("Text Pro")).toBeTruthy();
    expect(screen.getByText("Images")).toBeTruthy();
    expect(screen.getByText("GPT 5.6")).toBeTruthy();
    expect(screen.getByText("GPT Image 2 · 2K")).toBeTruthy();
    expect(screen.getByText("GPT Image 2 · 4K")).toBeTruthy();
    expect(screen.getAllByText("Image")).toHaveLength(2);
    expect(api.setCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ configurationVersion: "7" }),
    );
  });
});
