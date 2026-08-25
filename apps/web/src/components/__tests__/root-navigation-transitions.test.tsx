import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import type { SessionRecord, WorldRecord } from "@/services/api.js";
import { Route } from "@/routes/__root.js";

const navigate = vi.hoisted(() => vi.fn());
const locationState = vi.hoisted(() => ({
  pathname: "/session",
  search: { sid: "sess_1" },
}));

const mockBackToWorldSelect = vi.hoisted(() => vi.fn());
const mockSessionState = vi.hoisted(() => ({
  session: {
    id: "sess_1",
    worldId: "fog-port",
    turnCount: 1,
    createdAt: "",
    updatedAt: "",
  } as SessionRecord | null,
  world: {
    id: "fog-port",
    name: "雾港·裂潮纪",
    description: "海港世界",
  } as WorldRecord | null,
}));

const transitionSpies = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (config: Record<string, unknown>) => config,
  useNavigate: () => navigate,
  useLocation: () => locationState,
  Link: ({
    to,
    onClick,
    children,
    className,
  }: {
    to: string;
    onClick?: (e: React.MouseEvent) => void;
    children: ReactNode;
    className?: string;
  }) => (
    <a
      href={to}
      className={className}
      onClick={onClick}
      data-testid="router-link"
    >
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("@tanstack/react-router-devtools", () => ({
  TanStackRouterDevtools: () => null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultVal?: string) => defaultVal ?? key,
  }),
}));

vi.mock("@/components/theme-toggle.js", () => ({
  ThemeToggle: () => null,
}));

vi.mock("@/components/frostfox-account-summary.js", () => ({
  FrostFoxAccountSummary: () => null,
}));

vi.mock("@/components/ui/toast-host.js", () => ({
  ToastHost: () => null,
}));

vi.mock("@/components/ui/confirm-host.js", () => ({
  ConfirmHost: () => null,
}));

vi.mock("@/components/error-boundary.js", () => ({
  AppErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/hooks/useLocalePreference.js", () => ({
  useLocalePreference: () => ({ locale: "zh-CN", setLocale: vi.fn() }),
}));

vi.mock("@/lib/desktop-bridge.js", () => ({
  getCovelIpc: () => null,
}));

vi.mock("@/stores/session-store.js", () => ({
  useSession: () => ({
    state: mockSessionState,
    backToWorldSelect: mockBackToWorldSelect,
  }),
}));

vi.mock("@/components/visual-effects/SceneLoadingTransition.js", () => ({
  SceneLoadingTransition: (props: Record<string, unknown>) => {
    transitionSpies.lastProps = props;
    return (
      <div data-testid="scene-loading-transition">
        <span data-testid="transition-title">{String(props.title ?? "")}</span>
        <button
          type="button"
          data-testid="complete-transition"
          onClick={() => (props.onComplete as (() => void) | undefined)?.()}
        >
          Complete
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/reactbits/index.js", () => ({
  Particles: () => null,
  ShinyText: ({ children }: { children: ReactNode }) => children,
  DecryptedText: ({ text }: { text: string }) => <span>{text}</span>,
  Magnet: ({ children }: { children: ReactNode }) => children,
  StarBorder: ({ children }: { children: ReactNode }) => children,
}));

function getRouteComponent(): () => React.JSX.Element {
  return (Route.options?.component ?? (Route as { component?: unknown }).component) as () => React.JSX.Element;
}

describe("Root layout navigation transitions", () => {
  beforeEach(() => {
    navigate.mockClear();
    mockBackToWorldSelect.mockClear();
    transitionSpies.lastProps = null;
    locationState.pathname = "/session";
    locationState.search = { sid: "sess_1" };
    mockSessionState.session = {
      id: "sess_1",
      worldId: "fog-port",
      status: "active",
      turnCount: 1,
      createdAt: "",
      updatedAt: "",
    };
    mockSessionState.world = {
      id: "fog-port",
      name: "雾港·裂潮纪",
      description: "海港世界",
      createdAt: "",
    };

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("shows loading progress transition when clicking 'Home' (首页) and completes navigation", () => {
    const Component = getRouteComponent();
    render(<Component />);

    const homeBtn = screen.getByRole("button", { name: "Home" });
    fireEvent.click(homeBtn);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe(
      "FrostFox Game",
    );
    fireEvent.click(screen.getByTestId("complete-transition"));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("shows loading progress transition when clicking logo and completes navigation to home", () => {
    const Component = getRouteComponent();
    render(<Component />);

    const logoLink = screen.getByTestId("router-link");
    fireEvent.click(logoLink);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe(
      "FrostFox Game",
    );

    fireEvent.click(screen.getByTestId("complete-transition"));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("shows loading progress transition when clicking 'World' (世界) and completes backToWorldSelect", () => {
    const Component = getRouteComponent();
    render(<Component />);

    const worldBtn = screen.getByRole("button", { name: "World" });
    fireEvent.click(worldBtn);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe(
      "选择世界",
    );

    fireEvent.click(screen.getByTestId("complete-transition"));
    expect(mockBackToWorldSelect).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/session", search: {} });
  });
});
