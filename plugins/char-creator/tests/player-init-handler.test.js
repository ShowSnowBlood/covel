import { describe, expect, it } from "vitest";
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
});
