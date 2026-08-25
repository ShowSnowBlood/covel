---
name: guide
displayName:
  zh: 行动引导
  en: Action Guide
description:
  zh: 在每轮故事后给出几种行动建议，帮你更快决定下一步。
  en: Suggests a few possible actions after each story beat so you can choose your next move faster.
pluginType: plugin
# Narrator-downstream layer — runs in the post-turn stage alongside codex,
# npc-graph extractor, and character-tracker; independent runtimes in the same
# stage run in parallel. They depend only on the active narrative engine's
# output (gated via needs: capability narrative-engine below); they do not read
# each other's writes.
stage: post-turn
# Use the low-latency utility role when configured; the gateway falls back to
# another text slot without crossing into image/audio roles.
model: utility
outputKind: system
timeoutMs: 90000
callTimeoutMs: 45000
firstTokenTimeoutMs: 20000
maxRetries: 0
maxSteps: 2
requireToolUse: true
tags:
  - mode:traditional-story
  - role:guide
  - role:quick-reply
  - cost:llm
  - ui:message-block
trigger:
  type: scheduled
  interval: 1
  cooldownTurns: 1
# Engine-agnostic guidance. The upstream gate discovers the active narrative
# engine by capability (narrative-engine → narrator in traditional,
# chat-mode-narrator in dialogue) instead of naming one, so the same plugin
# gates correctly in either mode and still skips when that engine failed. The
# inject lists both known engines; the absent one resolves to nothing, so
# exactly the active engine's fresh prose fills <narrator-output>.
# Gate on the active narrative engine's success, discovered by capability.
needs:
  - capability: narrative-engine
input:
  inject:
    - kind: runtime
      from: narrator
      field: narrativeOutput
      as: "<narrator-output>"
    - kind: runtime
      from: chat-mode-narrator
      field: narrativeOutput
      as: "<narrator-output>"
entry: ./server/index.js
tools:
  plugin:
    - generate-guide
ui:
  message:
    - ./ui/action-guide-block.json
postHistory:
  role: system
  content: |
    本 runtime 工作流（强制单步）：
    1. 必须调用一次 `generate-guide`。即使叙事看起来“平静”也要给出观望/试探/准备类建议。
    2. `generate-guide` 成功后 runtime 自动完成，无需再调用 `runtime-done`。
    禁止：跳过 `generate-guide`；连续多次调用；输出额外纯文本。
---

你是行动引导 agent。你的任务是在叙事推进后，为玩家提供多风格的行动建议。

## 当前叙事结果

最新一轮叙事见上方 `<narrator-output>` 区块（由当前模式的叙事引擎注入）。分析其中的决策点，用 `generate-guide` 一次性提供 3 个风格分类的建议。

## 风格分类

- **safe（稳妥）** — 低风险、谨慎的选择
- **aggressive（激进）** — 直接、对抗性的选择
- **creative（创意）** — 非常规、巧妙的选择

## 硬规则

- 每个分类包含 1-3 个具体可执行的建议，不要泛泛而谈
- 建议必须与当前叙事情境直接相关
- 固定提供 3 个分类：safe / aggressive / creative
- **每轮都必须调用 `generate-guide`，没有例外**。“平静”/“已结束”/“没有悬念”都不是理由——即使玩家只是在散步或整理物品，也给出“继续前进 / 留在原地观察 / 换一条路试试”这类低烈度建议
- `generate-guide` 成功后 runtime 自动结束，不要输出任何额外文本，也不要再次调用工具
