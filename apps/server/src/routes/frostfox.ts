import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { errorBody } from "../api-error.js";
import { hasOperatorToken } from "./api/session/session-guard.js";
import {
  FrostFoxService,
  FrostFoxServiceError,
  type FrostFoxPrincipal,
} from "../frostfox/service.js";

const FROSTFOX_SESSION_COOKIE = "covel_frostfox_session";
const FROSTFOX_TRANSACTION_COOKIE = "covel_frostfox_login";

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

const TRANSACTION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/auth/frostfox",
} as const;

export function createFrostFoxPrincipalMiddleware(
  service: FrostFoxService | null,
): MiddlewareHandler {
  return async (c, next) => {
    const principal = service
      ? await service.resolvePrincipal(getCookie(c, FROSTFOX_SESSION_COOKIE))
      : null;
    c.set("frostFoxPrincipal", principal);
    await next();
  };
}

export function createFrostFoxRoutes(service: FrostFoxService | null): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    noStore(c);
    await next();
  });

  app.get("/api/frostfox/account", async (c) => {
    if (!service) return c.json({ enabled: false, authenticated: false });
    let principal = c.get("frostFoxPrincipal");
    if (principal) {
      try {
        principal = await service.refreshPrincipal(principal);
      } catch {
        // Account status remains useful during a transient Router outage.
      }
    }
    const operatorAuthorized = hasOperatorToken(c);
    return c.json({
      enabled: true,
      authenticated: !!principal,
      clientId: service.runtimeConfig.clientId,
      routerBaseUrl: service.runtimeConfig.routerBaseUrl,
      operatorAuthorized,
      canEditModels: Boolean(operatorAuthorized || principal?.isAdmin === true),
      ...(principal
        ? {
            account: {
              id: principal.routerAccountId,
              name: principal.accountName,
              balance: principal.balance,
              isAdmin: principal.isAdmin === true,
              credentialState: principal.credentialState,
              lastVerifiedAt: principal.lastVerifiedAt,
            },
          }
        : {}),
    });
  });

  app.get("/auth/frostfox/start", async (c) => {
    if (!service) {
      return frostFoxError(
        c,
        "FrostFox account connection is not enabled",
        "frostfox_saas_disabled",
        404,
      );
    }
    const start = await service.startAuthorization();
    setCookie(c, FROSTFOX_TRANSACTION_COOKIE, start.transactionToken, {
      ...TRANSACTION_COOKIE_OPTIONS,
      maxAge: start.maxAgeSeconds,
    });
    return c.redirect(start.redirectUrl, 302);
  });

  app.get("/auth/frostfox/callback", async (c) => {
    if (!service) return c.redirect("/?frostfox=disabled", 302);
    const url = new URL(c.req.url);
    const codeValues = url.searchParams.getAll("code");
    const stateValues = url.searchParams.getAll("state");
    const allowedKeys = new Set(["code", "state"]);
    const hasUnexpectedKey = [...url.searchParams.keys()].some(
      (key) => !allowedKeys.has(key),
    );
    const transactionToken = getCookie(c, FROSTFOX_TRANSACTION_COOKIE);
    deleteCookie(c, FROSTFOX_TRANSACTION_COOKIE, TRANSACTION_COOKIE_OPTIONS);
    if (
      hasUnexpectedKey ||
      codeValues.length !== 1 ||
      stateValues.length !== 1
    ) {
      return redirectWithResult(
        service,
        c,
        "error",
        "invalid_frostfox_callback",
      );
    }

    try {
      const result = await service.completeAuthorization({
        code: codeValues[0]!,
        state: stateValues[0]!,
        transactionToken,
      });
      setCookie(c, FROSTFOX_SESSION_COOKIE, result.sessionToken, {
        ...SESSION_COOKIE_OPTIONS,
        maxAge: result.maxAgeSeconds,
      });
      return redirectWithResult(service, c, "connected");
    } catch (error) {
      const code =
        error instanceof FrostFoxServiceError
          ? error.code
          : "frostfox_connection_failed";
      return redirectWithResult(service, c, "error", code);
    }
  });

  app.get("/api/frostfox/models", async (c) => {
    const access = requireFrostFoxAccount(c, service);
    if (!access.ok) return access.response;
    try {
      return c.json(await access.service.listModels(access.principal));
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.get("/api/frostfox/model-schedule", async (c) => {
    const access = requireFrostFoxAccount(c, service);
    if (!access.ok) return access.response;
    try {
      const schedule = await access.service.getModelSchedule(access.principal);
      return c.json({
        story: schedule?.story ?? [],
        updatedAt: schedule?.updatedAt ?? null,
        canEdit: hasOperatorToken(c) || access.principal.isAdmin === true,
      });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.put("/api/frostfox/model-schedule", async (c) => {
    const access = requireFrostFoxAccount(c, service, true);
    if (!access.ok) return access.response;
    const body: unknown = await c.req.json().catch(() => null);
    const story = readScheduleStory(body);
    if (!story) {
      return frostFoxError(
        c,
        "Model schedule is invalid",
        "frostfox_model_schedule_invalid",
        400,
      );
    }
    try {
      const schedule = await access.service.setModelSchedule(
        access.principal,
        story,
        { operatorAuthorized: hasOperatorToken(c) },
      );
      return c.json({ ...schedule, canEdit: true });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.get("/api/frostfox/runtime-policy", async (c) => {
    const access = requireFrostFoxPolicyAccess(c, service);
    if (!access.ok) return access.response;
    try {
      const record = await access.service.getRuntimePolicy();
      return c.json({
        policy: record?.policy ?? {},
        updatedAt: record?.updatedAt ?? null,
        canEdit:
          access.operatorAuthorized || access.principal?.isAdmin === true,
      });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.put("/api/frostfox/runtime-policy", async (c) => {
    const access = requireFrostFoxPolicyAccess(c, service, true);
    if (!access.ok) return access.response;
    const body: unknown = await c.req.json().catch(() => null);
    const policy =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { policy?: unknown }).policy
        : undefined;
    try {
      const record = await access.service.setRuntimePolicy(
        access.principal,
        policy,
        { operatorAuthorized: access.operatorAuthorized },
      );
      return c.json({ ...record, canEdit: true });
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.get("/api/frostfox/progression", async (c) => {
    const access = requireFrostFoxAccount(c, service);
    if (!access.ok) return access.response;
    try {
      return c.json(await access.service.getProgression(access.principal));
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.post("/api/frostfox/progression/complete", async (c) => {
    const access = requireFrostFoxAccount(c, service, true);
    if (!access.ok) return access.response;
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("worldId" in body) ||
      typeof body.worldId !== "string"
    ) {
      return frostFoxError(
        c,
        "worldId is required",
        "frostfox_level_input_invalid",
        400,
      );
    }
    const worldId = body.worldId;
    try {
      return c.json(
        await access.service.completeLevel(access.principal, worldId),
      );
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.post("/api/frostfox/logout", async (c) => {
    if (service && !hasExpectedOrigin(c, service)) {
      return frostFoxError(
        c,
        "Request origin is not allowed",
        "frostfox_origin_invalid",
        403,
      );
    }
    deleteCookie(c, FROSTFOX_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ ok: true });
  });

  app.delete("/api/frostfox/account", async (c) => {
    const access = requireFrostFoxAccount(c, service, true);
    if (!access.ok) return access.response;
    await access.service.unbind(access.principal);
    deleteCookie(c, FROSTFOX_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ ok: true });
  });

  return app;
}

type FrostFoxAccountAccess =
  | {
      readonly ok: true;
      readonly service: FrostFoxService;
      readonly principal: FrostFoxPrincipal;
    }
  | { readonly ok: false; readonly response: Response };

type FrostFoxPolicyAccess =
  | {
      readonly ok: true;
      readonly service: FrostFoxService;
      readonly principal: FrostFoxPrincipal | null;
      readonly operatorAuthorized: boolean;
    }
  | { readonly ok: false; readonly response: Response };

function requireFrostFoxAccount(
  c: Context,
  service: FrostFoxService | null,
  requireOrigin = false,
): FrostFoxAccountAccess {
  if (!service) {
    return {
      ok: false,
      response: frostFoxError(
        c,
        "FrostFox account connection is not enabled",
        "frostfox_saas_disabled",
        404,
      ),
    };
  }
  if (requireOrigin && !hasExpectedOrigin(c, service)) {
    return {
      ok: false,
      response: frostFoxError(
        c,
        "Request origin is not allowed",
        "frostfox_origin_invalid",
        403,
      ),
    };
  }
  const principal = c.get("frostFoxPrincipal");
  return principal
    ? { ok: true, service, principal }
    : {
        ok: false,
        response: frostFoxError(
          c,
          "FrostFox account connection required",
          "frostfox_account_required",
          401,
        ),
      };
}

function requireFrostFoxPolicyAccess(
  c: Context,
  service: FrostFoxService | null,
  requireOrigin = false,
): FrostFoxPolicyAccess {
  if (!service) {
    return {
      ok: false,
      response: frostFoxError(
        c,
        "FrostFox account connection is not enabled",
        "frostfox_saas_disabled",
        404,
      ),
    };
  }
  if (requireOrigin && !hasExpectedOrigin(c, service)) {
    return {
      ok: false,
      response: frostFoxError(
        c,
        "Request origin is not allowed",
        "frostfox_origin_invalid",
        403,
      ),
    };
  }
  const principal = c.get("frostFoxPrincipal");
  const operatorAuthorized = hasOperatorToken(c);
  if (!principal && !operatorAuthorized) {
    return {
      ok: false,
      response: frostFoxError(
        c,
        "FrostFox account connection or operator access required",
        "frostfox_account_required",
        401,
      ),
    };
  }
  return { ok: true, service, principal, operatorAuthorized };
}

function frostFoxError(
  c: Context,
  message: string,
  code: string,
  status: 400 | 401 | 403 | 404 | 409 | 502,
): Response {
  return c.json(errorBody(message, { code }), status);
}

function noStore(c: Context): void {
  c.header("Cache-Control", "no-store, max-age=0");
  c.header("Pragma", "no-cache");
  c.header("Vary", "Cookie");
}

function readScheduleStory(
  value: unknown,
): Array<{ channelKey: string; modelId: string }> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("story" in value) ||
    !Array.isArray(value.story) ||
    value.story.length > 8
  ) {
    return null;
  }
  const entries: Array<{ channelKey: string; modelId: string }> = [];
  for (const item of value.story) {
    if (
      item === null ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !("channelKey" in item) ||
      !("modelId" in item) ||
      typeof item.channelKey !== "string" ||
      typeof item.modelId !== "string"
    ) {
      return null;
    }
    entries.push({
      channelKey: item.channelKey,
      modelId: item.modelId,
    });
  }
  return entries;
}

function hasExpectedOrigin(c: Context, service: FrostFoxService): boolean {
  const origin = c.req.header("origin");
  return origin === new URL(service.runtimeConfig.callbackUrl).origin;
}

function redirectWithResult(
  service: FrostFoxService,
  c: Context,
  result: "connected" | "error",
  code?: string,
): Response {
  const target = new URL("/", service.runtimeConfig.callbackUrl);
  target.searchParams.set("frostfox", result);
  if (code) target.searchParams.set("code", code);
  return c.redirect(target.toString(), 302);
}

function serviceError(c: Context, error: unknown): Response {
  if (error instanceof FrostFoxServiceError) {
    const status =
      error.status === 400 ||
      error.status === 401 ||
      error.status === 403 ||
      error.status === 409 ||
      error.status === 502
        ? error.status
        : 502;
    return c.json(errorBody(error.code, { code: error.code }), status);
  }
  return c.json(
    errorBody("FrostFox request failed", { code: "frostfox_request_failed" }),
    502,
  );
}
