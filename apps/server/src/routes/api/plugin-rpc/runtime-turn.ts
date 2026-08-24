import {
  createTurnEmitter,
  collectExecutionJournal,
  executeTurn,
  finalizeExecution,
  saveAutoSnapshot,
  type TurnExecutorDeps,
} from "@covel/runtime";
import type { DataStore, SessionRecord } from "@covel/store";
import type { EventBus } from "@covel/events";
import type { RuntimeManifest, RuntimeResult, TurnInput } from "@covel/shared";
import { createHash } from "node:crypto";

import type { SessionLock } from "../../../lib/session-lock.js";
import type {
  ManualTurnSummary,
  TurnCommitOutcome,
} from "./runtime-response.js";

export interface PluginRpcRuntimeTurnContext {
  readonly store: DataStore;
  readonly eventBus: EventBus;
  readonly sessionLock: SessionLock;
  readonly sessionId: string;
  readonly session: Pick<SessionRecord, "locale" | "runtimeModelOverrides">;
  readonly activeRuntimes: readonly RuntimeManifest[];
  readonly deps: Omit<TurnExecutorDeps, "store" | "eventBus" | "emitter">;
  readonly hookPipeline?: TurnExecutorDeps["hookPipeline"];
}

export interface RunManualTurnArgs {
  readonly turnId: string;
  readonly runtimeId: string;
  readonly payload?: unknown;
  /**
   * Retry seeding: recorded runtime results of the original turn, threaded
   * into `TurnInput.manualTrigger.retrySeedResults` so the executor resolves
   * the target's inject/needs against them.
   */
  readonly retrySeedResults?: readonly RuntimeResult[];
  readonly userSettings?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /**
   * Run the runtime outside the session lock, committing under it — set for
   * `execution: background`, which has already detached from the request and
   * may run for minutes. Sync callers leave it unset: they await the response
   * and are short enough that holding the lock throughout costs nothing.
   */
  readonly detached?: boolean;
}

export interface RunDeferredFollowerArgs {
  readonly followerTurnId: string;
  readonly runtimeId: string;
  readonly triggerEvent: {
    readonly topic: string;
    readonly data: Readonly<Record<string, unknown>>;
  };
  readonly userSettings?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
}

/**
 * Stable identity for a detached provider job. Duplicate work (same runtime,
 * activation and settings) must share a cross-process lock; unrelated scene or
 * media jobs keep distinct keys and can execute concurrently.
 */
function backgroundJobLockId(
  sessionId: string,
  runtimeId: string,
  input: TurnInput,
): string {
  const work = {
    activation:
      input.manualTrigger?.triggerEvent ?? input.manualTrigger?.payload ?? null,
    userSettings: input.userSettings ?? null,
  };
  const canonical = JSON.stringify(work, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  return `background-runtime:${JSON.stringify([
    sessionId,
    runtimeId,
    fingerprint,
  ])}`;
}

export function createPluginRpcRuntimeTurnRunner(
  ctx: PluginRpcRuntimeTurnContext,
): {
  runManualTurn(args: RunManualTurnArgs): Promise<ManualTurnSummary>;
  runDeferredFollowerTurn(args: RunDeferredFollowerArgs): Promise<{
    readonly turnResult: Awaited<ReturnType<typeof executeTurn>>;
    readonly commit: TurnCommitOutcome;
  }>;
} {
  async function processTurnResults(
    turnResult: Awaited<ReturnType<typeof executeTurn>>,
    emitter: ReturnType<typeof createTurnEmitter>,
  ): Promise<TurnCommitOutcome> {
    // Commit the whole execution (top-level + nested recursiveCall results) in
    // ONE transaction via the shared finalize primitive. Any proposal failure
    // rolls the turn back (committed siblings included) and settles the
    // turn_results row to `failed`; a clean run settles it `committed`, both
    // inside that transaction.
    const outcome = await finalizeExecution({
      store: ctx.store,
      sessionId: ctx.sessionId,
      ...(turnResult.executionContext
        ? { executionContext: turnResult.executionContext }
        : {}),
      runtimes: ctx.activeRuntimes,
      results: [
        ...turnResult.runtimeResults,
        ...(turnResult.nestedRuntimeResults ?? []),
      ],
      journalMessages: collectExecutionJournal(turnResult),
      turnIds: [turnResult.turnId],
      ...(ctx.hookPipeline ? { hookPipeline: ctx.hookPipeline } : {}),
      eventBus: ctx.eventBus,
      emitter,
      // Manual / late-setup runs settle their setup attempts too (a manual
      // retrigger of a pending setup runtime burns an attempt).
      ...(turnResult.setupRan ? { setupRan: turnResult.setupRan } : {}),
      // Publishes recordAs exports inside the commit transaction — a manual /
      // background execution can publish just like a player turn.
      loadOutputSchema: async (runtimeId) => {
        const rt = ctx.activeRuntimes.find((r) => r.name === runtimeId);
        return rt
          ? (await ctx.deps.loadRuntime(rt, ctx.session.locale ?? undefined))
              ?.outputSchema
          : undefined;
      },
      // MediaRef canonicalization / ownership for published export values.
      ...(ctx.deps.mediaStore ? { mediaStore: ctx.deps.mediaStore } : {}),
    });

    // Commit failures must not report success. Surface each one as a
    // `proposal.failed` trace event (manual/background turns have no live
    // action stream; the /debug timeline and subscription channel carry it).
    for (const fp of outcome.failedProposals) {
      await emitter.emit("proposal.failed", {
        proposalId: fp.proposal.id,
        proposalType: fp.proposal.type,
        runtimeId: fp.proposal.source.runtimeId,
        pluginId: fp.proposal.source.pluginId,
        error: fp.error,
      });
    }

    const committed = outcome.status === "committed";
    let snapshotFailed = false;
    if (committed) {
      try {
        await saveAutoSnapshot({
          store: ctx.store,
          sessionId: ctx.sessionId,
          turnId: turnResult.turnId,
          createdAt: turnResult.timestamp,
          eventBus: ctx.eventBus,
        });
      } catch (err) {
        snapshotFailed = true;
        console.warn(
          `[plugin-rpc] auto snapshot failed for session ${ctx.sessionId} turn ${turnResult.turnId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    } else {
      console.error(
        `[plugin-rpc] proposal commit failed for session ${ctx.sessionId} turn ${turnResult.turnId} — ` +
          "withholding auto-snapshot and turn completion",
      );
    }

    // Commit barrier: fire the authoritative turn.completed event and memory
    // ingestion only when every proposal committed. A failed auto-snapshot does
    // NOT withhold completion — the proposals already committed (commit_status
    // was settled inside finalize), so business state is consistent and only
    // the best-effort checkpoint is missing; counting it as a failure made the
    // sync RPC return 500 and the client retry, replaying committed proposals.
    // So `committed` tracks proposal commit alone, matching commit_status;
    // `snapshotFailed` stays on the outcome for observability.
    if (committed) {
      turnResult.completeTurn?.();
    }
    return {
      committed,
      failedProposalCount: outcome.failedProposals.length,
      snapshotFailed,
    };
  }

  /**
   * Run a detached execution: the runtime executes OUTSIDE the session lock and
   * only its commit takes it. Shared by deferred followers and by manual
   * triggers in `execution: background` mode — both are media generations that
   * legitimately run for minutes, and holding the session lock across that
   * makes every player action queue behind them (under PostgreSQL, where the
   * acquire budget is 30s, it makes them fail outright).
   *
   * Executing unlocked is safe here because the session clock is untouched
   * (this path passes no `sessionClock` to `finalizeExecution`, and
   * `completedPlayerTurns` counts only player-origin executions), domain writes
   * are buffered into the commit transaction rather than dribbling out during
   * the run, and no turn messages are appended. Executions of the SAME runtime
   * stay serialised on the injected cross-process session lock, using a key
   * distinct from the session commit lock. This keeps a handler's "already
   * generated?" check and provider call atomic across pods without blocking
   * player turns; the nested commit lock uses the plain session id, so the two
   * acquisitions cannot self-deadlock.
   */
  async function runDetached(
    runtimeId: string,
    turnInput: TurnInput,
    emitter: ReturnType<typeof createTurnEmitter>,
  ): Promise<{
    readonly turnResult: Awaited<ReturnType<typeof executeTurn>>;
    readonly commit: TurnCommitOutcome;
  }> {
    const jobLockId = backgroundJobLockId(ctx.sessionId, runtimeId, turnInput);
    return ctx.sessionLock.withLock(jobLockId, async () => {
      const result = await executeTurn(turnInput, ctx.activeRuntimes, {
        ...ctx.deps,
        store: ctx.store,
        eventBus: ctx.eventBus,
        emitter,
        ...(ctx.hookPipeline ? { hookPipeline: ctx.hookPipeline } : {}),
      });
      const outcome = await ctx.sessionLock.withLock(
        ctx.sessionId,
        async () => {
          // Minutes can pass while the generation runs, so the session state
          // read before it started is no longer trustworthy. Re-read under
          // the lock and refuse to commit into a session the player has since
          // paused or ended — the throw is caught by the background job
          // runner, which settles the job row as failed.
          const live = await ctx.store.getSession(ctx.sessionId);
          if (!live) {
            throw new Error(
              "session was deleted while the background job was running",
            );
          }
          if (live.status && live.status !== "active") {
            throw new Error(
              `session is ${live.status}; background job results were discarded`,
            );
          }
          return processTurnResults(result, emitter);
        },
      );
      return { turnResult: result, commit: outcome };
    });
  }

  async function runManualTurn(
    args: RunManualTurnArgs,
  ): Promise<ManualTurnSummary> {
    const emitter = createTurnEmitter({
      store: ctx.store,
      eventBus: ctx.eventBus,
      sessionId: ctx.sessionId,
      turnId: args.turnId,
    });
    const turnInput: TurnInput = {
      sessionId: ctx.sessionId,
      turnId: args.turnId,
      playerMessage: "",
      locale: ctx.session.locale ?? "zh-CN",
      // A manual RPC trigger is not a player turn.
      origin: "manual",
      manualTrigger: {
        runtimeId: args.runtimeId,
        ...(args.payload !== undefined && args.payload !== null
          ? { payload: args.payload as Record<string, unknown> }
          : {}),
        ...(args.retrySeedResults && args.retrySeedResults.length > 0
          ? { retrySeedResults: args.retrySeedResults }
          : {}),
      },
      ...(ctx.session.runtimeModelOverrides
        ? { runtimeModelOverrides: ctx.session.runtimeModelOverrides }
        : {}),
      ...(args.userSettings && Object.keys(args.userSettings).length > 0
        ? { userSettings: args.userSettings }
        : {}),
    };

    // Background mode has already returned 202 to the client and detached from
    // the request, and the only manual runtime that uses it is a media
    // generation (mimo-tts/manual-narrate) — exactly the shape that must not
    // hold the session lock. Sync mode is request-bound, short, and its caller
    // awaits the HTTP response, so it keeps the whole run serialised.
    const { result, commit } = args.detached
      ? await runDetached(args.runtimeId, turnInput, emitter).then((r) => ({
          result: r.turnResult,
          commit: r.commit,
        }))
      : await ctx.sessionLock.withLock(ctx.sessionId, async () => {
          const turnResult = await executeTurn(turnInput, ctx.activeRuntimes, {
            ...ctx.deps,
            store: ctx.store,
            eventBus: ctx.eventBus,
            emitter,
            ...(ctx.hookPipeline ? { hookPipeline: ctx.hookPipeline } : {}),
          });
          const outcome = await processTurnResults(turnResult, emitter);
          return { result: turnResult, commit: outcome };
        });

    return {
      commit,
      turnId: args.turnId,
      runtimeResults: result.runtimeResults.map((rr) => ({
        runtimeId: rr.runtimeId,
        pluginId: rr.pluginId,
        status: rr.status,
        durationMs: rr.durationMs,
        ...(rr.error ? { error: rr.error } : {}),
        output: rr.output,
      })),
      durationMs: result.durationMs,
      ...(result.abortReason ? { abortReason: result.abortReason } : {}),
      deferredFollowers: result.deferredFollowers ?? [],
    };
  }

  async function runDeferredFollowerTurn(
    args: RunDeferredFollowerArgs,
  ): Promise<{
    readonly turnResult: Awaited<ReturnType<typeof executeTurn>>;
    readonly commit: TurnCommitOutcome;
  }> {
    const emitter = createTurnEmitter({
      store: ctx.store,
      eventBus: ctx.eventBus,
      sessionId: ctx.sessionId,
      turnId: args.followerTurnId,
    });
    const turnInput: TurnInput = {
      sessionId: ctx.sessionId,
      turnId: args.followerTurnId,
      playerMessage: "",
      locale: ctx.session.locale ?? "zh-CN",
      // A deferred background follower is not a player turn.
      origin: "follower",
      manualTrigger: {
        runtimeId: args.runtimeId,
        triggerEvent: args.triggerEvent,
      },
      ...(ctx.session.runtimeModelOverrides
        ? { runtimeModelOverrides: ctx.session.runtimeModelOverrides }
        : {}),
      ...(args.userSettings && Object.keys(args.userSettings).length > 0
        ? { userSettings: args.userSettings }
        : {}),
    };

    return runDetached(args.runtimeId, turnInput, emitter);
  }

  return { runManualTurn, runDeferredFollowerTurn };
}
