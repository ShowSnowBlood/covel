import type { Proposal } from "@covel/shared";

const TOOL_PENDING_PROPOSALS = Symbol.for("covel.tools.pendingProposals");
const TOOL_EMITTED_EVENTS = Symbol.for("covel.tools.emittedEvents");
const TOOL_EXECUTION_ENVELOPE = Symbol.for("covel.tools.executionEnvelope");
const TOOL_TERMINAL_RESULT = Symbol.for("covel.tools.terminalResult");

/** A domain event emitted by an agent tool call via `emit-event`. */
export interface EmittedEvent {
  readonly topic: string;
  readonly data: Record<string, unknown>;
}

export interface ToolExecutionEnvelope<T = unknown> {
  readonly content: T;
  readonly pendingProposals?: readonly Proposal[];
  readonly emittedEvents?: readonly EmittedEvent[];
  readonly [TOOL_EXECUTION_ENVELOPE]?: true;
}

interface PendingProposalCarrier {
  readonly [TOOL_PENDING_PROPOSALS]?: readonly Proposal[];
  readonly [TOOL_EXECUTION_ENVELOPE]?: true;
}

interface EmittedEventCarrier {
  readonly [TOOL_EMITTED_EVENTS]?: readonly EmittedEvent[];
  readonly [TOOL_EXECUTION_ENVELOPE]?: true;
}

interface TerminalResultCarrier {
  readonly [TOOL_TERMINAL_RESULT]?: true;
}

export function withPendingProposals<T extends object>(
  content: T,
  pendingProposals: readonly Proposal[],
): T;
export function withPendingProposals<T>(
  content: T,
  pendingProposals: readonly Proposal[],
): T | ToolExecutionEnvelope<T> {
  if (pendingProposals.length === 0) {
    return content;
  }

  const copied = [...pendingProposals];

  if (content !== null && typeof content === "object") {
    try {
      Object.defineProperty(content, TOOL_PENDING_PROPOSALS, {
        value: copied,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      return content;
    } catch {
      // Fall through to the explicit envelope path.
    }
  }

  const envelope = {
    content,
    pendingProposals: copied,
  } as ToolExecutionEnvelope<T>;
  Object.defineProperty(envelope, TOOL_EXECUTION_ENVELOPE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return envelope;
}

/**
 * Mark a successful business-tool result as terminal for the current agent
 * runtime. The executor still records the tool call and buffered proposals,
 * then ends the loop without spending a second LLM call on `runtime-done`.
 */
export function terminalToolResult<T extends object>(content: T): T {
  Object.defineProperty(content, TOOL_TERMINAL_RESULT, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return content;
}

/** Type guard used after tool execution; the marker is never exposed to LLMs. */
export function isTerminalToolResult(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as TerminalResultCarrier)[TOOL_TERMINAL_RESULT] === true
  );
}

function isExecutionEnvelope<T>(
  value: unknown,
): value is ToolExecutionEnvelope<T> {
  return (
    !!value &&
    typeof value === "object" &&
    (value as PendingProposalCarrier)[TOOL_EXECUTION_ENVELOPE] === true
  );
}

export function getToolContent<T>(value: T | ToolExecutionEnvelope<T>): T {
  return isExecutionEnvelope<T>(value) ? value.content : value;
}

export function getPendingProposals(value: unknown): readonly Proposal[] {
  if (isExecutionEnvelope(value)) {
    return value.pendingProposals ?? [];
  }
  if (value !== null && typeof value === "object") {
    const proposals = (value as PendingProposalCarrier)[TOOL_PENDING_PROPOSALS];
    if (Array.isArray(proposals)) {
      return proposals;
    }
  }
  return [];
}

export function withEmittedEvents<T extends object>(
  content: T,
  events: readonly EmittedEvent[],
): T;
export function withEmittedEvents<T>(
  content: T,
  events: readonly EmittedEvent[],
): T | ToolExecutionEnvelope<T> {
  if (events.length === 0) {
    return content;
  }

  const copied = [...events];

  if (content !== null && typeof content === "object") {
    try {
      Object.defineProperty(content, TOOL_EMITTED_EVENTS, {
        value: copied,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      return content;
    } catch {
      // Fall through to the explicit envelope path.
    }
  }

  const envelope = {
    content,
    emittedEvents: copied,
  } as ToolExecutionEnvelope<T>;
  Object.defineProperty(envelope, TOOL_EXECUTION_ENVELOPE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return envelope;
}

export function getEmittedEvents(
  value: unknown,
): readonly EmittedEvent[] | undefined {
  if (isExecutionEnvelope(value)) {
    return value.emittedEvents;
  }
  if (value !== null && typeof value === "object") {
    const events = (value as EmittedEventCarrier)[TOOL_EMITTED_EVENTS];
    if (Array.isArray(events)) {
      return events;
    }
  }
  return undefined;
}
