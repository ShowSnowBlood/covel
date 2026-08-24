/**
 * SQLite boot DDL.
 *
 * Table + index DDL is DERIVED from the Drizzle schema (`./schema.ts`) — the
 * single source of truth — via {@link buildCreateTablesSql}. There is no longer
 * a hand-maintained copy of the column/index definitions here; editing a column
 * means editing the Drizzle table, and this DDL follows automatically.
 *
 * Only the two things Drizzle cannot model stay hand-written below, because they
 * are operational, not a second copy of the schema:
 *   - the `vector_models` table-name backfill trigger;
 *   - idempotent in-place column migrations for pre-existing databases.
 *
 * The schema↔DDL parity guard lives in `tests/schema-index-consistency.test.ts`
 * and `tests/schema-ddl-codegen.test.ts`.
 */

import type Database from "better-sqlite3";

import { buildCreateTablesSql } from "../common/ddl-codegen.js";
import * as schema from "./schema.js";

/**
 * `CREATE TABLE IF NOT EXISTS` + index DDL for every Drizzle table, generated
 * from the schema. Order follows the (deterministic) module-namespace key sort;
 * with zero foreign keys the order is not load-bearing.
 */
export const CREATE_TABLES_SQL = buildCreateTablesSql(
  Object.values(schema),
  "sqlite",
);

/**
 * Atomic `table_name` backfill: SQLite AFTER INSERT triggers see the generated
 * rowid via NEW.id. The UPDATE runs in the same implicit transaction as the
 * INSERT, so readers always see a populated row. Drizzle does not model
 * triggers, so this is hand-written and executed right after table creation.
 */
const VECTOR_MODELS_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS vector_models_fill_table_name
    AFTER INSERT ON vector_models
    FOR EACH ROW
    WHEN NEW.table_name = '' OR NEW.table_name IS NULL
  BEGIN
    UPDATE vector_models
       SET table_name = 'vec_mem_m' || NEW.id
     WHERE id = NEW.id;
  END;
`;

/**
 * Idempotent column migrations for databases created by an earlier schema.
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so newly-added
 * columns must be backfilled with `ALTER TABLE`. Each guard checks
 * `PRAGMA table_info` first so this is safe to run on every boot.
 */
function applySessionColumnMigrations(sqlite: Database.Database): void {
  const sessionCols = sqlite
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  const colNames = new Set(sessionCols.map((c) => c.name));
  if (!colNames.has("embedding_model_id")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN embedding_model_id INTEGER");
  }
  if (!colNames.has("embedding_locked_at")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN embedding_locked_at TEXT");
  }
  if (!colNames.has("runtime_model_overrides")) {
    sqlite.exec(
      "ALTER TABLE sessions ADD COLUMN runtime_model_overrides TEXT DEFAULT '{}'",
    );
  }
  if (!colNames.has("metadata")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN metadata TEXT");
  }
  // Scheduling-redesign lifecycle fields (all nullable; safe on legacy rows).
  if (!colNames.has("phase")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN phase TEXT");
  }
  if (!colNames.has("completed_player_turns")) {
    sqlite.exec(
      "ALTER TABLE sessions ADD COLUMN completed_player_turns INTEGER",
    );
  }
  if (!colNames.has("setup_runtimes")) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN setup_runtimes TEXT");
  }

  // Execution origin + recursive parent linkage on turn_results.
  const turnResultCols = sqlite
    .prepare("PRAGMA table_info(turn_results)")
    .all() as Array<{ name: string }>;
  const trColNames = new Set(turnResultCols.map((c) => c.name));
  if (!trColNames.has("origin")) {
    sqlite.exec("ALTER TABLE turn_results ADD COLUMN origin TEXT");
  }
  if (!trColNames.has("parent_turn_id")) {
    sqlite.exec("ALTER TABLE turn_results ADD COLUMN parent_turn_id TEXT");
  }
  if (!trColNames.has("commit_status")) {
    sqlite.exec("ALTER TABLE turn_results ADD COLUMN commit_status TEXT");
  }
}

const SESSION_SCOPED_IDENTITY_TABLES = [
  {
    name: "characters",
    ddl: buildCreateTablesSql([schema.characters], "sqlite"),
  },
  {
    name: "lorebook_entries",
    ddl: buildCreateTablesSql([schema.lorebookEntries], "sqlite"),
  },
] as const;

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Migrate legacy global-id primary keys to `(session_id, id)` without dropping
 * data. SQLite cannot alter a primary key in place, so both tables are rebuilt
 * inside one transaction; any failure restores the original tables intact.
 */
function applySessionScopedIdentityMigrations(sqlite: Database.Database): void {
  const pending = SESSION_SCOPED_IDENTITY_TABLES.filter(({ name }) => {
    const columns = sqlite
      .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
      .all() as Array<{ name: string; pk: number }>;
    const primaryKey = columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    return primaryKey.join("\0") !== "session_id\0id";
  });
  if (pending.length === 0) return;

  sqlite.transaction(() => {
    for (const { name, ddl } of pending) {
      const legacyName = `__covel_${name}_global_id`;
      sqlite.exec(
        `ALTER TABLE ${quoteIdentifier(name)} RENAME TO ${quoteIdentifier(legacyName)}`,
      );

      const legacyIndexes = sqlite
        .prepare(`PRAGMA index_list(${quoteIdentifier(legacyName)})`)
        .all() as Array<{ name: string; origin: string }>;
      for (const index of legacyIndexes) {
        if (index.origin === "c") {
          sqlite.exec(`DROP INDEX ${quoteIdentifier(index.name)}`);
        }
      }

      sqlite.exec(ddl);
      const columns = (
        sqlite
          .prepare(`PRAGMA table_info(${quoteIdentifier(legacyName)})`)
          .all() as Array<{ name: string }>
      ).map((column) => quoteIdentifier(column.name));
      const columnList = columns.join(", ");
      sqlite.exec(
        `INSERT INTO ${quoteIdentifier(name)} (${columnList}) ` +
          `SELECT ${columnList} FROM ${quoteIdentifier(legacyName)}`,
      );
      sqlite.exec(`DROP TABLE ${quoteIdentifier(legacyName)}`);
    }
  })();
}

export function createTables(sqlite: Database.Database): void {
  sqlite.exec(CREATE_TABLES_SQL);
  sqlite.exec(VECTOR_MODELS_TRIGGER_SQL);
  applySessionColumnMigrations(sqlite);
  applySessionScopedIdentityMigrations(sqlite);
}
