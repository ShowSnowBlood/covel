import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  createFrostFoxCredentialStore,
  type FrostFoxCredentialStore,
  type FrostFoxBinding,
} from "../../src/frostfox/credentials.js";

const BASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://covel:covel_dev@localhost:5432/covel";
const TEST_DATABASE = "covel_test_frostfox_credentials";

async function createIsolatedDatabase(): Promise<string | null> {
  const admin = postgres(BASE_URL, { max: 1, connect_timeout: 3 });
  try {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`,
    );
    await admin.unsafe(`CREATE DATABASE "${TEST_DATABASE}"`);
    const url = new URL(BASE_URL);
    url.pathname = `/${TEST_DATABASE}`;
    return url.toString();
  } catch (error) {
    console.warn(
      `[frostfox-credentials-pg] PostgreSQL isolation unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  } finally {
    await admin.end();
  }
}

async function dropIsolatedDatabase(): Promise<void> {
  const admin = postgres(BASE_URL, { max: 1, connect_timeout: 3 });
  try {
    await admin.unsafe(
      `DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`,
    );
  } finally {
    await admin.end();
  }
}

let isolatedUrl: string | null = null;
let pgReachable = false;
try {
  const probe = postgres(BASE_URL, { max: 1, connect_timeout: 2 });
  await probe`SELECT 1`;
  await probe.end();
  pgReachable = true;
} catch {
  // Keep the suite deterministic on machines without PostgreSQL.
}
if (pgReachable) isolatedUrl = await createIsolatedDatabase();

describe.skipIf(isolatedUrl === null)("FrostFox PostgreSQL credentials", () => {
  let store: FrostFoxCredentialStore;

  beforeAll(async () => {
    store = await createFrostFoxCredentialStore({
      storeBackend: "pg",
      databaseUrl: isolatedUrl!,
      sqlitePath: ":memory:",
    });
  });

  afterAll(async () => {
    await store?.close();
    await dropIsolatedDatabase();
  });

  it("round-trips an administrator binding as true", async () => {
    const now = new Date().toISOString();
    const binding: FrostFoxBinding = {
      localUserId: "pg-admin-local",
      issuer: "https://market.example",
      routerAccountId: "pg-admin-account",
      accountName: "Admin",
      balance: 10,
      isAdmin: true,
      accountKeyCiphertext: "test-envelope",
      credentialState: "active",
      credentialGenerationUpdatedAt: now,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await expect(store.upsertBinding(binding)).resolves.toMatchObject({
      isAdmin: true,
    });
    await expect(
      store.getBindingByLocalUserId(binding.localUserId),
    ).resolves.toMatchObject({ isAdmin: true });
  });
});

if (isolatedUrl === null) {
  describe("FrostFox PostgreSQL credentials (skipped)", () => {
    it("skips when PostgreSQL is unavailable", () => {
      expect(true).toBe(true);
    });
  });
}
