import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrostFoxModelCatalog } from "@/services/api.js";
import i18n from "@/i18n";
import {
  FrostFoxAccountProvider,
  FrostFoxAccountSummary,
  useFrostFoxAccount,
} from "../frostfox-account-summary.js";

const api = vi.hoisted(() => ({
  clearManagedFrostFoxSlots: vi.fn(),
  fetchAccount: vi.fn(),
  getManagedFrostFoxCatalog: vi.fn().mockReturnValue(null),
  hydrateManagedFrostFoxModels: vi.fn(),
  reconcileSlots: vi.fn(),
  signOutFrostFox: vi.fn(),
}));

vi.mock("@/services/api.js", () => ({
  clearManagedFrostFoxSlots: api.clearManagedFrostFoxSlots,
  fetchFrostFoxAccount: api.fetchAccount,
  hydrateManagedFrostFoxModels: api.hydrateManagedFrostFoxModels,
  reconcileManagedFrostFoxSlots: api.reconcileSlots,
  signOutFrostFox: api.signOutFrostFox,
  getManagedFrostFoxCatalog: api.getManagedFrostFoxCatalog,
  setManagedFrostFoxCatalog: vi.fn(),
}));

type AccountStatusFixture = {
  enabled: boolean;
  authenticated: boolean;
  account: {
    id: string;
    name: string;
    balance: number;
    credentialState: "active";
    lastVerifiedAt: string;
  };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function RefreshProbe() {
  const { status, catalog, refresh } = useFrostFoxAccount();
  return (
    <>
      <output data-testid="account-name">{status?.account?.name ?? ""}</output>
      <output data-testid="catalog-version">
        {catalog?.configurationVersion ?? ""}
      </output>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
    </>
  );
}

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
    expect(api.clearManagedFrostFoxSlots).toHaveBeenCalled();

    fireEvent.click(button);
    expect(screen.getByTestId("frostfox-connect-dialog")).toBeTruthy();
    expect(screen.getByText("Connect FrostFox Account")).toBeTruthy();
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
  it("publishes signed-out state after logout and refreshes the provider", async () => {
    api.fetchAccount
      .mockResolvedValueOnce({
        enabled: true,
        authenticated: true,
        account: {
          id: "ff-user-signout",
          name: "signout-user",
          balance: 10,
          credentialState: "active",
          lastVerifiedAt: "2026-08-26T02:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({ enabled: true, authenticated: false });
    api.signOutFrostFox.mockResolvedValue(undefined);

    render(
      <FrostFoxAccountProvider>
        <FrostFoxAccountSummary />
      </FrostFoxAccountProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Account and balance" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect Account" }),
      ).toBeTruthy(),
    );
    expect(api.signOutFrostFox).toHaveBeenCalledTimes(1);
    expect(api.fetchAccount).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest account state when refreshes resolve out of order", async () => {
    const first = deferred<AccountStatusFixture>();
    const second = deferred<AccountStatusFixture>();
    api.fetchAccount
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    api.hydrateManagedFrostFoxModels.mockResolvedValue(undefined);

    render(
      <FrostFoxAccountProvider>
        <RefreshProbe />
      </FrostFoxAccountProvider>,
    );
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(2));

    const current = {
      enabled: true,
      authenticated: true,
      account: {
        id: "new-account",
        name: "new",
        balance: 2,
        credentialState: "active" as const,
        lastVerifiedAt: "2026-08-26T00:00:00.000Z",
      },
    };
    await act(async () => {
      second.resolve(current);
      await second.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("account-name").textContent).toBe("new"),
    );

    await act(async () => {
      first.resolve({
        ...current,
        account: { ...current.account, name: "old" },
      });
      await first.promise;
    });
    expect(screen.getByTestId("account-name").textContent).toBe("new");
  });
  it("does not let stale hydration overwrite the newest account catalog", async () => {
    const firstAccount = deferred<AccountStatusFixture>();
    const secondAccount = deferred<AccountStatusFixture>();
    const firstCatalog = deferred<FrostFoxModelCatalog | null>();
    const secondCatalog = deferred<FrostFoxModelCatalog | null>();
    let currentCatalog: FrostFoxModelCatalog | null = null;
    api.fetchAccount
      .mockReturnValueOnce(firstAccount.promise)
      .mockReturnValueOnce(secondAccount.promise);
    api.getManagedFrostFoxCatalog.mockImplementation(() => currentCatalog);
    api.hydrateManagedFrostFoxModels
      .mockReturnValueOnce(firstCatalog.promise)
      .mockReturnValueOnce(secondCatalog.promise);

    const accountA: AccountStatusFixture = {
      enabled: true,
      authenticated: true,
      account: {
        id: "account-a",
        name: "A",
        balance: 1,
        credentialState: "active",
        lastVerifiedAt: "2026-08-26T00:00:00.000Z",
      },
    };
    const accountB: AccountStatusFixture = {
      ...accountA,
      account: { ...accountA.account, id: "account-b", name: "B" },
    };

    render(
      <FrostFoxAccountProvider>
        <RefreshProbe />
      </FrostFoxAccountProvider>,
    );
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(1));

    await act(async () => {
      firstAccount.resolve(accountA);
      await firstAccount.promise;
    });
    await waitFor(() =>
      expect(api.hydrateManagedFrostFoxModels).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(2));
    await act(async () => {
      secondAccount.resolve(accountB);
      await secondAccount.promise;
    });
    await waitFor(() =>
      expect(api.hydrateManagedFrostFoxModels).toHaveBeenCalledTimes(2),
    );

    currentCatalog = { configurationVersion: "account-b", channels: [] };
    await act(async () => {
      secondCatalog.resolve(currentCatalog);
      await secondCatalog.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("catalog-version").textContent).toBe(
        "account-b",
      ),
    );

    currentCatalog = { configurationVersion: "account-a", channels: [] };
    await act(async () => {
      firstCatalog.resolve(currentCatalog);
      await firstCatalog.promise;
    });
    expect(screen.getByTestId("catalog-version").textContent).toBe("account-b");
  });

  it("clears account model bindings when the account identity changes", async () => {
    const first = deferred<AccountStatusFixture>();
    const second = deferred<AccountStatusFixture>();
    api.fetchAccount
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    api.hydrateManagedFrostFoxModels.mockResolvedValue(undefined);

    render(
      <FrostFoxAccountProvider>
        <RefreshProbe />
      </FrostFoxAccountProvider>,
    );
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(1));

    const accountA: AccountStatusFixture = {
      enabled: true,
      authenticated: true,
      account: {
        id: "account-a",
        name: "A",
        balance: 1,
        credentialState: "active",
        lastVerifiedAt: "2026-08-26T00:00:00.000Z",
      },
    };
    await act(async () => {
      first.resolve(accountA);
      await first.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("account-name").textContent).toBe("A"),
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(api.fetchAccount).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve({
        ...accountA,
        account: { ...accountA.account, id: "account-b", name: "B" },
      });
      await second.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("account-name").textContent).toBe("B"),
    );
    expect(api.clearManagedFrostFoxSlots).toHaveBeenCalledTimes(1);
  });
});
