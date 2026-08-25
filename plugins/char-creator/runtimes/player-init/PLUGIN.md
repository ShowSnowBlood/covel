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
trigger:
  type: auto
# This setup runtime remains pending until its deterministic handler observes a
# submitted char-creation form and returns preGameDone=true.
needs:
  - pregame
  - world-init/schema-gen
# First setup execution receives same-turn producer values. Optional bindings
# remain available while the runtime waits for the player's form submission.
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
    - characters:*
    - plugin-data:self:characters
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

此 runtime 不调用 LLM。`handler.js` 负责完整的确定性流程，因此服务商瞬时故障
不会阻塞开局：

1. 首次 setup 执行把 `world-init/schema-gen` 输出的角色属性 Schema 转换成
   `char-creation` 表单，并返回 `preGameDone: false`。
2. 玩家提交后，下一次执行读取 `player_inputs`，原子写入玩家角色及角色面板镜像，
   返回 `preGameDone: true`，不再生成第二张表单。
3. 已存在玩家时，handler 直接完成 setup 并保持角色镜像。

字段规则：姓名必填；按 `bio → abilities → social → equipment → stats` 选择最多
三个可编辑属性；数值型 `stats` 使用 Schema 默认值，不进入表单。
