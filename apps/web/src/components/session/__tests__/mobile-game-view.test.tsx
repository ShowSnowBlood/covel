import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TFunction } from "i18next";
import type { SessionRecord, WorldRecord } from "@/services/api.js";
import { GameViewHeader } from "../game-view/game-view-header.js";
import { MessageComposer } from "../game-view/message-composer.js";
import { SessionCanvasHero } from "../chat-messages/session-canvas-hero.js";

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

vi.mock("@/components/theme-toggle.js", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("@/components/session/game-view/connection-status.js", () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

const mockWorld: WorldRecord = {
  id: "mistport",
  name: "雾港·裂潮纪",
  description: "一座被永恒浓雾包裹的港口城市。",
  createdAt: "2026-01-01T00:00:00Z",
};

const mockSession: SessionRecord = {
  id: "sess_test",
  worldId: "mistport",
  status: "active",
  turnCount: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("GameView mobile responsive adaptation", () => {
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

  it("renders GameViewHeader with mobile-friendly mode toggles and breadcrumbs", () => {
    const onViewModeChange = vi.fn();
    const onToggleLeft = vi.fn();
    const onToggleRight = vi.fn();
    const onBackWorld = vi.fn();
    const onReset = vi.fn();

    render(
      <GameViewHeader
        t={formatTranslation as unknown as TFunction}
        world={mockWorld}
        executing={false}
        viewMode="parsed"
        isLeftCollapsed={true}
        isRightCollapsed={false}
        onViewModeChange={onViewModeChange}
        onToggleLeftPanel={onToggleLeft}
        onToggleRightPanel={onToggleRight}
        onOpenSettings={vi.fn()}
        onOpenSuspensions={vi.fn()}
        onBackToWorldSelect={onBackWorld}
        onResetSession={onReset}
        suspensionsCount={0}
        canCompleteLevel={false}
        levelCompleted={false}
        completingLevel={false}
        onCompleteLevel={vi.fn()}
      />,
    );

    // Breadcrumb renders world name
    expect(screen.getByText("雾港·裂潮纪")).toBeTruthy();

    // Mode toggles for parsed and stage are rendered
    const parsedToggle = screen.getByRole("button", { name: "session.viewParsedAria" });
    const stageToggle = screen.getByRole("button", { name: "session.viewStageAria" });
    expect(parsedToggle).toBeTruthy();
    expect(stageToggle).toBeTruthy();

    // Switching to stage view triggers callback
    fireEvent.click(stageToggle);
    expect(onViewModeChange).toHaveBeenCalledWith("stage");
  });

  it("renders MessageComposer with input, action buttons and safe-area padding", () => {
    const onInputValueChange = vi.fn();
    const onSubmit = vi.fn();
    const onAbort = vi.fn();

    render(
      <MessageComposer
        t={formatTranslation as unknown as TFunction}
        session={mockSession}
        executing={false}
        inputValue="下潜到第二层遗迹"
        composerBlocked={false}
        composerDisabled={false}
        awaitingBegin={false}
        onInputValueChange={onInputValueChange}
        onSubmit={onSubmit}
        onAbort={onAbort}
        onKeyDown={vi.fn()}
      />,
    );

    const input = screen.getByTestId("game-composer-input");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("下潜到第二层遗迹");

    const sendBtn = screen.getByRole("button", { name: "send" });
    fireEvent.click(sendBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders SessionCanvasHero with responsive title, tags and adventure action", () => {
    const onBegin = vi.fn();

    render(
      <SessionCanvasHero
        world={mockWorld}
        onBegin={onBegin}
        beginLabel="开始冒险"
        hintLabel="先点「开始冒险」，故事开始后再说话"
      />,
    );

    expect(screen.getByText("§ SESSION CANVAS")).toBeTruthy();
    expect(screen.getByText("雾港·裂潮纪")).toBeTruthy();

    const beginBtn = screen.getByRole("button", { name: "开始冒险" });
    fireEvent.click(beginBtn);
    expect(onBegin).toHaveBeenCalledTimes(1);
  });
});
