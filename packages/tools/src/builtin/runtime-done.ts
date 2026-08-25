/**
 * Runtime-done builtin tool.
 *
 * Auto-registered on every agent runtime. Lets the LLM declare "I'm done"
 * without the framework having to round-trip another LLM call just so the
 * model can write a terminator message.
 *
 * Runtimes that make no business write, or whose tools are not terminal,
 * call this sentinel to stop without emitting another prose response. A
 * single-shot business tool may instead return `terminalToolResult(...)`;
 * successful terminal tools end the loop directly while failed calls still
 * flow back to the model for correction.
 *
 * The turn-executor strips this sentinel from business outputs before
 * finalization.
 *
 * Pattern mirrors `suspend` — sentinel + type guard + early exit.
 */

import { z } from "zod";
import { tool } from "../tool.js";
import type { ToolModule } from "../types.js";

/** Sentinel shape the turn-executor checks after each tool call. */
export interface RuntimeDoneSentinel {
  readonly _covelRuntimeDone: true;
  readonly reason?: string;
}

/** Type guard for the runtime-done sentinel. */
export function isRuntimeDoneSentinel(
  value: unknown,
): value is RuntimeDoneSentinel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["_covelRuntimeDone"] === true
  );
}

export const runtimeDoneTool: ToolModule = tool({
  name: "runtime-done",
  description:
    "Call this IMMEDIATELY after you have finished all required tool calls for this runtime. It exits the runtime without forcing another LLM round-trip. Do not write any terminator text — just call this tool.",
  parameters: z.object({
    reason: z
      .string()
      .optional()
      .describe("Optional short note for trace/debug."),
  }),
  execute: async ({ reason }) => {
    return { _covelRuntimeDone: true, reason } satisfies RuntimeDoneSentinel;
  },
});
