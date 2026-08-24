import type { MiddlewareHandler } from "hono";
import { errorBody } from "../api-error.js";
import { hasOperatorToken } from "../routes/api/session/session-guard.js";

/**
 * Require a live first-party account on every session endpoint when the
 * FrostFox integration is enabled. The operator token remains available for
 * deployment probes and administrative tooling; local/self-hosted installs
 * without FrostFox keep their existing token-free behavior.
 */
export function createFrostFoxSessionRequirementMiddleware(
  frostFoxEnabled: boolean,
): MiddlewareHandler {
  return async (c, next) => {
    if (
      !frostFoxEnabled ||
      c.get("frostFoxPrincipal") !== null ||
      hasOperatorToken(c)
    ) {
      await next();
      return;
    }

    return c.json(
      errorBody("FrostFox account connection required", {
        code: "frostfox_account_required",
      }),
      401,
    );
  };
}
