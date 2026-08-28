import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n/index.js";
import type { SessionPluginInfo } from "@/services/api.js";
import type { RuntimeJobStatus } from "@/stores/session-store.js";
import {
  IllustrationGenerationDialog,
  isIllustrationJob,
} from "../game-view/illustration-generation-dialog.js";

const imagePlugin: SessionPluginInfo = {
  id: "scene-stage",
  displayName: { "zh-CN": "场景舞台", "en-US": "Scene Stage" },
  isActive: true,
  runtimes: [
    {
      id: "scene-stage/background-gen",
      capabilities: ["image-generation", "image-generator"],
    },
  ],
};

function job(overrides: Partial<RuntimeJobStatus> = {}): RuntimeJobStatus {
  return {
    sessionId: "session-1",
    progressScopeId: "execution-1",
    pluginId: "scene-stage",
    runtimeId: "scene-stage/background-gen",
    jobId: "scene-background:harbour:day",
    state: "running",
    progress: 35,
    sequence: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    turnId: "turn-1",
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});

afterEach(() => cleanup());

describe("IllustrationGenerationDialog", () => {
  it("opens for an active capability-declared image runtime", () => {
    render(
      <IllustrationGenerationDialog
        jobStatuses={[job()]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    expect(screen.getByText("正在生成本回合插画")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "35",
    );
    expect(
      screen.getByText("关闭弹窗不会中断生成，你可以继续当前回合。"),
    ).toBeTruthy();
  });

  it("ignores ordinary runtime jobs", () => {
    render(
      <IllustrationGenerationDialog
        jobStatuses={[
          job({
            pluginId: "dice-check",
            runtimeId: "dice-check/roller",
            jobId: "dice-pool",
          }),
        ]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    expect(screen.queryByText("正在生成本回合插画")).toBeNull();
  });

  it("stays dismissed for later progress from the same job", () => {
    const view = render(
      <IllustrationGenerationDialog
        jobStatuses={[job()]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭并继续" }));
    expect(screen.queryByText("正在生成本回合插画")).toBeNull();

    view.rerender(
      <IllustrationGenerationDialog
        jobStatuses={[job({ state: "progress", progress: 70, sequence: 2 })]}
        sessionPlugins={[imagePlugin]}
      />,
    );
    expect(screen.queryByText("正在生成本回合插画")).toBeNull();
  });

  it("keeps the dialog open for a clear completion result", () => {
    const view = render(
      <IllustrationGenerationDialog
        jobStatuses={[job()]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    view.rerender(
      <IllustrationGenerationDialog
        jobStatuses={[
          job({
            state: "succeeded",
            progress: 100,
            sequence: 2,
          }),
        ]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    expect(screen.getByText("本回合插画已完成")).toBeTruthy();
    expect(screen.getByText("新插画已加入当前回合。"));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });

  it("shows a provider error in the failed final state", () => {
    const view = render(
      <IllustrationGenerationDialog
        jobStatuses={[job()]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    view.rerender(
      <IllustrationGenerationDialog
        jobStatuses={[
          job({
            state: "failed",
            progress: undefined,
            sequence: 2,
            message: "provider unavailable",
          }),
        ]}
        sessionPlugins={[imagePlugin]}
      />,
    );

    expect(screen.getByText("插画生成失败")).toBeTruthy();
    expect(screen.getByText("provider unavailable")).toBeTruthy();
  });

  it("recognises explicit image metadata when plugin details arrive late", () => {
    expect(
      isIllustrationJob(
        job({
          pluginId: "late-plugin",
          runtimeId: "late-plugin/generator",
          data: { modality: "image" },
        }),
        [],
      ),
    ).toBe(true);
  });
});
