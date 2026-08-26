import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { SessionRecord, WorldRecord } from "@/services/api.js";
import { Route } from "../session.js";

const navigate = vi.hoisted(() => vi.fn());
const routeSearch = vi.hoisted(() => ({ sid: "sess-1" }));
const sessionState = vi.hoisted(() => ({
  booted: true,
  bootError: null as string | null,
  session: null as SessionRecord | null,
  world: null as WorldRecord | null,
  worlds: [] as WorldRecord[],
  packages: [],
  presets: [],
  llmConfig: null,
}));
const resumeSessionById = vi.hoisted(() => vi.fn());
const resetSession = vi.hoisted(() => vi.fn());
const backToWorldSelect = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => routeSearch,
  }),
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      typeof options === "string" ? options : key,
  }),
}));

vi.mock("@/components/frostfox-account-summary.js", () => ({
  useFrostFoxAccount: () => ({
    status: { enabled: false, authenticated: false, account: null },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/stores/session-store.js", () => ({
  useSession: () => ({
    state: sessionState,
    boot: vi.fn(),
    selectWorld: vi.fn(),
    startGame: vi.fn(),
    resumeSession: vi.fn(),
    resumeSessionById,
    deleteSession: vi.fn(),
    backToWorldSelect,
    resetSession,
    updateWorldLocal: vi.fn(),
    addWorldLocal: vi.fn(),
    removeWorldLocal: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-slot-config.js", () => ({
  useSlotConfig: () => ({ resolvedSlots: [] }),
}));

vi.mock("@/hooks/use-settings-dialog.js", () => ({
  useSettingsDialog: () => ({
    open: false,
    setOpen: vi.fn(),
    onOpenChange: vi.fn(),
    initialKey: undefined,
  }),
}));

vi.mock("@/lib/desktop-bridge.js", () => ({
  initDesktopBridge: () => () => {},
}));

vi.mock("@/services/data-service.js", () => ({
  getDataService: () => ({ listMessages: vi.fn() }),
}));

vi.mock("@/lib/chat-export.js", () => ({
  mergeChatExportMessages: vi.fn(),
}));

vi.mock("@/stores/streaming-text-store.js", () => ({
  getStreamingText: vi.fn(),
}));

vi.mock("@/lib/toast-channel.js", () => ({
  emitToast: vi.fn(),
}));

vi.mock("@/components/session/game-view.js", () => ({
  GameView: ({ session }: { session: SessionRecord }) => (
    <div data-testid="game-view">{session.id}</div>
  ),
}));

vi.mock("@/components/session/world-select-screen.js", () => ({
  WorldSelectScreen: () => <div data-testid="world-select" />,
}));

vi.mock("@/components/session/session-prep-screen.js", () => ({
  SessionPrepScreen: () => <div data-testid="session-prep" />,
}));

vi.mock("@/components/onboarding-wizard.js", () => ({
  OnboardingWizard: () => null,
}));

vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

function getRouteComponent(): () => React.JSX.Element {
  return (Route.options?.component ??
    (Route as { component?: unknown }).component) as () => React.JSX.Element;
}

function makeSession(id = "sess-1"): SessionRecord {
  return {
    id,
    worldId: "fog-port",
    status: "active",
    turnCount: 1,
    createdAt: "",
    updatedAt: "",
  };
}

function makeWorld(): WorldRecord {
  return {
    id: "fog-port",
    name: "Fog Port",
    description: "A harbor world.",
    createdAt: "",
  };
}

describe("Session URL synchronization", () => {
  beforeEach(() => {
    cleanup();
    navigate.mockClear();
    resetSession.mockClear();
    backToWorldSelect.mockClear();
    resumeSessionById.mockReset().mockResolvedValue(undefined);
    routeSearch.sid = "sess-1";
    sessionState.booted = true;
    sessionState.bootError = null;
    sessionState.session = makeSession();
    sessionState.world = makeWorld();
  });

  afterEach(() => {
    cleanup();
  });

  it("clears the old sid instead of auto-resuming after returning to prep", async () => {
    const Component = getRouteComponent();
    const view = render(<Component />);
    await screen.findByTestId("game-view");

    resetSession();
    sessionState.session = null;
    view.rerender(<Component />);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/session",
        search: {},
        replace: true,
      }),
    );
    expect(resumeSessionById).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-prep")).toBeTruthy();
  });

  it("still auto-resumes a direct session URL once", async () => {
    routeSearch.sid = "sess-restore";
    sessionState.session = null;
    sessionState.world = null;

    const Component = getRouteComponent();
    render(<Component />);

    await waitFor(() =>
      expect(resumeSessionById).toHaveBeenCalledWith("sess-restore"),
    );
  });
});
