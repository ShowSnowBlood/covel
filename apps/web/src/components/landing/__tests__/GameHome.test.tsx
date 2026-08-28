import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const setOpen = vi.hoisted(() => vi.fn());
const accountState = vi.hoisted(() => ({
  status: {
    enabled: true,
    authenticated: false,
    account: undefined,
  } as {
    enabled: boolean;
    authenticated: boolean;
    account?: { isAdmin?: boolean };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/frostfox-account-context.js", () => ({
  useFrostFoxAccount: () => ({
    status: accountState.status,
    loading: false,
    error: false,
    refresh: vi.fn(),
  }),
  frostFoxSettingsAvailable: (
    status: typeof accountState.status,
    localAdmin = false,
  ) =>
    localAdmin ||
    status?.enabled === false ||
    status?.account?.isAdmin === true,
}));
vi.mock("@/hooks/use-settings-dialog.js", () => ({
  useSettingsDialog: () => ({
    open: false,
    setOpen,
    onOpenChange: vi.fn(),
    initialKey: undefined,
  }),
}));
vi.mock("@/settings/SettingsDialog.js", () => ({
  SettingsDialog: () => null,
}));
vi.mock("@/components/visual-effects/SceneLoadingTransition.js", () => ({
  SceneLoadingTransition: () => null,
}));
vi.mock("@/components/reactbits/index.js", () => ({
  Particles: () => null,
  ShinyText: ({ children }: { children: React.ReactNode }) => children,
  Magnet: ({ children }: { children: React.ReactNode }) => children,
  StarBorder: ({ children }: { children: React.ReactNode }) => children,
}));

const { GameHome } = await import("../GameHome.js");

describe("GameHome", () => {
  beforeEach(() => {
    accountState.status = {
      enabled: true,
      authenticated: false,
      account: undefined,
    };
    navigate.mockClear();
    setOpen.mockClear();
  });

  it("keeps the cinematic home and its actions visible before account login", () => {
    render(<GameHome />);

    expect(
      screen.getByRole("heading", { name: "home.gameTitle" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "home.startPlaying" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.queryByRole("button", { name: "home.openSettings" }),
    ).toBeNull();
    expect(screen.queryByText("home.mainLoginRequired")).toBeNull();
    expect(
      document.querySelector(
        'img[src="/visuals/backgrounds/frostfox-game-cover-image2.png"]',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^Level /)).toBeNull();
  });

  it("opens settings for an administrator", () => {
    accountState.status = {
      enabled: true,
      authenticated: true,
      account: { isAdmin: true },
    };
    render(<GameHome />);

    fireEvent.click(screen.getByRole("button", { name: "home.openSettings" }));
    expect(setOpen).toHaveBeenCalledWith(true);
  });
});
