import type { Context, MiddlewareHandler } from "hono";
import { readRuntimeEnv } from "@covel/shared";
import { errorBody } from "../api-error.js";

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

/**
 * Per-launch bearer token gate for desktop-controlled filesystem APIs.
 */
export function makeDesktopRestTokenGuard(): MiddlewareHandler {
  return async (c: Context, next) => {
    const env = readRuntimeEnv();
    if (isFrostFoxAdministrator(c, env)) return next();
    const expected = env.desktopRestToken;
    if (!expected) return next();
    const provided = bearerToken(c);
    if (!provided || provided !== expected) {
      return c.json(
        errorBody("Desktop REST token missing or invalid", {
          code: "desktop_rest_token_invalid",
        }),
        401,
      );
    }
    return next();
  };
}

/**
 * Install endpoints write plugin/world packages to local disk.
 *
 * Desktop sidecars use the same bearer token as config writes. Production
 * self-host deployments require either that token or an explicit operator
 * opt-in through COVEL_INSTALL_API_ENABLED=1.
 */
export function makeInstallApiGuard(): MiddlewareHandler {
  return async (c: Context, next) => {
    const env = readRuntimeEnv();
    if (isFrostFoxAdministrator(c, env)) return next();
    if (env.desktopRestToken) {
      const provided = bearerToken(c);
      if (!provided || provided !== env.desktopRestToken) {
        return c.json(
          errorBody("Desktop REST token missing or invalid", {
            code: "desktop_rest_token_invalid",
          }),
          401,
        );
      }
      return next();
    }

    if (env.nodeEnv === "production" && !env.installApiEnabled) {
      return c.json(
        errorBody("Install API is disabled in production", {
          code: "install_api_disabled",
        }),
        403,
      );
    }

    return next();
  };
}

function isFrostFoxAdministrator(
  c: Context,
  env: ReturnType<typeof readRuntimeEnv>,
): boolean {
  if (env.deploymentTier !== "commercial" || !env.frostFoxSaasEnabled) {
    return false;
  }
  const principal = c.get("frostFoxPrincipal") as
    { isAdmin?: unknown } | null | undefined;
  return principal?.isAdmin === true;
}
