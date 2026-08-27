import { useEffect } from "react";
import * as api from "@/services/api";
import type { DataService } from "@/services/data-service.js";
import { ignoreError } from "@/lib/ignore-error.js";
import { loadPluginData } from "@/stores/plugin-data-store.js";
import { isDurableExecutionStep } from "./execution-steps.js";
import type { SessionDispatch, SessionState } from "./types.js";

export function useBootEffect(
  state: Pick<SessionState, "booted" | "bootError">,
  boot: () => Promise<void>,
  enabled = true,
): void {
  useEffect(() => {
    if (enabled && !state.booted && !state.bootError) {
      void boot();
    }
  }, [boot, enabled, state.booted, state.bootError]);
}
/**
 * Persist only terminal runtime rows. Live LLM/tool projections are rendered
 * from the action stream and must not turn every trace boundary into a storage
 * write.
 */
export function usePersistExecutionStepsEffect(
  state: Pick<SessionState, "executionSteps" | "session">,
  ds: DataService,
): void {
  useEffect(() => {
    const sid = state.session?.id;
    const durableSteps = state.executionSteps.filter(isDurableExecutionStep);
    if (!sid || durableSteps.length === 0) return;
    ds.saveExecutionSteps(sid, durableSteps).catch(
      ignoreError("save execution steps"),
    );
  }, [state.executionSteps, state.session?.id, ds]);
}

export function useMessageUiSpecHydrationEffect(
  sessionId: string | null | undefined,
  dispatch: SessionDispatch,
): void {
  useEffect(() => {
    if (!sessionId) {
      dispatch({ type: "LOAD_MESSAGE_UI_SPECS", specs: [] });
      return;
    }
    let cancelled = false;
    api
      .fetchUiSpecs(sessionId)
      .then((res) => {
        if (cancelled) return;
        const specs = res.message ?? [];
        dispatch({ type: "LOAD_MESSAGE_UI_SPECS", specs });

        const pluginIds = new Set(specs.map((entry) => entry.pluginId));
        for (const pluginId of pluginIds) {
          api
            .listPluginData(sessionId, pluginId, "message")
            .then((items) => {
              if (cancelled || items.length === 0) return;
              const changes = items.map((item) => ({
                namespace: item.namespace,
                key: item.key,
                value: item.value,
                operation: "set" as const,
              }));
              // The reducer mirror feeds json-render's persisted message
              // surface; StageView reads the fine-grained external store.
              // Hydrating only one of the two leaves stage-only consumers
              // blind to message UI data after a session restore.
              loadPluginData(
                pluginId,
                "message",
                items.map((item) => ({ key: item.key, value: item.value })),
              );
              dispatch({
                type: "PLUGIN_DATA_CHANGED",
                pluginId,
                changes,
              });
            })
            .catch(ignoreError("load plugin data for message ui spec"));
        }
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "LOAD_MESSAGE_UI_SPECS", specs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, dispatch]);
}
