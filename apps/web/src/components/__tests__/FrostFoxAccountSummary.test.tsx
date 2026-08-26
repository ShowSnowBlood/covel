import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import {
  FrostFoxAccountProvider,
  FrostFoxAccountSummary,
} from "../frostfox-account-summary.js";

const api = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  hydrateManagedFrostFoxModels: vi.fn(),
  signOutFrostFox: vi.fn(),
}));

vi.mock("@/services/api.js", () => ({
  fetchFrostFoxAccount: api.fetchAccount,
  hydrateManagedFrostFoxModels: api.hydrateManagedFrostFoxModels,
  signOutFrostFox: api.signOutFrostFox,
  getManagedFrostFoxCatalog: vi.fn().mockReturnValue(null),
  setManagedFrostFoxCatalog: vi.fn(),
}));

vi.mock("@/settings/SettingsDialog.js", () => ({
  SettingsDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="settings-dialog">Mock Settings Dialog</div> : null,
}));

describe("FrostFoxAccountSummary", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
  });

  it("renders connect button when unauthenticated", async () => {
    api.fetchAccount.mockResolvedValue({
      enabled: true,
      authenticated: false,
    });

    render(
      <FrostFoxAccountProvider>
        <FrostFoxAccountSummary />
      </FrostFoxAccountProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "Connect Account",
    });
    expect(button).toBeTruthy();
  });

  it("renders interactive pill and opens popover on click when authenticated", async () => {
    api.fetchAccount.mockResolvedValue({
      enabled: true,
      authenticated: true,
      account: {
        id: "ff-user-12345678",
        name: "starriverlee",
        balance: 12673765.66,
        credentialState: "active",
        lastVerifiedAt: "2026-08-26T02:00:00.000Z",
      },
    });

    render(
      <FrostFoxAccountProvider>
        <FrostFoxAccountSummary />
      </FrostFoxAccountProvider>,
    );

    // Should display the username and initial
    expect(await screen.findByText("starriverlee")).toBeTruthy();
    expect(screen.getByText("S")).toBeTruthy();
    expect(screen.getByText("$12,673,765.66")).toBeTruthy();

    const trigger = screen.getByRole("button", {
      name: "Account and balance",
    });
    expect(trigger).toBeTruthy();

    // Click trigger to open popover
    fireEvent.click(trigger);

    // Popover dialog should now be visible
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("ff-user-12345678")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Account Settings")).toBeTruthy();
    expect(screen.getByText("Sign Out")).toBeTruthy();

    // Clicking Account Settings opens SettingsDialog
    const settingsBtn = screen.getByText("Account Settings");
    fireEvent.click(settingsBtn);
    expect(screen.getByTestId("settings-dialog")).toBeTruthy();
  });

  it("closes popover on Escape key press", async () => {
    api.fetchAccount.mockResolvedValue({
      enabled: true,
      authenticated: true,
      account: {
        id: "ff-user-999",
        name: "testuser",
        balance: 50.0,
        credentialState: "active",
        lastVerifiedAt: "2026-08-26T02:00:00.000Z",
      },
    });

    render(
      <FrostFoxAccountProvider>
        <FrostFoxAccountSummary />
      </FrostFoxAccountProvider>,
    );

    const trigger = await screen.findByRole("button", {
      name: "Account and balance",
    });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
