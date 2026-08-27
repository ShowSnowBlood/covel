import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type {
  FrostFoxPrincipal,
  FrostFoxService,
} from "../../src/frostfox/service.js";
import { FrostFoxServiceError } from "../../src/frostfox/service.js";
import { createFrostFoxRoutes } from "../../src/routes/frostfox.js";

const runtimeConfig = {
  clientId: "covel",
  routerBaseUrl: "https://market.example",
  callbackUrl: "https://covel.example/auth/frostfox/callback",
};

const player: FrostFoxPrincipal = {
  localUserId: "player-local",
  routerAccountId: "player-account",
  accountName: "Player",
  balance: 10,
  isAdmin: false,
  credentialState: "active",
  lastVerifiedAt: "2026-08-27T00:00:00.000Z",
};

const admin: FrostFoxPrincipal = {
  ...player,
  localUserId: "admin-local",
  routerAccountId: "admin-account",
  accountName: "Admin",
  isAdmin: true,
};

function createApp(principal: FrostFoxPrincipal | null) {
  const service = {
    runtimeConfig,
    refreshPrincipal: vi.fn(async (value: FrostFoxPrincipal) => value),
    completeAuthorization: vi.fn(async () => ({
      principal: player,
      sessionToken: "new-session-token",
      maxAgeSeconds: 3600,
    })),
    getModelSchedule: vi.fn(async () => ({
      story: [{ channelKey: "story", modelId: "primary" }],
      updatedAt: "2026-08-27T00:00:00.000Z",
    })),
    setModelSchedule: vi.fn(async (value: FrostFoxPrincipal) => {
      if (!value.isAdmin) {
        throw new FrostFoxServiceError("frostfox_admin_required", 403);
      }
      return {
        story: [{ channelKey: "story", modelId: "primary" }],
        updatedAt: "2026-08-27T00:00:00.000Z",
      };
    }),
  } as unknown as FrostFoxService;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("frostFoxPrincipal", principal);
    await next();
  });
  app.route("/", createFrostFoxRoutes(service));
  return { app, service };
}

describe("FrostFox auth session routes", () => {
  it("replaces a stale session cookie after account authorization", async () => {
    const { app, service } = createApp(player);
    const state = "a".repeat(43);
    const response = await app.request(
      `/auth/frostfox/callback?code=ffac_account_b&state=${state}`,
      {
        headers: {
          cookie:
            "covel_frostfox_login=transaction; covel_frostfox_session=old-session",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(service.completeAuthorization).toHaveBeenCalledWith({
      code: "ffac_account_b",
      state,
      transactionToken: "transaction",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "covel_frostfox_session=new-session-token",
    );
  });

  it("clears the session cookie on logout", async () => {
    const { app } = createApp(player);
    const response = await app.request("/api/frostfox/logout", {
      method: "POST",
      headers: {
        origin: "https://covel.example",
        cookie: "covel_frostfox_session=old-session",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /covel_frostfox_session=; Max-Age=0; Path=\//,
    );
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});

describe("FrostFox model schedule routes", () => {
  it("exposes the schedule to players without granting edit access", async () => {
    const { app } = createApp(player);
    const response = await app.request("/api/frostfox/model-schedule");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      canEdit: false,
      story: [{ channelKey: "story", modelId: "primary" }],
    });
  });

  it("returns the service authorization error for a player write", async () => {
    const { app, service } = createApp(player);
    const response = await app.request("/api/frostfox/model-schedule", {
      method: "PUT",
      headers: {
        origin: runtimeConfig.callbackUrl.replace(
          "/auth/frostfox/callback",
          "",
        ),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        story: [{ channelKey: "story", modelId: "primary" }],
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "frostfox_admin_required",
    });
    expect(service.setModelSchedule).toHaveBeenCalledTimes(1);
  });

  it("allows an administrator to save a valid schedule", async () => {
    const { app, service } = createApp(admin);
    const response = await app.request("/api/frostfox/model-schedule", {
      method: "PUT",
      headers: {
        origin: "https://covel.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        story: [{ channelKey: "story", modelId: "primary" }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ canEdit: true });
    expect(service.setModelSchedule).toHaveBeenCalledWith(admin, [
      { channelKey: "story", modelId: "primary" },
    ]);
  });
});
