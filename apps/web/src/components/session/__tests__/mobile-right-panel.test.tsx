import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WorldRecord } from "@/services/api.js";
import { RightPanel } from "../right-panel.js";
import { WorldDocumentPanel } from "../world-document-panel.js";

const { formatTranslation } = vi.hoisted(() => {
  const format = (
    key: string,
    options?: string | { defaultValue?: string; [k: string]: unknown },
  ) => {
    if (typeof options === "string") return options;
    if (options && typeof options === "object" && typeof options.defaultValue === "string") {
      return options.defaultValue;
    }
    return key;
  };
  return { formatTranslation: format };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: formatTranslation,
    i18n: { language: "zh-CN" },
  }),
}));

vi.mock("@/stores/session-store.js", () => ({
  useSession: () => ({
    state: {
      sessionPlugins: [],
    },
  }),
}));
vi.mock("@/services/api.js", () => ({
  fetchUiSpecs: vi.fn().mockResolvedValue({ right: [] }),
  listPluginData: vi.fn().mockResolvedValue([]),
  listStateTables: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/stores/plugin-data-store.js", () => ({
  loadPluginData: vi.fn(),
  usePluginNamespace: () => ({}),
}));

vi.mock("@/components/reactbits/index.js", () => ({
  ShinyText: ({ children }: { children: React.ReactNode }) => children,
}));

const mockWorld: WorldRecord = {
  id: "mistport",
  name: "雾港·裂潮纪",
  description: "一座被永恒浓雾包裹的港口城市。",
  lore: "## 世界设定\n\n雾港是一座嵌在悬崖断面与海面之间的港口城市。\n\n## 核心规则\n\n- 裂潮法则：每次退潮，下潮区都会重组。",
  tags: ["悬疑", "奇幻", "航海"],
  createdAt: "2026-01-01T00:00:00Z",
};

describe("RightPanel mobile & responsive adaptation", () => {
  beforeEach(() => {
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
  });

  it("renders horizontal top tab scroller on mobile viewport", () => {
    const { container } = render(
      <RightPanel
        sessionId="sess_test"
        world={mockWorld}
        statePatches={[]}
      />,
    );

    // In mobile mode, the horizontal scroller container is rendered with border-b
    const tabScroller = container.querySelector(".border-b.overflow-x-auto");
    expect(tabScroller).toBeTruthy();

    // Both World and Database tabs are rendered
    expect(screen.getByRole("tab", { name: "session.worldTab" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "session.database" })).toBeTruthy();

    // Default tab is World, rendering the WorldDocumentPanel with hero card and markdown
    expect(screen.getByText("§ WORLD ARCHIVE")).toBeTruthy();
    expect(screen.getByText("雾港·裂潮纪")).toBeTruthy();
    expect(screen.getByText("悬疑")).toBeTruthy();
  });

  it("switches to Database tab on mobile click", () => {
    render(
      <RightPanel
        sessionId="sess_test"
        world={mockWorld}
        statePatches={[]}
      />,
    );

    const dbTab = screen.getByRole("tab", { name: "session.database" });
    fireEvent.keyDown(dbTab, { key: "Enter" });
    // Database tab content is now active
    expect(screen.getByText(/session\.dbVolumes/)).toBeTruthy();
  });

  it("renders vertical rail on desktop viewport", () => {
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

    const { container } = render(
      <RightPanel
        sessionId="sess_test"
        world={mockWorld}
        statePatches={[]}
      />,
    );

    // In desktop mode, the vertical rail with border-r is rendered
    const verticalRail = container.querySelector(".border-r");
    expect(verticalRail).toBeTruthy();
  });

  it("renders WorldDocumentPanel with hero card, tag badges and styled markdown", () => {
    render(<WorldDocumentPanel world={mockWorld} />);

    expect(screen.getByText("§ WORLD ARCHIVE")).toBeTruthy();
    expect(screen.getByText("雾港·裂潮纪")).toBeTruthy();
    expect(screen.getByText("悬疑")).toBeTruthy();
    expect(screen.getByText("奇幻")).toBeTruthy();
    expect(screen.getByText("航海")).toBeTruthy();
    expect(screen.getByText(/世界设定/)).toBeTruthy();
    expect(screen.getByText(/核心规则/)).toBeTruthy();
  });
});
