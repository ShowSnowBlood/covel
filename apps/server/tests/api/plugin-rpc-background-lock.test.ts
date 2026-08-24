import { createEventBus } from "@covel/events";
import type {
  FunctionHandler,
  FunctionHandlerContext,
  LoadedRuntime,
} from "@covel/plugin-loader";
import type { RuntimeManifest } from "@covel/shared";
import { createMemoryStore } from "@covel/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInProcessSessionLock,
  type SessionLock,
} from "../../src/lib/session-lock.js";
import { createPluginRpcRuntimeTurnRunner } from "../../src/routes/api/plugin-rpc/runtime-turn.js";

const SESSION_ID = "sess-background-lock";
const PLUGIN_ID = "image-plugin";
const RUNTIME_A = `${PLUGIN_ID}/generator-a`;
const RUNTIME_B = `${PLUGIN_ID}/generator-b`;

function manifest(name: string): RuntimeManifest {
  return {
    name,
    pluginId: PLUGIN_ID,
    description: name,
    runtimeType: "function",
    handler: "./handler.js",
    execution: "background",
    trigger: { type: "event", topic: "image.generate" },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function trackingLock(): {
  lock: SessionLock;
  requestedKeys: string[];
} {
  const inner = createInProcessSessionLock();
  const requestedKeys: string[] = [];
  return {
    requestedKeys,
    lock: {
      withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        requestedKeys.push(key);
        return inner.withLock(key, fn);
      },
    },
  };
}

describe("detached runtime cross-process lock boundary", () => {
  const runtimes = [manifest(RUNTIME_A), manifest(RUNTIME_B)];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function setup(handler: FunctionHandler) {
    const store = createMemoryStore();
    const now = new Date().toISOString();
    await store.createSession({
      id: SESSION_ID,
      worldId: null,
      status: "active",
      presetId: null,
      activePlugins: [PLUGIN_ID],
      turnCount: 1,
      preGameCompleted: [],
      createdAt: now,
      updatedAt: now,
    });
    const { lock, requestedKeys } = trackingLock();
    const runner = createPluginRpcRuntimeTurnRunner({
      store,
      eventBus: createEventBus(store),
      sessionLock: lock,
      sessionId: SESSION_ID,
      session: { locale: "en" },
      activeRuntimes: runtimes,
      deps: {
        loadRuntime: async (runtime): Promise<LoadedRuntime> => ({
          manifest: runtime,
          promptTemplate: "",
          handler,
        }),
        llm: { generate: vi.fn() },
      } as unknown as Parameters<
        typeof createPluginRpcRuntimeTurnRunner
      >[0]["deps"],
    });
    return { runner, lock, requestedKeys };
  }

  const triggerEvent = {
    topic: "image.generate",
    data: { prompt: "same image", variant: "day" },
  };

  it("serializes the same runtime while leaving the session commit key free", async () => {
    const firstGate = deferred();
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const handler: FunctionHandler = async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) await firstGate.promise;
      active--;
      return { ok: true };
    };
    const { runner, lock, requestedKeys } = await setup(handler);

    const first = runner.runDeferredFollowerTurn({
      followerTurnId: "follower-a-1",
      runtimeId: RUNTIME_A,
      triggerEvent,
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = runner.runDeferredFollowerTurn({
      followerTurnId: "follower-a-2",
      runtimeId: RUNTIME_A,
      triggerEvent: {
        topic: "image.generate",
        data: { variant: "day", prompt: "same image" },
      },
    });

    await lock.withLock(SESSION_ID, async () => undefined);
    expect(calls).toBe(1);
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
    const backgroundKeys = requestedKeys.filter((key) =>
      key.startsWith("background-runtime:"),
    );
    expect(backgroundKeys).toHaveLength(2);
    expect(new Set(backgroundKeys).size).toBe(1);
    expect(backgroundKeys[0]).not.toBe(SESSION_ID);
  });

  it("allows different runtime or activation jobs to execute concurrently", async () => {
    const gate = deferred();
    const started = new Set<string>();
    let active = 0;
    let maxActive = 0;
    const handler: FunctionHandler = async (ctx: FunctionHandlerContext) => {
      started.add(`${ctx.runtimeId}:${String(ctx.triggerEvent?.data.prompt)}`);
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      return { ok: true };
    };
    const { runner } = await setup(handler);

    const first = runner.runDeferredFollowerTurn({
      followerTurnId: "follower-a-1",
      runtimeId: RUNTIME_A,
      triggerEvent,
    });
    const second = runner.runDeferredFollowerTurn({
      followerTurnId: "follower-a-2",
      runtimeId: RUNTIME_A,
      triggerEvent: {
        topic: "image.generate",
        data: { prompt: "different image" },
      },
    });
    const third = runner.runDeferredFollowerTurn({
      followerTurnId: "follower-b",
      runtimeId: RUNTIME_B,
      triggerEvent,
    });
    await vi.waitFor(() => expect(started.size).toBe(3));

    expect(maxActive).toBe(3);
    gate.resolve();
    await Promise.all([first, second, third]);
  });
});
