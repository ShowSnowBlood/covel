/**
 * Miscellaneous API routes — presets, packages, commands, llm-config, provider-keys.
 *
 * These endpoints are consumed by the frontend boot sequence.
 */

import { Hono } from "hono";
import { readEnvString, readRuntimeEnv } from "@covel/shared";
import {
  FrostFoxServiceError,
  type FrostFoxService,
} from "../frostfox/service.js";
import { errorBody } from "../api-error.js";
import { reloadAiStack, type AiStack } from "../ai-setup.js";
import {
  applySlotOverlay,
  publicPresetId,
  resolveOverlayPresetId,
  type SlotOverridesInput,
} from "@covel/ai-provider";
import type { PluginRegistry } from "@covel/plugin-loader";
import type { DataStore } from "@covel/store";
import { buildPackagesResponse } from "./misc-api/plugin-catalog.js";
import { buildPluginFlowResponse } from "./misc-api/plugin-flow.js";
import { bearerToken } from "./misc-api/shared.js";
import { buildUiSpecsResponse } from "./misc-api/ui-specs.js";
import {
  checkHostedOperator,
  checkSessionOwnerById,
  hasOperatorToken,
} from "./api/session/session-guard.js";
import {
  mergeManagedSlotDefaults,
  parseProviderKeys,
  parseSlotOverrides,
} from "../middleware/per-request-llm.js";

const PING_TOTAL_TIMEOUT_MS = 30_000;
const PING_STREAM_TIMEOUT_MS = 10_000;

export function createMiscApiRoutes(
  ai: AiStack,
  registry: PluginRegistry,
  store: DataStore,
  frostFox?: FrostFoxService | null,
  /** Startup provider keys for self/desktop model probes. */
  envApiKeys: Record<string, string> = {},
): Hono {
  const app = new Hono();

  // GET /api/presets — list configured model presets
  //
  // Each entry carries enough info for the settings UI to identify exactly
  // what a Ping would hit:
  //   - `baseUrl`: preset-level override, else the provider default
  //   - `protocol`: preset-level protocol, else the provider default
  //   - `slotBindings`: every slot id whose `presetId` resolves here — lets
  //     the UI show e.g. `default, fast` next to the preset so operators can
  //     tell which aliases share a single underlying model.
  app.get("/api/presets", (c) => {
    const slotMap = ai.slotRegistry.listSlots();
    const slotBindingsByPreset = new Map<string, string[]>();
    for (const [slotId, slot] of Object.entries(slotMap)) {
      const list = slotBindingsByPreset.get(slot.presetId) ?? [];
      list.push(slotId);
      slotBindingsByPreset.set(slot.presetId, list);
    }

    const presets = ai.presetRegistry.listPresets().map((p) => {
      // Fall back to the provider's registered default baseUrl/protocol
      // when the preset itself doesn't override them. `resolve` never
      // throws for a known provider; unknown providers return null here.
      let providerBaseUrl: string | undefined;
      let providerProtocol: string | undefined;
      try {
        const resolution = ai.providerRegistry.resolve({
          provider: p.provider,
        });
        providerBaseUrl = resolution.config.baseUrl;
        providerProtocol = resolution.protocol;
      } catch {
        // Unknown provider — leave both undefined; the UI will show "-"
      }

      return {
        id: p.id,
        name: p.name,
        provider: p.provider,
        model: p.model,
        enabled: p.enabled,
        isDefault: p.isDefault ?? false,
        scope: "global",
        baseUrl: p.baseUrl ?? providerBaseUrl,
        protocol: p.protocol ?? providerProtocol,
        ...(p.capability ? { capability: p.capability } : {}),
        slotBindings: slotBindingsByPreset.get(p.id) ?? [],
      };
    });
    return c.json(presets);
  });

  // GET /api/packages — list loaded plugin packages with runtime/tool info
  app.get("/api/packages", async (c) => {
    return c.json(await buildPackagesResponse(registry));
  });

  // GET /api/plugin-flows — framework-orchestrated flow data for pre-game preview
  app.get("/api/plugin-flows", async (c) => {
    const payload = await buildPluginFlowResponse();
    return c.json(payload);
  });

  // GET /api/ui-specs — list UI specs from plugin manifests, grouped by slot.
  // When ?sessionId= is provided, filter to that session's activePlugins so the
  // panel only shows plugins actually enabled for the current session.
  // (Audit Finding w2 — without this, RightPanel shows specs for plugins that
  // are loaded globally but not enabled for the active session.)
  app.get("/api/ui-specs", async (c) => {
    const sessionId = c.req.query("sessionId");
    // Owner guard: a session-scoped request both reads that
    // session's active-plugin set and synchronously (re)writes its
    // plugin_data UI-spec rows, so hosted tiers require the owner token, the
    // operator token, or the matching FrostFox account cookie BEFORE
    // buildUiSpecsResponse touches the store. No-op on self.
    // misc-api routes mount on the root app (no bootstrap middleware), so the
    // closure `store` is passed explicitly.
    if (sessionId) {
      const denied = await checkSessionOwnerById(c, store, sessionId);
      if (denied) return denied;
    }
    return c.json(
      await buildUiSpecsResponse({
        sessionId,
        registry,
        store,
      }),
    );
  });

  // GET /api/llm-config — return slot configuration with capability info
  app.get("/api/llm-config", (c) => {
    const slots = ai.slotRegistry.listSlots();
    const slotsInfo: Record<string, Record<string, unknown>> = {};

    for (const [slotId, slot] of Object.entries(slots)) {
      const preset = ai.presetRegistry
        .listPresets()
        .find((p) => p.id === slot.presetId);
      if (!preset) continue;
      const fallbackPresetId = preset.fallbackPresetIds?.[0];
      const fallbackSlotId =
        typeof fallbackPresetId === "string"
          ? fallbackPresetId.startsWith("slot-")
            ? fallbackPresetId.slice("slot-".length)
            : fallbackPresetId
          : undefined;
      slotsInfo[slotId] = {
        provider: preset.provider,
        model: preset.model,
        protocol: preset.protocol ?? "openai-chat-v1",
        tag: slot.tag,
        ...(fallbackSlotId ? { fallback: fallbackSlotId } : {}),
        ...(preset.capability ? { capability: preset.capability } : {}),
      };
    }

    return c.json({
      configured: Object.keys(slotsInfo).length > 0,
      slots: slotsInfo,
      providers: [
        ...new Set(ai.presetRegistry.listPresets().map((p) => p.provider)),
      ],
      // Present only when the last llm.toml load failed to parse and fell back
      // to the built-in default — lets the UI explain why slots are missing.
      ...(ai.lastLoadError ? { error: ai.lastLoadError } : {}),
    });
  });

  // POST /api/llm-config/reload — re-read llm.toml and apply it to the live
  // gateway in place (no restart). Mirrors the desktop write-endpoint auth:
  // when a desktop REST token is configured the request must carry it; dev/web
  // tiers (no token) stay open, matching the rest of misc-api. Always returns
  // 200 on a completed reload — the body's `ok` / `error` conveys whether the
  // file parsed (a broken file falls back to the default, reported via `error`).
  app.post("/api/llm-config/reload", (c) => {
    const denied = checkHostedOperator(c);
    if (denied) return denied;
    const env = readRuntimeEnv();
    if (env.desktopRestToken && bearerToken(c) !== env.desktopRestToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json(reloadAiStack(ai));
  });

  // GET /api/provider-keys — return server-configured API keys to desktop bearer clients only.
  app.get("/api/provider-keys", (c) => {
    // Which providers the deployment has configured — and the masked key
    // fragments below — are operator-only facts on hosted tiers. Strict no-op
    // on self/desktop, where the raw-key branch below is the real path.
    const denied = checkHostedOperator(c);
    if (denied) return denied;
    const KNOWN_PROVIDERS = [
      "DEEPSEEK",
      "DASHSCOPE",
      "OPENAI",
      "ANTHROPIC",
      "OPENROUTER",
    ] as const;

    const env = readRuntimeEnv();
    const allowRawKeys =
      !!env.desktopRestToken && bearerToken(c) === env.desktopRestToken;

    if (allowRawKeys) {
      const keys: Record<string, string> = {};
      for (const provider of KNOWN_PROVIDERS) {
        const envKey = `${provider}_API_KEY`;
        const value = readEnvString(envKey);
        if (value) keys[provider.toLowerCase()] = value;
      }
      return c.json({ keys });
    }

    // Non-T1 or non-localhost: return availability + masked metadata only
    const providers: Record<string, { configured: boolean; masked: string }> =
      {};
    for (const provider of KNOWN_PROVIDERS) {
      const envKey = `${provider}_API_KEY`;
      const value = readEnvString(envKey);
      if (value) {
        const masked =
          value.length > 8
            ? `${value.slice(0, 4)}...${value.slice(-4)}`
            : "****";
        providers[provider.toLowerCase()] = { configured: true, masked };
      }
    }
    return c.json({ keys: {}, providers });
  });

  // POST /api/ai/ping — real provider latency probe.
  //
  // Streams a minimal "hi" completion and records time-to-first-token
  // (TTFB) against the first non-empty `text-delta` or `reasoning-delta`
  // event (so "thinking" models are measured on their first reasoning
  // character, not the first visible text token).
  //
  // The stream is aborted shortly after the first content arrives to keep
  // the probe cheap — we only care about connectivity + latency, not the
  // full reply.
  app.post("/api/ai/ping", async (c) => {
    const operator = hasOperatorToken(c);
    const principal = c.get("frostFoxPrincipal");
    let frostFoxContext: Awaited<
      ReturnType<FrostFoxService["prepareAiContext"]>
    > = null;
    if (!operator && frostFox) {
      if (!principal) {
        return c.json(
          errorBody("FrostFox account connection required", {
            code: "frostfox_account_required",
          }),
          401,
        );
      }
      try {
        frostFoxContext = await frostFox.prepareAiContext(principal);
      } catch (error) {
        if (error instanceof FrostFoxServiceError) {
          return c.json(
            errorBody(error.code, { code: error.code }),
            error.status === 400 ? 400 : 401,
          );
        }
        throw error;
      }
    } else if (!operator) {
      const denied = checkHostedOperator(c);
      if (denied) return denied;
    }
    const body = await c.req
      .json<{ presetId?: string; slot?: string }>()
      .catch((): { presetId?: string; slot?: string } => ({}));
    const requested =
      body.presetId ?? (body.slot ? `slot-${body.slot}` : "slot-default");

    const canUseModelOverrides =
      !frostFox || operator || principal?.isAdmin === true;
    // Decode per-request API keys only for self-hosted/admin callers. A
    // hosted player must use the managed account credential and route.
    let apiKeys: Record<string, string> | undefined = canUseModelOverrides
      ? (parseProviderKeys(c.req.header("X-Provider-Keys")) ?? undefined)
      : undefined;
    if (frostFoxContext) {
      // The derived managed key wins over any browser-supplied value for the
      // reserved FrostFox provider ids.
      apiKeys = { ...(apiKeys ?? {}), ...frostFoxContext.apiKeys };
    }

    // Decode the client slot config header (base64 JSON). Shared with the
    // turn pipeline's per-request middleware — the ping endpoint needs its
    // own decode because ping can be called before the per-request
    // middleware runs (same request, but the resolution we do here happens
    // against the already-mutated registries).
    // Malformed header → behave as if no overrides were supplied.
    const browserSlotConfig = canUseModelOverrides
      ? parseSlotOverrides(c.req.header("X-Slot-Config"))
      : null;
    let sanitizedSlotConfig: SlotOverridesInput | null;
    try {
      sanitizedSlotConfig = frostFox
        ? frostFox.sanitizeSlotOverrides(
            browserSlotConfig,
            frostFoxContext !== null,
          )
        : browserSlotConfig;
    } catch (error) {
      if (error instanceof FrostFoxServiceError) {
        return c.json(
          errorBody(error.code, { code: error.code }),
          error.status === 400 ? 400 : 401,
        );
      }
      throw error;
    }
    const slotConfig =
      mergeManagedSlotDefaults(
        frostFoxContext?.managedSlotDefaults,
        sanitizedSlotConfig,
      ) ?? {};

    // Register client-declared custom presets via the shared overlay helper
    // (request-isolated scoped ids, ref-counted, base-registry-safe).
    const cleanupTransient = applySlotOverlay(ai, slotConfig);

    const allPresets = ai.presetRegistry.listPresets().filter((p) => p.enabled);

    // Overlay presets register under request-scoped ids — map a
    // public id through THIS request's own custom-preset declarations.
    const findPresetById = (id: string | undefined) => {
      const effective = resolveOverlayPresetId(id, slotConfig, (k) =>
        ai.presetRegistry.hasPreset(k),
      );
      return allPresets.find((p) => p.id === effective);
    };

    // `resolvedVia` is echoed back in `testedTarget` so the UI can warn
    // when a slot Ping silently fell through to a tag-fallback preset.
    type ResolvedVia = "managed" | "direct" | "slot" | "tag-fallback" | "any";
    let resolvedVia: ResolvedVia = "direct";
    let preset: (typeof allPresets)[number] | undefined;

    const managedPresetId =
      frostFoxContext?.managedModelPolicy?.presetIdsByTag.text;
    if (frostFoxContext?.managedModelPolicy) {
      // Hosted players cannot select a local or browser-declared model. The
      // gateway enforces the same policy for the actual request; selecting
      // it here keeps `testedTarget` honest in the response/UI.
      preset = findPresetById(managedPresetId);
      resolvedVia = "managed";
    } else {
      // `slot-<name>` is the browser's reserved slot request namespace. A
      // server preset can also happen to use that string as its id, but the
      // direct-preset branch must not win for slot requests.
      preset = requested.startsWith("slot-")
        ? undefined
        : findPresetById(requested);
      if (!preset && requested.startsWith("slot-")) {
        const slotName = requested.slice("slot-".length);
        const overrideId = slotConfig.slotPresetOverrides?.[slotName];
        if (overrideId) {
          preset = findPresetById(overrideId);
          if (preset) resolvedVia = "slot";
        }
        if (!preset) {
          const presetIdFromSlot = ai.slotRegistry.resolveSlot(slotName);
          if (presetIdFromSlot) {
            preset = allPresets.find((p) => p.id === presetIdFromSlot);
            if (preset) resolvedVia = "slot";
          }
        }
      }
      if (!preset) {
        preset = findPresetById(requested);
      }
      if (!preset) {
        const textSlots = ai.slotRegistry.listSlotsByTag("text");
        if (textSlots.length > 0) {
          preset = allPresets.find((p) => p.id === textSlots[0].presetId);
          if (preset) resolvedVia = "tag-fallback";
        }
      }
      if (!preset) {
        preset = allPresets[0];
        if (preset) resolvedVia = "any";
      }
    }

    if (!preset) {
      cleanupTransient();
      return c.json({
        ok: false,
        latencyMs: 0,
        error:
          "No LLM provider configured. Add a slot to llm.toml or via Settings.",
      });
    }

    // Resolve the effective baseUrl/protocol once so error + success paths
    // both report the exact target. Unknown providers can still ping via
    // the preset's own baseUrl, so treat resolution failure as non-fatal.
    let effectiveBaseUrl = preset.baseUrl;
    let effectiveProtocol: string | undefined = preset.protocol;
    try {
      const resolution = ai.providerRegistry.resolve({
        provider: preset.provider,
        baseUrl: preset.baseUrl,
        protocol: preset.protocol,
      });
      effectiveBaseUrl = resolution.config.baseUrl ?? preset.baseUrl;
      effectiveProtocol = resolution.protocol;
    } catch {
      // Provider not registered — fall back to preset fields as-is.
    }

    const testedTarget = {
      // Overlay presets carry internal scoped ids — echo the public form.
      presetId: publicPresetId(preset.id),
      provider: preset.provider,
      model: preset.model,
      baseUrl: effectiveBaseUrl,
      protocol: effectiveProtocol,
      resolvedVia,
    };

    // Keep the probe request identical across streaming and completion paths.
    // Some OpenAI-compatible gateways accept chat completions but return an
    // empty SSE stream; the completion fallback below still proves the model
    // is reachable without making the user retry manually.
    const pingInput = {
      presetId: preset.id,
      messages: [{ role: "user", content: "Reply with OK." }],
    };
    const pingSlotOverrides = {
      ...(slotConfig.slotPresetOverrides
        ? { slotPresetOverrides: slotConfig.slotPresetOverrides }
        : {}),
      ...(slotConfig.parameterOverrides
        ? { parameterOverrides: slotConfig.parameterOverrides }
        : {}),
    };
    const startedAt = Date.now();
    let ttfbMs: number | null = null;
    let firstText = "";
    let finalUsage: { inputTokens: number; outputTokens: number } | null = null;
    const abort = new AbortController();
    let aborted = false;
    let timedOut = false;
    let streamError: unknown = null;

    // Keep one total budget for both probes. A provider that accepts ordinary
    // completions but never produces SSE must not make the user wait 30s for
    // the stream and another 30s for the fallback.
    const deadline = startedAt + PING_TOTAL_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      if (!aborted) {
        timedOut = true;
        aborted = true;
        abort.abort();
      }
    }, PING_STREAM_TIMEOUT_MS);

    try {
      for await (const event of ai.gateway.streamText(pingInput, {
        apiKeys,
        envApiKeys,
        ...(frostFoxContext?.managedModelPolicy
          ? { managedModelPolicy: frostFoxContext.managedModelPolicy }
          : {}),
        allowProviderFallbackOnClientError: !!frostFoxContext,
        // Some OpenAI-compatible gateways reject an eight-token ceiling,
        // and reasoning-capable models may consume that entire allowance
        // before emitting visible text. The probe still aborts after eight
        // received characters, so a 64-token ceiling remains cheap while
        // leaving enough room for a standards-compliant proof of life.
        parameterOverrides: {
          maxOutputTokens: 64,
          reasoningEffort: "disabled",
        },
        signal: abort.signal,
        slotOverrides: pingSlotOverrides,
      })) {
        if (event.type === "text-delta" && event.textDelta.length > 0) {
          if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
          firstText += event.textDelta;
          // Stop once we have proof-of-life; keeps probe cheap (~1 token).
          if (firstText.length >= 8 && !aborted) {
            aborted = true;
            abort.abort();
          }
        } else if (
          event.type === "reasoning-delta" &&
          event.reasoningDelta.length > 0
        ) {
          if (ttfbMs === null) {
            ttfbMs = Date.now() - startedAt;
            // Reasoning is still provider output and is enough to prove the
            // connection. Stop immediately instead of waiting for a model that
            // may deliberately emit no visible text in a short probe.
            if (!aborted) {
              aborted = true;
              abort.abort();
            }
          }
        } else if (event.type === "done") {
          finalUsage = event.usage;
        }
      }
    } catch (err) {
      if (!aborted) streamError = err;
      // Deliberate abort — either a post-TTFB early-stop or our 30s timeout.
    }
    clearTimeout(timeout);

    // A few OpenAI-compatible gateways implement the ordinary completion
    // endpoint but produce no usable SSE content. Ping is a connectivity
    // check, not a streaming-capability check, so retry once through the
    // completion path before surfacing a no-content failure. The fallback is
    // included in the same overall deadline as the stream probe.
    const remainingMs = deadline - Date.now();
    const canTryCompletion =
      ttfbMs === null &&
      remainingMs > 0 &&
      (streamError === null ||
        timedOut ||
        isCompletionFallbackError(streamError));

    if (canTryCompletion && typeof ai.gateway.generateText === "function") {
      let completionTimedOut = false;
      const completionAbort = new AbortController();
      const completionTimeout = setTimeout(() => {
        completionTimedOut = true;
        completionAbort.abort();
      }, remainingMs);

      try {
        const result = await ai.gateway.generateText(pingInput, {
          apiKeys,
          envApiKeys,
          ...(frostFoxContext?.managedModelPolicy
            ? { managedModelPolicy: frostFoxContext.managedModelPolicy }
            : {}),
          parameterOverrides: {
            maxOutputTokens: 64,
            reasoningEffort: "disabled",
          },
          allowProviderFallbackOnClientError: !!frostFoxContext,
          signal: completionAbort.signal,
          slotOverrides: pingSlotOverrides,
        });
        if (completionTimedOut) {
          streamError = new Error(
            `Provider did not return any content within ${PING_TOTAL_TIMEOUT_MS / 1000}s`,
          );
        } else {
          const hasOutput =
            (typeof result.text === "string" &&
              result.text.trim().length > 0) ||
            (result.reasoningContent?.trim().length ?? 0) > 0 ||
            (result.toolCalls?.length ?? 0) > 0;
          if (hasOutput) {
            cleanupTransient();
            return c.json({
              ok: true,
              latencyMs: Date.now() - startedAt,
              text: `${preset.name} (${preset.provider}/${preset.model})`,
              usage: result.usage,
              testedTarget,
            });
          }
          streamError = new Error("Provider returned no content");
        }
      } catch (err) {
        streamError = completionTimedOut
          ? new Error(
              `Provider did not return any content within ${PING_TOTAL_TIMEOUT_MS / 1000}s`,
            )
          : err;
      } finally {
        clearTimeout(completionTimeout);
      }
    }

    cleanupTransient();
    const latencyMs = Date.now() - startedAt;
    if (ttfbMs === null) {
      const error =
        streamError instanceof Error && streamError.message
          ? streamError.message
          : streamError !== null
            ? String(streamError)
            : timedOut
              ? "Provider did not return any content within 30s"
              : "Provider returned no content";
      return c.json({
        ok: false,
        latencyMs,
        error,
        testedTarget,
      });
    }

    if (ttfbMs !== null && streamError !== null) {
      const error =
        streamError instanceof Error && streamError.message
          ? streamError.message
          : String(streamError);
      return c.json({
        ok: false,
        latencyMs,
        ttfbMs,
        error,
        testedTarget,
      });
    }

    return c.json({
      ok: true,
      latencyMs,
      ttfbMs,
      text: `${preset.name} (${preset.provider}/${preset.model})`,
      ...(finalUsage ? { usage: finalUsage } : {}),
      testedTarget,
    });
  });

  return app;
}

/**
 * A ping should validate provider reachability, not require streaming support.
 * Providers commonly return a useful completion while their SSE endpoint is
 * disabled or wrapped in an HTML/proxy response. Retry those failures through
 * the ordinary completion endpoint, but do not double-submit clear client
 * errors such as authentication, rate-limit, or configuration failures.
 */
function isCompletionFallbackError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !(
    /\bHTTP\s+4\d\d\b/i.test(message) ||
    /\b(401|403|404|408|409|422|429)\b/.test(message) ||
    /unauthori[sz]|forbidden|rate[-\s]?limit|invalid\s+(?:api\s*)?key|configuration|schema/i.test(
      message,
    )
  );
}
