import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { FrostFoxPrincipal } from "../../src/frostfox/service.js";
import { createFrostFoxSessionRequirementMiddleware } from "../../src/middleware/frostfox-session-required.js";

const originalOperatorToken = process.env.COVEL_DESKTOP_REST_TOKEN;

const principal: FrostFoxPrincipal = {
  localUserId: "local-user-1",
  routerAccountId: "router-account-1",
  accountName: "Player One",
  balance: 42,
  credentialState: "active",
  lastVerifiedAt: "2026-08-25T00:00:00.000Z",
};

afterEach(() => {
  if (originalOperatorToken === undefined) {
    delete process.env.COVEL_DESKTOP_REST_TOKEN;
  } else {
    process.env.COVEL_DESKTOP_REST_TOKEN = originalOperatorToken;
  }
});

function createApp(
  frostFoxEnabled: boolean,
  currentPrincipal: FrostFoxPrincipal | null,
): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("frostFoxPrincipal", currentPrincipal);
    await next();
  });
  const requirement =
    createFrostFoxSessionRequirementMiddleware(frostFoxEnabled);
  app.use("/api/sessions", requirement);
  app.use("/api/sessions/*", requirement);
  app.get("/api/sessions", (c) => c.json({ ok: true }));
  app.get("/api/sessions/:id", (c) => c.json({ id: c.req.param("id") }));
  return app;
}

describe("FrostFox session requirement", () => {
  it("keeps local deployments available when FrostFox is disabled", async () => {
    const response = await createApp(false, null).request("/api/sessions");

    expect(response.status).toBe(200);
  });

  it("rejects anonymous collection and session requests when enabled", async () => {
    const app = createApp(true, null);

    for (const path of ["/api/sessions", "/api/sessions/session-1"]) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "frostfox_account_required",
      });
    }
  });

  it("allows a connected FrostFox account", async () => {
    const response = await createApp(true, principal).request(
      "/api/sessions/session-1",
    );

    expect(response.status).toBe(200);
  });

  it("allows the operator credential for administrative tooling", async () => {
    process.env.COVEL_DESKTOP_REST_TOKEN = "operator-secret";
    const response = await createApp(true, null).request("/api/sessions", {
      headers: { authorization: "Bearer operator-secret" },
    });

    expect(response.status).toBe(200);
  });
});
