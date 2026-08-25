---
name: char-creator/player-init
description:
  zh: 开局引导你填写主角信息，并把主角加入故事。
  en: Guides you through creating your hero at the start and brings them into the story.
pluginType: core-plugin
stage: setup
runtimeType: function
resultFormat: envelope-v1
outputKind: system
handler: ./handler.js
timeoutMs: 5000
tags:
  - role:pre-game
  - role:character
  - data:world-data
  - data:characters
  - cost:function
  - ui:right-panel
guard: ./guard.js
trigger:
  type: auto
# Keep the session-aware setup gate: on the submission execution these
# producers may already be in setupRuntimes rather than running again.
needs:
  - pregame
  - world-init/schema-gen
# First setup execution receives same-turn values. Optional bindings let the
# guard consume a later form submission even when completed producers do not
# rerun in that execution.
inputs:
  opening:
    from:
      runtime: pregame
    select: "/narrativeOutput"
    required: false
  worldSchema:
    from:
      runtime: world-init/schema-gen
    select: "/worldSchema"
    required: false
effects:
  writes:
    - interaction:*
dataSchemas:
  characters:
    schemaVersion: 1
    acceptsWorldData: true
    schema: ./schemas/characters.schema.json
    description: Importable session character records for the character panel.
ui:
  right:
    - ../../ui/character-panel.json
---

# 确定性角色创建表单

此 runtime 不调用 LLM。`handler.js` 把 `world-init/schema-gen` 输出的角色属性
Schema 直接转换成表单，因此服务商瞬时故障不会阻塞开局：

1. 首次 setup 执行返回 `char-creation` 表单，`preGameDone: false`。
2. 玩家提交后，`guard.js` 在下一次执行中确定性写入玩家角色并返回
   `preGameDone: true`。
3. 已存在玩家时，guard 直接跳过并保持角色镜像。

字段规则：姓名必填；按 `bio → abilities → social → equipment → stats` 选择最多
三个可编辑属性；数值型 `stats` 使用 Schema 默认值，不进入表单。
