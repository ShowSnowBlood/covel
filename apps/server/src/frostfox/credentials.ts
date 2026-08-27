import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import postgres from "postgres";

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS frostfox_login_transactions (
  token_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  verifier_ciphertext TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS frostfox_login_transactions_expires_idx
  ON frostfox_login_transactions(expires_at);
CREATE TABLE IF NOT EXISTS frostfox_account_bindings (
  local_user_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  router_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  balance REAL NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  account_key_ciphertext TEXT NOT NULL,
  credential_state TEXT NOT NULL,
  credential_generation_updated_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS frostfox_account_bindings_subject_uq
  ON frostfox_account_bindings(issuer, router_account_id);
CREATE TABLE IF NOT EXISTS frostfox_model_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schedule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS frostfox_account_progression (
  local_user_id TEXT PRIMARY KEY,
  completed_level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (local_user_id) REFERENCES frostfox_account_bindings(local_user_id) ON DELETE CASCADE
);
`;

const POSTGRES_DDL = `
CREATE TABLE IF NOT EXISTS frostfox_login_transactions (
  token_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  verifier_ciphertext TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS frostfox_login_transactions_expires_idx
  ON frostfox_login_transactions(expires_at);
CREATE TABLE IF NOT EXISTS frostfox_account_bindings (
  local_user_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  router_account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  balance DOUBLE PRECISION NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  account_key_ciphertext TEXT NOT NULL,
  credential_state TEXT NOT NULL,
  credential_generation_updated_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer, router_account_id)
);
CREATE TABLE IF NOT EXISTS frostfox_model_schedule (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schedule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS frostfox_account_progression (
  local_user_id TEXT PRIMARY KEY REFERENCES frostfox_account_bindings(local_user_id) ON DELETE CASCADE,
  completed_level INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`;

type FrostFoxCredentialState = "active" | "recovery_required";

interface FrostFoxLoginTransaction {
  readonly tokenHash: string;
  readonly state: string;
  readonly verifierCiphertext: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface FrostFoxBinding {
  readonly localUserId: string;
  readonly issuer: string;
  readonly routerAccountId: string;
  readonly accountName: string;
  readonly balance: number;
  readonly isAdmin: boolean;
  readonly accountKeyCiphertext: string;
  readonly credentialState: FrostFoxCredentialState;
  readonly credentialGenerationUpdatedAt: string;
  readonly lastVerifiedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FrostFoxModelScheduleEntry {
  readonly channelKey: string;
  readonly modelId: string;
}

export interface FrostFoxModelSchedule {
  readonly story: readonly FrostFoxModelScheduleEntry[];
  readonly updatedAt: string;
}

interface FrostFoxProgression {
  readonly localUserId: string;
  readonly completedLevel: number;
  readonly updatedAt: string;
}

export interface FrostFoxCredentialStore {
  createLoginTransaction(record: FrostFoxLoginTransaction): Promise<void>;
  consumeLoginTransaction(
    tokenHash: string,
    state: string,
    now: number,
  ): Promise<FrostFoxLoginTransaction | null>;
  getBindingBySubject(
    issuer: string,
    routerAccountId: string,
  ): Promise<FrostFoxBinding | null>;
  getBindingByLocalUserId(localUserId: string): Promise<FrostFoxBinding | null>;
  upsertBinding(record: FrostFoxBinding): Promise<FrostFoxBinding>;
  getModelSchedule(): Promise<FrostFoxModelSchedule | null>;
  setModelSchedule(
    story: readonly FrostFoxModelScheduleEntry[],
  ): Promise<FrostFoxModelSchedule>;
  getProgression(localUserId: string): Promise<FrostFoxProgression>;
  setCompletedLevel(
    localUserId: string,
    completedLevel: number,
  ): Promise<FrostFoxProgression>;
  deleteBinding(localUserId: string): Promise<void>;
  purgeExpiredTransactions(now: number): Promise<void>;
  close(): Promise<void>;
}

export interface FrostFoxStorageConfig {
  readonly storeBackend: "memory" | "sqlite" | "pg";
  readonly databaseUrl: string | undefined;
  readonly sqlitePath: string;
}

export async function createFrostFoxCredentialStore(
  env: FrostFoxStorageConfig,
): Promise<FrostFoxCredentialStore> {
  if (env.storeBackend === "memory") return createMemoryCredentialStore();
  if (env.storeBackend === "pg") {
    if (!env.databaseUrl) {
      throw new Error(
        "DATABASE_URL is required for FrostFox PostgreSQL storage",
      );
    }
    return createPostgresCredentialStore(env.databaseUrl);
  }
  return createSqliteCredentialStore(env.sqlitePath);
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deriveContextKey(rootKey: Uint8Array, context: string): Buffer {
  return createHmac("sha256", rootKey).update(context, "utf8").digest();
}

export function sealSecret(
  plaintext: string,
  masterKey: Uint8Array,
  associatedData: string,
): string {
  const dataKey = randomBytes(32);
  try {
    const wrappedKey = aesGcmEncrypt(
      masterKey,
      dataKey,
      `frostfox-envelope-key\n${associatedData}`,
    );
    const ciphertext = aesGcmEncrypt(
      dataKey,
      Buffer.from(plaintext, "utf8"),
      `frostfox-envelope-payload\n${associatedData}`,
    );
    return `ffev1.${wrappedKey.toString("base64url")}.${ciphertext.toString("base64url")}`;
  } finally {
    dataKey.fill(0);
  }
}

export function openSecret(
  sealed: string,
  masterKey: Uint8Array,
  associatedData: string,
): string {
  const [version, wrappedEncoded, ciphertextEncoded, extra] = sealed.split(".");
  if (version !== "ffev1" || !wrappedEncoded || !ciphertextEncoded || extra) {
    throw new Error("unsupported FrostFox credential envelope");
  }
  const dataKey = aesGcmDecrypt(
    masterKey,
    Buffer.from(wrappedEncoded, "base64url"),
    `frostfox-envelope-key\n${associatedData}`,
  );
  try {
    if (dataKey.length !== 32) throw new Error("invalid envelope data key");
    const plaintext = aesGcmDecrypt(
      dataKey,
      Buffer.from(ciphertextEncoded, "base64url"),
      `frostfox-envelope-payload\n${associatedData}`,
    );
    return plaintext.toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}

function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: string,
): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function aesGcmDecrypt(
  key: Uint8Array,
  packed: Uint8Array,
  associatedData: string,
): Buffer {
  if (packed.length < 29)
    throw new Error("invalid FrostFox credential envelope");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createMemoryCredentialStore(): FrostFoxCredentialStore {
  const transactions = new Map<string, FrostFoxLoginTransaction>();
  const bindings = new Map<string, FrostFoxBinding>();
  const progressions = new Map<string, FrostFoxProgression>();
  let modelSchedule: FrostFoxModelSchedule | null = null;

  return {
    async createLoginTransaction(record) {
      transactions.set(record.tokenHash, record);
    },
    async consumeLoginTransaction(tokenHash, state, now) {
      const record = transactions.get(tokenHash);
      if (!record || record.state !== state || record.expiresAt < now)
        return null;
      transactions.delete(tokenHash);
      return record;
    },
    async getBindingBySubject(issuer, routerAccountId) {
      return (
        [...bindings.values()].find(
          (binding) =>
            binding.issuer === issuer &&
            binding.routerAccountId === routerAccountId,
        ) ?? null
      );
    },
    async getBindingByLocalUserId(localUserId) {
      return bindings.get(localUserId) ?? null;
    },
    async upsertBinding(record) {
      const existing = [...bindings.values()].find(
        (binding) =>
          binding.issuer === record.issuer &&
          binding.routerAccountId === record.routerAccountId,
      );
      const next = existing
        ? {
            ...record,
            localUserId: existing.localUserId,
            createdAt: existing.createdAt,
          }
        : record;
      bindings.set(next.localUserId, next);
      return next;
    },
    async getModelSchedule() {
      return modelSchedule;
    },
    async setModelSchedule(story) {
      modelSchedule = {
        story: story.map((entry) => ({
          channelKey: entry.channelKey,
          modelId: entry.modelId,
        })),
        updatedAt: new Date().toISOString(),
      };
      return modelSchedule;
    },
    async getProgression(localUserId) {
      return (
        progressions.get(localUserId) ?? {
          localUserId,
          completedLevel: 0,
          updatedAt: "",
        }
      );
    },
    async setCompletedLevel(localUserId, completedLevel) {
      const existing = progressions.get(localUserId);
      const next: FrostFoxProgression = {
        localUserId,
        completedLevel: Math.max(
          existing?.completedLevel ?? 0,
          Math.max(0, Math.floor(completedLevel)),
        ),
        updatedAt: new Date().toISOString(),
      };
      progressions.set(localUserId, next);
      return next;
    },

    async deleteBinding(localUserId) {
      bindings.delete(localUserId);
      progressions.delete(localUserId);
    },
    async purgeExpiredTransactions(now) {
      for (const [key, record] of transactions) {
        if (record.expiresAt < now) transactions.delete(key);
      }
    },
    async close() {
      transactions.clear();
      bindings.clear();
      progressions.clear();
      modelSchedule = null;
    },
  };
}

function createSqliteCredentialStore(dbPath: string): FrostFoxCredentialStore {
  const parent = dirname(dbPath);
  if (parent && parent !== "." && dbPath !== ":memory:") {
    mkdirSync(parent, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(SQLITE_DDL);
  const bindingColumns = db.pragma(
    "table_info(frostfox_account_bindings)",
  ) as Array<{ name?: unknown }>;
  if (!bindingColumns.some((column) => column.name === "is_admin")) {
    db.exec(
      "ALTER TABLE frostfox_account_bindings ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    );
  }

  const scheduleById = db.prepare(
    "SELECT schedule_json, updated_at FROM frostfox_model_schedule WHERE id = 1",
  );
  const upsertSchedule = db.prepare(`
    INSERT INTO frostfox_model_schedule (id, schedule_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      schedule_json = excluded.schedule_json,
      updated_at = excluded.updated_at
    RETURNING schedule_json, updated_at
  `);

  const insertTransaction = db.prepare(`
    INSERT INTO frostfox_login_transactions
      (token_hash, state, verifier_ciphertext, expires_at, consumed_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `);
  const consumeTransaction = db.prepare(`
    UPDATE frostfox_login_transactions
    SET consumed_at = ?
    WHERE token_hash = ? AND state = ? AND consumed_at IS NULL AND expires_at >= ?
    RETURNING token_hash, state, verifier_ciphertext, expires_at, created_at
  `);
  const bindingBySubject = db.prepare(`
    SELECT * FROM frostfox_account_bindings
    WHERE issuer = ? AND router_account_id = ?
  `);
  const bindingByLocalUser = db.prepare(`
    SELECT * FROM frostfox_account_bindings WHERE local_user_id = ?
  `);
  const upsertBinding = db.prepare(`
    INSERT INTO frostfox_account_bindings (
      local_user_id, issuer, router_account_id, account_name, balance, is_admin,
      account_key_ciphertext, credential_state,
      credential_generation_updated_at, last_verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(issuer, router_account_id) DO UPDATE SET
      account_name = excluded.account_name,
      balance = excluded.balance,
      is_admin = excluded.is_admin,
      account_key_ciphertext = excluded.account_key_ciphertext,
      credential_state = excluded.credential_state,
      credential_generation_updated_at = excluded.credential_generation_updated_at,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at
    RETURNING *
  `);
  const progressionByLocalUser = db.prepare(`
    SELECT * FROM frostfox_account_progression WHERE local_user_id = ?
  `);
  const upsertProgression = db.prepare(`
    INSERT INTO frostfox_account_progression (local_user_id, completed_level, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(local_user_id) DO UPDATE SET
      completed_level = max(frostfox_account_progression.completed_level, excluded.completed_level),
      updated_at = excluded.updated_at
    RETURNING *
  `);

  const deleteBinding = db.prepare(
    "DELETE FROM frostfox_account_bindings WHERE local_user_id = ?",
  );
  const purgeTransactions = db.prepare(
    "DELETE FROM frostfox_login_transactions WHERE expires_at < ? OR consumed_at IS NOT NULL",
  );

  return {
    async createLoginTransaction(record) {
      insertTransaction.run(
        record.tokenHash,
        record.state,
        record.verifierCiphertext,
        record.expiresAt,
        record.createdAt,
      );
    },
    async consumeLoginTransaction(tokenHash, state, now) {
      const row = consumeTransaction.get(now, tokenHash, state, now);
      return row ? mapTransactionRow(row) : null;
    },
    async getBindingBySubject(issuer, routerAccountId) {
      const row = bindingBySubject.get(issuer, routerAccountId);
      return row ? mapBindingRow(row) : null;
    },
    async getBindingByLocalUserId(localUserId) {
      const row = bindingByLocalUser.get(localUserId);
      return row ? mapBindingRow(row) : null;
    },
    async upsertBinding(record) {
      const row = upsertBinding.get(...bindingParams(record));
      if (!row) throw new Error("failed to upsert FrostFox binding");
      return mapBindingRow(row);
    },
    async getModelSchedule() {
      const row = scheduleById.get();
      return row ? mapScheduleRow(row) : null;
    },
    async setModelSchedule(story) {
      const row = upsertSchedule.get(
        JSON.stringify({ story }),
        new Date().toISOString(),
      );
      if (!row) throw new Error("failed to upsert FrostFox model schedule");
      return mapScheduleRow(row);
    },
    async getProgression(localUserId) {
      const row = progressionByLocalUser.get(localUserId);
      return row
        ? mapProgressionRow(row)
        : { localUserId, completedLevel: 0, updatedAt: "" };
    },
    async setCompletedLevel(localUserId, completedLevel) {
      const row = upsertProgression.get(
        localUserId,
        Math.max(0, Math.floor(completedLevel)),
        new Date().toISOString(),
      );
      if (!row) throw new Error("failed to upsert FrostFox progression");
      return mapProgressionRow(row);
    },
    async deleteBinding(localUserId) {
      deleteBinding.run(localUserId);
    },
    async purgeExpiredTransactions(now) {
      purgeTransactions.run(now);
    },
    async close() {
      db.close();
    },
  };
}

async function createPostgresCredentialStore(
  databaseUrl: string,
): Promise<FrostFoxCredentialStore> {
  const sql = postgres(databaseUrl, { max: 2 });
  await sql.unsafe(POSTGRES_DDL);
  await sql.unsafe(
    "ALTER TABLE frostfox_account_bindings ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
  );

  return {
    async createLoginTransaction(record) {
      await sql.unsafe(
        `INSERT INTO frostfox_login_transactions
          (token_hash, state, verifier_ciphertext, expires_at, consumed_at, created_at)
         VALUES ($1, $2, $3, $4, NULL, $5)`,
        [
          record.tokenHash,
          record.state,
          record.verifierCiphertext,
          record.expiresAt,
          record.createdAt,
        ],
      );
    },
    async consumeLoginTransaction(tokenHash, state, now) {
      const rows = await sql.unsafe(
        `UPDATE frostfox_login_transactions
         SET consumed_at = $1
         WHERE token_hash = $2 AND state = $3
           AND consumed_at IS NULL AND expires_at >= $4
         RETURNING token_hash, state, verifier_ciphertext, expires_at, created_at`,
        [now, tokenHash, state, now],
      );
      return rows[0] ? mapTransactionRow(rows[0]) : null;
    },
    async getBindingBySubject(issuer, routerAccountId) {
      const rows = await sql.unsafe(
        `SELECT * FROM frostfox_account_bindings
         WHERE issuer = $1 AND router_account_id = $2`,
        [issuer, routerAccountId],
      );
      return rows[0] ? mapBindingRow(rows[0]) : null;
    },
    async getBindingByLocalUserId(localUserId) {
      const rows = await sql.unsafe(
        "SELECT * FROM frostfox_account_bindings WHERE local_user_id = $1",
        [localUserId],
      );
      return rows[0] ? mapBindingRow(rows[0]) : null;
    },
    async upsertBinding(record) {
      const rows = await sql.unsafe(
        `INSERT INTO frostfox_account_bindings (
           local_user_id, issuer, router_account_id, account_name, balance, is_admin,
           account_key_ciphertext, credential_state,
           credential_generation_updated_at, last_verified_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT(issuer, router_account_id) DO UPDATE SET
           account_name = excluded.account_name,
           balance = excluded.balance,
           is_admin = excluded.is_admin,
           account_key_ciphertext = excluded.account_key_ciphertext,
           credential_state = excluded.credential_state,
           credential_generation_updated_at = excluded.credential_generation_updated_at,
           last_verified_at = excluded.last_verified_at,
           updated_at = excluded.updated_at
         RETURNING *`,
        bindingParams(record),
      );
      if (!rows[0]) throw new Error("failed to upsert FrostFox binding");
      return mapBindingRow(rows[0]);
    },
    async getModelSchedule() {
      const rows = await sql.unsafe(
        "SELECT schedule_json, updated_at FROM frostfox_model_schedule WHERE id = 1",
      );
      return rows[0] ? mapScheduleRow(rows[0]) : null;
    },
    async setModelSchedule(story) {
      const rows = await sql.unsafe(
        `INSERT INTO frostfox_model_schedule (id, schedule_json, updated_at)
         VALUES (1, $1, $2)
         ON CONFLICT(id) DO UPDATE SET
           schedule_json = excluded.schedule_json,
           updated_at = excluded.updated_at
         RETURNING schedule_json, updated_at`,
        [JSON.stringify({ story }), new Date().toISOString()],
      );
      if (!rows[0]) throw new Error("failed to upsert FrostFox model schedule");
      return mapScheduleRow(rows[0]);
    },
    async getProgression(localUserId) {
      const rows = await sql.unsafe(
        "SELECT * FROM frostfox_account_progression WHERE local_user_id = $1",
        [localUserId],
      );
      return rows[0]
        ? mapProgressionRow(rows[0])
        : { localUserId, completedLevel: 0, updatedAt: "" };
    },
    async setCompletedLevel(localUserId, completedLevel) {
      const rows = await sql.unsafe(
        `INSERT INTO frostfox_account_progression (local_user_id, completed_level, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(local_user_id) DO UPDATE SET
           completed_level = greatest(frostfox_account_progression.completed_level, excluded.completed_level),
           updated_at = excluded.updated_at
         RETURNING *`,
        [
          localUserId,
          Math.max(0, Math.floor(completedLevel)),
          new Date().toISOString(),
        ],
      );
      if (!rows[0]) throw new Error("failed to upsert FrostFox progression");
      return mapProgressionRow(rows[0]);
    },

    async deleteBinding(localUserId) {
      await sql.unsafe(
        "DELETE FROM frostfox_account_bindings WHERE local_user_id = $1",
        [localUserId],
      );
    },
    async purgeExpiredTransactions(now) {
      await sql.unsafe(
        "DELETE FROM frostfox_login_transactions WHERE expires_at < $1 OR consumed_at IS NOT NULL",
        [now],
      );
    },
    async close() {
      await sql.end();
    },
  };
}

function bindingParams(record: FrostFoxBinding): Array<string | number> {
  return [
    record.localUserId,
    record.issuer,
    record.routerAccountId,
    record.accountName,
    record.balance,
    record.isAdmin ? 1 : 0,
    record.accountKeyCiphertext,
    record.credentialState,
    record.credentialGenerationUpdatedAt,
    record.lastVerifiedAt,
    record.createdAt,
    record.updatedAt,
  ];
}

function mapTransactionRow(row: unknown): FrostFoxLoginTransaction {
  const value = asRow(row);
  return {
    tokenHash: String(value.token_hash),
    state: String(value.state),
    verifierCiphertext: String(value.verifier_ciphertext),
    expiresAt: Number(value.expires_at),
    createdAt: Number(value.created_at),
  };
}

function mapBindingRow(row: unknown): FrostFoxBinding {
  const value = asRow(row);
  const state = String(value.credential_state);
  if (state !== "active" && state !== "recovery_required") {
    throw new Error("invalid FrostFox credential state in storage");
  }
  return {
    localUserId: String(value.local_user_id),
    issuer: String(value.issuer),
    routerAccountId: String(value.router_account_id),
    accountName: String(value.account_name),
    balance: Number(value.balance),
    isAdmin: readBoolean(value.is_admin),
    accountKeyCiphertext: String(value.account_key_ciphertext),
    credentialState: state,
    credentialGenerationUpdatedAt: String(
      value.credential_generation_updated_at,
    ),
    lastVerifiedAt: String(value.last_verified_at),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function mapScheduleRow(row: unknown): FrostFoxModelSchedule {
  const value = asRow(row);
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value.schedule_json));
  } catch {
    parsed = null;
  }
  const story =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { story?: unknown }).story
      : undefined;
  return {
    story: Array.isArray(story)
      ? story.filter(isScheduleEntry).map((entry) => ({
          channelKey: entry.channelKey,
          modelId: entry.modelId,
        }))
      : [],
    updatedAt: String(value.updated_at),
  };
}

function isScheduleEntry(value: unknown): value is FrostFoxModelScheduleEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.channelKey === "string" &&
    typeof entry.modelId === "string" &&
    entry.channelKey.length > 0 &&
    entry.modelId.length > 0
  );
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}
function mapProgressionRow(row: unknown): FrostFoxProgression {
  const value = asRow(row);
  return {
    localUserId: String(value.local_user_id),
    completedLevel: Number(value.completed_level),
    updatedAt: String(value.updated_at),
  };
}

function asRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid FrostFox storage row");
  }
  return value as Record<string, unknown>;
}
