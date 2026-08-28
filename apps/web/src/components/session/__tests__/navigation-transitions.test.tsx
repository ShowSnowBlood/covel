import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import type { SessionRecord, WorldRecord } from "@/services/api.js";
import type * as apiModule from "@/services/api.js";
import { GameView } from "../game-view.js";
import { SessionPrepScreen } from "../session-prep-screen.js";
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

const { formatTranslation, transitionSpies } = vi.hoisted(() => {
  const format = (
    key: string,
    options?: string | { defaultValue?: string; [k: string]: unknown },
  ) => {
    if (typeof options === "string") return options;
    if (key === "session.breadcrumbWorldSelect") return "选择世界";
    if (
      options &&
      typeof options === "object" &&
      typeof options.defaultValue === "string"
    ) {
      return options.defaultValue;
    }
    return key;
  };
  return {
    formatTranslation: format,
    transitionSpies: {
      lastProps: null as Record<string, unknown> | null,
    },
  };
});

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
vi.mock("@/settings/SettingsDialog.js", () => ({
  SettingsDialog: () => null,
}));

vi.mock("i18next", () => ({
  default: { language: "zh-CN", t: formatTranslation },
}));

vi.mock("@/i18n", () => ({
  default: { language: "zh-CN", t: formatTranslation },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: formatTranslation,
    i18n: { language: "zh-CN" },
  }),
}));

vi.mock("@/components/reactbits/index.js", () => ({
  Particles: () => null,
  ShinyText: ({ children }: { children: ReactNode }) => children,
  DecryptedText: ({ text }: { text: string }) => <span>{text}</span>,
  Magnet: ({ children }: { children: ReactNode }) => children,
  StarBorder: ({ children }: { children: ReactNode }) => children,
}));

const mockBackToWorldSelect = vi.fn();
const mockResetSession = vi.fn();

const mockSessionState = {
  world: {
    id: "fog-port",
    name: "雾港·裂潮纪",
    description: "一座被永恒浓雾包裹的港口城市。",
    metadata: {},
  } as WorldRecord,
  messages: [],
  executing: false,
  executionError: null,
  packages: [],
  pluginLoadErrors: [],
  sessionPlugins: [],
  presets: [],
  llmConfig: {},
  statePatches: [],
  executionSteps: [],
  worldSessions: [],
  submittedBlockIds: [],
  submittedBlockValues: {},
};

vi.mock("@/stores/session-store.js", () => ({
  useSession: () => ({
    state: mockSessionState,
    sendMessage: vi.fn(),
    submitBlock: vi.fn(),
    submitInteraction: vi.fn(),
    beginAdventure: vi.fn(),
    retryRuntime: vi.fn(),
    resetSession: mockResetSession,
    backToWorldSelect: mockBackToWorldSelect,
    resumeSession: vi.fn(),
    deleteSession: vi.fn(),
    loadWorldSessions: vi.fn(),
    loadSessionPlugins: vi.fn().mockResolvedValue([]),
    toggleSessionPlugin: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-slot-config.js", () => ({
  useSlotConfig: () => ({ resolvedSlots: [], refresh: vi.fn() }),
  formatSlotLabel: () => "",
  resolveDeclaredSlot: () => ({ isConfigured: true }),
}));

vi.mock("@/hooks/use-settings-dialog.js", () => ({
  useSettingsDialog: () => ({
    open: false,
    setOpen: vi.fn(),
    onOpenChange: vi.fn(),
    initialKey: undefined,
  }),
}));

vi.mock("@/hooks/use-document-session-state.js", () => ({
  useDocumentSessionState: () => {},
}));

vi.mock("@/components/session/game-view/use-game-view-composer.js", () => ({
  useGameViewComposer: () => ({
    inputValue: "",
    setInputValue: vi.fn(),
    pendingDrafts: [],
    suspensions: [],
    composerBlocked: false,
    composerDisabled: false,
    awaitingBegin: false,
    handleConfirmDrafts: vi.fn(),
    handleSubmit: vi.fn(),
    handleAbort: vi.fn(),
    handleKeyDown: vi.fn(),
    removeInteractionDraft: vi.fn(),
    resumeSuspension: vi.fn(),
    cancelSuspension: vi.fn(),
  }),
}));

vi.mock("@/components/session/stage/use-stage-media-preload.js", () => ({
  useStageMediaPreload: () => {},
}));

vi.mock("@/services/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>();
  return {
    ...actual,
    fetchFrostFoxProgression: vi.fn().mockResolvedValue({ completedLevel: 0 }),
    frostFoxLevelForWorld: () => 1,
    listWorldSessions: vi.fn().mockResolvedValue([]),
    getSessionPlugins: vi.fn().mockResolvedValue([]),
    getWorldOverlay: vi.fn().mockResolvedValue(null),
    removeWorldOverlay: vi.fn().mockResolvedValue(undefined),
    getPrepRuntimeBindings: vi.fn().mockReturnValue({}),
  };
});
describe("Navigation loading progress transitions", () => {
  beforeEach(() => {
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
    transitionSpies.lastProps = null;
    mockBackToWorldSelect.mockClear();
    mockResetSession.mockClear();
  });

  it("renders when layout persistence is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      render(
        <GameView
          session={{
            id: "sess_no_storage",
            worldId: "fog-port",
            status: "active",
            turnCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }}
        />,
      );
      expect(screen.getByRole("button", { name: "选择世界" })).toBeTruthy();
    } finally {
      if (descriptor) {
        Object.defineProperty(window, "localStorage", descriptor);
      }
    }
  });

  it("shows scene loading progress when clicking '选择世界' in GameView breadcrumb", () => {
    const session: SessionRecord = {
      id: "sess_1",
      worldId: "fog-port",
      status: "active",
      turnCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<GameView session={session} />);

    const worldSelectBtn = screen.getByRole("button", {
      name: "选择世界",
    });
    fireEvent.click(worldSelectBtn);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe("选择世界");
    fireEvent.click(screen.getByTestId("complete-transition"));
    expect(mockBackToWorldSelect).toHaveBeenCalledTimes(1);
  });

  it("shows scene loading progress when clicking world title ('雾港·裂潮纪') in GameView breadcrumb", () => {
    const session: SessionRecord = {
      id: "sess_1",
      worldId: "fog-port",
      status: "active",
      turnCount: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<GameView session={session} />);

    const worldTitleBtn = screen.getByRole("button", {
      name: "雾港·裂潮纪",
    });
    fireEvent.click(worldTitleBtn);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe(
      "雾港·裂潮纪",
    );

    fireEvent.click(screen.getByTestId("complete-transition"));
    expect(mockResetSession).toHaveBeenCalledTimes(1);
  });

  it("shows scene loading progress when clicking 'Select World' back button in SessionPrepScreen", () => {
    const onBack = vi.fn();
    const world: WorldRecord = {
      id: "fog-port",
      name: "雾港·裂潮纪",
      description: "一座被永恒浓雾包裹的港口城市。",
      createdAt: new Date().toISOString(),
    };

    render(
      <SessionPrepScreen
        world={world}
        packages={[]}
        presets={[]}
        llmConfig={{ configured: true, slots: {}, providers: [] }}
        onBack={onBack}
        onStart={vi.fn()}
        onResume={vi.fn()}
        onDeleteSession={vi.fn()}
        settingsOpen={false}
        onSettingsOpenChange={vi.fn()}
      />,
    );

    const backButton = screen.getByRole("button", {
      name: "Select World",
    });
    fireEvent.click(backButton);

    expect(screen.getByTestId("scene-loading-transition")).toBeTruthy();
    expect(screen.getByTestId("transition-title").textContent).toBe("选择世界");
  });
  it("uses full-height overlay drawers on mobile instead of stacked rails", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 768px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const session: SessionRecord = {
      id: "sess_mobile",
      worldId: "fog-port",
      status: "active",
      turnCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<GameView session={session} />);

    expect(document.querySelectorAll("[data-panel]")).toHaveLength(1);
    const leftDrawer = document.querySelector(
      '[data-testid="mobile-rail-drawer"][data-side="left"]',
    );
    const rightDrawer = document.querySelector(
      '[data-testid="mobile-rail-drawer"][data-side="right"]',
    );
    expect(leftDrawer?.getAttribute("data-open")).toBe("false");
    expect(rightDrawer?.getAttribute("data-open")).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: "session.toggleStoryPanel" }),
    );
    expect(leftDrawer?.getAttribute("data-open")).toBe("true");
    expect(leftDrawer?.querySelector('[role="dialog"]')).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(leftDrawer?.getAttribute("data-open")).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: "session.toggleContextPanel" }),
    );
    expect(rightDrawer?.getAttribute("data-open")).toBe("true");
    expect(leftDrawer?.getAttribute("data-open")).toBe("false");
  });
});
