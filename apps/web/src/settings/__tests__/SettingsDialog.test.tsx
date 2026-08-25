import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

const fakeStore = vi.hoisted(() => ({
  listEntries: () => [
    {
      key: "plugin.chat-mode-narrator.dialogueRatio",
      group: "plugin",
      pluginId: "chat-mode-narrator",
      label: "Dialogue ratio",
    },
    {
      key: "plugin.cost-gate.tokenBudget",
      group: "plugin",
      pluginId: "cost-gate",
      label: "Token budget",
    },
  ],
  subscribeAll: () => () => undefined,
}));

vi.mock("@/settings/use-settings.js", () => ({
  useSettingsStore: () => fakeStore,
}));
vi.mock("@/lib/desktop-bridge.js", () => ({ isDesktopApp: () => true }));
vi.mock("@/settings/widgets/index.js", () => ({
  SettingWidget: ({ entry }: { entry: { key: string } }) => (
    <div data-testid="active-setting">{entry.key}</div>
  ),
}));
vi.mock("@/components/reactbits/index.js", () => ({
  ShinyText: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/ui/dialog.js", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));
vi.mock("@/settings/panes/AppearancePane.js", () => ({
  AppearancePane: () => <div data-testid="appearance-pane" />,
}));

const { SettingsDialog } = await import("../SettingsDialog.js");

describe("SettingsDialog plugin navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US");
  });

  it("does not reapply initialKey after the player selects another plugin", async () => {
    render(
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        initialKey="plugin.chat-mode-narrator.dialogueRatio"
      />,
    );

    expect((await screen.findByTestId("active-setting")).textContent).toBe(
      "plugin.chat-mode-narrator.dialogueRatio",
    );

    const costGateButtons = screen.getAllByRole("button", {
      name: "cost-gate",
    });
    fireEvent.click(costGateButtons[0]!);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("active-setting").textContent).toBe(
      "plugin.cost-gate.tokenBudget",
    );
    for (const button of costGateButtons) {
      expect(button.getAttribute("aria-current")).toBe("page");
    }
    for (const button of screen.getAllByRole("button", {
      name: "chat-mode-narrator",
    })) {
      expect(button.hasAttribute("aria-current")).toBe(false);
    }
  });
});
