import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { errorBody } from "../api-error.js";
import { FrostFoxService, FrostFoxServiceError } from "../frostfox/service.js";

export const FROSTFOX_SESSION_COOKIE = "covel_frostfox_session";
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

  app.get("/api/frostfox/account", async (c) => {
    noStore(c);
    if (!service) return c.json({ enabled: false, authenticated: false });
    let principal = c.get("frostFoxPrincipal");
    if (principal) {
      try {
        principal = await service.refreshPrincipal(principal);
      } catch {
        // Account status remains useful during a transient Router outage.
      }
    }
    return c.json({
      enabled: true,
      authenticated: !!principal,
      clientId: service.runtimeConfig.clientId,
      routerBaseUrl: service.runtimeConfig.routerBaseUrl,
      ...(principal
        ? {
            account: {
              id: principal.routerAccountId,
              name: principal.accountName,
              balance: principal.balance,
              credentialState: principal.credentialState,
              lastVerifiedAt: principal.lastVerifiedAt,
            },
          }
        : {}),
    });
  });

  app.get("/auth/frostfox/start", async (c) => {
    noStore(c);
    if (!service) {
      return c.json(
        errorBody("FrostFox account connection is not enabled", {
          code: "frostfox_saas_disabled",
        }),
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
    noStore(c);
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
        currentSessionToken: getCookie(c, FROSTFOX_SESSION_COOKIE),
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
    noStore(c);
    if (!service) {
      return c.json(
        errorBody("FrostFox account connection is not enabled", {
          code: "frostfox_saas_disabled",
        }),
        404,
      );
    }
    const principal = c.get("frostFoxPrincipal");
    if (!principal) {
      return c.json(
        errorBody("FrostFox account connection required", {
          code: "frostfox_account_required",
        }),
        401,
      );
    }
    try {
      return c.json(await service.listModels(principal));
    } catch (error) {
      return serviceError(c, error);
    }
  });

  app.post("/api/frostfox/logout", async (c) => {
    noStore(c);
    if (service && !hasExpectedOrigin(c, service)) {
      return c.json(
        errorBody("Request origin is not allowed", {
          code: "frostfox_origin_invalid",
        }),
        403,
      );
    }
    deleteCookie(c, FROSTFOX_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ ok: true });
  });

  app.delete("/api/frostfox/account", async (c) => {
    noStore(c);
    if (!service) {
      return c.json(
        errorBody("FrostFox account connection is not enabled", {
          code: "frostfox_saas_disabled",
        }),
        404,
      );
    }
    if (!hasExpectedOrigin(c, service)) {
      return c.json(
        errorBody("Request origin is not allowed", {
          code: "frostfox_origin_invalid",
        }),
        403,
      );
    }
    const principal = c.get("frostFoxPrincipal");
    if (!principal) {
      return c.json(
        errorBody("FrostFox account connection required", {
          code: "frostfox_account_required",
        }),
        401,
      );
    }
    await service.unbind(principal);
    deleteCookie(c, FROSTFOX_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ ok: true });
  });

  return app;
}

function noStore(c: { header(name: string, value: string): void }): void {
  c.header("Cache-Control", "no-store, max-age=0");
  c.header("Pragma", "no-cache");
}

function hasExpectedOrigin(
  c: { req: { header(name: string): string | undefined } },
  service: FrostFoxService,
): boolean {
  const origin = c.req.header("origin");
  return origin === new URL(service.runtimeConfig.callbackUrl).origin;
}

function redirectWithResult(
  service: FrostFoxService,
  c: Parameters<typeof setCookie>[0],
  result: "connected" | "error",
  code?: string,
): Response {
  const target = new URL("/", service.runtimeConfig.callbackUrl);
  target.searchParams.set("frostfox", result);
  if (code) target.searchParams.set("code", code);
  return c.redirect(target.toString(), 302);
}

function serviceError(
  c: {
    json(
      body: ReturnType<typeof errorBody>,
      status: 400 | 401 | 409 | 502,
    ): Response;
  },
  error: unknown,
): Response {
  if (error instanceof FrostFoxServiceError) {
    const status =
      error.status === 400 ||
      error.status === 401 ||
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
