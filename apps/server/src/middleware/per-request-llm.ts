/**
 * Per-request LLM adapter middleware.
 *
 * Parses the two request-scoped configuration headers sent by the
 * browser:
 *
 *   - `X-Provider-Keys`  base64 JSON  →  `{ [provider]: apiKey }`
 *   - `X-Slot-Config`    base64 JSON  →  `{ slotPresetOverrides?, parameterOverrides?, customPresets? }`
 *
 * and, when either is present, swaps `c.get('llmAdapter')` for a
 * request-scoped adapter that forwards these through the gateway. This
 * lets browser-only custom slots (e.g. `covel.fast`) participate in
 * real turn execution instead of silently falling back to the first
 * text slot configured in llm.toml.
 *
 * Keys are never written to disk or process memory beyond the scope of
 * a single request. API keys provided by the browser win over any
 * server-side environment keys so the UI can override per session.
 *
 * Env keys are passed to the gateway separately (`envApiKeys`) from the
 * browser-supplied keys (`apiKeys`): the provider registry only attaches
 * an env key when the resolved target's baseUrl origin matches trusted
 * server config, so a request-scoped custom preset that redirects a
 * built-in provider to a foreign origin can never exfiltrate a server
 * key.
 *
 * When neither header is present the middleware is a no-op and the
 * base-startup `llmAdapter` stays in place.
 */

import type { MiddlewareHandler } from "hono";
import {
  createGatewayAdapter,
  createPluginRuntimeGateway,
} from "@covel/runtime";
import type { AiStack } from "../ai-setup.js";
import type { SlotOverridesInput } from "@covel/ai-provider";
import {
  AiProviderError,
  PROVIDER_PROTOCOLS,
  REASONING_EFFORT_VALUES,
} from "@covel/ai-provider";
import type { PluginRuntimeGateway } from "@covel/plugin-loader";
import { decodeBase64Json } from "../lib/base64-json.js";
import {
  FrostFoxService,
  FrostFoxServiceError,
  type FrostFoxAiContext,
} from "../frostfox/service.js";
import { errorBody } from "../api-error.js";

export interface PerRequestLlmOptions {
  readonly ai: AiStack;
  /** Base API keys from process.env (*_API_KEY). Client keys override. */
  readonly envApiKeys: Record<string, string>;
  /**
   * The adapter produced at server startup. Used as a fallback when the
   * request has no overriding headers so callers can keep relying on
   * `c.get('llmAdapter')` without null checks.
   */
  readonly defaultLlmAdapter: import("@covel/runtime").LLMAdapter;
  /**
   * The plugin-runtime gateway facade produced at server startup. When the
   * request carries overriding headers the middleware rebuilds a request-
   * scoped facade so function-runtime `ctx.gateway.resolveSlot(...)` /
   * `generateText(...)` calls honour the same browser-supplied provider
   * keys / custom presets / slot overrides as the agent-runtime LLM
   * adapter. Without this rebuild the function-runtime path silently uses
   * the startup env keys and the server-side llm.toml, defeating
   * per-session UI settings.
   */
  readonly defaultPluginGateway: PluginRuntimeGateway;
  /** Trusted first-party account integration; absent on desktop/self-hosted tiers. */
  readonly frostFox?: FrostFoxService | null;
}

const MAX_HEADER_BYTES = 64 * 1024; // sanity cap — browsers rarely send bigger

export function createPerRequestLlmMiddleware(
  opts: PerRequestLlmOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const browserKeys = parseProviderKeys(c.req.header("X-Provider-Keys"));
    const parsedOverrides = parseSlotOverrides(c.req.header("X-Slot-Config"));
    let frostFoxContext: FrostFoxAiContext | null = null;
    if (opts.frostFox) {
      try {
        frostFoxContext = await opts.frostFox.prepareAiContext(
          c.get("frostFoxPrincipal"),
        );
      } catch (error) {
        if (error instanceof FrostFoxServiceError) {
          return c.json(
            errorBody(error.code, { code: error.code }),
            error.status === 400 ? 400 : 401,
          );
        }
        throw error;
      }
    }
    if (opts.frostFox && isFrostFoxAiRequest(c.req.path) && !frostFoxContext) {
      return c.json(
        errorBody("FrostFox account connection required", {
          code: "frostfox_account_required",
        }),
        401,
      );
    }
    let slotOverrides: SlotOverridesInput | null;
    try {
      const browserSlotOverrides = opts.frostFox
        ? opts.frostFox.sanitizeSlotOverrides(
            parsedOverrides,
            frostFoxContext !== null,
          )
        : parsedOverrides;
      slotOverrides = mergeManagedSlotDefaults(
        frostFoxContext?.managedSlotDefaults,
        browserSlotOverrides,
      );
    } catch (error) {
      if (error instanceof FrostFoxServiceError) {
        return c.json(errorBody(error.code, { code: error.code }), 400);
      }
      throw error;
    }
    // Managed credentials win for their reserved provider ids. Browser keys
    // can still supply every ordinary provider, but can never replace or
    // redirect the derived FrostFox Gateway key.
    const requestKeys = {
      ...(browserKeys ?? {}),
      ...(frostFoxContext?.apiKeys ?? {}),
    };

    const hasRequestKeys = Object.keys(requestKeys).length > 0;
    const hasOverrides =
      slotOverrides !== null &&
      ((slotOverrides.customPresets?.length ?? 0) > 0 ||
        Object.keys(slotOverrides.parameterOverrides ?? {}).length > 0 ||
        Object.keys(slotOverrides.slotPresetOverrides ?? {}).length > 0);

    if (!hasRequestKeys && !hasOverrides) {
      await next();
      return;
    }

    const perRequestAdapter = createGatewayAdapter(opts.ai.gateway, {
      apiKeys: requestKeys,
      envApiKeys: opts.envApiKeys,
      ...(slotOverrides ? { slotOverrides } : {}),
    });

    // Keep the function-runtime gateway in lock-step with the
    // agent-runtime LLM adapter. Both are rebuilt from the same merged
    // keys / slot overrides so `ctx.gateway.resolveSlot(...)` inside a
    // function handler resolves the same browser-declared custom presets.
    const perRequestPluginGateway = createPluginRuntimeGateway(
      opts.ai.gateway,
      {
        apiKeys: requestKeys,
        envApiKeys: opts.envApiKeys,
        ...(slotOverrides ? { slotOverrides } : {}),
      },
    );

    c.set("llmAdapter", perRequestAdapter);
    c.set("pluginGateway", perRequestPluginGateway);
    try {
      await next();
    } catch (error) {
      if (
        opts.frostFox &&
        frostFoxContext &&
        error instanceof AiProviderError &&
        error.statusCode === 401 &&
        error.provider.startsWith("frostfox-")
      ) {
        await opts.frostFox
          .handleGatewayUnauthorized(frostFoxContext.principal)
          .catch(() => undefined);
      }
      throw error;
    }
  };
}

export function mergeManagedSlotDefaults(
  defaults: SlotOverridesInput | undefined,
  overrides: SlotOverridesInput | null,
): SlotOverridesInput | null {
  if (!defaults) return overrides;
  if (!overrides) return defaults;

  const configuredDefaults = defaults.slotPresetOverrides ?? {};
  const explicitSlots = overrides.slotPresetOverrides ?? {};
  const replacementByDefault = new Map<string, string>();
  for (const [slotId, presetId] of Object.entries(explicitSlots)) {
    const defaultPresetId = configuredDefaults[slotId];
    if (defaultPresetId && !replacementByDefault.has(defaultPresetId)) {
      replacementByDefault.set(defaultPresetId, presetId);
    }
  }
  const defaultSlots = Object.fromEntries(
    Object.entries(configuredDefaults)
      .filter(([slotId]) => !Object.hasOwn(explicitSlots, slotId))
      .map(([slotId, presetId]) => [
        slotId,
        replacementByDefault.get(presetId) ?? presetId,
      ]),
  );
  const slotPresetOverrides = { ...defaultSlots, ...explicitSlots };
  const managedPresetIds = new Set(
    (defaults.customPresets ?? []).map((preset) => preset.id),
  );
  // Keep the trusted managed definition whenever any final slot points to it,
  // including an explicit browser binding to the same managed id. Dropping it
  // here would let a header reintroduce the preset without its image tag.
  const activeManagedPresetIds = new Set(
    Object.values(slotPresetOverrides).filter((presetId) =>
      managedPresetIds.has(presetId),
    ),
  );
  const customPresets = [
    ...(defaults.customPresets ?? []).filter((preset) =>
      activeManagedPresetIds.has(preset.id),
    ),
    ...(overrides.customPresets ?? []).filter(
      (preset) => !activeManagedPresetIds.has(preset.id),
    ),
  ];

  return {
    ...overrides,
    slotPresetOverrides,
    ...(customPresets.length > 0
      ? { customPresets }
      : { customPresets: undefined }),
  };
}

function parseProviderKeys(
  header: string | undefined,
): Record<string, string> | null {
  if (!header || header.length > MAX_HEADER_BYTES) return null;
  const parsed = decodeBase64Json(header);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) result[k] = v;
  }
  return result;
}

function parseSlotOverrides(
  header: string | undefined,
): SlotOverridesInput | null {
  if (!header || header.length > MAX_HEADER_BYTES) return null;
  // Defensive try/catch: untrusted browser input parsed across many branches.
  try {
    const parsed = decodeBase64Json(header);
    if (!parsed || typeof parsed !== "object") return null;
    const out: SlotOverridesInput = {};
    const slotMap = (parsed as Record<string, unknown>).slotPresetOverrides;
    if (slotMap && typeof slotMap === "object" && !Array.isArray(slotMap)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(slotMap as Record<string, unknown>)) {
        if (typeof k === "string" && typeof v === "string" && v.length > 0) {
          clean[k] = v;
        }
      }
      if (Object.keys(clean).length > 0) out.slotPresetOverrides = clean;
    }
    const paramMap =
      (parsed as Record<string, unknown>).parameterOverrides ??
      (parsed as Record<string, unknown>).paramOverrides;
    if (paramMap && typeof paramMap === "object" && !Array.isArray(paramMap)) {
      const clean: NonNullable<SlotOverridesInput["parameterOverrides"]> = {};
      for (const [slotId, raw] of Object.entries(
        paramMap as Record<string, unknown>,
      )) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const source = raw as Record<string, unknown>;
        const next: Record<string, number | string> = {};
        for (const key of [
          "temperature",
          "topP",
          "topK",
          "maxOutputTokens",
          "frequencyPenalty",
          "presencePenalty",
        ] as const) {
          const value = source[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            next[key] = value;
          }
        }
        const reasoningEffort = source.reasoningEffort;
        if (
          typeof reasoningEffort === "string" &&
          (REASONING_EFFORT_VALUES as readonly string[]).includes(
            reasoningEffort,
          )
        ) {
          next.reasoningEffort = reasoningEffort;
        }
        if (Object.keys(next).length > 0) {
          clean[slotId] = next as NonNullable<
            SlotOverridesInput["parameterOverrides"]
          >[string];
        }
      }
      if (Object.keys(clean).length > 0) out.parameterOverrides = clean;
    }
    const customPresets = (parsed as Record<string, unknown>).customPresets;
    if (Array.isArray(customPresets)) {
      const clean: SlotOverridesInput["customPresets"] = [];
      for (const raw of customPresets) {
        if (!raw || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        if (
          typeof r.id === "string" &&
          r.id.length > 0 &&
          typeof r.provider === "string" &&
          r.provider.length > 0 &&
          typeof r.model === "string" &&
          r.model.length > 0
        ) {
          clean.push({
            id: r.id,
            name: typeof r.name === "string" ? r.name : r.id,
            provider: r.provider,
            model: r.model,
            ...(typeof r.baseUrl === "string" ? { baseUrl: r.baseUrl } : {}),
            ...(typeof r.protocol === "string" &&
            (PROVIDER_PROTOCOLS as readonly string[]).includes(r.protocol)
              ? {
                  protocol:
                    r.protocol as SlotOverridesInput["customPresets"] extends Array<
                      infer T
                    >
                      ? T extends { protocol?: infer P }
                        ? P
                        : never
                      : never,
                }
              : {}),
            ...(typeof r.tag === "string" &&
            r.tag.trim().length > 0 &&
            r.tag.trim().length <= 64
              ? { tag: r.tag.trim() }
              : {}),
          });
        }
      }
      if (clean.length > 0) out.customPresets = clean;
    }
    return out;
  } catch {
    return null;
  }
}
function isFrostFoxAiRequest(path: string): boolean {
  return (
    path === "/api/actions" ||
    path.startsWith("/api/ai/") ||
    path.startsWith("/api/kernel/") ||
    /^\/api\/sessions\/[^/]+\/(resume|plugin-rpc)(?:\/|$)/.test(path)
  );
}
