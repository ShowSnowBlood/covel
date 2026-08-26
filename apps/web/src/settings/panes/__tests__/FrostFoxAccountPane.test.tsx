import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FrostFoxAccountStatus,
  FrostFoxModelCatalog,
  ModelCapabilityInfo,
} from "@/services/api.js";
import i18n from "@/i18n";

const api = vi.hoisted(() => ({
  clearManagedFrostFoxSlots: vi.fn(),
  fetchModels: vi.fn(),
  setCatalog: vi.fn(),
  signOut: vi.fn(),
  disconnect: vi.fn(),
  accountContext: {
    status: null as FrostFoxAccountStatus | null,
    catalog: null as FrostFoxModelCatalog | null,
    loading: true,
    error: false,
    refresh: vi.fn(),
  },
}));

vi.mock("@/services/api.js", () => ({
  clearManagedFrostFoxSlots: api.clearManagedFrostFoxSlots,
  fetchFrostFoxModels: api.fetchModels,
  setManagedFrostFoxCatalog: api.setCatalog,
  signOutFrostFox: api.signOut,
  disconnectFrostFox: api.disconnect,
}));

vi.mock("@/components/frostfox-account-summary.js", () => ({
  useFrostFoxAccount: () => api.accountContext,
}));

const { FrostFoxAccountPane } = await import("../FrostFoxAccountPane.js");

const TEXT_CAPABILITY: ModelCapabilityInfo = {
  input: ["text"],
  output: ["text"],
};
const IMAGE_CAPABILITY: ModelCapabilityInfo = {
  input: ["text", "image"],
  output: ["image"],
};

describe("FrostFoxAccountPane", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    api.accountContext.status = {
      enabled: true,
      authenticated: true,
      account: {
        id: "account-1",
        name: "Player One",
        balance: 42.5,
        credentialState: "active",
        lastVerifiedAt: "2026-08-25T00:00:00.000Z",
      },
    };
    api.accountContext.catalog = {
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
    };
    api.accountContext.loading = false;
    api.accountContext.error = false;
    api.accountContext.refresh.mockResolvedValue(undefined);
  });

  it("renders the catalog supplied by the account provider", async () => {
    render(<FrostFoxAccountPane />);

    expect(await screen.findByText("FrostFox managed models")).toBeTruthy();
    expect(screen.getByText("3 models")).toBeTruthy();
    expect(screen.getByText("Text Pro")).toBeTruthy();
    expect(screen.getByText("Images")).toBeTruthy();
    expect(screen.getByText("GPT 5.6")).toBeTruthy();
    expect(screen.getByText("GPT Image 2 · 2K")).toBeTruthy();
    expect(screen.getByText("GPT Image 2 · 4K")).toBeTruthy();
    expect(screen.getAllByText("Image")).toHaveLength(2);
    expect(api.fetchModels).not.toHaveBeenCalled();
  });

  it("refreshes account state without requesting the model directory", async () => {
    render(<FrostFoxAccountPane />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));
    await waitFor(() =>
      expect(api.accountContext.refresh).toHaveBeenCalledTimes(1),
    );
    expect(api.fetchModels).not.toHaveBeenCalled();
  });
});
