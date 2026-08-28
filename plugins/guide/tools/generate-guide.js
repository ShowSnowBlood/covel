/**
 * Plugin-local tool: generate-guide
 *
 * Generates three fixed action styles with 1-3 concrete suggestions each.
 * The flat input shape keeps tool arguments short and unambiguous for smaller
 * function-calling models; the output remains the category array consumed by UI.
 * Returns plugin-data state rendered as styled action choices.
 */

import { makeProposal } from "@covel/plugin-handlers-utils";
import { terminalToolResult, withPendingProposals } from "@covel/tools";

const STYLE_CONFIG = {
  safe: { zh: "稳妥", en: "Safe", icon: "shield", color: "blue" },
  aggressive: { zh: "激进", en: "Aggressive", icon: "swords", color: "red" },
  creative: { zh: "创意", en: "Creative", icon: "lightbulb", color: "purple" },
};

const STYLE_ORDER = ["safe", "aggressive", "creative"];

export default function ({ tool, z }) {
  const suggestionsSchema = z
    .array(z.string().min(1))
    .min(1)
    .max(3)
    .describe("1-3 concrete, actionable suggestions");

  return tool({
    name: "generate-guide",
    description:
      "Generate exactly three action styles: safe, aggressive, and creative.",
    parameters: z.object({
      topic: z
        .string()
        .min(1)
        .describe("A brief description of the current decision point"),
      safe: suggestionsSchema.describe("1-3 low-risk, cautious actions"),
      aggressive: suggestionsSchema.describe(
        "1-3 direct, confrontational actions",
      ),
      creative: suggestionsSchema.describe(
        "1-3 unconventional, clever actions",
      ),
    }),
    execute: async (params, context) => {
      const { topic } = params;
      const resolvedCategories = STYLE_ORDER.map((style, index) => {
        const config = STYLE_CONFIG[style];
        return {
          slot: index + 1,
          style,
          label: { zh: config.zh, en: config.en },
          icon: config.icon,
          color: config.color,
          suggestions: params[style],
        };
      });

      const now = new Date().toISOString();
      // plugin.data.batch items only need {namespace, key, value} — the commit
      // handler owns ids/timestamps.
      const items = [
        { namespace: "message", key: "__turnId", value: context.turnId },
        { namespace: "message", key: "topic", value: topic },
      ];

      for (const category of resolvedCategories) {
        items.push(
          {
            namespace: "message",
            key: `category${category.slot}Label`,
            value: category.label,
          },
          {
            namespace: "message",
            key: `category${category.slot}Icon`,
            value: category.icon,
          },
          {
            namespace: "message",
            key: `category${category.slot}Color`,
            value: category.color,
          },
        );

        for (let i = 0; i < 3; i += 1) {
          items.push({
            namespace: "message",
            key: `category${category.slot}Suggestion${i + 1}`,
            value: category.suggestions[i] ?? "",
          });
        }
      }

      return terminalToolResult(
        withPendingProposals(
          {
            topic,
            categories: resolvedCategories,
          },
          [makeProposal(context, now, "plugin.data.batch", { items })],
        ),
      );
    },
  });
}
