import { describe, expect, it, vi } from "vitest";
import handler from "../runtimes/player-init/handler.js";

function slot(value, runtimeId) {
  return {
    value,
    source: { runtimeId, pluginId: runtimeId.split("/")[0] },
  };
}

describe("char-creator/player-init deterministic form", () => {
  it("projects the world schema into one localized form without an LLM", async () => {
    const result = await handler({
      locale: "zh-CN",
      inputs: {
        opening: slot("雾港的深退潮即将开始。", "pregame"),
        worldSchema: slot(
          {
            "character-attributes": {
              version: 1,
              attributes: [
                {
                  id: "persona",
                  name: { "zh-CN": "性格", "en-US": "Personality" },
                  description: { "zh-CN": "描述你的行事风格" },
                  type: "string",
                  category: "bio",
                },
                {
                  id: "tideSense",
                  name: { "zh-CN": "潮感", "en-US": "Tide Sense" },
                  type: "enum",
                  options: ["敏锐", "迟钝"],
                  category: "abilities",
                },
                {
                  id: "fogRot",
                  name: { "zh-CN": "雾蚀", "en-US": "Fog Rot" },
                  type: "number",
                  min: 0,
                  max: 100,
                  defaultValue: 0,
                  category: "stats",
                },
                {
                  id: "faction",
                  name: { "zh-CN": "势力", "en-US": "Faction" },
                  type: "string",
                  category: "social",
                },
              ],
            },
          },
          "world-init/schema-gen",
        ),
      },
    });

    expect(result).toMatchObject({
      outcome: "success",
      value: { narrativeOutput: "", preGameDone: false },
      effects: {
        interactions: [
          {
            type: "form",
            interactionId: "char-creation",
            title: "塑造你的角色",
            submitLabel: "踏入雾中",
            submitBehavior: {
              echoFilledNarrative: true,
              immediate: true,
            },
          },
        ],
      },
    });
    expect(result).not.toHaveProperty("completion");

    const form = result.effects.interactions[0];
    expect(form.fields.map((field) => field.name)).toEqual([
      "characterName",
      "persona",
      "tideSense",
      "faction",
    ]);
    expect(form.fields[0]).toMatchObject({
      type: "text",
      required: true,
      label: "角色姓名",
    });
    expect(form.fields[2]).toMatchObject({
      type: "select",
      options: ["敏锐", "迟钝"],
    });
    expect(form.narrativeTemplate).toContain("{{characterName}}");
    expect(form.narrativeTemplate).toContain("{{tideSense}}");
  });

  it("falls back to a name-only form when no schema binding is available", async () => {
    const result = await handler({ locale: "en-US", inputs: {} });
    const form = result.effects.interactions[0];

    expect(form.title).toBe("Create your character");
    expect(form.submitLabel).toBe("Begin the adventure");
    expect(form.fields).toEqual([
      {
        type: "text",
        name: "characterName",
        label: "Character name",
        placeholder: "Enter your name",
        required: true,
      },
    ]);
  });

  it("consumes the submitted form once and completes setup without another interaction", async () => {
    let player;
    const upsertCharacter = vi.fn(async (character) => {
      player = character;
    });
    const setPluginData = vi.fn(async () => undefined);
    const store = {
      listCharacters: vi.fn(async () => (player ? [player] : [])),
      listPlayerInputs: vi.fn(async () => [
        {
          id: "input-unrelated",
          formId: "other-form",
          values: { characterName: "错误名字" },
          createdAt: "2026-08-25T00:00:02.000Z",
        },
        {
          id: "input-character",
          formId: "char-creation",
          values: { characterName: "七月", persona: "冷静" },
          createdAt: "2026-08-25T00:00:01.000Z",
        },
      ]),
      listPluginDataSessionScope: vi.fn(async () => [
        {
          namespace: "schema",
          key: "character-attributes",
          value: {
            attributes: [
              { id: "persona", type: "string" },
              { id: "trust", type: "number", defaultValue: 0 },
            ],
          },
        },
      ]),
      upsertCharacter,
      setPluginData,
    };

    const first = await handler({
      locale: "zh-CN",
      sessionId: "session-1",
      store,
    });
    const second = await handler({
      locale: "zh-CN",
      sessionId: "session-1",
      store,
    });

    expect(first).toMatchObject({
      outcome: "success",
      value: {
        preGameDone: true,
        playerExists: true,
        playerName: "七月",
      },
    });
    expect(first).not.toHaveProperty("effects.interactions");
    expect(second).toMatchObject({
      outcome: "success",
      value: {
        narrativeOutput: "",
        preGameDone: true,
        playerName: "七月",
      },
    });
    expect(second).not.toHaveProperty("effects.interactions");
    expect(upsertCharacter).toHaveBeenCalledTimes(1);
    expect(player).toMatchObject({
      name: "七月",
      type: "player",
      fields: { persona: "冷静", trust: 0 },
    });
    expect(setPluginData).toHaveBeenCalledTimes(2);
  });

  it("fails visibly instead of generating another form when the player write fails", async () => {
    const store = {
      listCharacters: vi.fn(async () => []),
      listPlayerInputs: vi.fn(async () => [
        {
          id: "input-character",
          formId: "char-creation",
          values: { characterName: "七月" },
          createdAt: "2026-08-25T00:00:01.000Z",
        },
      ]),
      listPluginDataSessionScope: vi.fn(async () => []),
      upsertCharacter: vi.fn(async () => {
        throw new Error("character write failed");
      }),
      setPluginData: vi.fn(async () => undefined),
    };

    await expect(
      handler({ locale: "zh-CN", sessionId: "session-1", store }),
    ).rejects.toThrow("character write failed");
  });
});
