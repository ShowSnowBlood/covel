/**
 * ToolExecutor — resolves, validates, and executes tool calls from LLM responses.
 *
 * Pipeline per call:
 *   1. Look up tool by name (via the injected findTool callback)
 *   2. Check approval pipeline (if configured)
 *   3. Parse arguments JSON
 *   4. Execute tool.execute(params, context)
 *   5. Record call to DataStore (if available)
 *   6. Return result string for LLM
 */

import {
  ToolValidationError,
  getEmittedEvents,
  getPendingProposals,
  getToolContent,
  isTerminalToolResult,
  type EmittedEvent,
  type ToolModule,
} from "@covel/tools";
import type { DataStore } from "@covel/store";
import type { ApprovalPipeline } from "@covel/approval";
import type { ApprovalStatus, Proposal } from "@covel/shared";

// ── Structured tool error shape (returned to LLM) ────────────────

type ToolErrorCode =
  | "NOT_FOUND"
  | "DENIED"
  | "UNAUTHORIZED"
  | "INVALID_ARGS"
  | "VALIDATION_ERROR"
  | "EXECUTION_ERROR";

function toolError(
  code: ToolErrorCode,
  message: string,
  details?: string[],
): string {
  const payload: Record<string, unknown> = {
    success: false,
    error: message,
    code,
  };
  if (details && details.length > 0) payload.details = details;
  return JSON.stringify(payload);
}

// ── Types ────────────────────────────────────────────────────────

export interface ToolCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: string; // JSON string from LLM
}

export interface ToolCallContext {
  readonly sessionId: string;
  readonly turnId: string;
  readonly pluginId: string;
  readonly runtimeId: string;
  readonly pendingProposals?: readonly Proposal[];
  /** Authoritative logical turn number, forwarded to ToolExecutionContext. */
  readonly turnNumber?: number;
  /** Topics already emitted via `emit-event` earlier in this tool loop — see @covel/tools ToolExecutionContext. */
  readonly emittedEventTopics?: readonly string[];
  /** Optional trace emitter — when present, tool.calling / tool.completed / tool.failed are traced. */
  readonly emitter?: import("../trace/turn-emitter.js").TurnEmitter;
  /**
   * The calling runtime's exact tool authorization set (declared whitelist +
   * framework contract tools). When present, `execute` rejects any call whose
   * name is outside the set BEFORE resolution/approval — the advertisement
   * list alone is not an authorization boundary (: a
   * prompt-injected or hook-rewritten name used to reach any builtin, or any
   * local tool of a sibling runtime in the same plugin).
   */
  readonly authorizedToolNames?: ReadonlySet<string>;
}

export interface ToolCallResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly result: string; // JSON string for LLM
  readonly parsedResult: unknown; // Parsed result for framework use
  readonly pendingProposals?: readonly Proposal[];
  /** Domain events emitted via the `emit-event` builtin tool (see @covel/tools result.ts). */
  readonly emittedEvents?: readonly EmittedEvent[];
  /** Successful business tool completed the runtime; no terminator LLM call. */
  readonly terminal?: boolean;
  readonly success: boolean;
  readonly approvalStatus?: ApprovalStatus;
}

export interface ToolInfo {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

export interface ToolExecutor {
  execute(call: ToolCall, context: ToolCallContext): Promise<ToolCallResult>;
  /**
   * Look up a tool's LLM-facing shape (name/description/jsonSchema).
   *
   * `context` is optional so legacy call sites keep working, but passing it
   * lets the resolver return a session-specific variant — e.g.
   * `create-character` / `update-character` with `fields` typed against the
   * active world's CharacterAttributeSchema. Without context the generic
   * variant is returned.
   */
  getToolInfo(name: string, context?: ToolCallContext): ToolInfo | undefined;
}

// ── Implementation ───────────────────────────────────────────────

export interface ToolExecutorConfig {
  /** Tool lookup function — returns the tool module by name. Context enables per-plugin scoping. */
  readonly findTool?: (
    name: string,
    context?: ToolCallContext,
  ) => ToolModule | undefined;
  /** Optional DataStore for recording tool calls. */
  readonly store?: DataStore;
  /** Optional approval pipeline for permission checking. */
  readonly approval?: ApprovalPipeline;
  /** Optional function to determine tool source category. */
  readonly getToolSource?: (
    toolName: string,
  ) => "builtin" | "local" | "third-party";
}

function toolLabel(pluginId: string, toolName: string): string {
  return `${pluginId}/${toolName}`;
}

/**
 * Emit a tool trace event (`tool.calling` / `tool.completed` / `tool.failed`).
 *
 * No-op when no emitter is configured. The shared identity envelope
 * (runtimeId / pluginId / toolName / toolCallId / label / approvalStatus) is
 * always present; event-specific fields are merged from `extra`. This single
 * helper replaces the three near-identical `emitToolCalling/Completed/Failed`
 * functions that all unpacked the same context.
 */
async function emitToolEvent(
  ctx: ToolCallContext,
  call: ToolCall,
  eventType: "tool.calling" | "tool.completed" | "tool.failed",
  approvalStatus: ApprovalStatus,
  extra: Record<string, unknown>,
): Promise<void> {
  if (!ctx.emitter) return;
  await ctx.emitter.emit(eventType, {
    runtimeId: ctx.runtimeId,
    pluginId: ctx.pluginId,
    toolName: call.name,
    toolCallId: call.toolCallId,
    label: toolLabel(ctx.pluginId, call.name),
    approvalStatus,
    ...extra,
  });
}

function emitToolCalling(
  ctx: ToolCallContext,
  call: ToolCall,
  source: "builtin" | "local" | "third-party",
  approvalStatus: ApprovalStatus,
  argumentsRepaired: boolean,
): Promise<void> {
  return emitToolEvent(ctx, call, "tool.calling", approvalStatus, {
    arguments: call.arguments,
    source,
    ...(argumentsRepaired ? { argumentsRepaired: true } : {}),
  });
}

function emitToolCompleted(
  ctx: ToolCallContext,
  call: ToolCall,
  result: string,
  parsedResult: unknown,
  durationMs: number,
  approvalStatus: ApprovalStatus,
): Promise<void> {
  return emitToolEvent(ctx, call, "tool.completed", approvalStatus, {
    result,
    parsedResult,
    durationMs,
    success: true,
  });
}

function emitToolFailed(
  ctx: ToolCallContext,
  call: ToolCall,
  code: ToolErrorCode,
  error: string,
  details: string[] | undefined,
  durationMs: number,
  approvalStatus: ApprovalStatus,
): Promise<void> {
  return emitToolEvent(ctx, call, "tool.failed", approvalStatus, {
    code,
    error,
    ...(details && details.length > 0 ? { details } : {}),
    durationMs,
    success: false,
  });
}

function resolveToolModule(
  config: ToolExecutorConfig,
  name: string,
  context?: ToolCallContext,
): ToolModule | undefined {
  return config.findTool?.(name, context);
}

export function createToolExecutor(config: ToolExecutorConfig): ToolExecutor {
  return {
    getToolInfo(name: string, context?: ToolCallContext): ToolInfo | undefined {
      const tool = resolveToolModule(config, name, context);
      if (!tool) return undefined;
      return {
        name: tool.name,
        description: tool.description,
        jsonSchema: tool.jsonSchema as Record<string, unknown>,
      };
    },

    async execute(
      call: ToolCall,
      context: ToolCallContext,
    ): Promise<ToolCallResult> {
      const startTime = Date.now();

      // 0. Runtime-level authorization. Enforced at the execution
      // boundary — after session overrides and PreToolUse replacement have
      // already produced the final name — so a rewritten or hallucinated
      // name cannot escape the calling runtime's declared surface.
      if (
        context.authorizedToolNames &&
        !context.authorizedToolNames.has(call.name)
      ) {
        const errorResult = toolError(
          "UNAUTHORIZED",
          `Tool "${call.name}" is not declared by runtime "${context.runtimeId}". Only declared tools may be called.`,
        );
        await recordCall(
          config.store,
          call,
          context,
          errorResult,
          startTime,
          false,
          "auto-allowed",
        );
        await emitToolFailed(
          context,
          call,
          "UNAUTHORIZED",
          `tool not declared by runtime ${context.runtimeId}`,
          undefined,
          Date.now() - startTime,
          "auto-allowed",
        );
        return {
          toolCallId: call.toolCallId,
          name: call.name,
          result: errorResult,
          parsedResult: null,
          success: false,
          approvalStatus: "auto-allowed" as const,
        };
      }

      // 1. Resolve tool module (scoped to calling plugin if context available)
      const tool = resolveToolModule(config, call.name, context);
      if (!tool) {
        const errorResult = toolError(
          "NOT_FOUND",
          `Unknown tool: ${call.name}. Check the tool name and try again.`,
        );
        await recordCall(
          config.store,
          call,
          context,
          errorResult,
          startTime,
          false,
          "auto-allowed",
        );
        await emitToolFailed(
          context,
          call,
          "NOT_FOUND",
          `Unknown tool: ${call.name}`,
          undefined,
          Date.now() - startTime,
          "auto-allowed",
        );
        return {
          toolCallId: call.toolCallId,
          name: call.name,
          result: errorResult,
          parsedResult: null,
          success: false,
          approvalStatus: "auto-allowed" as const,
        };
      }

      // 2. Check approval
      let approvalStatus: ApprovalStatus = "auto-allowed";
      const toolSource = config.getToolSource?.(call.name) ?? "local";

      if (config.approval) {
        const checkResult = config.approval.check(
          {
            toolName: call.name,
            pluginId: context.pluginId,
            runtimeId: context.runtimeId,
            input: tryParseJson(call.arguments),
            turnId: context.turnId,
            sessionId: context.sessionId,
          },
          toolSource,
        );

        if (checkResult.needsApproval) {
          // Check session-level prior approval
          if (
            config.approval.hasSessionAllow(
              context.sessionId,
              call.name,
              context.pluginId,
            )
          ) {
            approvalStatus = "user-allowed";
          } else {
            // Denied — do not execute
            approvalStatus = "user-denied";
            const denyResult = toolError(
              "DENIED",
              `Tool "${call.name}" was denied by the approval policy. Reason: ${checkResult.reason}. Do not retry this tool call.`,
            );
            await recordCall(
              config.store,
              call,
              context,
              denyResult,
              startTime,
              false,
              approvalStatus,
            );
            await emitToolFailed(
              context,
              call,
              "DENIED",
              checkResult.reason ?? "denied by approval policy",
              undefined,
              Date.now() - startTime,
              approvalStatus,
            );
            return {
              toolCallId: call.toolCallId,
              name: call.name,
              result: denyResult,
              parsedResult: null,
              success: false,
              approvalStatus,
            };
          }
        }
      }

      // 3. Parse arguments. Some OpenAI-compatible gateways truncate only the
      // final closing delimiters of an otherwise complete tool payload. Repair
      // that narrow shape locally; arbitrary malformed JSON still fails.
      const parsedArguments = parseToolArguments(call.arguments);
      if (!parsedArguments) {
        const errorResult = toolError(
          "INVALID_ARGS",
          `Arguments for tool "${call.name}" are not valid JSON. Ensure the arguments object is properly formatted JSON.`,
        );
        await recordCall(
          config.store,
          call,
          context,
          errorResult,
          startTime,
          false,
          approvalStatus,
        );
        await emitToolFailed(
          context,
          call,
          "INVALID_ARGS",
          "arguments are not valid JSON",
          undefined,
          Date.now() - startTime,
          approvalStatus,
        );
        return {
          toolCallId: call.toolCallId,
          name: call.name,
          result: errorResult,
          parsedResult: null,
          success: false,
          approvalStatus,
        };
      }
      const params = parsedArguments.value;
      const executedCall = parsedArguments.repaired
        ? { ...call, arguments: parsedArguments.json }
        : call;

      // Emit calling AFTER arg-parse so the trace carries the actual arguments.
      await emitToolCalling(
        context,
        executedCall,
        toolSource,
        approvalStatus,
        parsedArguments.repaired,
      );

      // 4. Execute
      try {
        const execContext = {
          sessionId: context.sessionId,
          turnId: context.turnId,
          pluginId: context.pluginId,
          runtimeId: context.runtimeId,
          pendingProposals: context.pendingProposals,
          emittedEventTopics: context.emittedEventTopics,
          ...(context.turnNumber !== undefined
            ? { turnNumber: context.turnNumber }
            : {}),
        };
        const rawResult = await tool.execute(params, execContext);
        const parsedResult = getToolContent(rawResult);
        const pendingProposals = getPendingProposals(rawResult);
        const emittedEvents = getEmittedEvents(rawResult);
        const terminal = isTerminalToolResult(rawResult);

        // Text-first convention: if the tool result is an object with a
        // `_text` string field, send ONLY the text as the LLM-facing payload
        // (instead of JSON-stringifying the whole object). This keeps LLM
        // prompts human-readable while framework tracing still gets the full
        // structured object via `parsedResult`. Falls back to JSON.stringify
        // for tools that don't opt in.
        const resultStr =
          parsedResult &&
          typeof parsedResult === "object" &&
          typeof (parsedResult as { _text?: unknown })._text === "string"
            ? (parsedResult as { _text: string })._text
            : JSON.stringify(parsedResult);

        const durationMs = Date.now() - startTime;
        await recordCall(
          config.store,
          executedCall,
          context,
          resultStr,
          startTime,
          true,
          approvalStatus,
        );
        await emitToolCompleted(
          context,
          executedCall,
          resultStr,
          parsedResult,
          durationMs,
          approvalStatus,
        );
        return {
          toolCallId: call.toolCallId,
          name: call.name,
          result: resultStr,
          parsedResult,
          pendingProposals,
          emittedEvents,
          terminal,
          success: true,
          approvalStatus,
        };
      } catch (error: unknown) {
        let errorResult: string;
        let code: ToolErrorCode;
        let details: string[] | undefined;
        let message: string;
        if (error instanceof ToolValidationError) {
          // Dedupe Zod issues by path so only the FIRST issue on any given
          // field is reported. Zod v4 has a quirk where `z.array(...).max(N)`
          // will emit a bogus `too_big: expected string to have <=N characters`
          // alongside the real `invalid_type: expected array, received string`
          // when the LLM sends a JSON-stringified array. Feeding both to the
          // LLM confuses it into fixing a phantom "string length" problem
          // while the real fix ("send an array") is buried. Keeping only the
          // first issue per path eliminates the contradiction without losing
          // information — multi-field errors still list each field once.
          const seenPaths = new Set<string>();
          const dedupedDetails: typeof error.details = [];
          for (const detail of error.details) {
            const key = detail.path ?? "";
            if (seenPaths.has(key)) continue;
            seenPaths.add(key);
            dedupedDetails.push(detail);
          }
          details = dedupedDetails.map((d) => `${d.path}: ${d.message}`);
          message = dedupedDetails.map((d) => d.message).join("; ");
          code = "VALIDATION_ERROR";
          errorResult = toolError(
            code,
            `Invalid parameters for tool "${call.name}": ${message}. Fix the highlighted fields and retry.`,
            details,
          );
        } else {
          message = error instanceof Error ? error.message : String(error);
          code = "EXECUTION_ERROR";
          errorResult = toolError(
            code,
            `Tool "${call.name}" failed during execution: ${message}`,
          );
        }
        await recordCall(
          config.store,
          executedCall,
          context,
          errorResult,
          startTime,
          false,
          approvalStatus,
        );
        await emitToolFailed(
          context,
          executedCall,
          code,
          message,
          details,
          Date.now() - startTime,
          approvalStatus,
        );
        return {
          toolCallId: call.toolCallId,
          name: call.name,
          result: errorResult,
          parsedResult: null,
          success: false,
          approvalStatus,
        };
      }
    },
  };
}

interface ParsedToolArguments {
  readonly value: unknown;
  readonly json: string;
  readonly repaired: boolean;
}

function parseToolArguments(json: string): ParsedToolArguments | null {
  try {
    return { value: JSON.parse(json), json, repaired: false };
  } catch {
    const repaired = repairTruncatedJson(json);
    if (!repaired) return null;
    return { value: repaired.value, json: repaired.json, repaired: true };
  }
}

function tryParseJson(json: string): Record<string, unknown> {
  const parsed = parseToolArguments(json)?.value;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Repair only omitted closing delimiters at the JSON suffix. A mismatch is
 * repairable only when the rest of the payload contains closing delimiters;
 * malformed content in the middle remains an INVALID_ARGS failure.
 */
function repairTruncatedJson(
  raw: string,
): { readonly json: string; readonly value: unknown } | null {
  const source = raw.trimEnd();
  if (!(source.startsWith("{") || source.startsWith("["))) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let repaired = "";
  let changed = false;

  const closerFor = (opener: string): string => (opener === "{" ? "}" : "]");
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (inString) {
      repaired += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      repaired += char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      repaired += char;
      continue;
    }
    if (char === "}" || char === "]") {
      const expectedOpener = char === "}" ? "{" : "[";
      if (stack.at(-1) !== expectedOpener) {
        const suffix = source.slice(index).replace(/\s/gu, "");
        if (!stack.includes(expectedOpener) || !/^[\]}]+$/u.test(suffix)) {
          return null;
        }
        while (stack.at(-1) !== expectedOpener) {
          repaired += closerFor(stack.pop()!);
          changed = true;
        }
      }
      stack.pop();
      repaired += char;
      continue;
    }
    repaired += char;
  }

  if (inString) return null;
  if (stack.length > 0) {
    repaired = repaired.replace(/,\s*$/u, "");
    while (stack.length > 0) repaired += closerFor(stack.pop()!);
    changed = true;
  }
  if (!changed) return null;

  try {
    return { json: repaired, value: JSON.parse(repaired) };
  } catch {
    return null;
  }
}

async function recordCall(
  store: DataStore | undefined,
  call: ToolCall,
  context: ToolCallContext,
  result: string,
  startTime: number,
  success: boolean,
  approvalStatus: string,
): Promise<void> {
  if (!store) return;
  try {
    await store.saveToolCall({
      id: crypto.randomUUID(),
      sessionId: context.sessionId,
      turnId: context.turnId,
      toolName: call.name,
      pluginId: context.pluginId,
      runtimeId: context.runtimeId,
      input: call.arguments,
      output: result,
      durationMs: Date.now() - startTime,
      approvalStatus,
      createdAt: new Date().toISOString(),
    });
  } catch (recordErr) {
    console.warn(
      `[ToolExecutor] Failed to record tool call for ${call.name}:`,
      recordErr,
    );
  }
}
