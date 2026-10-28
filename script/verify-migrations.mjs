import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import pg from "pg";

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.INFRA_TEST_DATABASE_URL;
if (!adminUrl || !new URL(adminUrl).pathname.slice(1).endsWith("_infra_test")) {
  throw new Error("INFRA_TEST_DATABASE_URL debe apuntar a una base desechable cuyo nombre termine en _infra_test.");
}

const admin = new URL(adminUrl);
const databasePrefix = admin.pathname.slice(1);
const createdDatabases = [];

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function urlForDatabase(name) {
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;
  return databaseUrl.toString();
}

async function createDatabase(suffix) {
  const name = `${databasePrefix}_${suffix}_${randomBytes(3).toString("hex")}`;
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await client.end();
  }
  createdDatabases.push(name);
  return name;
}

async function connectDatabase(name) {
  const client = new Client({ connectionString: urlForDatabase(name) });
  await client.connect();
  return client;
}

function runMigrationCommand(database, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["script/db-migrate.mjs", command], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: urlForDatabase(database) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

let emptyDatabase;
let existingDatabase;
let currentDatabase;
let incompatibleDatabase;

before(async () => {
  emptyDatabase = await createDatabase("empty");
  existingDatabase = await createDatabase("existing");
  currentDatabase = await createDatabase("current");
  incompatibleDatabase = await createDatabase("incompatible");
});

after(async () => {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const database of createdDatabases) {
      await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [database]);
      await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
    }
  } finally {
    await client.end();
  }
});

test("migrate initializes an empty database once, including concurrent invocations", async () => {
  const [first, second] = await Promise.all([
    runMigrationCommand(emptyDatabase, "migrate"),
    runMigrationCommand(emptyDatabase, "migrate"),
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);

  const client = await connectDatabase(emptyDatabase);
  try {
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    assert.deepEqual(new Set(tables.rows.map((row) => row.tablename)), new Set([
      "opostest_schema_migrations", "questions", "results", "session", "test_attempts", "users",
    ]));

    const applied = await client.query("SELECT version, filename, checksum, applied_at FROM opostest_schema_migrations ORDER BY version");
    assert.equal(applied.rowCount, 2);
    assert.match(applied.rows[0].filename, /baseline\.sql$/);
    assert.equal(applied.rows[1].filename, "20261028_attempt_result_link.sql");
    assert.match(applied.rows[0].checksum, /^[a-f0-9]{64}$/);

    const attemptColumn = await client.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'results' AND column_name = 'attempt_id'",
    );
    assert.equal(attemptColumn.rows[0].is_nullable, "YES");

    const beforeRepeat = applied.rows.map((row) => row.applied_at.toISOString());
    const repeat = await runMigrationCommand(emptyDatabase, "migrate");
    assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
    const afterRepeat = await client.query("SELECT applied_at FROM opostest_schema_migrations ORDER BY version");
    assert.deepEqual(afterRepeat.rows.map((row) => row.applied_at.toISOString()), beforeRepeat);

    await client.query("UPDATE opostest_schema_migrations SET checksum = repeat('0', 64) WHERE version = $1", [applied.rows[0].version]);
    const tampered = await runMigrationCommand(emptyDatabase, "migrate");
    assert.notEqual(tampered.status, 0, "an altered migration checksum must stop the runner");
    assert.match(tampered.stderr + tampered.stdout, /checksum/i);
  } finally {
    await client.end();
  }
});

test("baseline adopts an existing pre-link schema and preserves legacy results", async () => {
  const client = await connectDatabase(existingDatabase);
  try {
    const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
    await client.query(baseline);
    await client.query(
      "INSERT INTO results (test_id, score, correct_count, total_questions, user_id) VALUES ('legacy-bank', 7, 7, 10, NULL)",
    );
  } finally {
    await client.end();
  }

  const unsafeMigration = await runMigrationCommand(existingDatabase, "migrate");
  assert.notEqual(unsafeMigration.status, 0, "untracked pre-existing tables must require explicit baseline");
  assert.match(unsafeMigration.stderr + unsafeMigration.stdout, /baseline/i);

  const baselineCommand = await runMigrationCommand(existingDatabase, "baseline");
  assert.equal(baselineCommand.status, 0, baselineCommand.stderr || baselineCommand.stdout);

  const migration = await runMigrationCommand(existingDatabase, "migrate");
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const adopted = await connectDatabase(existingDatabase);
  try {
    const rows = await adopted.query("SELECT test_id, attempt_id FROM results");
    assert.deepEqual(rows.rows, [{ test_id: "legacy-bank", attempt_id: null }]);
    const history = await adopted.query("SELECT version FROM opostest_schema_migrations ORDER BY version");
    assert.equal(history.rowCount, 2);
  } finally {
    await adopted.end();
  }
});

test("baseline recognizes a current db:push schema without replaying the result-link migration", async () => {
  const pushed = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push"], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: urlForDatabase(currentDatabase) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

  const client = await connectDatabase(currentDatabase);
  try {
    await client.query(
      "INSERT INTO results (test_id, score, correct_count, total_questions, user_id) VALUES ('current-install', 3, 3, 5, NULL)",
    );
  } finally {
    await client.end();
  }

  const baselineCommand = await runMigrationCommand(currentDatabase, "baseline");
  assert.equal(baselineCommand.status, 0, baselineCommand.stderr || baselineCommand.stdout);
  const migration = await runMigrationCommand(currentDatabase, "migrate");
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);

  const adopted = await connectDatabase(currentDatabase);
  try {
    const rows = await adopted.query("SELECT test_id, attempt_id FROM results");
    assert.deepEqual(rows.rows, [{ test_id: "current-install", attempt_id: null }]);
    const history = await adopted.query("SELECT filename FROM opostest_schema_migrations ORDER BY version");
    assert.deepEqual(history.rows.map((row) => row.filename), [
      "20261028_000_baseline.sql",
      "20261028_attempt_result_link.sql",
    ]);
  } finally {
    await adopted.end();
  }
});

test("baseline rejects an existing schema with incompatible column types without creating history", async () => {
  const client = await connectDatabase(incompatibleDatabase);
  try {
    const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
    await client.query(baseline);
    await client.query("ALTER TABLE results ALTER COLUMN score TYPE text USING score::text");
  } finally {
    await client.end();
  }

  const result = await runMigrationCommand(incompatibleDatabase, "baseline");
  assert.notEqual(result.status, 0, "baseline must not adopt incompatible column types");
  assert.match(result.stderr + result.stdout, /results\.score.*integer/i);

  const inspect = await connectDatabase(incompatibleDatabase);
  try {
    const history = await inspect.query("SELECT to_regclass('public.opostest_schema_migrations') AS history_table");
    assert.equal(history.rows[0].history_table, null, "a rejected baseline must leave no partial migration history");
  } finally {
    await inspect.end();
  }
});

test("baseline rejects misleading defaults, composite identity constraints, and an incorrect attempt foreign key", async (t) => {
  const baseline = await readFile(path.join(projectRoot, "migrations", "20261028_000_baseline.sql"), "utf8");
  const attemptLink = await readFile(path.join(projectRoot, "migrations", "20261028_attempt_result_link.sql"), "utf8");
  const cases = [
    {
      name: "a numeric default that only contains the expected zero",
      alter: "ALTER TABLE test_attempts ALTER COLUMN current_index SET DEFAULT 100",
      expected: /test_attempts\.current_index.*valor por defecto/i,
    },
    {
      name: "a composite primary key containing id",
      alter: "ALTER TABLE questions DROP CONSTRAINT questions_pkey; ALTER TABLE questions ADD PRIMARY KEY (id, test_id)",
      expected: /questions debe tener clave primaria id/i,
    },
    {
      name: "a composite username uniqueness constraint",
      alter: "ALTER TABLE users DROP CONSTRAINT users_username_unique; ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username, created_at)",
      expected: /users\.username debe ser único/i,
    },
    {
      name: "an attempt link referencing the wrong table",
      alter: "ALTER TABLE results DROP CONSTRAINT results_attempt_id_fkey; ALTER TABLE results ADD CONSTRAINT results_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES users(id) ON DELETE SET NULL",
      expected: /La base ya tiene results\.attempt_id.*FK ON DELETE SET NULL/i,
      withAttemptLink: true,
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    await t.test(scenario.name, async () => {
      const database = await createDatabase(`invalid_${index}`);
      const client = await connectDatabase(database);
      try {
        await client.query(baseline);
        if (scenario.withAttemptLink) await client.query(attemptLink);
        await client.query(scenario.alter);
      } finally {
        await client.end();
      }
      const result = await runMigrationCommand(database, "baseline");
      assert.notEqual(result.status, 0, "baseline must reject this incompatible schema");
      assert.match(result.stderr + result.stdout, scenario.expected);
      const inspect = await connectDatabase(database);
      try {
        const history = await inspect.query("SELECT to_regclass('public.opostest_schema_migrations') AS history_table");
        assert.equal(history.rows[0].history_table, null, "a rejected baseline must leave no partial migration history");
      } finally {
        await inspect.end();
      }
    });
  }
});
